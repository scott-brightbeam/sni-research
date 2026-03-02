#!/usr/bin/env bun
/**
 * notify.js — iMessage notification for SNI Research Tool
 *
 * Sends a pipeline summary via iMessage using osascript.
 * Falls back to writing a notification file if iMessage fails.
 *
 * Usage:
 *   bun scripts/notify.js --summary output/runs/pipeline-2026-02-27.json
 *   bun scripts/notify.js --summary output/runs/pipeline-2026-02-27.json --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

import { loadEnvKey } from './lib/env.js';

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const OSASCRIPT_TIMEOUT_MS = 10000;

// ─── iMessage sending ────────────────────────────────────────────────────────

/**
 * Send an iMessage via osascript.
 * @param {string} message — multi-line plain text
 * @param {string} recipient — iCloud email or phone number
 * @returns {Promise<{ sent: boolean, error: string|null }>}
 */
async function sendIMessage(message, recipient) {
  // Escape special characters for AppleScript string
  const escaped = message
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');

  const script = `
tell application "Messages"
  send "${escaped}" to buddy "${recipient}" of (service 1 whose service type is iMessage)
end tell`;

  return new Promise((resolve) => {
    const proc = spawn('osascript', ['-e', script], {
      timeout: OSASCRIPT_TIMEOUT_MS,
    });

    let stderr = '';
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ sent: true, error: null });
      } else {
        resolve({ sent: false, error: stderr.trim() || `osascript exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ sent: false, error: err.message });
    });
  });
}

// ─── Notification formatting ────────────────────────────────────────────────

/**
 * Format a pipeline summary into a human-readable notification.
 * @param {object} ctx — PipelineContext (or summary JSON)
 * @returns {string}
 */
function formatNotification(ctx) {
  const lines = [];
  const weekNum = ctx.weekNumber || 'unknown';

  // Determine headline status
  const stages = ctx.stages || [];
  const draftStage = stages.find(s => s.name === 'draft');
  const reviewStage = stages.find(s => s.name === 'review');
  const linkStage = stages.find(s => s.name === 'verify-links');
  const fetchStage = stages.find(s => s.name === 'fetch');
  const scoreStage = stages.find(s => s.name === 'score');

  const draftFailed = draftStage && draftStage.status === 'failed';
  const headline = draftFailed
    ? `SNI Week ${weekNum} — Research pack only (draft failed)`
    : `SNI Week ${weekNum} — Draft ready`;

  lines.push(headline);
  lines.push('');

  // Draft/report path
  if (draftFailed) {
    const reportStage = stages.find(s => s.name === 'report');
    if (reportStage?.stats?.reportPath) {
      lines.push(`Research pack: ${reportStage.stats.reportPath}`);
    }
    if (draftStage.errors?.length > 0) {
      lines.push(`Error: ${draftStage.errors[draftStage.errors.length - 1]}`);
    }
  } else if (draftStage?.stats?.draftPath) {
    lines.push(`Draft: ${draftStage.stats.draftPath}`);
    if (draftStage.stats.theme) {
      lines.push(`Theme: ${draftStage.stats.theme}`);
    }
  }

  lines.push('');

  // Pipeline stats
  const totalStages = stages.length;
  const failedStages = stages.filter(s => s.status === 'failed').length;
  const totalDurationMs = stages.reduce((sum, s) => sum + (s.duration || 0), 0);
  const totalDuration = formatDuration(totalDurationMs);

  lines.push(`Pipeline: ${totalStages} stages in ${totalDuration}${failedStages > 0 ? ` (${failedStages} failed)` : ''}`);

  // Article counts
  const found = fetchStage?.stats?.saved || 0;
  const scored = scoreStage?.stats?.kept || 0;
  const inDraft = draftStage?.stats?.stats?.articles ?? draftStage?.stats?.articles ?? 0;

  if (found > 0 || scored > 0) {
    let articleLine = `Articles: ${found} found`;
    if (scored > 0) articleLine += ` → ${scored} scored relevant`;
    if (inDraft > 0 && !draftFailed) articleLine += ` → ${inDraft} in draft`;
    lines.push(articleLine);
  }

  // Sector breakdown
  const bySector = draftStage?.stats?.stats?.bySector ?? draftStage?.stats?.bySector ?? scoreStage?.stats?.bySector;
  if (bySector && Object.keys(bySector).length > 0) {
    const parts = Object.entries(bySector)
      .filter(([, count]) => count > 0)
      .map(([sector, count]) => `${sector} (${count})`);
    if (parts.length > 0) {
      lines.push(`Sectors: ${parts.join(', ')}`);
    }
  }

  lines.push('');

  // Self-review
  if (reviewStage) {
    if (reviewStage.status === 'failed' || reviewStage.status === 'skipped') {
      lines.push('Self-review: UNREVIEWED');
    } else {
      const pass = reviewStage.stats?.stats?.pass ?? reviewStage.stats?.pass;
      const issues = reviewStage.stats?.stats?.issueCount ?? reviewStage.stats?.issueCount ?? 0;
      lines.push(`Self-review: ${pass ? 'PASS' : 'FAIL'} (${issues} issues)`);
    }
  }

  // Links
  if (linkStage) {
    if (linkStage.status === 'failed' || linkStage.status === 'skipped') {
      lines.push('Links: UNCHECKED');
    } else {
      const summary = linkStage.stats?.summary || {};
      const okCount = summary.ok || 0;
      const total = summary.checked || summary.total || 0;
      const warnings = (summary.dead || 0) + (summary.mismatch || 0) + (summary.timeout || 0);
      lines.push(`Links: ${okCount}/${total} verified (${warnings} warnings)`);
    }
  }

  // Error details for failed stages
  const failedStageDetails = stages.filter(s => s.status === 'failed' && s.errors?.length > 0);
  if (failedStageDetails.length > 0) {
    lines.push('');
    for (const stage of failedStageDetails) {
      lines.push(`⚠ ${stage.name}: ${stage.errors[stage.errors.length - 1]}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format milliseconds into a human-readable duration.
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Send pipeline notification via iMessage (with file fallback).
 *
 * @param {object} args
 * @param {string} [args.summary] — path to pipeline run JSON
 * @param {object} [args.context] — PipelineContext object (alternative to summary file)
 * @param {string} [args.recipient] — override recipient email
 * @param {boolean} [args.dryRun] — print notification without sending
 * @returns {{ sent: boolean, fallbackPath: string|null, message: string }}
 */
export async function runNotify(args = {}) {
  const startTime = Date.now();

  // Load pipeline context
  let ctx;
  if (args.context) {
    ctx = args.context;
  } else if (args.summary) {
    if (!existsSync(args.summary)) {
      throw new Error(`Summary file not found: ${args.summary}`);
    }
    ctx = JSON.parse(readFileSync(args.summary, 'utf8'));
  } else {
    throw new Error('Either --summary <path> or context object is required');
  }

  // Format notification
  const message = formatNotification(ctx);

  log('Notification:');
  console.log('');
  console.log(message);
  console.log('');

  if (args.dryRun) {
    ok('Dry run — notification not sent');
    return { sent: false, fallbackPath: null, message, dryRun: true };
  }

  // Determine recipient
  const recipient = args.recipient || loadEnvKey('SNI_NOTIFY_RECIPIENT');
  if (!recipient) {
    warn('No recipient configured (set SNI_NOTIFY_RECIPIENT in .env)');
    // Fall through to file fallback
    return saveFallback(ctx, message);
  }

  // Send via iMessage
  log(`Sending via iMessage to ${recipient}...`);
  const { sent, error } = await sendIMessage(message, recipient);

  if (sent) {
    ok('Notification sent via iMessage');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    return { sent: true, fallbackPath: null, message, elapsed: parseFloat(elapsed) };
  }

  // iMessage failed — fall back to file
  warn(`iMessage failed: ${error}`);
  return saveFallback(ctx, message);
}

/**
 * Save notification to a fallback file.
 */
function saveFallback(ctx, message) {
  const weekNum = ctx.weekNumber || 'unknown';
  const outputDir = join(ROOT, 'output');
  const fallbackPath = join(outputDir, `notification-week-${weekNum}.txt`);

  try {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(fallbackPath, message, 'utf8');
    ok(`Notification saved to ${fallbackPath}`);
    return { sent: false, fallbackPath, message };
  } catch (err) {
    warn(`Failed to save notification fallback: ${err.message}`);
    return { sent: false, fallbackPath: null, message };
  }
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--summary')   { args.summary = argv[++i]; continue; }
    if (argv[i] === '--recipient') { args.recipient = argv[++i]; continue; }
    if (argv[i] === '--dry-run')   { args.dryRun = true; continue; }
  }

  if (!args.summary) {
    console.error('Usage: bun scripts/notify.js --summary <path> [--recipient <email>] [--dry-run]');
    process.exit(1);
  }

  runNotify(args)
    .then(result => {
      log(`Result: sent=${result.sent} fallback=${result.fallbackPath || 'none'}`);
      process.exit(0);
    })
    .catch(err => {
      warn(`Fatal: ${err.message}`);
      process.exit(1);
    });
}
