# Pipeline Alerts — Design Spec

**Date:** 2026-03-22
**Status:** Draft
**Scope:** New standalone alerting script + launchd jobs

## Problem

The SNI pipeline has no persistent alerting. The Brave Search API hit its $50 spend cap on March 15 and returned zero search results for a full week before anyone noticed. macOS Notification Centre alerts are ephemeral and easily missed. The iMessage notification only fires on full Thursday pipeline runs. There is no cross-run trend detection, no satellite job monitoring, and no suppression of duplicate alerts.

## Solution

A standalone `scripts/pipeline-alerts.js` that reads pipeline output files (never imports pipeline modules), detects failures and degradation, and sends Telegram alerts via Zaphod's bot API. Runs as its own launchd jobs after pipeline and satellite jobs complete.

## Architecture constraints

- All code in `scripts/pipeline-alerts.js` + `scripts/lib/telegram.js` (new files only)
- Reads `output/runs/`, `data/source-health.json`, `logs/` — never modifies them
- Never imports from pipeline modules — standalone reader
- Credentials in `.env` (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`)
- Alert state persisted in `data/alert-state.json`

## File inventory

| File | Purpose |
|------|---------|
| `scripts/lib/telegram.js` | Telegram Bot API wrapper — `sendTelegram(text, opts)` |
| `scripts/pipeline-alerts.js` | Main alert runner — reads state, runs checks, sends alerts |
| `scripts/tests/pipeline-alerts.test.js` | Unit tests for check functions |
| `data/alert-state.json` | Persistent state (last alert times, suppression windows) |
| `com.sni.alerts-post-fetch.plist` | launchd job: 04:45 daily |
| `com.sni.alerts-post-satellite.plist` | launchd job: 08:00 daily |

## Telegram delivery — `scripts/lib/telegram.js`

```js
import { loadEnvKey } from './env.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a Telegram message via Zaphod's bot API.
 * @param {string} text — message body (Markdown)
 * @param {object} [opts]
 * @param {string} [opts.parseMode='HTML'] — 'MarkdownV2' | 'HTML'
 * @returns {Promise<{ ok: boolean, messageId?: number, error?: string }>}
 */
export async function sendTelegram(text, opts = {}) {
  const token = loadEnvKey('TELEGRAM_BOT_TOKEN');
  const chatId = loadEnvKey('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    console.warn('[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return { ok: false, error: 'missing credentials' };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode || 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || 'unknown' };
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    console.warn(`[telegram] Send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
```

## Alert state — `data/alert-state.json`

Tracks when each alert type was last sent to suppress duplicates.

```json
{
  "lastAlerts": {
    "brave-api-down": "2026-03-15T04:45:00.000Z",
    "zero-articles": "2026-03-16T04:45:00.000Z"
  },
  "lastRunAt": "2026-03-22T04:45:00.000Z"
}
```

**Suppression rules:**
- Critical alerts: suppress for 24 hours, then send "still occurring" reminder
- Warning alerts: suppress for 72 hours
- After 3 days of continuous suppression, escalate with "ONGOING" prefix

## Check categories

### 1. Immediate failure checks

Run after every fetch. Read today's run summary from `output/runs/pipeline-YYYY-MM-DD.json`.

| Check | Condition | Severity | Message |
|-------|-----------|----------|---------|
| **Brave API down** | Fetch stats: all Brave queries returned 0 results, or `fetchErrors` > 80% of total queries, or error log contains `402` / `USAGE_LIMIT` | 🔴 Critical | `🚨 Brave Search API down — 0 results from N queries. Check API key / spend cap.` |
| **Zero articles** | `stats.saved === 0` in fetch stage | 🔴 Critical | `🚨 Fetch saved 0 articles — pipeline has no new content.` |
| **Stage failure** | Any stage with `status === 'failed'` | 🔴 Critical | `🚨 Pipeline stage "{name}" failed: {error}` |
| **Job didn't run** | No run summary file for today by check time (04:45) | 🟡 Warning | `⚠️ No pipeline run summary for today — launchd job may have failed.` |
| **High flag rate** | Score stage: `moved / total > 0.25` (25%) | 🟡 Warning | `⚠️ {pct}% of articles flagged for review — possible scoring issue.` |

**Brave API detection logic:**

```js
function checkBraveApi(runSummary) {
  const fetchStage = runSummary.stages?.find(s => s.name === 'fetch');
  if (!fetchStage) return null;

  const stats = fetchStage.stats || {};
  const queryStats = stats.queryStats || {};
  const braveQueries = Object.entries(queryStats)
    .filter(([key]) => key.startsWith('L1:') || key.startsWith('L2:') ||
                       key.startsWith('L3:') || key.startsWith('L4:'));

  if (braveQueries.length === 0) return null;

  const totalResults = braveQueries.reduce((sum, [, q]) => sum + (q.results || 0), 0);
  const totalErrors = braveQueries.reduce((sum, [, q]) => sum + (q.errors || 0), 0);

  if (totalResults === 0) {
    return {
      type: 'brave-api-down',
      severity: 'critical',
      message: `🚨 <b>Brave Search API down</b> — 0 results from ${braveQueries.length} queries. Check API key / spend cap.`,
    };
  }

  // High error rate across Brave queries (individual URL fetch errors)
  const errorRate = totalErrors / braveQueries.length;
  if (errorRate > 0.80) {
    return {
      type: 'brave-api-errors',
      severity: 'critical',
      message: `🚨 <b>Brave Search</b> — ${(errorRate * 100).toFixed(0)}% query error rate (${totalErrors}/${braveQueries.length}). API may be degraded.`,
    };
  }

  return null;
}
```

**Log scanning for 402 errors:**

The fetch error log format is `[HH:MM:SS] ⚠ Brave API error 402 for: <query>` with no date prefix. We use the file's mtime to determine if it was written today, then read the tail (last 500 lines) to count 402 errors. This avoids parsing the entire log.

```js
import { statSync } from 'fs';

function checkFetchErrorLog() {
  const logPath = join(ROOT, 'logs', 'fetch-error.log');
  if (!existsSync(logPath)) return null;

  // Only check if log was modified today
  const mtime = statSync(logPath).mtime;
  const today = new Date().toISOString().slice(0, 10);
  if (mtime.toISOString().slice(0, 10) !== today) return null;

  const content = readFileSync(logPath, 'utf8');
  const lines = content.split('\n');
  // Read last 500 lines (tail of today's run)
  const tail = lines.slice(-500);

  const errors402 = tail.filter(l => l.includes('Brave API error 402')).length;
  if (errors402 > 10) {
    return {
      type: 'brave-api-402',
      severity: 'critical',
      message: `🚨 <b>Brave Search API</b> — ${errors402} HTTP 402 errors in latest run. Spend limit likely exceeded.`,
    };
  }
  return null;
}
```

**Zero articles check:**

```js
function checkZeroArticles(runSummary) {
  const fetchStage = runSummary.stages?.find(s => s.name === 'fetch');
  if (!fetchStage || fetchStage.status === 'failed') return null; // handled by checkStageFailed

  const saved = fetchStage.stats?.saved ?? -1;
  if (saved === 0) {
    return {
      type: 'zero-articles',
      severity: 'critical',
      message: '🚨 <b>Fetch saved 0 articles</b> — pipeline has no new content.',
    };
  }
  return null;
}
```

**Stage failure check:**

```js
function checkStageFailed(runSummary) {
  const failed = (runSummary.stages || []).filter(s => s.status === 'failed');
  return failed.map(s => ({
    type: `stage-failed-${s.name}`,
    severity: 'critical',
    message: `🚨 Pipeline stage <b>${s.name}</b> failed: ${s.errors?.[0] || 'unknown error'}`,
  }));
}
```

**Job didn't run check:**

```js
function checkJobRan() {
  const today = new Date().toISOString().slice(0, 10);
  const summaryPath = join(ROOT, 'output', 'runs', `pipeline-${today}.json`);

  if (!existsSync(summaryPath)) {
    // Check if pipeline is still running (lock file present)
    const lockPath = join(ROOT, 'data', '.pipeline.lock');
    if (existsSync(lockPath)) return null; // still running, don't alert

    return {
      type: 'job-didnt-run',
      severity: 'warning',
      message: '⚠️ No pipeline run summary for today — launchd job may have failed.',
    };
  }
  return null;
}
```

**High flag rate check:**

```js
function checkHighFlagRate(runSummary) {
  // Check both 'score' and 'score-discover' stages
  const scoreStages = (runSummary.stages || [])
    .filter(s => (s.name === 'score' || s.name === 'score-discover') && s.status === 'success');

  for (const stage of scoreStages) {
    const { total, moved } = stage.stats || {};
    if (!total || total === 0 || !moved) continue;

    const pct = ((moved / total) * 100).toFixed(1);
    if (moved / total > 0.25) {
      return {
        type: 'high-flag-rate',
        severity: 'warning',
        message: `⚠️ ${pct}% of articles flagged for review (${moved}/${total}) — possible scoring issue.`,
      };
    }
  }
  return null;
}
```

**Source health check:**

```js
function checkSourceHealth() {
  const healthPath = join(ROOT, 'data', 'source-health.json');
  if (!existsSync(healthPath)) return [];

  try {
    const health = JSON.parse(readFileSync(healthPath, 'utf8'));
    const alerts = [];
    for (const [name, entry] of Object.entries(health)) {
      if ((entry.consecutiveFailures || 0) >= 3) {
        alerts.push({
          type: `source-health-${name.toLowerCase().replace(/\s+/g, '-')}`,
          severity: 'warning',
          message: `⚠️ RSS source <b>${name}</b> has failed ${entry.consecutiveFailures} consecutive times: ${entry.lastError || 'unknown'}`,
        });
      }
    }
    return alerts;
  } catch {
    return [];
  }
}
```

### 2. Trend degradation checks

Compare today's run against the rolling 7-day history.

| Check | Condition | Severity | Message |
|-------|-----------|----------|---------|
| **Volume drop** | Today's `saved` count < 50% of 7-day daily average | 🟡 Warning | `⚠️ Article volume down — {today} saved vs {avg} avg/day (7d)` |
| **Error rate rising** | `fetchErrors / Object.keys(queryStats).length > 0.30` AND higher than 7-day avg | 🟡 Warning | `⚠️ Fetch error rate {pct}% — rising trend over 7 days` |
| **RSS source failures** | `source-health.json` entry with `consecutiveFailures >= 3` | 🟡 Warning | `⚠️ RSS source "{name}" has failed {n} consecutive times: {lastError}` |

**Rolling history logic:**

```js
function loadRecentRuns(days = 7) {
  const runsDir = join(ROOT, 'output', 'runs');
  const runs = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const path = join(runsDir, `pipeline-${dateStr}.json`);
    if (existsSync(path)) {
      try {
        runs.push(JSON.parse(readFileSync(path, 'utf8')));
      } catch {}
    }
  }
  return runs;
}
```

### 3. Satellite job checks

Check that auxiliary jobs (podcast import, EV extraction) completed when expected.

| Check | Condition | Severity | Message |
|-------|-----------|----------|---------|
| **Podcast import missing** | No `podcast-import-YYYY-MM-DD.json` in `output/runs/` for today | 🟡 Warning | `⚠️ Podcast import didn't run today` |
| **Podcast import empty** | Run summary exists but zero episodes imported | 🟡 Warning | `⚠️ Podcast import ran but found 0 new episodes` |
| **EV extraction missing** | No `ev-extract-YYYY-MM-DD.json` for today (if EV job is installed) | ℹ️ Info | macOS notification only |

**Satellite check logic:**

```js
function checkSatelliteJob(prefix, label) {
  const today = new Date().toISOString().slice(0, 10);
  const path = join(ROOT, 'output', 'runs', `${prefix}-${today}.json`);

  if (!existsSync(path)) {
    return {
      type: `${prefix}-missing`,
      severity: 'warning',
      message: `⚠️ <b>${label}</b> didn't run today — check launchd job.`,
    };
  }

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    // Check for zero output
    const count = data.stats?.saved ?? data.stats?.imported ?? data.stats?.extracted ?? -1;
    if (count === 0) {
      return {
        type: `${prefix}-empty`,
        severity: 'warning',
        message: `⚠️ <b>${label}</b> ran but produced 0 results.`,
      };
    }
  } catch {}

  return null;
}
```

## Main runner — `scripts/pipeline-alerts.js`

```js
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
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { sendTelegram } from './lib/telegram.js';
import { sendAlert } from './lib/alert.js';
import { loadEnvKey } from './lib/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
```

**Execution flow:**

1. Load alert state from `data/alert-state.json`
2. Run all check functions → collect `Alert[]`
3. Filter out suppressed alerts (check `lastAlerts` timestamps)
4. For each remaining alert:
   - Critical/Warning → `sendTelegram()`
   - Info → `sendAlert()` (macOS notification)
5. Update `data/alert-state.json` with sent timestamps
6. Log summary to stdout (captured by launchd)

**Alert type:**

```ts
interface Alert {
  type: string;        // e.g. 'brave-api-down'
  severity: 'critical' | 'warning' | 'info';
  message: string;     // Telegram Markdown formatted
}
```

**Suppression logic:**

```js
const SUPPRESSION_WINDOWS = {
  critical: 24 * 60 * 60 * 1000,   // 24 hours
  warning:  72 * 60 * 60 * 1000,   // 72 hours
};
const ESCALATION_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3 days

function shouldSend(alert, state) {
  const lastSent = state.lastAlerts?.[alert.type];
  if (!lastSent) return true;

  const elapsed = Date.now() - new Date(lastSent).getTime();
  const window = SUPPRESSION_WINDOWS[alert.severity] || SUPPRESSION_WINDOWS.warning;

  if (elapsed < window) return false;

  // After escalation threshold, prefix with ONGOING
  if (elapsed > ESCALATION_THRESHOLD) {
    alert.message = `🔄 ONGOING: ${alert.message}`;
  }

  return true;
}
```

## CLI flags

| Flag | Behaviour |
|------|-----------|
| (none) | Run all checks, send alerts |
| `--dry-run` | Run checks, print alerts to stdout, don't send |
| `--test` | Send a test Telegram message and exit |
| `--check fetch` | Run only fetch-related checks |
| `--check satellite` | Run only satellite job checks |
| `--reset` | Clear alert state (forces re-send of all active alerts) |

## launchd jobs

### `com.sni.alerts-post-fetch.plist`

Runs at 04:45 daily — 45 minutes after the 04:00 fetch job, allowing time for completion.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sni.alerts-post-fetch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/scott/.bun/bin/bun</string>
    <string>/Users/scott/Projects/sni-research-v2/scripts/pipeline-alerts.js</string>
    <string>--check</string>
    <string>fetch</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/scott/Projects/sni-research-v2</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>4</integer>
    <key>Minute</key>
    <integer>45</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/alerts.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/scott/Projects/sni-research-v2/logs/alerts-error.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/scott/.bun/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
```

### `com.sni.alerts-post-satellite.plist`

Runs at 08:00 daily — after podcast import (07:00) and EV extraction (07:30).

Same structure, `--check satellite` flag, `Hour` = 8, `Minute` = 0.

## .env additions

```
TELEGRAM_BOT_TOKEN=<your-bot-token>
TELEGRAM_CHAT_ID=<your-chat-id>
```

## Testing strategy

Unit tests in `scripts/tests/pipeline-alerts.test.js` using Bun's native test runner.

| Test | What it covers |
|------|---------------|
| `checkBraveApi()` — zero results | Returns critical alert when all Brave queries have 0 results |
| `checkBraveApi()` — normal results | Returns null when queries have results |
| `checkZeroArticles()` — zero saved | Returns critical alert |
| `checkZeroArticles()` — nonzero saved | Returns null |
| `checkStageFailed()` — failed stage | Returns critical alert with stage name and error |
| `checkVolumeDropped()` — >50% drop | Returns warning with today vs average |
| `checkVolumeDropped()` — normal volume | Returns null |
| `checkSourceHealth()` — 3+ failures | Returns warning per failed source |
| `checkSatelliteJob()` — missing file | Returns warning |
| `checkSatelliteJob()` — zero results | Returns warning |
| `shouldSend()` — first alert | Returns true |
| `shouldSend()` — within suppression | Returns false |
| `shouldSend()` — after suppression | Returns true |
| `shouldSend()` — after escalation | Returns true with ONGOING prefix |

Tests use fixture data (inline JSON objects), not live files. Each check function is a pure function that receives data as parameters rather than reading files directly, enabling isolated testing.

## Edge cases

- **No run summaries at all** (fresh install): skip trend checks, only run immediate checks
- **Telegram API unreachable**: log warning, fall back to macOS notification
- **Malformed run summary JSON**: catch parse errors, skip that file, log warning
- **alert-state.json missing or corrupt**: create fresh state, all alerts will fire
- **Multiple failures in same run**: send one consolidated message grouping all alerts, not separate messages per check
- **Pipeline still running at 04:45**: "job didn't run" check uses a grace window — if no summary exists but the lock file is present, skip the check

## Consolidated message format

When multiple alerts fire in one run, group them into a single Telegram message using HTML parse mode:

```
🚨 <b>SNI Pipeline Alerts</b> — 2026-03-22

• Brave Search API down — 0 results from 329 queries
• Fetch saved 0 articles

<i>2 critical issues detected. Check dashboard for details.</i>
```

**Message length:** Telegram has a 4096-character limit. If the consolidated message exceeds 3800 characters, truncate the alert list and append `... and N more`. This is unlikely with the current check set but protects against future expansion or verbose error messages.
