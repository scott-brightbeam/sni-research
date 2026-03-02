#!/usr/bin/env bun
/**
 * measure-override.js — Measure edit distance between draft and published version
 *
 * Primary success metric: <20% override rate means the draft was useful.
 * Uses word-level diff to calculate how much Scott edited the generated draft.
 *
 * Usage:
 *   bun scripts/measure-override.js --draft output/draft-week-9.md --published output/published/week-9.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { diffWords } from 'diff';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

/**
 * Measure the override rate between a draft and its published version.
 *
 * @param {string} draftText — raw markdown of the generated draft
 * @param {string} publishedText — raw markdown of Scott's published version
 * @returns {{ overrideRate: number, totalWords: number, changedWords: number,
 *             additions: number, deletions: number, details: object[] }}
 */
export function measureOverrideRate(draftText, publishedText) {
  const changes = diffWords(draftText, publishedText);

  let totalWords = 0;
  let additions = 0;
  let deletions = 0;
  const details = [];

  for (const part of changes) {
    const wordCount = part.value.trim().split(/\s+/).filter(w => w.length > 0).length;

    if (!part.added && !part.removed) {
      // Unchanged text
      totalWords += wordCount;
    } else if (part.added) {
      totalWords += wordCount;
      additions += wordCount;
      details.push({ type: 'added', words: wordCount, sample: part.value.slice(0, 100) });
    } else if (part.removed) {
      deletions += wordCount;
      details.push({ type: 'removed', words: wordCount, sample: part.value.slice(0, 100) });
    }
  }

  const changedWords = additions + deletions;
  // Use max(totalWords, 1) to avoid division by zero
  const overrideRate = totalWords > 0 ? (changedWords / (totalWords + deletions)) * 100 : 0;

  return {
    overrideRate: Math.round(overrideRate * 10) / 10,
    totalWords,
    changedWords,
    additions,
    deletions,
    draftWordCount: draftText.trim().split(/\s+/).length,
    publishedWordCount: publishedText.trim().split(/\s+/).length,
    details: details.slice(0, 50), // Cap detail output
  };
}

/**
 * Main entry point.
 */
export async function runMeasureOverride(args = {}) {
  if (!args.draft || !args.published) {
    throw new Error('Usage: bun scripts/measure-override.js --draft <path> --published <path>');
  }

  log(`Draft:     ${args.draft}`);
  log(`Published: ${args.published}`);

  const draftText = readFileSync(args.draft, 'utf8');
  const publishedText = readFileSync(args.published, 'utf8');

  const result = measureOverrideRate(draftText, publishedText);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Override Rate Measurement');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`  Override rate:    ${result.overrideRate}%`);
  console.log(`  Target:           <20%`);
  console.log(`  Status:           ${result.overrideRate < 20 ? 'PASS' : 'NEEDS IMPROVEMENT'}`);
  console.log('');
  console.log(`  Draft words:      ${result.draftWordCount}`);
  console.log(`  Published words:  ${result.publishedWordCount}`);
  console.log(`  Words added:      ${result.additions}`);
  console.log(`  Words removed:    ${result.deletions}`);
  console.log(`  Total changed:    ${result.changedWords}`);
  console.log('');

  // Show top changes
  if (result.details.length > 0) {
    console.log('  Top changes:');
    for (const d of result.details.slice(0, 10)) {
      const prefix = d.type === 'added' ? '+' : '-';
      console.log(`    ${prefix} (${d.words} words) ${d.sample.replace(/\n/g, ' ').slice(0, 60)}...`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════');

  // Save result
  const weekMatch = args.published.match(/week-(\d+)/i);
  const weekSuffix = weekMatch ? `week-${weekMatch[1]}` : 'latest';
  mkdirSync(join(ROOT, 'output'), { recursive: true });
  const outputPath = join(ROOT, 'output', `override-${weekSuffix}.json`);
  try {
    writeFileSync(outputPath, JSON.stringify({
      ...result,
      draft: args.draft,
      published: args.published,
      measuredAt: new Date().toISOString(),
    }, null, 2));
    ok(`Results saved to ${outputPath}`);
  } catch (err) {
    warn(`Failed to save results: ${err.message}`);
  }

  return result;
}

// --- CLI entry point ---
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--draft') args.draft = argv[++i];
    if (argv[i] === '--published') args.published = argv[++i];
  }

  runMeasureOverride(args)
    .then(result => {
      log(`Override rate: ${result.overrideRate}%`);
      process.exit(0);
    })
    .catch(e => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
}
