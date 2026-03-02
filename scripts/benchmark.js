#!/usr/bin/env bun
/**
 * benchmark.js — Comparative benchmark for SNI Research Tool
 *
 * Compares a pipeline-generated draft against a published reference newsletter
 * to measure how close the automated output is to publication quality.
 *
 * Runs deterministic metrics (story overlap, word count, structure, prohibited
 * language) and LLM comparative evaluation (GPT-5.2 + Gemini Pro 3.1).
 *
 * Usage:
 *   bun scripts/benchmark.js --draft output/draft-week-9.md --reference output/published/week-9.md
 *   bun scripts/benchmark.js --draft output/draft-week-9.md --reference output/published/week-9.md --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { callBothModels, availableProviders } from './lib/multi-model.js';
import { loadPrompt, renderPrompt } from './lib/prompt.js';
import { compileBannedPatterns } from './lib/prohibited.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// ─── Prohibited language ─────────────────────────────────────────────────────

const COMPILED_BANNED = compileBannedPatterns();

// ─── Deterministic metrics ───────────────────────────────────────────────────

/**
 * Extract all markdown links [text](url) from a document.
 * Normalise URLs by stripping trailing slashes, query params and anchors.
 */
function extractUrls(markdown) {
  const matches = [...markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];
  return matches.map(m => ({
    text: m[1],
    url: m[2].replace(/[?#].*$/, '').replace(/\/+$/, ''),
  }));
}

/**
 * Calculate story overlap between published and draft.
 */
function measureStoryOverlap(publishedMd, draftMd) {
  const pubUrls = new Set(extractUrls(publishedMd).map(l => l.url));
  const draftUrls = new Set(extractUrls(draftMd).map(l => l.url));

  const shared = [...pubUrls].filter(u => draftUrls.has(u));
  const publishedOnly = [...pubUrls].filter(u => !draftUrls.has(u));
  const draftOnly = [...draftUrls].filter(u => !pubUrls.has(u));

  const total = new Set([...pubUrls, ...draftUrls]).size;
  const overlapPct = total > 0 ? parseFloat(((shared.length / total) * 100).toFixed(1)) : 0;

  return {
    shared: shared.length,
    published_only: publishedOnly,
    draft_only: draftOnly,
    overlap_pct: overlapPct,
  };
}

/**
 * Count words in a text.
 */
function countWords(text) {
  return text.split(/\s+/).filter(w => w.length > 0).length;
}

/**
 * Measure word counts for both documents.
 */
function measureWordCount(publishedMd, draftMd) {
  const published = countWords(publishedMd);
  const draft = countWords(draftMd);
  const delta = draft - published;
  const deltaPct = published > 0 ? parseFloat(((delta / published) * 100).toFixed(1)) : 0;

  return {
    published,
    draft,
    delta,
    delta_pct: deltaPct,
    in_range: draft >= 3000 && draft <= 4000,
  };
}

/**
 * Count linked story headings in body sections.
 * Story headings are lines that are a single markdown link.
 */
function countStories(markdown) {
  const lines = markdown.split('\n');
  let count = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines that are entirely a markdown link (story heading pattern)
    if (/^\[.+\]\(https?:\/\/.+\)$/.test(trimmed)) {
      count++;
    }
    // Also match ### [Title](url) format
    if (/^#{1,3}\s+\[.+\]\(https?:\/\/.+\)$/.test(trimmed)) {
      count++;
    }
  }
  return count;
}

/**
 * Measure story counts for both documents.
 */
function measureStoryCount(publishedMd, draftMd) {
  const published = countStories(publishedMd);
  const draft = countStories(draftMd);

  return {
    published,
    draft,
    target_range: '12-15',
    in_range: draft >= 12 && draft <= 15,
  };
}

/**
 * Check for presence of required body section headings.
 */
function measureSectionPresence(publishedMd, draftMd) {
  const sections = [
    { name: 'AI industry', patterns: [/ai industry/i, /ai & tech/i, /ai and tech/i] },
    { name: 'Biopharma', patterns: [/biopharma/i] },
    { name: 'MedTech', patterns: [/medtech/i, /med\s*tech/i, /digital health/i] },
    { name: 'Manufacturing', patterns: [/manufacturing/i] },
    { name: 'Insurance', patterns: [/insurance/i] },
  ];

  const missingInDraft = [];
  const missingInRef = [];

  for (const section of sections) {
    const inDraft = section.patterns.some(p => p.test(draftMd));
    const inRef = section.patterns.some(p => p.test(publishedMd));
    if (!inDraft) missingInDraft.push(section.name);
    if (!inRef) missingInRef.push(section.name);
  }

  return {
    all_present: missingInDraft.length === 0,
    missing_in_draft: missingInDraft,
    missing_in_reference: missingInRef,
  };
}

/**
 * Check draft structural compliance — required elements in order.
 */
function measureStructuralCompliance(draftMd) {
  const issues = [];

  // Title
  if (!/^SNI: Week \d+/m.test(draftMd)) {
    issues.push('Missing title line (SNI: Week N)');
  }

  // Welcome
  if (!/^Welcome to/m.test(draftMd)) {
    issues.push('Missing welcome line');
  }

  // tl;dr
  if (!/^tl;dr:/m.test(draftMd) && !/tl;dr:/i.test(draftMd)) {
    issues.push('Missing tl;dr section');
  }

  // Sector bullets in tl;dr
  const tldrBullets = [
    { label: 'In AI & tech', pattern: /in ai (&|and) tech/i },
    { label: 'In Biopharma', pattern: /in biopharma/i },
    { label: 'In Medtech', pattern: /in medtech/i },
    { label: 'In Manufacturing', pattern: /in manufacturing/i },
    { label: 'In Insurance', pattern: /in insurance/i },
  ];
  for (const bullet of tldrBullets) {
    if (!bullet.pattern.test(draftMd)) {
      issues.push(`Missing tl;dr sector bullet: ${bullet.label}`);
    }
  }

  // Transition line
  if (!/^And if you're still hungry/m.test(draftMd) && !/And if you're still hungry/i.test(draftMd)) {
    issues.push('Missing transition line');
  }

  // Body sections (checked separately in section presence)

  // Closing line
  if (!/^Thank you for reading/m.test(draftMd) && !/Thank you for reading/i.test(draftMd)) {
    issues.push('Missing closing line');
  }

  return {
    pass: issues.length === 0,
    issues,
  };
}

/**
 * Scan draft for prohibited language.
 */
function measureProhibitedLanguage(draftMd) {
  const lines = draftMd.split('\n');
  const matches = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { pattern, label } of COMPILED_BANNED) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        // Get surrounding context (trimmed)
        const context = line.trim().slice(0, 120);
        matches.push({
          term: label,
          line: i + 1,
          context,
        });
      }
    }
  }

  return {
    count: matches.length,
    matches,
  };
}

/**
 * Check link formatting — all links should be inline markdown, not footnotes or bare URLs.
 */
function measureLinkFormatting(draftMd) {
  // Bare URLs not inside markdown link syntax
  // Look for URLs that aren't preceded by ( — i.e. not part of [text](url)
  const bareUrlPattern = /(?<!\()(https?:\/\/[^\s)>\]]+)(?!\))/g;
  const bareMatches = [...draftMd.matchAll(bareUrlPattern)];
  // Filter out URLs that are part of markdown links by checking surrounding context
  const trueBareUrls = bareMatches.filter(m => {
    const idx = m.index;
    // Check if this URL is inside a markdown link [text](url)
    const before = draftMd.slice(Math.max(0, idx - 2), idx);
    return !before.includes('(');
  });

  // Footnote references like [1] or (source: Name)
  const footnotePattern = /\[(\d+)\](?!\()/g;
  const footnoteMatches = [...draftMd.matchAll(footnotePattern)];

  return {
    pass: trueBareUrls.length === 0 && footnoteMatches.length === 0,
    bare_urls: trueBareUrls.length,
    footnote_refs: footnoteMatches.length,
  };
}

/**
 * Spot-check number formatting compliance.
 */
function measureNumberFormatting(draftMd) {
  const issues = [];

  // Currency should be $NNbn/$NNm not $NN billion/$NN million
  const longCurrency = [...draftMd.matchAll(/\$[\d.,]+\s+(billion|million)/gi)];
  for (const m of longCurrency) {
    issues.push(`Long currency format: '${m[0]}' — should use bn/m abbreviation`);
  }

  // Percentages should use numerals
  const spelledPct = [...draftMd.matchAll(/\b(one|two|three|four|five|six|seven|eight|nine)\s+per\s*cent/gi)];
  for (const m of spelledPct) {
    issues.push(`Spelled-out percentage: '${m[0]}' — should use numerals`);
  }

  // £ and € same check
  const longGBP = [...draftMd.matchAll(/£[\d.,]+\s+(billion|million)/gi)];
  for (const m of longGBP) {
    issues.push(`Long currency format: '${m[0]}' — should use bn/m abbreviation`);
  }
  const longEUR = [...draftMd.matchAll(/€[\d.,]+\s+(billion|million)/gi)];
  for (const m of longEUR) {
    issues.push(`Long currency format: '${m[0]}' — should use bn/m abbreviation`);
  }

  return { issues };
}

/**
 * Run all deterministic metrics.
 */
function runDeterministicMetrics(publishedMd, draftMd) {
  return {
    story_overlap: measureStoryOverlap(publishedMd, draftMd),
    word_count: measureWordCount(publishedMd, draftMd),
    story_count: measureStoryCount(publishedMd, draftMd),
    sections: measureSectionPresence(publishedMd, draftMd),
    structure: measureStructuralCompliance(draftMd),
    prohibited_language: measureProhibitedLanguage(draftMd),
    link_formatting: measureLinkFormatting(draftMd),
    number_formatting: measureNumberFormatting(draftMd),
  };
}

// ─── LLM evaluation ─────────────────────────────────────────────────────────

const BENCHMARK_CRITERIA = [
  'theme_quality',
  'story_selection',
  'analytical_depth',
  'voice_fidelity',
  'narrative_coherence',
  'structural_balance',
  'overall_closeness',
];

/**
 * Parse and validate a benchmark evaluation response.
 */
function parseBenchmarkEvaluation(parsed, providerName) {
  if (!parsed?.scores) {
    warn(`${providerName}: no scores object in benchmark response`);
    return null;
  }

  const scores = {};
  for (const criterion of BENCHMARK_CRITERIA) {
    const entry = parsed.scores[criterion];
    if (entry && typeof entry.score === 'number') {
      scores[criterion] = {
        score: Math.max(1, Math.min(5, Math.round(entry.score))),
        feedback: entry.feedback || '',
        // Preserve extra fields per criterion
        ...(entry.reference_stories_missed ? { reference_stories_missed: entry.reference_stories_missed } : {}),
        ...(entry.draft_stories_unnecessary ? { draft_stories_unnecessary: entry.draft_stories_unnecessary } : {}),
        ...(entry.strongest_analysis ? { strongest_analysis: entry.strongest_analysis } : {}),
        ...(entry.weakest_analysis ? { weakest_analysis: entry.weakest_analysis } : {}),
        ...(entry.lapses ? { lapses: entry.lapses } : {}),
      };
    } else {
      scores[criterion] = { score: 0, feedback: 'Not evaluated' };
    }
  }

  const validScores = Object.values(scores).filter(s => s.score > 0).map(s => s.score);
  const calculatedAvg = validScores.length > 0
    ? parseFloat((validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1))
    : 0;

  const overallScore = (typeof parsed.overall_score === 'number' && parsed.overall_score >= 1 && parsed.overall_score <= 5)
    ? parsed.overall_score
    : calculatedAvg;

  return {
    scores,
    overall_score: overallScore,
    top_matches: Array.isArray(parsed.top_matches) ? parsed.top_matches : [],
    top_gaps: Array.isArray(parsed.top_gaps) ? parsed.top_gaps : [],
    rewrite_suggestions: Array.isArray(parsed.rewrite_suggestions) ? parsed.rewrite_suggestions.slice(0, 5) : [],
  };
}

/**
 * Build consensus from two benchmark evaluations.
 */
function buildBenchmarkConsensus(evaluations) {
  const valid = evaluations.filter(e => e !== null);
  if (valid.length === 0) return null;

  if (valid.length === 1) {
    return {
      average_scores: Object.fromEntries(
        BENCHMARK_CRITERIA.map(c => [c, valid[0].scores[c].score])
      ),
      overall_closeness: valid[0].overall_score,
      agreed_matches: valid[0].top_matches,
      agreed_gaps: valid[0].top_gaps,
      divergent_views: [],
    };
  }

  const averageScores = {};
  const divergent = [];

  for (const criterion of BENCHMARK_CRITERIA) {
    const scores = valid.map(e => e.scores[criterion].score).filter(s => s > 0);
    if (scores.length === 0) {
      averageScores[criterion] = 0;
      continue;
    }
    const avg = parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
    averageScores[criterion] = avg;

    if (scores.length >= 2) {
      const gap = Math.abs(scores[0] - scores[1]);
      if (gap >= 2) {
        divergent.push({
          criterion,
          gpt_score: scores[0],
          gemini_score: scores[1],
          gap,
        });
      }
    }
  }

  const overallScores = valid.map(e => e.overall_score).filter(s => s > 0);
  const overallCloseness = overallScores.length > 0
    ? parseFloat((overallScores.reduce((a, b) => a + b, 0) / overallScores.length).toFixed(1))
    : 0;

  // Find agreed matches/gaps using keyword overlap
  const agreedMatches = findOverlapping(valid.map(e => e.top_matches));
  const agreedGaps = findOverlapping(valid.map(e => e.top_gaps));

  return {
    average_scores: averageScores,
    overall_closeness: overallCloseness,
    agreed_matches: agreedMatches.length > 0 ? agreedMatches : valid[0].top_matches.slice(0, 3),
    agreed_gaps: agreedGaps.length > 0 ? agreedGaps : valid[0].top_gaps.slice(0, 3),
    divergent_views: divergent,
  };
}

/**
 * Find items with keyword overlap across lists.
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

// ─── Console output ──────────────────────────────────────────────────────────

function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

function printSummary(weekNum, deterministic, gptEval, geminiEval, consensus, outputPath) {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  SNI Benchmark — Week ${weekNum}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log('  DETERMINISTIC CHECKS');
  console.log('  ────────────────────');

  const so = deterministic.story_overlap;
  console.log(`  Story overlap:        ${so.overlap_pct}% (${so.shared} shared, ${so.published_only.length} published-only, ${so.draft_only.length} draft-only)`);

  const wc = deterministic.word_count;
  const wcSign = wc.delta >= 0 ? '+' : '';
  const wcCheck = wc.in_range ? '✓ in range' : '✗ out of range';
  console.log(`  Word count:           ${formatNumber(wc.draft)} vs ${formatNumber(wc.published)} (${wcSign}${wc.delta_pct}%) ${wcCheck}`);

  const sc = deterministic.story_count;
  const scCheck = sc.in_range ? '✓ in range' : '✗ out of range';
  console.log(`  Story count:          ${sc.draft} vs ${sc.published} ${scCheck}`);

  const sect = deterministic.sections;
  const sectCheck = sect.all_present ? '✓ all present' : `✗ missing: ${sect.missing_in_draft.join(', ')}`;
  console.log(`  Sections:             ${sectCheck}`);

  const struct = deterministic.structure;
  const structCheck = struct.pass ? '✓ compliant' : `✗ ${struct.issues.length} issue(s)`;
  console.log(`  Structure:            ${structCheck}`);
  if (!struct.pass) {
    for (const issue of struct.issues.slice(0, 3)) {
      console.log(`                        · ${issue}`);
    }
  }

  const pl = deterministic.prohibited_language;
  const plCheck = pl.count === 0 ? '✓ 0 matches' : `✗ ${pl.count} match(es)`;
  console.log(`  Prohibited language:  ${plCheck}`);
  if (pl.count > 0) {
    for (const m of pl.matches.slice(0, 5)) {
      console.log(`                        · '${m.term}' (line ${m.line})`);
    }
    if (pl.count > 5) console.log(`                        · ... and ${pl.count - 5} more`);
  }

  const lf = deterministic.link_formatting;
  const lfCheck = lf.pass ? '✓ all inline' : `✗ ${lf.bare_urls} bare URL(s), ${lf.footnote_refs} footnote ref(s)`;
  console.log(`  Link formatting:      ${lfCheck}`);

  const nf = deterministic.number_formatting;
  const nfCheck = nf.issues.length === 0 ? '✓ no issues' : `✗ ${nf.issues.length} issue(s)`;
  console.log(`  Number formatting:    ${nfCheck}`);

  if (consensus) {
    console.log('');
    console.log('  LLM COMPARATIVE SCORES (1-5)');
    console.log('  ────────────────────────────');
    for (const c of BENCHMARK_CRITERIA) {
      const gpt = gptEval?.scores[c]?.score || '–';
      const gem = geminiEval?.scores[c]?.score || '–';
      const avg = consensus.average_scores[c] || '–';
      const diverge = consensus.divergent_views.find(d => d.criterion === c);
      const flag = diverge ? ' ⚠ divergent' : '';
      const label = c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()).padEnd(24);
      console.log(`  ${label} ${avg}  (GPT: ${gpt}, Gemini: ${gem})${flag}`);
    }

    console.log('');
    console.log(`  Overall closeness:    ${consensus.overall_closeness}`);

    if (consensus.agreed_matches.length > 0) {
      console.log('');
      console.log('  Agreed strengths:');
      for (const m of consensus.agreed_matches.slice(0, 3)) {
        console.log(`    · ${m.slice(0, 100)}`);
      }
    }

    if (consensus.agreed_gaps.length > 0) {
      console.log('');
      console.log('  Agreed gaps:');
      for (const g of consensus.agreed_gaps.slice(0, 3)) {
        console.log(`    · ${g.slice(0, 100)}`);
      }
    }
  }

  console.log('');
  console.log(`  Saved: ${outputPath}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Run the benchmark comparison.
 *
 * @param {object} args
 * @param {string} args.draft — path to pipeline draft
 * @param {string} args.reference — path to published reference
 * @param {boolean} [args.dryRun] — skip API calls, run deterministic only
 * @returns {Promise<{ benchmarkPath: string, stats: object }>}
 */
export async function runBenchmark(args = {}) {
  const startTime = Date.now();

  if (!args.draft || !existsSync(args.draft)) {
    throw new Error(`Draft file not found: ${args.draft}`);
  }
  if (!args.reference || !existsSync(args.reference)) {
    throw new Error(`Reference file not found: ${args.reference}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Benchmark');
  console.log(`  Draft:     ${args.draft}`);
  console.log(`  Reference: ${args.reference}`);
  if (args.dryRun) console.log('  DRY RUN — deterministic metrics only');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Read both documents
  log('Reading draft and reference...');
  const draftMd = readFileSync(args.draft, 'utf8');
  const referenceMd = readFileSync(args.reference, 'utf8');
  ok(`Draft: ${countWords(draftMd)} words, Reference: ${countWords(referenceMd)} words`);

  // Run deterministic metrics
  log('Running deterministic metrics...');
  const deterministic = runDeterministicMetrics(referenceMd, draftMd);
  ok('Deterministic metrics complete');

  // Determine week number
  const weekMatch = args.draft.match(/week-(\d+)/i) || args.reference.match(/week-(\d+)/i);
  const weekNum = weekMatch ? weekMatch[1] : 'unknown';

  let gptEval = null;
  let geminiEval = null;
  let consensus = null;

  if (!args.dryRun) {
    // Check provider availability
    const providers = availableProviders();
    if (!providers.openai && !providers.gemini) {
      warn('No multi-model API keys configured. Skipping LLM evaluation.');
    } else {
      log(`Providers: OpenAI=${providers.openai ? 'yes' : 'no'}, Gemini=${providers.gemini ? 'yes' : 'no'}`);

      // Build prompt
      const { template, meta } = loadPrompt('benchmark');
      const prompt = renderPrompt(template, {
        reference: referenceMd,
        draft: draftMd,
      });
      const maxTokens = meta?.max_tokens || 5000;

      // Call both models
      log(`Calling GPT-5.2 and Gemini Pro 3.1 in parallel (max_tokens: ${maxTokens})...`);
      const results = await callBothModels(prompt, { maxTokens });

      if (results.openai.parsed) {
        gptEval = parseBenchmarkEvaluation(results.openai.parsed, 'GPT-5.2');
        if (gptEval) ok(`GPT-5.2: overall ${gptEval.overall_score}/5`);
        else warn('GPT-5.2: response parsed but evaluation invalid');
      } else {
        warn(`GPT-5.2 failed: ${results.openai.error}`);
      }

      if (results.gemini.parsed) {
        geminiEval = parseBenchmarkEvaluation(results.gemini.parsed, 'Gemini-Pro-3.1');
        if (geminiEval) ok(`Gemini Pro 3.1: overall ${geminiEval.overall_score}/5`);
        else warn('Gemini Pro 3.1: response parsed but evaluation invalid');
      } else {
        warn(`Gemini Pro 3.1 failed: ${results.gemini.error}`);
      }

      // Build consensus
      consensus = buildBenchmarkConsensus([gptEval, geminiEval]);
    }
  }

  // Build output
  const output = {
    deterministic,
    gpt_evaluation: gptEval,
    gemini_evaluation: geminiEval,
    consensus,
    benchmarked_at: new Date().toISOString(),
    reference_path: args.reference,
    draft_path: args.draft,
  };

  // Save
  const outputDir = join(ROOT, 'output');
  const benchmarkPath = join(outputDir, `benchmark-week-${weekNum}.json`);
  try {
    writeFileSync(benchmarkPath, JSON.stringify(output, null, 2), 'utf8');
    ok(`Benchmark saved to ${benchmarkPath}`);
  } catch (err) {
    warn(`Failed to save benchmark: ${err.message}`);
  }

  // Print summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Benchmark complete in ${elapsed}s`);
  printSummary(weekNum, deterministic, gptEval, geminiEval, consensus, benchmarkPath);

  return {
    benchmarkPath,
    stats: {
      overlapPct: deterministic.story_overlap.overlap_pct,
      draftWords: deterministic.word_count.draft,
      prohibitedCount: deterministic.prohibited_language.count,
      structurePass: deterministic.structure.pass,
      gptScore: gptEval?.overall_score || 0,
      geminiScore: geminiEval?.overall_score || 0,
      consensusScore: consensus?.overall_closeness || 0,
    },
  };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.warn(`[unhandledRejection] ${reason}`);
  });

  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--draft')     { args.draft = argv[++i]; continue; }
    if (argv[i] === '--reference') { args.reference = argv[++i]; continue; }
    if (argv[i] === '--dry-run')   { args.dryRun = true; continue; }
  }

  if (!args.draft || !args.reference) {
    console.error('Usage: bun scripts/benchmark.js --draft <path> --reference <path> [--dry-run]');
    process.exit(1);
  }

  runBenchmark(args)
    .then(({ stats }) => {
      log(`Result: overlap=${stats.overlapPct}% prohibited=${stats.prohibitedCount} consensus=${stats.consensusScore}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
