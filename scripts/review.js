#!/usr/bin/env bun
/**
 * review.js — Self-review quality gate for SNI Research Tool
 *
 * Runs the generated draft through a structured quality checklist:
 *   - Prohibited language scan
 *   - Structural compliance
 *   - Formatting rules (UK English, punctuation, numbers)
 *   - Link presence
 *   - Unsupported claims
 *   - Word count
 *   - Missing sectors
 *
 * Returns a ReviewResult JSON. This is a quality gate, NOT a re-generation
 * step — it flags issues but does NOT attempt to fix the draft.
 *
 * Usage:
 *   bun scripts/review.js --draft output/draft-week-9.md
 *   bun scripts/review.js --draft output/draft-week-9.md --model claude-sonnet-4-20250514
 *   bun scripts/review.js --draft output/draft-week-9.md --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, renderPrompt } from './lib/prompt.js';
import { withRetry } from './lib/retry.js';
import { loadEnvKey } from './lib/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// ─── Parse review response ───────────────────────────────────────────────────

/**
 * Extract and parse the ReviewResult JSON from the LLM response.
 * Uses the same regex pattern as score.js.
 */
function parseReviewResponse(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON found in review response');

  const result = JSON.parse(jsonMatch[0]);

  // Validate required fields — fill in defaults for missing optional fields
  if (typeof result.overall_pass !== 'boolean') {
    result.overall_pass = false;
  }
  if (typeof result.word_count !== 'number') {
    result.word_count = 0;
  }
  if (!Array.isArray(result.prohibited_found)) result.prohibited_found = [];
  if (!Array.isArray(result.structural_issues)) result.structural_issues = [];
  if (!Array.isArray(result.formatting_issues)) result.formatting_issues = [];
  if (!Array.isArray(result.link_issues)) result.link_issues = [];
  if (!Array.isArray(result.unsupported_claims)) result.unsupported_claims = [];
  if (!Array.isArray(result.missing_sectors)) result.missing_sectors = [];

  return result;
}

// ─── Local pre-checks (no LLM needed) ───────────────────────────────────────

/**
 * Run quick local checks before sending to the LLM.
 * Returns an array of issues to include alongside LLM findings.
 */
function runLocalChecks(draftText) {
  const issues = [];
  const lines = draftText.split('\n');

  // Word count
  const wordCount = draftText.split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 2800) {
    issues.push({ type: 'word_count', issue: `Word count ${wordCount} is below 2,800 minimum target` });
  }
  if (wordCount > 4200) {
    issues.push({ type: 'word_count', issue: `Word count ${wordCount} is above 4,200 maximum target` });
  }

  // Check for [TRUNCATED] marker (draft was cut short by max_tokens)
  if (draftText.includes('[TRUNCATED]')) {
    issues.push({ type: 'structural', issue: 'Draft was truncated by token limit — incomplete output' });
  }

  // Check for em dashes (common formatting error)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('—')) {
      issues.push({ type: 'formatting', issue: `Em dash found (should be spaced en dash)`, line: i + 1 });
      break; // Only flag once
    }
  }

  // Check for double quotes used for speech (should be single)
  const doubleQuotePattern = /"\w+.*?\w+"/;
  for (let i = 0; i < lines.length; i++) {
    if (doubleQuotePattern.test(lines[i]) && !lines[i].trim().startsWith('-') && !lines[i].includes('](')) {
      issues.push({ type: 'formatting', issue: 'Double quotes found (should be single quotes for speech/titles)', line: i + 1 });
      break;
    }
  }

  return { wordCount, issues };
}

// ─── Main review function ────────────────────────────────────────────────────

/**
 * Run the self-review quality gate on a draft.
 *
 * @param {object} args
 * @param {string} args.draft — path to draft markdown file
 * @param {string} [args.model] — model override
 * @param {boolean} [args.dryRun] — skip LLM call, run local checks only
 * @returns {{ reviewPath: string, result: object, stats: object }}
 */
export async function runReview(args) {
  const startTime = Date.now();
  const draftPath = args.draft;

  if (!draftPath || !existsSync(draftPath)) {
    throw new Error(`Draft file not found: ${draftPath}`);
  }

  log(`Reading draft: ${draftPath}`);
  const draftText = readFileSync(draftPath, 'utf8');

  // Local pre-checks (always run, even in dry-run)
  const { wordCount, issues: localIssues } = runLocalChecks(draftText);
  log(`Word count: ${wordCount}`);
  if (localIssues.length > 0) {
    for (const issue of localIssues) {
      warn(`Local check: ${issue.issue}`);
    }
  }

  // Determine week number from filename for output path
  const weekMatch = draftPath.match(/week-(\d+)/i);
  const weekNum = weekMatch ? weekMatch[1] : 'unknown';

  if (args.dryRun) {
    log('Dry run — skipping LLM review');
    const dryResult = {
      overall_pass: localIssues.length === 0,
      word_count: wordCount,
      prohibited_found: [],
      structural_issues: localIssues.filter(i => i.type === 'structural').map(i => ({ issue: i.issue, location: 'draft' })),
      formatting_issues: localIssues.filter(i => i.type === 'formatting').map(i => ({ issue: i.issue, location: `line ${i.line || 'unknown'}` })),
      link_issues: [],
      unsupported_claims: [],
      missing_sectors: [],
      mode: 'dry-run (local checks only)',
    };
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    ok(`Dry run complete in ${elapsed}s — ${localIssues.length} local issues found`);
    return { reviewPath: null, result: dryResult, stats: { wordCount, issueCount: localIssues.length, pass: localIssues.length === 0, mode: 'dry-run' } };
  }

  // Load prompt and call LLM
  const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
  if (!apiKey) { log('ANTHROPIC_API_KEY not configured. LLM review now runs through Claude Code.'); process.exit(0); }

  const anthropic = new Anthropic({ apiKey });
  const { meta, template } = loadPrompt('self-review');
  const model = args.model || meta.model;
  const maxTokens = meta.max_tokens || 4000;

  const userPrompt = renderPrompt(template, { draft: draftText });

  log(`Calling ${model} for self-review...`);

  let result;
  try {
    const response = await withRetry(
      async () => {
        const res = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          system: 'You are a strict editorial quality reviewer for a professional newsletter. Return only valid JSON with no markdown fencing.',
          messages: [{ role: 'user', content: userPrompt }],
        });

        if (!res.content?.length) throw new Error('Empty response from API');
        return res;
      },
      {
        maxAttempts: 3,
        onRetry: (attempt, error) => warn(`Review attempt ${attempt} failed: ${error.message}`),
      }
    );

    const text = response.content[0].text;
    result = parseReviewResponse(text);
    ok(`LLM review complete — overall_pass: ${result.overall_pass}`);
  } catch (error) {
    warn(`LLM review failed after retries: ${error.message}`);
    // Return local-only results with UNREVIEWED flag
    result = {
      overall_pass: false,
      word_count: wordCount,
      prohibited_found: [],
      structural_issues: localIssues.filter(i => i.type === 'structural').map(i => ({ issue: i.issue, location: 'draft' })),
      formatting_issues: localIssues.filter(i => i.type === 'formatting').map(i => ({ issue: i.issue, location: `line ${i.line || 'unknown'}` })),
      link_issues: [],
      unsupported_claims: [],
      missing_sectors: [],
      mode: 'UNREVIEWED (LLM failed)',
      error: error.message,
    };
  }

  // Merge local checks with LLM results
  if (result.word_count === 0) result.word_count = wordCount;
  for (const issue of localIssues) {
    if (issue.type === 'formatting') {
      const alreadyFound = result.formatting_issues.some(f => f.issue === issue.issue);
      if (!alreadyFound) {
        result.formatting_issues.push({ issue: issue.issue, location: `line ${issue.line || 'unknown'}` });
      }
    }
    if (issue.type === 'structural') {
      result.structural_issues.push({ issue: issue.issue, location: 'draft' });
    }
  }

  // Save review result
  const outputDir = join(ROOT, 'output');
  const reviewPath = join(outputDir, `review-week-${weekNum}.json`);
  try {
    writeFileSync(reviewPath, JSON.stringify(result, null, 2), 'utf8');
    ok(`Review saved to ${reviewPath}`);
  } catch (e) {
    warn(`Failed to save review: ${e.message}`);
  }

  // Log summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const issueCount =
    result.prohibited_found.length +
    result.structural_issues.length +
    result.formatting_issues.length +
    result.link_issues.length +
    result.unsupported_claims.length +
    result.missing_sectors.length;

  log(`Review summary: ${issueCount} issues found`);
  if (result.prohibited_found.length > 0) warn(`  Prohibited language: ${result.prohibited_found.length}`);
  if (result.structural_issues.length > 0) warn(`  Structural issues: ${result.structural_issues.length}`);
  if (result.formatting_issues.length > 0) warn(`  Formatting issues: ${result.formatting_issues.length}`);
  if (result.link_issues.length > 0) warn(`  Link issues: ${result.link_issues.length}`);
  if (result.unsupported_claims.length > 0) warn(`  Unsupported claims: ${result.unsupported_claims.length}`);
  if (result.missing_sectors.length > 0) warn(`  Missing sectors: ${result.missing_sectors.join(', ')}`);

  ok(`Done in ${elapsed}s — overall_pass: ${result.overall_pass}`);
  return { reviewPath, result, stats: { wordCount, issueCount, pass: result.overall_pass } };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--draft')   { args.draft = argv[++i]; continue; }
    if (argv[i] === '--model')   { args.model = argv[++i]; continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
  }

  if (!args.draft) {
    console.error('Usage: bun scripts/review.js --draft <path> [--model <model>] [--dry-run]');
    process.exit(1);
  }

  runReview(args)
    .then(({ result, stats }) => {
      log(`Result: pass=${stats.pass} issues=${stats.issueCount} words=${stats.wordCount}`);
      process.exit(0);
    })
    .catch(err => {
      warn(`Fatal: ${err.message}`);
      process.exit(1);
    });
}
