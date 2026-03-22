#!/usr/bin/env bun
/**
 * pipeline-alerts.js — Post-pipeline health checks and Telegram alerts
 *
 * Reads pipeline output files and sends alerts for failures/degradation.
 * Does not import or modify any pipeline modules.
 *
 * Usage:
 *   bun scripts/pipeline-alerts.js              # Run all checks
 *   bun scripts/pipeline-alerts.js --dry-run    # Print alerts without sending
 *   bun scripts/pipeline-alerts.js --test       # Send a test message
 *   bun scripts/pipeline-alerts.js --check fetch
 *   bun scripts/pipeline-alerts.js --check satellite
 *   bun scripts/pipeline-alerts.js --reset      # Clear suppression state
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendTelegram } from './lib/telegram.js';
import { sendAlert } from './lib/alert.js';
import {
  checkBraveApi,
  checkZeroArticles,
  checkStageFailed,
  checkHighFlagRate,
  checkSourceHealth,
  checkVolumeDropped,
  checkSatelliteJob,
  checkFetchErrorLog,
  checkJobRan,
  checkErrorRateTrend,
  formatConsolidatedMessage,
  shouldSend,
} from './lib/alert-checks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// ─── File readers ─────────────────────────────────────────────────────────────

function loadJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    warn(`Failed to parse ${path}: ${err.message}`);
    return null;
  }
}

function loadAlertState() {
  return loadJson(join(ROOT, 'data', 'alert-state.json')) || { lastAlerts: {} };
}

function saveAlertState(state) {
  state.lastRunAt = new Date().toISOString();
  const dir = join(ROOT, 'data');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'alert-state.json'), JSON.stringify(state, null, 2), 'utf8');
}

function loadTodayRun() {
  const today = new Date().toISOString().slice(0, 10);
  return loadJson(join(ROOT, 'output', 'runs', `pipeline-${today}.json`));
}

function loadRecentRuns(days = 7) {
  const runs = [];
  for (let i = 1; i <= days; i++) { // start at 1 to skip today
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const run = loadJson(join(ROOT, 'output', 'runs', `pipeline-${dateStr}.json`));
    if (run) runs.push(run);
  }
  return runs;
}

function loadSatelliteRun(prefix) {
  const today = new Date().toISOString().slice(0, 10);
  return loadJson(join(ROOT, 'output', 'runs', `${prefix}-${today}.json`));
}

// ─── File-reading wrappers for pure check functions ───────────────────────────

function readFetchErrorLogTail() {
  const logPath = join(ROOT, 'logs', 'fetch-error.log');
  if (!existsSync(logPath)) return { lines: null, isToday: false };
  const mtime = statSync(logPath).mtime;
  const today = new Date().toISOString().slice(0, 10);
  const isToday = mtime.toISOString().slice(0, 10) === today;
  const content = readFileSync(logPath, 'utf8');
  return { lines: content.split('\n').slice(-500), isToday };
}

function checkJobExists() {
  const today = new Date().toISOString().slice(0, 10);
  const summaryExists = existsSync(join(ROOT, 'output', 'runs', `pipeline-${today}.json`));
  const lockExists = existsSync(join(ROOT, 'data', '.pipeline.lock'));
  return { summaryExists, lockExists };
}

function computeErrorRate(run) {
  const fetchStage = run.stages?.find(s => s.name === 'fetch');
  if (!fetchStage) return 0;
  const qs = fetchStage.stats?.queryStats || {};
  const total = Object.keys(qs).length;
  if (total === 0) return 0;
  const withErrors = Object.values(qs).filter(q => (q.errors || 0) > 0).length;
  return withErrors / total;
}

// ─── Check runners ────────────────────────────────────────────────────────────

function runFetchChecks() {
  const alerts = [];
  const run = loadTodayRun();

  // Job-level check
  const { summaryExists, lockExists } = checkJobExists();
  const jobAlert = checkJobRan(summaryExists, lockExists);
  if (jobAlert) alerts.push(jobAlert);

  if (run) {
    // Immediate checks
    const braveAlert = checkBraveApi(run);
    if (braveAlert) alerts.push(braveAlert);

    const zeroAlert = checkZeroArticles(run);
    if (zeroAlert) alerts.push(zeroAlert);

    const stageAlerts = checkStageFailed(run);
    alerts.push(...stageAlerts);

    const flagAlert = checkHighFlagRate(run);
    if (flagAlert) alerts.push(flagAlert);

    // Log scanning (pure function — we read the file, pass lines in)
    const { lines: logTail, isToday } = readFetchErrorLogTail();
    const logAlert = checkFetchErrorLog(logTail, isToday);
    if (logAlert) alerts.push(logAlert);

    // Trend checks
    const recentRuns = loadRecentRuns(7);
    if (recentRuns.length >= 3) {
      const todaySaved = run.stages?.find(s => s.name === 'fetch')?.stats?.saved ?? 0;
      const recentSaved = recentRuns.map(r => r.stages?.find(s => s.name === 'fetch')?.stats?.saved ?? 0);
      const volumeAlert = checkVolumeDropped(todaySaved, recentSaved);
      if (volumeAlert) alerts.push(volumeAlert);

      // Error rate trend
      const todayRate = computeErrorRate(run);
      const recentRates = recentRuns.map(computeErrorRate);
      const errAlert = checkErrorRateTrend(todayRate, recentRates);
      if (errAlert) alerts.push(errAlert);
    }

    // Source health
    const health = loadJson(join(ROOT, 'data', 'source-health.json'));
    if (health) {
      const healthAlerts = checkSourceHealth(health);
      alerts.push(...healthAlerts);
    }
  }

  return alerts;
}

function runSatelliteChecks() {
  const alerts = [];

  const podcastAlert = checkSatelliteJob(
    loadSatelliteRun('podcast-import'), 'podcast-import', 'Podcast import');
  if (podcastAlert) alerts.push(podcastAlert);

  // EV extraction — info-level only (may not be installed)
  const evRun = loadSatelliteRun('ev-extract');
  if (evRun === null) {
    // Only alert if EV plist exists (job is installed)
    if (existsSync(join(ROOT, 'com.sni.ev-extract.plist'))) {
      alerts.push({
        type: 'ev-extract-missing',
        severity: 'info',
        message: 'EV extraction didn\'t run today.',
      });
    }
  }

  return alerts;
}

// formatConsolidatedMessage is imported from alert-checks.js

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const testMode = argv.includes('--test');
  const resetMode = argv.includes('--reset');
  const checkIdx = argv.indexOf('--check');
  const checkScope = checkIdx >= 0 ? argv[checkIdx + 1] : 'all';

  // --test: send test message and exit
  if (testMode) {
    const result = await sendTelegram('🔧 SNI Pipeline Alert system test — all clear.');
    log(`Test message: ${result.ok ? 'sent' : 'failed'} ${result.error || ''}`);
    process.exit(result.ok ? 0 : 1);
  }

  // --reset: clear suppression state
  if (resetMode) {
    saveAlertState({ lastAlerts: {} });
    log('Alert state cleared');
    process.exit(0);
  }

  // Load suppression state
  const state = loadAlertState();

  // Collect alerts
  let alerts = [];
  if (checkScope === 'all' || checkScope === 'fetch') {
    alerts.push(...runFetchChecks());
  }
  if (checkScope === 'all' || checkScope === 'satellite') {
    alerts.push(...runSatelliteChecks());
  }

  log(`Checks complete: ${alerts.length} alert(s) found`);

  if (alerts.length === 0) {
    log('All clear — no alerts');
    saveAlertState(state);
    return;
  }

  // Apply suppression
  const unsuppressed = alerts.filter(a => shouldSend(a, state));
  const suppressed = alerts.length - unsuppressed.length;
  if (suppressed > 0) log(`Suppressed ${suppressed} duplicate alert(s)`);

  if (unsuppressed.length === 0) {
    log('All alerts suppressed — nothing to send');
    saveAlertState(state);
    return;
  }

  // Split by delivery channel
  const telegramAlerts = unsuppressed.filter(a => a.severity !== 'info');
  const infoAlerts = unsuppressed.filter(a => a.severity === 'info');

  // Send Telegram (consolidated)
  if (telegramAlerts.length > 0) {
    const message = formatConsolidatedMessage(telegramAlerts);

    if (dryRun) {
      log('DRY RUN — would send Telegram:');
      console.log(message);
    } else {
      const result = await sendTelegram(message);
      if (result.ok) {
        log(`Telegram alert sent (${telegramAlerts.length} items)`);
      } else {
        warn(`Telegram failed: ${result.error} — falling back to macOS notification`);
        sendAlert('SNI Pipeline Alert', `${telegramAlerts.length} issue(s) detected. Check logs.`);
      }
    }
  }

  // Send info alerts via macOS notification only
  for (const alert of infoAlerts) {
    if (dryRun) {
      log(`DRY RUN — macOS notification: ${alert.message}`);
    } else {
      sendAlert('SNI Pipeline', alert.message);
    }
  }

  // Update suppression state
  for (const alert of unsuppressed) {
    state.lastAlerts[alert.type] = new Date().toISOString();
  }
  saveAlertState(state);

  log(`Done — sent ${unsuppressed.length} alert(s)`);
}

main().catch(err => {
  console.error(`[pipeline-alerts] Fatal: ${err.message}`);
  process.exit(1);
});
