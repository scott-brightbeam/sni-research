#!/usr/bin/env bun
/**
 * status.js — Pipeline status dashboard
 *
 * Shows last run summary, article counts, agent health, and recent errors.
 *
 * Usage:
 *   bun scripts/status.js
 *   bun scripts/status.js --json
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

// ─── Data collection ──────────────────────────────────────────────────────────

function getLastRun() {
  const runsDir = join(ROOT, 'output', 'runs');
  if (!existsSync(runsDir)) return null;
  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.json'))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(runsDir, files[0]), 'utf8'));
  } catch { return null; }
}

function getArticleCounts() {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return { today: 0, total: 0, dates: {} };
  const today = new Date().toISOString().slice(0, 10);
  const dates = {};
  let total = 0;
  for (const entry of readdirSync(verifiedDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
    const count = readdirSync(join(verifiedDir, entry.name))
      .filter(f => f.endsWith('.json')).length;
    dates[entry.name] = count;
    total += count;
  }
  return { today: dates[today] || 0, total, dates };
}

function getLaunchdStatus() {
  try {
    const output = execSync('launchctl list 2>/dev/null | grep com.sni', { encoding: 'utf8' });
    return output.trim().split('\n').map(line => {
      const [pid, exitCode, label] = line.trim().split(/\s+/);
      return { label, pid: pid === '-' ? null : parseInt(pid), exitCode: parseInt(exitCode) };
    });
  } catch { return []; }
}

function getRecentErrors(maxLines = 5) {
  const logPath = join(ROOT, 'logs', 'fetch-error.log');
  if (!existsSync(logPath)) return [];
  try {
    const content = readFileSync(logPath, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch { return []; }
}

// ─── Display ──────────────────────────────────────────────────────────────────

export function runStatus(args = {}) {
  const lastRun = getLastRun();
  const articles = getArticleCounts();
  const agents = getLaunchdStatus();
  const errors = getRecentErrors();

  if (args.json) {
    console.log(JSON.stringify({ lastRun, articles, agents, errors }, null, 2));
    return { lastRun, articles, agents, errors };
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool — Status');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Last run
  if (lastRun) {
    const failed = (lastRun.stages || []).filter(s => s.status === 'failed').length;
    const icon = failed > 0 ? '⚠' : '✓';
    console.log(`  ${icon} Last run: ${lastRun.mode} mode, ${lastRun.dateWindow?.start || '?'} → ${lastRun.dateWindow?.end || '?'}`);
    console.log(`    Completed: ${lastRun.completedAt || '?'}`);
    console.log(`    Duration:  ${formatDuration(lastRun.totalDuration || 0)}`);
    console.log(`    Stages:    ${(lastRun.stages || []).length} total, ${failed} failed`);
    for (const s of (lastRun.stages || [])) {
      const sIcon = s.status === 'success' ? '✓' : s.status === 'failed' ? '✗' : '⊘';
      console.log(`      ${sIcon} ${s.name}: ${s.status} (${formatDuration(s.duration || 0)})`);
    }
  } else {
    console.log('  No pipeline runs found');
  }

  console.log('');

  // Articles
  const today = new Date().toISOString().slice(0, 10);
  console.log(`  Articles: ${articles.today} today (${today}), ${articles.total} total`);
  const recentDates = Object.entries(articles.dates).sort().reverse().slice(0, 5);
  if (recentDates.length > 0) {
    for (const [date, count] of recentDates) {
      console.log(`    ${date}: ${count} articles`);
    }
  }

  console.log('');

  // launchd agents
  if (agents.length > 0) {
    console.log('  Agents:');
    for (const a of agents) {
      const status = a.exitCode === 0 ? '✓ OK' : `⚠ exit ${a.exitCode}`;
      console.log(`    ${a.label}: ${status}${a.pid ? ` (PID ${a.pid})` : ''}`);
    }
  } else {
    console.log('  Agents: none loaded (launchctl list found no com.sni entries)');
  }

  console.log('');

  // Recent errors
  if (errors.length > 0) {
    console.log('  Recent errors (fetch-error.log):');
    for (const line of errors) {
      console.log(`    ${line}`);
    }
  } else {
    console.log('  No recent errors');
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  return { lastRun, articles, agents, errors };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = {};
  if (process.argv.includes('--json')) args.json = true;
  runStatus(args);
}
