#!/usr/bin/env bun
/**
 * evaluate.js — Multi-model editorial evaluation for SNI Research Tool
 *
 * Sends the finished draft (post self-review) to GPT-5.2 and Gemini Pro 3.1.
 * Each model independently scores 5 editorial categories on a 1–5 scale
 * and provides a publish-readiness judgement.
 * Results are aggregated into a consensus view with feedback classification.
 *
 * Usage:
 *   bun scripts/evaluate.js --draft output/draft-week-9.md
 *   bun scripts/evaluate.js --draft output/draft-week-9.md --review output/review-week-9.json
 *   bun scripts/evaluate.js --draft output/draft-week-9.md --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callBothModels, availableProviders } from './lib/multi-model.js';
import { loadPrompt, renderPrompt } from './lib/prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const SCORE_CRITERIA = [
  'factual_integrity',
  'completeness',
  'editorial_quality',
  'link_integrity',
  'structural_compliance',
];

// ─── Prohibited language list (for feedback classification) ──────────────────

const BANNED_WORDS = [
  'landscape', 'realm', 'spearheading', 'game-changer', 'game-changing',
  'paradigm shift', 'ecosystem', 'synergy', 'leverage', 'utilize', 'utilise',
  'cutting-edge', 'state-of-the-art', 'best-in-class', 'world-class',
  'next-generation', 'revolutionize', 'revolutionise', 'disrupt', 'transform',
  'harness', 'unlock', 'empower', 'enable', 'drive', 'robust', 'seamless',
  'holistic', 'innovative', 'groundbreaking', 'pioneering', 'trailblazing',
  'streamline', 'delve', 'stakeholder',
];

const BANNED_PHRASES = [
  'double down', 'lean in', 'move the needle', 'boil the ocean', 'deep dive',
  'circle back', 'low-hanging fruit', 'at the end of the day', 'going forward',
  'in terms of', 'it goes without saying', 'needless to say',
  'it remains to be seen', "it's worth noting", "it's important to note",
  'interestingly', 'notably', 'significantly', 'crucially', 'essentially',
  'fundamentally', 'ultimately',
];

const BANNED_INTENSIFIERS = [
  'incredibly', 'extremely', 'truly', 'absolutely', 'fundamentally',
  'highly', 'deeply', 'vastly',
];

const ALL_BANNED = [...BANNED_WORDS, ...BANNED_PHRASES, ...BANNED_INTENSIFIERS];

// ─── Response parsing ────────────────────────────────────────────────────────

/**
 * Parse and validate an evaluation response from a model.
 * Matches the new 5-category schema from evaluate.md v2.
 * Returns normalised evaluation or null if parsing fails.
 */
function parseEvaluation(parsed, providerName) {
  // The new format has top-level category keys, not a nested .scores object
  // Accept either shape: { factual_integrity: { score, ... } } or { scores: { ... } }
  const hasTopLevel = SCORE_CRITERIA.some(c => parsed?.[c]?.score !== undefined);
  const source = hasTopLevel ? parsed : parsed;

  // Validate we have at least some scores
  const foundCriteria = SCORE_CRITERIA.filter(c => source?.[c]?.score !== undefined);
  if (foundCriteria.length === 0) {
    warn(`${providerName}: no recognisable score categories in response`);
    return null;
  }

  // Normalise scores — clamp to 1–5, default missing to 0
  const scores = {};
  for (const criterion of SCORE_CRITERIA) {
    const entry = source[criterion];
    if (entry && typeof entry.score === 'number') {
      scores[criterion] = {
        score: Math.max(1, Math.min(5, Math.round(entry.score))),
        ...extractCategoryDetail(criterion, entry),
      };
    } else {
      scores[criterion] = { score: 0, feedback: 'Not evaluated' };
    }
  }

  // Overall score — use provided or calculate average
  const validScores = Object.values(scores).filter(s => s.score > 0).map(s => s.score);
  const calculatedAvg = validScores.length > 0
    ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1))
    : 0;

  const overallScore = (typeof parsed.overall_score === 'number' && parsed.overall_score >= 1 && parsed.overall_score <= 5)
    ? parsed.overall_score
    : calculatedAvg;

  // Publish readiness
  const publishReady = typeof parsed.publish_ready === 'boolean'
    ? parsed.publish_ready
    : overallScore >= 4;

  return {
    scores,
    overall_score: overallScore,
    publish_ready: publishReady,
    publish_ready_reason: parsed.publish_ready_reason || '',
    top_changes: Array.isArray(parsed.top_changes) ? parsed.top_changes.slice(0, 5) : [],
  };
}

/**
 * Extract category-specific detail fields from a parsed evaluation entry.
 */
function extractCategoryDetail(criterion, entry) {
  const detail = {};
  switch (criterion) {
    case 'factual_integrity':
      detail.issues = Array.isArray(entry.issues) ? entry.issues : [];
      break;
    case 'completeness':
      detail.missing_stories = Array.isArray(entry.missing_stories) ? entry.missing_stories : [];
      detail.underserved_sectors = Array.isArray(entry.underserved_sectors) ? entry.underserved_sectors : [];
      break;
    case 'editorial_quality':
      detail.theme_assessment = entry.theme_assessment || '';
      detail.prose_issues = Array.isArray(entry.prose_issues) ? entry.prose_issues : [];
      break;
    case 'link_integrity':
      detail.issues = Array.isArray(entry.issues) ? entry.issues : [];
      break;
    case 'structural_compliance':
      detail.issues = Array.isArray(entry.issues) ? entry.issues : [];
      break;
  }
  return detail;
}

// ─── Feedback classification ─────────────────────────────────────────────────

/**
 * Classify a feedback item according to the editorial brief decision logic.
 *
 * @param {object} item — a top_change or issue item
 * @param {string} category — which evaluation category produced this
 * @param {boolean} modelAgreement — true if 2+ models flagged this issue
 * @returns {'auto_accept' | 'accept_if_agreed' | 'flag_for_human' | 'auto_reject'}
 */
function classifyFeedback(item, category, modelAgreement) {
  const text = [
    item.suggested || '',
    item.current || '',
    item.suggestion || '',
    item.reason || '',
  ].join(' ').toLowerCase();

  // Auto-reject: introduces prohibited language or adds unverified claims
  for (const banned of ALL_BANNED) {
    if (text.includes(banned.toLowerCase()) && !(item.current || '').toLowerCase().includes(banned.toLowerCase())) {
      // The suggestion introduces a banned term not present in the original
      return 'auto_reject';
    }
  }
  if (text.includes('unverified') && text.includes('add')) return 'auto_reject';

  // Auto-accept: factual corrections, missing significant stories, claims exceeding source
  if (category === 'factual_integrity') return 'auto_accept';
  if (category === 'completeness' && item.significance) return 'auto_accept';

  // Accept if models agree on structural/editorial/prose issues
  if (modelAgreement && ['editorial_quality', 'structural_compliance', 'link_integrity'].includes(category)) {
    return 'accept_if_agreed';
  }

  // Flag for human: models disagree, or item changes editorial angle/interpretation
  if (!modelAgreement) return 'flag_for_human';
  if (text.includes('angle') || text.includes('interpretation') || text.includes('judgement') || text.includes('tone')) {
    return 'flag_for_human';
  }

  // Default: accept if agreed, flag otherwise
  return modelAgreement ? 'accept_if_agreed' : 'flag_for_human';
}

// ─── Consensus builder ──────────────────────────────────────────────────────

/**
 * Build a consensus view from two evaluations.
 * Identifies agreement, divergence, publish readiness and classifies feedback.
 */
function buildConsensus(evaluations) {
  const valid = evaluations.filter(e => e !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    const classified = (valid[0].top_changes || []).map(item => ({
      ...item,
      classification: classifyFeedback(item, 'editorial_quality', false),
    }));
    return {
      average_score: valid[0].overall_score,
      criterion_averages: Object.fromEntries(
        SCORE_CRITERIA.map(c => [c, valid[0].scores[c].score])
      ),
      publish_ready: valid[0].publish_ready,
      top_changes: classified,
      divergent_views: [],
      evaluator_count: 1,
    };
  }

  // Average scores per criterion
  const criterionAverages = {};
  const divergent = [];

  for (const criterion of SCORE_CRITERIA) {
    const scores = valid.map(e => e.scores[criterion].score).filter(s => s > 0);
    if (scores.length === 0) {
      criterionAverages[criterion] = 0;
      continue;
    }
    const avg = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
    criterionAverages[criterion] = avg;

    // Flag divergence (>= 2 point gap)
    if (scores.length >= 2) {
      const gap = Math.abs(scores[0] - scores[1]);
      if (gap >= 2) {
        divergent.push({
          criterion,
          scores: valid.map((e, i) => ({
            provider: i === 0 ? 'gpt' : 'gemini',
            score: e.scores[criterion].score,
          })),
          gap,
        });
      }
    }
  }

  // Average overall score
  const overallScores = valid.map(e => e.overall_score).filter(s => s > 0);
  const averageScore = overallScores.length > 0
    ? parseFloat((overallScores.reduce((a, b) => a + b, 0) / overallScores.length).toFixed(1))
    : 0;

  // Publish readiness — both must agree for true
  const publishReady = valid.every(e => e.publish_ready);

  // Merge top_changes with keyword overlap and classify each
  const allChanges = valid.flatMap(e => e.top_changes || []);
  const mergedChanges = mergeChanges(allChanges);
  const classifiedChanges = mergedChanges.map(item => ({
    ...item,
    classification: classifyFeedback(item, item._category || 'editorial_quality', item._agreed || false),
  }));
  // Clean internal fields
  for (const c of classifiedChanges) {
    delete c._category;
    delete c._agreed;
  }

  return {
    average_score: averageScore,
    criterion_averages: criterionAverages,
    publish_ready: publishReady,
    top_changes: classifiedChanges,
    divergent_views: divergent,
    evaluator_count: valid.length,
  };
}

/**
 * Merge top_changes from multiple evaluations.
 * Items with keyword overlap are merged (marked as agreed).
 * Unique items are kept with agreed=false.
 */
function mergeChanges(allChanges) {
  if (allChanges.length === 0) return [];

  const merged = [];
  const used = new Set();

  for (let i = 0; i < allChanges.length; i++) {
    if (used.has(i)) continue;
    const item = allChanges[i];
    const itemWords = extractKeywords(item);
    let agreed = false;

    for (let j = i + 1; j < allChanges.length; j++) {
      if (used.has(j)) continue;
      const other = allChanges[j];
      const otherWords = extractKeywords(other);
      const shared = itemWords.filter(w => otherWords.includes(w));
      if (shared.length >= 2) {
        agreed = true;
        used.add(j);
      }
    }

    merged.push({ ...item, _agreed: agreed });
    used.add(i);
  }

  return merged;
}

/**
 * Extract significant keywords from a change item for overlap detection.
 */
function extractKeywords(item) {
  const text = [item.location || '', item.current || '', item.suggested || '', item.reason || ''].join(' ');
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 4);
}

/**
 * Find items with keyword overlap across lists.
 * Used as fallback when no exact string matches exist.
 */
function findOverlapping(lists) {
  if (lists.length < 2) return lists[0] || [];

  const keywords0 = new Set(lists[0].flatMap(s => s.toLowerCase().split(/\s+/).filter(w => w.length > 4)));
  const overlapping = [];

  for (const item of lists[1]) {
    const words = item.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const shared = words.filter(w => keywords0.has(w));
    if (shared.length >= 2) {
      overlapping.push(item);
    }
  }

  return overlapping.length > 0 ? overlapping : [];
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Run multi-model editorial evaluation on a draft.
 *
 * @param {object} args
 * @param {string} args.draft — path to draft markdown file
 * @param {string} [args.review] — path to self-review JSON (auto-detected if omitted)
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{ evaluatePath: string, stats: object }>}
 */
export async function runEvaluate(args = {}) {
  const startTime = Date.now();

  if (!args.draft || !existsSync(args.draft)) {
    throw new Error(`Draft file not found: ${args.draft}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Multi-Model Evaluation');
  console.log(`  Draft: ${args.draft}`);
  if (args.dryRun) console.log('  DRY RUN — no API calls');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Check provider availability
  const providers = availableProviders();
  if (!providers.openai && !providers.gemini) {
    warn('No multi-model API keys configured. Skipping evaluation.');
    return {
      evaluatePath: null,
      stats: { openaiScore: 0, geminiScore: 0, consensusScore: 0, publishReady: false, errors: ['No API keys'] },
    };
  }
  log(`Providers: OpenAI=${providers.openai ? 'yes' : 'no'}, Gemini=${providers.gemini ? 'yes' : 'no'}`);

  // Read draft
  log(`Reading draft: ${args.draft}`);
  const draftText = readFileSync(args.draft, 'utf8');

  // Read self-review if available
  let reviewText = 'No self-review available.';
  const reviewPath = args.review || findReviewPath(args.draft);
  if (reviewPath && existsSync(reviewPath)) {
    log(`Reading self-review: ${reviewPath}`);
    const reviewData = JSON.parse(readFileSync(reviewPath, 'utf8'));
    reviewText = formatReviewForPrompt(reviewData);
  } else {
    warn('No self-review found — evaluating draft without review context');
  }

  if (args.dryRun) {
    ok('Dry run — would call GPT-5.2 and Gemini Pro 3.1');
    return {
      evaluatePath: null,
      stats: { openaiScore: 0, geminiScore: 0, consensusScore: 0, publishReady: false, dryRun: true, errors: [] },
    };
  }

  // Build prompt
  const { template } = loadPrompt('evaluate');
  const prompt = renderPrompt(template, {
    draft: draftText,
    self_review: reviewText,
  });

  // Call both models
  log('Calling GPT-5.2 and Gemini Pro 3.1 in parallel...');
  const results = await callBothModels(prompt);

  const stats = {
    openaiScore: 0,
    geminiScore: 0,
    consensusScore: 0,
    publishReady: false,
    errors: [],
  };

  // Parse evaluations
  let openaiEval = null;
  let geminiEval = null;

  if (results.openai.parsed) {
    openaiEval = parseEvaluation(results.openai.parsed, 'GPT-5.2');
    if (openaiEval) {
      stats.openaiScore = openaiEval.overall_score;
      ok(`GPT-5.2: ${openaiEval.overall_score}/5 | publish_ready: ${openaiEval.publish_ready}`);
    } else {
      stats.errors.push('OpenAI: failed to parse evaluation');
      warn('GPT-5.2: response parsed but evaluation invalid');
    }
  } else {
    stats.errors.push(`OpenAI: ${results.openai.error}`);
    warn(`GPT-5.2 failed: ${results.openai.error}`);
  }

  if (results.gemini.parsed) {
    geminiEval = parseEvaluation(results.gemini.parsed, 'Gemini-Pro-3.1');
    if (geminiEval) {
      stats.geminiScore = geminiEval.overall_score;
      ok(`Gemini Pro 3.1: ${geminiEval.overall_score}/5 | publish_ready: ${geminiEval.publish_ready}`);
    } else {
      stats.errors.push('Gemini: failed to parse evaluation');
      warn('Gemini Pro 3.1: response parsed but evaluation invalid');
    }
  } else {
    stats.errors.push(`Gemini: ${results.gemini.error}`);
    warn(`Gemini Pro 3.1 failed: ${results.gemini.error}`);
  }

  // Build consensus
  const consensus = buildConsensus([openaiEval, geminiEval]);
  if (consensus) {
    stats.consensusScore = consensus.average_score;
    stats.publishReady = consensus.publish_ready;
  }

  // Determine week number from draft filename
  const weekMatch = args.draft.match(/week-(\d+)/i);
  const weekNum = weekMatch ? weekMatch[1] : 'unknown';

  // Load Claude self-review for the combined output
  let claudeReview = null;
  if (reviewPath && existsSync(reviewPath)) {
    try {
      const reviewData = JSON.parse(readFileSync(reviewPath, 'utf8'));
      claudeReview = {
        overall_pass: reviewData.overall_pass,
        issue_count: (reviewData.prohibited_found?.length || 0) +
                     (reviewData.structural_issues?.length || 0) +
                     (reviewData.formatting_issues?.length || 0) +
                     (reviewData.link_issues?.length || 0) +
                     (reviewData.unsupported_claims?.length || 0) +
                     (reviewData.missing_sectors?.length || 0),
        issues: {
          prohibited: reviewData.prohibited_found || [],
          structural: reviewData.structural_issues || [],
          formatting: reviewData.formatting_issues || [],
          links: reviewData.link_issues || [],
          unsupported: reviewData.unsupported_claims || [],
          missing_sectors: reviewData.missing_sectors || [],
        },
      };
    } catch { /* review parse failed — ok */ }
  }

  // Build aggregated output
  const evaluation = {
    claude_review: claudeReview,
    gpt_evaluation: openaiEval,
    gemini_evaluation: geminiEval,
    consensus,
    evaluated_at: new Date().toISOString(),
    models_used: [
      openaiEval ? results.openai.model : null,
      geminiEval ? results.gemini.model : null,
    ].filter(Boolean),
    draft_path: args.draft,
  };

  // Save
  const outputDir = join(ROOT, 'output');
  const evaluatePath = join(outputDir, `evaluate-week-${weekNum}.json`);
  try {
    writeFileSync(evaluatePath, JSON.stringify(evaluation, null, 2), 'utf8');
    ok(`Evaluation saved to ${evaluatePath}`);
  } catch (err) {
    warn(`Failed to save evaluation: ${err.message}`);
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Evaluation Complete');
  console.log(`  Time: ${elapsed}s`);
  console.log('');
  console.log('  SCORES (1-5)');
  console.log('  ────────────');
  for (const c of SCORE_CRITERIA) {
    const gpt = openaiEval?.scores[c]?.score || '–';
    const gem = geminiEval?.scores[c]?.score || '–';
    const avg = consensus?.criterion_averages[c] || '–';
    const label = c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).padEnd(24);
    console.log(`  ${label} ${avg}  (GPT: ${gpt}, Gemini: ${gem})`);
  }
  console.log('');
  if (openaiEval) {
    console.log(`  GPT-5.2 overall:      ${openaiEval.overall_score}/5  publish_ready: ${openaiEval.publish_ready}`);
  }
  if (geminiEval) {
    console.log(`  Gemini Pro 3.1:       ${geminiEval.overall_score}/5  publish_ready: ${geminiEval.publish_ready}`);
  }
  if (consensus) {
    console.log(`  Consensus:            ${consensus.average_score}/5  publish_ready: ${consensus.publish_ready}`);
    if (consensus.divergent_views.length > 0) {
      console.log(`  Divergent criteria:   ${consensus.divergent_views.map(d => d.criterion).join(', ')}`);
    }
    if (consensus.top_changes.length > 0) {
      console.log('');
      console.log('  FEEDBACK CLASSIFICATION');
      console.log('  ──────────────────────');
      const counts = { auto_accept: 0, accept_if_agreed: 0, flag_for_human: 0, auto_reject: 0 };
      for (const c of consensus.top_changes) counts[c.classification]++;
      if (counts.auto_accept > 0) console.log(`  Auto-accept:      ${counts.auto_accept}`);
      if (counts.accept_if_agreed > 0) console.log(`  Accept if agreed: ${counts.accept_if_agreed}`);
      if (counts.flag_for_human > 0) console.log(`  Flag for human:   ${counts.flag_for_human}`);
      if (counts.auto_reject > 0) console.log(`  Auto-reject:      ${counts.auto_reject}`);
    }
  }
  if (stats.errors.length > 0) {
    console.log(`  Errors: ${stats.errors.join('; ')}`);
  }
  console.log('');
  console.log(`  Saved: ${evaluatePath}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  return { evaluatePath, stats };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Auto-detect review path from draft path.
 * draft-week-9.md → review-week-9.json
 */
function findReviewPath(draftPath) {
  const weekMatch = draftPath.match(/week-(\d+)/i);
  if (!weekMatch) return null;
  return join(ROOT, 'output', `review-week-${weekMatch[1]}.json`);
}

/**
 * Format self-review data into readable text for the prompt.
 */
function formatReviewForPrompt(reviewData) {
  const lines = [];

  lines.push(`Overall pass: ${reviewData.overall_pass ? 'YES' : 'NO'}`);
  lines.push(`Word count: ${reviewData.word_count || 'unknown'}`);

  if (reviewData.prohibited_found?.length > 0) {
    lines.push(`\nProhibited language found (${reviewData.prohibited_found.length}):`);
    for (const item of reviewData.prohibited_found) {
      lines.push(`  - ${item.term || item.issue || JSON.stringify(item)}`);
    }
  }

  if (reviewData.structural_issues?.length > 0) {
    lines.push(`\nStructural issues (${reviewData.structural_issues.length}):`);
    for (const item of reviewData.structural_issues) {
      lines.push(`  - ${item.issue} (${item.location || 'unknown'})`);
    }
  }

  if (reviewData.formatting_issues?.length > 0) {
    lines.push(`\nFormatting issues (${reviewData.formatting_issues.length}):`);
    for (const item of reviewData.formatting_issues) {
      lines.push(`  - ${item.issue} (${item.location || 'unknown'})`);
    }
  }

  if (reviewData.unsupported_claims?.length > 0) {
    lines.push(`\nUnsupported claims (${reviewData.unsupported_claims.length}):`);
    for (const item of reviewData.unsupported_claims) {
      lines.push(`  - ${item.claim || item.issue || JSON.stringify(item)}`);
    }
  }

  if (reviewData.missing_sectors?.length > 0) {
    lines.push(`\nMissing sectors: ${reviewData.missing_sectors.join(', ')}`);
  }

  return lines.join('\n');
}

// ─── Exports for testing ────────────────────────────────────────────────────

export { parseEvaluation, buildConsensus, classifyFeedback, SCORE_CRITERIA };

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.warn(`[unhandledRejection] ${reason}`);
  });

  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--draft')   { args.draft = argv[++i]; continue; }
    if (argv[i] === '--review')  { args.review = argv[++i]; continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
  }

  if (!args.draft) {
    console.error('Usage: bun scripts/evaluate.js --draft <path> [--review <path>] [--dry-run]');
    process.exit(1);
  }

  runEvaluate(args)
    .then(({ stats }) => {
      log(`Result: gpt=${stats.openaiScore} gemini=${stats.geminiScore} consensus=${stats.consensusScore} publish_ready=${stats.publishReady}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
