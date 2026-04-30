#!/usr/bin/env bun
/**
 * pipeline.js — End-to-end orchestrator for SNI Research Tool
 *
 * Runs the full pipeline:
 *   fetch → score → discover → score (new) → report → draft (Opus 4.6)
 *   → review → evaluate → verify-links → notify
 * Or daily mode (Mon-Thu): fetch → score
 *
 * Features:
 *   - File-based locking (prevents concurrent runs)
 *   - Stage-level timing, retry, and error capture
 *   - Graceful degradation (failed stages don't block the pipeline)
 *   - Disk space pre-check
 *   - Run summary saved to output/runs/
 *
 * Usage:
 *   bun scripts/pipeline.js --week 9
 *   bun scripts/pipeline.js --week 9 --mode full
 *   bun scripts/pipeline.js --week 9 --mode daily
 *   bun scripts/pipeline.js --week 9 --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { acquireLock, releaseLock } from './lib/lock.js';
import { getWeekWindow, getCurrentWeek, getISOWeekNumber } from './lib/week.js';
import { sendAlert } from './lib/alert.js';
import { runFetch } from './fetch.js';
import { runScore } from './score.js';
import { runDiscover } from './discover.js';
import { runReport } from './report.js';
import { runDraft } from './draft.js';
import { runReview } from './review.js';
import { runEvaluate } from './evaluate.js';
import { runLinkCheck } from './verify-links.js';
import { runNotify } from './notify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const DISK_WARN_THRESHOLD_MB = 100;
const DISK_ABORT_THRESHOLD_MB = 10;

// ─── Disk space check ────────────────────────────────────────────────────────

/**
 * Check available disk space at ROOT.
 * Returns available MB. Logs warnings/errors.
 */
function checkDiskSpace() {
  try {
    const output = execSync(`df -m "${ROOT}" | tail -1`, { encoding: 'utf8' });
    // df -m output: Filesystem 1M-blocks Used Available Capacity ...
    const parts = output.trim().split(/\s+/);
    const availableMB = parseInt(parts[3], 10);
    if (isNaN(availableMB)) {
      warn('Could not parse disk space — continuing anyway');
      return Infinity;
    }
    if (availableMB < DISK_ABORT_THRESHOLD_MB) {
      throw new Error(`Insufficient disk space: ${availableMB}MB available (need >${DISK_ABORT_THRESHOLD_MB}MB)`);
    }
    if (availableMB < DISK_WARN_THRESHOLD_MB) {
      warn(`Low disk space: ${availableMB}MB available`);
    }
    return availableMB;
  } catch (err) {
    if (err.message.includes('Insufficient disk space')) throw err;
    warn(`Disk space check failed: ${err.message}`);
    return Infinity;
  }
}

// ─── Stage helpers ──────────────────────────────────────────────────────────

/**
 * Format stage stats into a short string for macOS notifications.
 */
function formatStageStats(name, stats) {
  if (!stats || Object.keys(stats).length === 0) return '';
  switch (name) {
    case 'fetch':        return `${stats.saved ?? '?'} saved`;
    case 'score':
    case 'score-discover':
                         return `${stats.kept ?? '?'} kept, ${stats.moved ?? 0} flagged`;
    case 'discover':     return `${stats.added ?? 0} new`;
    case 'report':       return 'built';
    case 'draft':        return stats.draftPath ? 'ready' : 'no output';
    case 'review':       return stats.pass === false ? 'needs work' : 'pass';
    case 'evaluate':     return stats.score ? `${stats.score}/10` : 'done';
    case 'verify-links': return `${stats.broken ?? 0} broken`;
    case 'notify':       return stats.sent ? 'sent' : 'saved';
    default: {
      const [k, v] = Object.entries(stats)[0] || [];
      return k ? `${k}: ${v}` : '';
    }
  }
}

/**
 * Delete review directory contents for a date range.
 * Removes data/review/<date>/ and data/review/raw/<date>/ for each day.
 */
function cleanupReview(startDate, endDate) {
  const reviewDir = join(ROOT, 'data', 'review');
  const rawDir = join(reviewDir, 'raw');
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const datePath = join(reviewDir, ds);
    const rawPath = join(rawDir, ds);
    if (existsSync(datePath)) rmSync(datePath, { recursive: true });
    if (existsSync(rawPath)) rmSync(rawPath, { recursive: true });
  }
}

/**
 * Auto-delete flagged articles unless >10% were flagged.
 * If threshold exceeded, keeps review dir and sends macOS alert.
 */
function handleScoreCleanup(scoreResult, startDate, endDate) {
  const { total, moved } = scoreResult.stats || {};
  if (!total || total === 0 || !moved) return;

  const pct = ((moved / total) * 100).toFixed(1);

  if (moved / total > 0.10) {
    // >10% flagged — something may be wrong, keep for review
    sendAlert('SNI Pipeline — Review needed',
      `⚠ ${moved}/${total} articles flagged (${pct}%) — kept in data/review/ for manual check`);
    warn(`Score threshold exceeded: ${moved}/${total} (${pct}%) flagged — review dir preserved`);
  } else {
    // ≤10% — normal, clean up
    cleanupReview(startDate, endDate);
    log(`Cleaned review dir: ${moved} flagged articles deleted (${pct}%)`);
  }
}

// ─── Stage runner ────────────────────────────────────────────────────────────

/**
 * Run a pipeline stage with timing, error capture, and macOS notification.
 *
 * @param {string} name — stage name
 * @param {() => Promise<object>} fn — stage function
 * @param {object} ctx — PipelineContext (stages array gets appended)
 * @param {object} [opts]
 * @param {string} [opts.nextStage] — name of next stage (shown in notification)
 * @returns {StageResult}
 */
async function runStage(name, fn, ctx, { nextStage } = {}) {
  const stageStart = Date.now();
  log(`━━━ Stage: ${name} ━━━`);

  const result = {
    name,
    status: 'success',
    attempts: 1,
    duration: 0,
    stats: {},
    errors: [],
  };

  try {
    const stats = await fn();
    result.stats = stats || {};
    result.status = 'success';
    ok(`${name} completed`);
  } catch (err) {
    result.status = 'failed';
    result.errors.push(err.message);
    warn(`${name} failed: ${err.message}`);
  }

  result.duration = Date.now() - stageStart;
  ctx.stages.push(result);

  const elapsed = (result.duration / 1000).toFixed(1);
  log(`${name}: ${result.status} (${elapsed}s)`);
  console.log('');

  // macOS notification at stage boundary
  const icon = result.status === 'success' ? '✓' : '✗';
  const statsLine = formatStageStats(name, result.stats);
  const next = nextStage ? ` → ${nextStage}` : '';
  const body = `${icon} ${name}${statsLine ? ': ' + statsLine : ''} (${elapsed}s)${next}`;
  sendAlert('SNI Pipeline', body);

  return result;
}

// ─── Pipeline modes ──────────────────────────────────────────────────────────

/**
 * Daily pipeline (Mon-Thu, Sat-Sun): fetch → score
 *
 * Uses yesterday's date — the pipeline runs at 04:00, so very little
 * will have been published today. Yesterday gives a full day of articles.
 */
async function runDailyPipeline(ctx) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().slice(0, 10);
  log(`Mode: DAILY (fetch → score) — date: ${dateStr}`);
  console.log('');
  sendAlert('SNI Pipeline', `Starting daily pipeline — ${dateStr}`);

  await runStage('fetch', () => runFetch({
    startDate: dateStr,
    endDate: dateStr,
  }), ctx, { nextStage: 'score' });

  const scoreResult = await runStage('score', () => runScore({
    startDate: dateStr,
    endDate: dateStr,
  }), ctx);

  handleScoreCleanup(scoreResult, dateStr, dateStr);
}

/**
 * Full pipeline (Thursday):
 *   fetch → score → discover → score (new) → report → draft (Opus 4.6)
 *   → review → evaluate → verify-links → notify
 */
async function runFullPipeline(ctx) {
  log('Mode: FULL (full pipeline)');
  console.log('');
  sendAlert('SNI Pipeline', `Starting full pipeline — week ${ctx.weekNumber}`);

  // Fetch
  await runStage('fetch', () => runFetch({
    week: ctx.weekNumber,
    year: ctx.year,
  }), ctx, { nextStage: 'score' });

  // Score (initial pass — RSS + search articles)
  const scoreResult = await runStage('score', () => runScore({
    week: ctx.weekNumber,
    year: ctx.year,
  }), ctx, { nextStage: 'discover' });

  handleScoreCleanup(scoreResult, ctx.dateWindow.start, ctx.dateWindow.end);

  // Discover (multi-model story discovery — finds articles we missed)
  const discoverResult = await runStage('discover', () => runDiscover({
    week: ctx.weekNumber,
    year: ctx.year,
  }), ctx, { nextStage: 'score-discover' });

  // Score again if discover added new articles
  if (discoverResult.status === 'success' && discoverResult.stats?.added > 0) {
    log(`Discovery added ${discoverResult.stats.added} articles — running second score pass`);
    const scoreDiscoverResult = await runStage('score-discover', () => runScore({
      week: ctx.weekNumber,
      year: ctx.year,
    }), ctx, { nextStage: 'report' });

    handleScoreCleanup(scoreDiscoverResult, ctx.dateWindow.start, ctx.dateWindow.end);
  }

  // Report (research pack — always generated as fallback content)
  await runStage('report', () => runReport({
    week: ctx.weekNumber,
    year: ctx.year,
  }), ctx, { nextStage: 'draft' });

  // Draft (depends on score completing for confidence fields)
  const draftResult = await runStage('draft', () => runDraft({
    week: ctx.weekNumber,
    year: ctx.year,
  }), ctx, { nextStage: 'review' });

  // Review, evaluate, and link-check only run if draft succeeded
  if (draftResult.status !== 'failed' && draftResult.stats?.draftPath) {
    const draftPath = draftResult.stats.draftPath;

    // Self-review (Claude mechanical quality gate)
    await runStage('review', () => runReview({
      draft: draftPath,
    }), ctx, { nextStage: 'evaluate' });

    // Evaluate (GPT-5.2 + Gemini Pro 3.1 editorial review)
    await runStage('evaluate', () => runEvaluate({
      draft: draftPath,
    }), ctx, { nextStage: 'verify-links' });

    // Link verification
    await runStage('verify-links', () => runLinkCheck({
      draft: draftPath,
    }), ctx, { nextStage: 'notify' });
  } else {
    // Draft failed — skip review, evaluate, and links
    warn('Draft failed — skipping review, evaluation and link verification');
    ctx.stages.push({
      name: 'review',
      status: 'skipped',
      attempts: 0,
      duration: 0,
      stats: {},
      errors: ['Skipped: draft generation failed'],
    });
    ctx.stages.push({
      name: 'evaluate',
      status: 'skipped',
      attempts: 0,
      duration: 0,
      stats: {},
      errors: ['Skipped: draft generation failed'],
    });
    ctx.stages.push({
      name: 'verify-links',
      status: 'skipped',
      attempts: 0,
      duration: 0,
      stats: {},
      errors: ['Skipped: draft generation failed'],
    });
  }

  // Always notify (even if partially failed)
  await runStage('notify', () => runNotify({
    context: ctx,
  }), ctx);
}

// ─── Dry run ─────────────────────────────────────────────────────────────────

function printDryRun(ctx) {
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  DRY RUN — Pipeline Execution Plan');
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`  Week:     ${ctx.weekNumber}`);
  console.log(`  Year:     ${ctx.year}`);
  console.log(`  Window:   ${ctx.dateWindow.start} → ${ctx.dateWindow.end}`);
  console.log(`  Mode:     ${ctx.mode}`);
  console.log(`  Run ID:   ${ctx.runId}`);
  console.log('');

  if (ctx.mode === 'daily') {
    console.log('  Stages:');
    console.log('    1. fetch  — RSS feeds + Brave Search');
    console.log('    2. score  — LLM relevance scoring');
  } else {
    console.log('  Stages:');
    console.log('     1. fetch          — RSS feeds + Brave Search');
    console.log('     2. score          — LLM relevance scoring');
    console.log('     3. discover       — Multi-model story discovery');
    console.log('     4. score-discover — Score newly discovered articles');
    console.log('     5. report         — Research pack generation');
    console.log('     6. draft          — Theme selection + draft writing (Opus 4.6)');
    console.log('     7. review         — Self-review quality gate (Claude)');
    console.log('     8. evaluate       — Multi-model editorial evaluation');
    console.log('     9. verify-links   — Link verification');
    console.log('    10. notify         — iMessage notification');
  }

  console.log('');
  console.log('  No API calls or file writes will be made.');
  console.log('═══════════════════════════════════════════════');
  console.log('');
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Run the full pipeline.
 *
 * @param {object} args
 * @param {number} [args.week] — ISO week number (defaults to current)
 * @param {number} [args.year] — year (defaults to current)
 * @param {string} [args.mode] — 'daily' | 'full' (defaults to day-based detection)
 * @param {boolean} [args.dryRun]
 */
export async function runPipeline(args = {}) {
  const pipelineStart = Date.now();

  // Determine week and year
  if (!args.week) {
    const current = getCurrentWeek();
    args.week = current.week;
    args.year = args.year || current.year;
    log(`No --week specified, using current week: ${args.week}`);
  }
  const year = args.year || new Date().getFullYear();

  // Determine mode. Friday is the weekly-full day as of Apr 2026 (was Thursday);
  // pass --mode friday explicitly from the launchd plist. Manual runs auto-detect.
  const dayOfWeek = new Date().getDay(); // 0=Sun, 5=Fri
  const mode = args.mode || (dayOfWeek === 5 ? 'friday' : 'daily');

  // Date window: daily uses yesterday (runs at 04:00), full uses editorial week
  let dateWindow;
  if (mode === 'daily') {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const d = yesterday.toISOString().slice(0, 10);
    dateWindow = { start: d, end: d };
  } else {
    dateWindow = getWeekWindow(args.week, year);
  }

  // Build pipeline context
  const ctx = {
    runId: `${year}-W${String(args.week).padStart(2, '0')}-${Math.floor(Date.now() / 1000)}`,
    weekNumber: args.week,
    year,
    dateWindow,
    mode,
    stages: [],
    startedAt: new Date().toISOString(),
    lockFile: null,
  };

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool — Pipeline');
  console.log(`  Week ${ctx.weekNumber}, ${ctx.year}`);
  console.log(`  Window: ${dateWindow.start} → ${dateWindow.end}`);
  console.log(`  Mode: ${mode}`);
  console.log(`  Run ID: ${ctx.runId}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Dry run
  if (args.dryRun) {
    printDryRun(ctx);
    return ctx;
  }

  // Disk space check
  const availableMB = checkDiskSpace();
  log(`Disk space: ${availableMB === Infinity ? 'unknown' : availableMB + 'MB'} available`);

  // Acquire lock
  const { acquired, lockPath, reason } = acquireLock('pipeline');
  if (!acquired) {
    warn(`Cannot acquire lock: ${reason}`);
    warn('Another pipeline is already running. Exiting.');
    ctx.stages.push({
      name: 'lock',
      status: 'failed',
      attempts: 1,
      duration: 0,
      stats: {},
      errors: [`Lock not acquired: ${reason}`],
    });
    return ctx;
  }
  ctx.lockFile = lockPath;
  ok('Lock acquired');

  try {
    // Run the appropriate pipeline
    if (mode === 'daily') {
      await runDailyPipeline(ctx);
    } else {
      await runFullPipeline(ctx);
    }
  } finally {
    // Always release lock
    releaseLock(lockPath);
    ok('Lock released');
  }

  // Save run summary
  const runsDir = join(ROOT, 'output', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const summaryPath = join(runsDir, `pipeline-${today}.json`);

  ctx.completedAt = new Date().toISOString();
  ctx.totalDuration = Date.now() - pipelineStart;

  try {
    writeFileSync(summaryPath, JSON.stringify(ctx, null, 2), 'utf8');
    ok(`Run summary saved to ${summaryPath}`);
  } catch (err) {
    warn(`Failed to save run summary: ${err.message}`);
  }

  // Final report
  const totalElapsed = (ctx.totalDuration / 1000).toFixed(1);
  const failedCount = ctx.stages.filter(s => s.status === 'failed').length;
  const skippedCount = ctx.stages.filter(s => s.status === 'skipped').length;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Pipeline Complete');
  console.log(`  Total time: ${totalElapsed}s`);
  console.log(`  Stages: ${ctx.stages.length} total, ${failedCount} failed, ${skippedCount} skipped`);
  for (const stage of ctx.stages) {
    const icon = stage.status === 'success' ? '✓' :
                 stage.status === 'failed'  ? '✗' :
                 stage.status === 'skipped' ? '⊘' : '?';
    const elapsed = (stage.duration / 1000).toFixed(1);
    console.log(`    ${icon} ${stage.name}: ${stage.status} (${elapsed}s)`);
  }
  console.log(`  Summary: ${summaryPath}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Pipeline-complete notification
  sendAlert('SNI Pipeline',
    `Pipeline complete — ${ctx.stages.length} stages, ${failedCount} failed (${totalElapsed}s)`);

  return ctx;
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  // Catch unhandled rejections without crashing the pipeline
  process.on('unhandledRejection', (reason) => {
    console.warn(`[unhandledRejection] ${reason}`);
  });

  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')    { args.week = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--year')    { args.year = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--mode')    { args.mode = argv[++i]; continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
  }

  runPipeline(args)
    .then(ctx => {
      const failed = ctx.stages.filter(s => s.status === 'failed').length;
      if (failed > 0) {
        log(`Pipeline finished with ${failed} failed stage(s)`);
        process.exit(1);
      }
      log('Pipeline finished successfully');
      process.exit(0);
    })
    .catch(err => {
      console.error('Pipeline fatal error:', err);
      process.exit(1);
    });
}
