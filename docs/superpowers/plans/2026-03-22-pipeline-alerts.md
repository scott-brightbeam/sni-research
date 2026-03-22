# Pipeline Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standalone pipeline alerting that detects failures and degradation, sends Telegram alerts via Zaphod, and suppresses duplicates.

**Architecture:** New `scripts/pipeline-alerts.js` reads pipeline output files (never imports pipeline modules). Pure check functions take data as params for testability. Consolidated messages sent via Telegram Bot API through `scripts/lib/telegram.js`. Alert state persisted in `data/alert-state.json` to suppress duplicates.

**Tech Stack:** Bun, Telegram Bot API (HTTP), `bun:test`

**Spec:** `docs/superpowers/specs/2026-03-22-pipeline-alerts-design.md`

**Existing dependencies (do not create — already exist):**
- `scripts/lib/env.js` — `loadEnvKey()` for .env parsing (Bun >=1.3 workaround)
- `scripts/lib/alert.js` — `sendAlert()` for macOS Notification Centre (fire-and-forget)

---

### Task 1: Telegram wrapper + .env credentials

**Files:**
- Create: `scripts/lib/telegram.js`
- Modify: `.env` (append 2 lines)

- [ ] **Step 1: Add Telegram credentials to .env**

Append to `.env`:

```
TELEGRAM_BOT_TOKEN=<bot-token-from-openclaw-config>
TELEGRAM_CHAT_ID=<chat-id-from-gateway-logs>
```

The actual values are already verified working (test message sent successfully during design). Use `cat /Users/scott/.openclaw/openclaw.json | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['channels']['telegram']['botToken'])"` for the token. Chat ID was resolved to `8454135977` from gateway logs.

- [ ] **Step 2: Create `scripts/lib/telegram.js`**

```js
/**
 * telegram.js — Telegram Bot API wrapper for SNI alerts
 *
 * Sends messages via Zaphod bot. Uses HTML parse mode for reliable formatting.
 * Fire-and-forget — caller handles fallback to macOS notifications.
 */

import { loadEnvKey } from './env.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a Telegram message via Zaphod's bot API.
 * @param {string} text — message body (HTML formatted)
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

- [ ] **Step 3: Verify Telegram delivery works**

Run: `bun -e "import { sendTelegram } from './scripts/lib/telegram.js'; const r = await sendTelegram('🔧 Pipeline alerts build test'); console.log(r);"`

Expected: `{ ok: true, messageId: <number> }` and message appears in Telegram.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/telegram.js
git commit -m "feat: add Telegram bot API wrapper for pipeline alerts"
```

Note: Do NOT commit `.env` — it's in `.gitignore`.

---

### Task 2: Check functions + suppression logic (tests first)

**Files:**
- Create: `scripts/tests/pipeline-alerts.test.js`
- Create: `scripts/lib/alert-checks.js`

The check functions are split into their own module (`alert-checks.js`) for clean testability — the main runner imports them.

- [ ] **Step 1: Write all tests in `scripts/tests/pipeline-alerts.test.js`**

```js
import { describe, it, expect } from 'bun:test';

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
  SUPPRESSION_WINDOWS,
  ESCALATION_THRESHOLD,
} from '../lib/alert-checks.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const braveDownSummary = {
  stages: [{
    name: 'fetch',
    status: 'success',
    stats: {
      saved: 0,
      queryStats: {
        'L1: biopharma query March 2026': { results: 0, new: 0, saved: 0, errors: 0 },
        'L1: medtech query March 2026': { results: 0, new: 0, saved: 0, errors: 0 },
        'L2: Reuters AI March 2026': { results: 0, new: 0, saved: 0, errors: 0 },
      },
    },
  }],
};

const braveHighErrorSummary = {
  stages: [{
    name: 'fetch',
    status: 'success',
    stats: {
      saved: 2,
      queryStats: {
        'L1: query1': { results: 5, new: 3, saved: 1, errors: 2 },
        'L1: query2': { results: 3, new: 2, saved: 1, errors: 1 },
        'L1: query3': { results: 2, new: 1, saved: 0, errors: 3 },
        'L1: query4': { results: 1, new: 0, saved: 0, errors: 1 },
        'L2: query5': { results: 10, new: 5, saved: 0, errors: 2 },
      },
    },
  }],
};

const normalSummary = {
  stages: [{
    name: 'fetch',
    status: 'success',
    stats: {
      saved: 14,
      queryStats: {
        'L1: query1': { results: 20, new: 15, saved: 5, errors: 2 },
        'L2: query2': { results: 10, new: 8, saved: 3, errors: 1 },
      },
    },
  }, {
    name: 'score',
    status: 'success',
    stats: { total: 40, kept: 38, moved: 2 },
  }],
};

const failedStageSummary = {
  stages: [
    { name: 'fetch', status: 'success', stats: { saved: 10 } },
    { name: 'draft', status: 'failed', errors: ['Anthropic API timeout after 120s'] },
  ],
};

const highFlagSummary = {
  stages: [{
    name: 'fetch',
    status: 'success',
    stats: { saved: 20 },
  }, {
    name: 'score',
    status: 'success',
    stats: { total: 20, kept: 14, moved: 6 },
  }],
};

// ─── checkBraveApi ────────────────────────────────────────────────────────────

describe('checkBraveApi', () => {
  it('returns critical alert when all Brave queries return 0 results', () => {
    const alert = checkBraveApi(braveDownSummary);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('brave-api-down');
    expect(alert.severity).toBe('critical');
    expect(alert.message).toContain('0 results from 3 queries');
  });

  it('returns critical alert when error rate > 80%', () => {
    const alert = checkBraveApi(braveHighErrorSummary);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('brave-api-errors');
    expect(alert.severity).toBe('critical');
  });

  it('returns null when queries have results and low error rate', () => {
    const alert = checkBraveApi(normalSummary);
    expect(alert).toBeNull();
  });

  it('returns null when no fetch stage exists', () => {
    const alert = checkBraveApi({ stages: [] });
    expect(alert).toBeNull();
  });

  it('returns null when no Brave queries exist (RSS-only run)', () => {
    const alert = checkBraveApi({
      stages: [{ name: 'fetch', status: 'success', stats: { saved: 5, queryStats: { 'RSS: feed1': { results: 10 } } } }],
    });
    expect(alert).toBeNull();
  });
});

// ─── checkZeroArticles ────────────────────────────────────────────────────────

describe('checkZeroArticles', () => {
  it('returns critical alert when saved is 0', () => {
    const alert = checkZeroArticles({
      stages: [{ name: 'fetch', status: 'success', stats: { saved: 0 } }],
    });
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('zero-articles');
    expect(alert.severity).toBe('critical');
  });

  it('returns null when articles were saved', () => {
    expect(checkZeroArticles(normalSummary)).toBeNull();
  });

  it('returns null when fetch stage failed (handled by checkStageFailed)', () => {
    expect(checkZeroArticles({
      stages: [{ name: 'fetch', status: 'failed', stats: { saved: 0 } }],
    })).toBeNull();
  });
});

// ─── checkStageFailed ─────────────────────────────────────────────────────────

describe('checkStageFailed', () => {
  it('returns critical alert per failed stage', () => {
    const alerts = checkStageFailed(failedStageSummary);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('stage-failed-draft');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].message).toContain('draft');
    expect(alerts[0].message).toContain('Anthropic API timeout');
  });

  it('returns empty array when no stages failed', () => {
    expect(checkStageFailed(normalSummary)).toHaveLength(0);
  });
});

// ─── checkHighFlagRate ────────────────────────────────────────────────────────

describe('checkHighFlagRate', () => {
  it('returns warning when > 25% flagged', () => {
    const alert = checkHighFlagRate(highFlagSummary);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('high-flag-rate');
    expect(alert.severity).toBe('warning');
    expect(alert.message).toContain('30.0%');
  });

  it('returns null when flag rate is normal', () => {
    expect(checkHighFlagRate(normalSummary)).toBeNull();
  });

  it('returns null when no score stage exists', () => {
    expect(checkHighFlagRate({
      stages: [{ name: 'fetch', status: 'success', stats: { saved: 10 } }],
    })).toBeNull();
  });
});

// ─── checkSourceHealth ────────────────────────────────────────────────────────

describe('checkSourceHealth', () => {
  it('returns warnings for sources with 3+ consecutive failures', () => {
    const health = {
      'Financial Times AI': { consecutiveFailures: 3, lastError: 'HTTP 403' },
      'TechCrunch AI': { consecutiveFailures: 0, lastError: null },
      'Insurance Journal AI': { consecutiveFailures: 5, lastError: 'Empty feed' },
    };
    const alerts = checkSourceHealth(health);
    expect(alerts).toHaveLength(2);
    expect(alerts[0].message).toContain('Financial Times AI');
    expect(alerts[1].message).toContain('Insurance Journal AI');
  });

  it('returns empty array when all sources are healthy', () => {
    const health = {
      'TechCrunch AI': { consecutiveFailures: 0 },
      'The Register': { consecutiveFailures: 2 },
    };
    expect(checkSourceHealth(health)).toHaveLength(0);
  });

  it('returns empty array for null/undefined input', () => {
    expect(checkSourceHealth(null)).toHaveLength(0);
    expect(checkSourceHealth(undefined)).toHaveLength(0);
  });
});

// ─── checkVolumeDropped ───────────────────────────────────────────────────────

describe('checkVolumeDropped', () => {
  it('returns warning when today < 50% of 7-day average', () => {
    const todaySaved = 5;
    const recentSaved = [20, 18, 22, 19, 21, 17, 23]; // avg ~20
    const alert = checkVolumeDropped(todaySaved, recentSaved);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('volume-drop');
    expect(alert.severity).toBe('warning');
    expect(alert.message).toContain('5 saved');
  });

  it('returns null when volume is normal', () => {
    expect(checkVolumeDropped(15, [20, 18, 22, 19, 21, 17, 23])).toBeNull();
  });

  it('returns null when insufficient history (< 3 days)', () => {
    expect(checkVolumeDropped(2, [10, 12])).toBeNull();
  });
});

// ─── checkSatelliteJob ────────────────────────────────────────────────────────

describe('checkSatelliteJob', () => {
  it('returns warning when run file is missing', () => {
    const alert = checkSatelliteJob(null, 'podcast-import', 'Podcast import');
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('podcast-import-missing');
    expect(alert.severity).toBe('warning');
  });

  it('returns warning when run produced 0 results', () => {
    const runData = { stats: { saved: 0, imported: 0 } };
    const alert = checkSatelliteJob(runData, 'podcast-import', 'Podcast import');
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('podcast-import-empty');
  });

  it('returns null when run completed with results', () => {
    const runData = { stats: { saved: 5, imported: 5 } };
    expect(checkSatelliteJob(runData, 'podcast-import', 'Podcast import')).toBeNull();
  });
});

// ─── shouldSend (suppression) ─────────────────────────────────────────────────

describe('shouldSend', () => {
  it('returns true for first-time alert', () => {
    const alert = { type: 'brave-api-down', severity: 'critical', message: 'test' };
    expect(shouldSend(alert, { lastAlerts: {} })).toBe(true);
  });

  it('returns false within critical suppression window (24h)', () => {
    const alert = { type: 'brave-api-down', severity: 'critical', message: 'test' };
    const state = { lastAlerts: { 'brave-api-down': new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() } };
    expect(shouldSend(alert, state)).toBe(false);
  });

  it('returns true after critical suppression window expires', () => {
    const alert = { type: 'brave-api-down', severity: 'critical', message: 'test' };
    const state = { lastAlerts: { 'brave-api-down': new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() } };
    expect(shouldSend(alert, state)).toBe(true);
  });

  it('returns false within warning suppression window (72h)', () => {
    const alert = { type: 'volume-drop', severity: 'warning', message: 'test' };
    const state = { lastAlerts: { 'volume-drop': new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() } };
    expect(shouldSend(alert, state)).toBe(false);
  });

  it('adds ONGOING prefix after escalation threshold (3 days)', () => {
    const alert = { type: 'brave-api-down', severity: 'critical', message: 'original' };
    const state = { lastAlerts: { 'brave-api-down': new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString() } };
    expect(shouldSend(alert, state)).toBe(true);
    expect(alert.message).toContain('ONGOING');
  });

  it('returns true after warning suppression window expires (72h)', () => {
    const alert = { type: 'volume-drop', severity: 'warning', message: 'test' };
    const state = { lastAlerts: { 'volume-drop': new Date(Date.now() - 73 * 60 * 60 * 1000).toISOString() } };
    expect(shouldSend(alert, state)).toBe(true);
  });
});

// ─── checkFetchErrorLog ───────────────────────────────────────────────────────

describe('checkFetchErrorLog', () => {
  it('returns critical alert when >10 402 errors in tail', () => {
    const lines = Array(15).fill('[04:13:22] ⚠  Brave API error 402 for: some query');
    const alert = checkFetchErrorLog(lines, true); // true = log modified today
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('brave-api-402');
    expect(alert.severity).toBe('critical');
    expect(alert.message).toContain('15');
  });

  it('returns null when < 10 402 errors', () => {
    const lines = Array(5).fill('[04:13:22] ⚠  Brave API error 402 for: query');
    expect(checkFetchErrorLog(lines, true)).toBeNull();
  });

  it('returns null when log was not modified today', () => {
    const lines = Array(50).fill('[04:13:22] ⚠  Brave API error 402 for: query');
    expect(checkFetchErrorLog(lines, false)).toBeNull();
  });

  it('returns null for empty/null input', () => {
    expect(checkFetchErrorLog(null, true)).toBeNull();
    expect(checkFetchErrorLog([], true)).toBeNull();
  });
});

// ─── checkJobRan ──────────────────────────────────────────────────────────────

describe('checkJobRan', () => {
  it('returns warning when no summary and no lock file', () => {
    const alert = checkJobRan(false, false); // no summary, no lock
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('job-didnt-run');
    expect(alert.severity).toBe('warning');
  });

  it('returns null when summary exists', () => {
    expect(checkJobRan(true, false)).toBeNull(); // summary exists
  });

  it('returns null when lock file present (still running)', () => {
    expect(checkJobRan(false, true)).toBeNull(); // no summary but lock present
  });
});

// ─── checkErrorRateTrend ──────────────────────────────────────────────────────

describe('checkErrorRateTrend', () => {
  it('returns warning when error rate > 30% and above 7-day avg', () => {
    const todayRate = 0.40; // 40% of queries had errors
    const recentRates = [0.10, 0.12, 0.08, 0.15, 0.11, 0.09, 0.13]; // avg ~11%
    const alert = checkErrorRateTrend(todayRate, recentRates);
    expect(alert).not.toBeNull();
    expect(alert.type).toBe('error-rate-rising');
    expect(alert.severity).toBe('warning');
  });

  it('returns null when error rate is normal', () => {
    expect(checkErrorRateTrend(0.12, [0.10, 0.12, 0.08, 0.15])).toBeNull();
  });

  it('returns null with insufficient history', () => {
    expect(checkErrorRateTrend(0.50, [0.10, 0.12])).toBeNull();
  });
});

// ─── checkVolumeDropped edge cases ────────────────────────────────────────────

describe('checkVolumeDropped edge cases', () => {
  it('returns null when average is 0', () => {
    expect(checkVolumeDropped(0, [0, 0, 0, 0])).toBeNull();
  });
});

// ─── formatConsolidatedMessage ────────────────────────────────────────────────

describe('formatConsolidatedMessage', () => {
  it('formats single critical alert', () => {
    const msg = formatConsolidatedMessage([
      { type: 'brave-api-down', severity: 'critical', message: '🚨 <b>Brave down</b> — 0 results' },
    ]);
    expect(msg).toContain('SNI Pipeline Alerts');
    expect(msg).toContain('Brave down');
    expect(msg).toContain('1 critical');
  });

  it('formats mixed critical and warning alerts', () => {
    const msg = formatConsolidatedMessage([
      { type: 'brave-api-down', severity: 'critical', message: '🚨 <b>Brave down</b>' },
      { type: 'volume-drop', severity: 'warning', message: '⚠️ Volume low' },
    ]);
    expect(msg).toContain('1 critical');
    expect(msg).toContain('1 warning');
  });

  it('truncates when message exceeds 3800 chars', () => {
    const alerts = Array(50).fill(null).map((_, i) => ({
      type: `test-${i}`,
      severity: 'warning',
      message: `⚠️ ${'A'.repeat(100)} warning number ${i}`,
    }));
    const msg = formatConsolidatedMessage(alerts);
    expect(msg.length).toBeLessThan(4096);
    expect(msg).toContain('... and');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun test scripts/tests/pipeline-alerts.test.js`

Expected: All tests FAIL with `Cannot find module '../lib/alert-checks.js'`

- [ ] **Step 3: Create `scripts/lib/alert-checks.js` with all check functions**

```js
/**
 * alert-checks.js — Pure check functions for pipeline health alerts
 *
 * Every function takes data as parameters (not file paths) for testability.
 * Returns Alert objects or arrays of Alert objects. Returns null when healthy.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

export const SUPPRESSION_WINDOWS = {
  critical: 24 * 60 * 60 * 1000,   // 24 hours
  warning:  72 * 60 * 60 * 1000,   // 72 hours
};

export const ESCALATION_THRESHOLD = 3 * 24 * 60 * 60 * 1000; // 3 days

// ─── Immediate failure checks ─────────────────────────────────────────────────

/**
 * Check if Brave Search API is down (all queries returned 0 results)
 * or experiencing high error rates (>80%).
 * @param {object} runSummary — pipeline run summary JSON
 * @returns {object|null} Alert or null
 */
export function checkBraveApi(runSummary) {
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

  // Count queries where errors > 0 (not total error count, which can exceed 1 per query)
  const queriesWithErrors = braveQueries.filter(([, q]) => (q.errors || 0) > 0).length;
  const errorRate = queriesWithErrors / braveQueries.length;
  if (errorRate > 0.80) {
    return {
      type: 'brave-api-errors',
      severity: 'critical',
      message: `🚨 <b>Brave Search</b> — ${(errorRate * 100).toFixed(0)}% of queries had errors (${queriesWithErrors}/${braveQueries.length}). API may be degraded.`,
    };
  }

  return null;
}

/**
 * Check if fetch saved zero articles.
 * Skips if fetch stage itself failed (handled by checkStageFailed).
 * @param {object} runSummary
 * @returns {object|null}
 */
export function checkZeroArticles(runSummary) {
  const fetchStage = runSummary.stages?.find(s => s.name === 'fetch');
  if (!fetchStage || fetchStage.status === 'failed') return null;

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

/**
 * Check for any failed pipeline stages.
 * @param {object} runSummary
 * @returns {object[]} Array of alerts (may be empty)
 */
export function checkStageFailed(runSummary) {
  const failed = (runSummary.stages || []).filter(s => s.status === 'failed');
  return failed.map(s => ({
    type: `stage-failed-${s.name}`,
    severity: 'critical',
    message: `🚨 Pipeline stage <b>${s.name}</b> failed: ${s.errors?.[0] || 'unknown error'}`,
  }));
}

/**
 * Check if score stage flagged > 25% of articles.
 * @param {object} runSummary
 * @returns {object|null}
 */
export function checkHighFlagRate(runSummary) {
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

// ─── Source health check ──────────────────────────────────────────────────────

/**
 * Check source-health.json for sources with 3+ consecutive failures.
 * @param {object|null} health — parsed source-health.json content
 * @returns {object[]} Array of alerts
 */
export function checkSourceHealth(health) {
  if (!health || typeof health !== 'object') return [];

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
}

// ─── Trend checks ─────────────────────────────────────────────────────────────

/**
 * Check if today's article volume dropped > 50% vs 7-day average.
 * @param {number} todaySaved — articles saved today
 * @param {number[]} recentSaved — saved counts from recent days
 * @returns {object|null}
 */
export function checkVolumeDropped(todaySaved, recentSaved) {
  if (!recentSaved || recentSaved.length < 3) return null; // insufficient history

  const avg = recentSaved.reduce((a, b) => a + b, 0) / recentSaved.length;
  if (avg === 0) return null;

  if (todaySaved < avg * 0.5) {
    return {
      type: 'volume-drop',
      severity: 'warning',
      message: `⚠️ Article volume down — ${todaySaved} saved vs ${avg.toFixed(0)} avg/day (7d).`,
    };
  }
  return null;
}

// ─── Satellite job checks ─────────────────────────────────────────────────────

/**
 * Check a satellite job's run summary.
 * @param {object|null} runData — parsed run summary, or null if file missing
 * @param {string} prefix — job prefix (e.g. 'podcast-import')
 * @param {string} label — human label (e.g. 'Podcast import')
 * @returns {object|null}
 */
export function checkSatelliteJob(runData, prefix, label) {
  if (runData === null || runData === undefined) {
    return {
      type: `${prefix}-missing`,
      severity: 'warning',
      message: `⚠️ <b>${label}</b> didn't run today — check launchd job.`,
    };
  }

  const count = runData.stats?.saved ?? runData.stats?.imported ?? runData.stats?.extracted ?? -1;
  if (count === 0) {
    return {
      type: `${prefix}-empty`,
      severity: 'warning',
      message: `⚠️ <b>${label}</b> ran but produced 0 results.`,
    };
  }

  return null;
}

// ─── Suppression logic ────────────────────────────────────────────────────────

/**
 * Determine whether an alert should be sent based on suppression state.
 * Mutates alert.message to add ONGOING prefix after escalation threshold.
 * @param {object} alert — { type, severity, message }
 * @param {object} state — { lastAlerts: { [type]: ISO timestamp } }
 * @returns {boolean}
 */
export function shouldSend(alert, state) {
  const lastSent = state.lastAlerts?.[alert.type];
  if (!lastSent) return true;

  const elapsed = Date.now() - new Date(lastSent).getTime();
  const window = SUPPRESSION_WINDOWS[alert.severity] || SUPPRESSION_WINDOWS.warning;

  if (elapsed < window) return false;

  if (elapsed > ESCALATION_THRESHOLD) {
    alert.message = `🔄 ONGOING: ${alert.message}`;
  }

  return true;
}

// ─── Log scanning (pure — takes lines + freshness flag) ───────────────────────

/**
 * Check fetch error log tail for Brave 402 errors.
 * @param {string[]|null} logTail — last 500 lines of fetch-error.log
 * @param {boolean} isToday — whether the log was modified today
 * @returns {object|null}
 */
export function checkFetchErrorLog(logTail, isToday) {
  if (!logTail || !isToday || logTail.length === 0) return null;

  const errors402 = logTail.filter(l => l.includes('Brave API error 402')).length;
  if (errors402 > 10) {
    return {
      type: 'brave-api-402',
      severity: 'critical',
      message: `🚨 <b>Brave Search API</b> — ${errors402} HTTP 402 errors in latest run. Spend limit likely exceeded.`,
    };
  }
  return null;
}

// ─── Job-didn't-run check (pure — takes existence flags) ──────────────────────

/**
 * Check if pipeline job ran today.
 * @param {boolean} summaryExists — whether pipeline-YYYY-MM-DD.json exists
 * @param {boolean} lockExists — whether .pipeline.lock exists (still running)
 * @returns {object|null}
 */
export function checkJobRan(summaryExists, lockExists) {
  if (summaryExists) return null;
  if (lockExists) return null; // still running, don't alert

  return {
    type: 'job-didnt-run',
    severity: 'warning',
    message: '⚠️ No pipeline run summary for today — launchd job may have failed.',
  };
}

// ─── Error rate trend check ───────────────────────────────────────────────────

/**
 * Check if fetch error rate is rising vs 7-day average.
 * Error rate = fraction of queries that had at least one error.
 * @param {number} todayRate — today's error rate (0-1)
 * @param {number[]} recentRates — error rates from recent days
 * @returns {object|null}
 */
export function checkErrorRateTrend(todayRate, recentRates) {
  if (!recentRates || recentRates.length < 3) return null;

  const avg = recentRates.reduce((a, b) => a + b, 0) / recentRates.length;
  if (todayRate > 0.30 && todayRate > avg * 1.5) {
    return {
      type: 'error-rate-rising',
      severity: 'warning',
      message: `⚠️ Fetch error rate ${(todayRate * 100).toFixed(0)}% — rising trend vs ${(avg * 100).toFixed(0)}% avg (7d).`,
    };
  }
  return null;
}

// ─── Consolidated message formatting ──────────────────────────────────────────

const MAX_MESSAGE_LENGTH = 3800;

/**
 * Format multiple alerts into a single consolidated Telegram message.
 * @param {object[]} alerts — array of { type, severity, message }
 * @returns {string} HTML-formatted message
 */
export function formatConsolidatedMessage(alerts) {
  const today = new Date().toISOString().slice(0, 10);
  const criticalCount = alerts.filter(a => a.severity === 'critical').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;

  const header = criticalCount > 0
    ? `🚨 <b>SNI Pipeline Alerts</b> — ${today}`
    : `⚠️ <b>SNI Pipeline Warnings</b> — ${today}`;

  // Strip HTML and emoji prefix for clean bullet list
  const bullets = alerts.map(a => {
    const plain = a.message
      .replace(/<[^>]+>/g, '')
      .replace(/^[🚨⚠️🔄]\s*/, '')
      .replace(/^ONGOING:\s*/, 'ONGOING: ');
    return `• ${plain.trim()}`;
  });

  let body;
  const joined = bullets.join('\n');
  if (joined.length > MAX_MESSAGE_LENGTH - 200) {
    const truncated = [];
    let len = 0;
    for (const b of bullets) {
      if (len + b.length > MAX_MESSAGE_LENGTH - 300) {
        truncated.push(`... and ${bullets.length - truncated.length} more`);
        break;
      }
      truncated.push(b);
      len += b.length + 1;
    }
    body = truncated.join('\n');
  } else {
    body = joined;
  }

  const parts = [];
  if (criticalCount > 0) parts.push(`${criticalCount} critical`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}`);
  const footer = `\n\n<i>${parts.join(', ')} detected.</i>`;

  return `${header}\n\n${body}${footer}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun test scripts/tests/pipeline-alerts.test.js`

Expected: All 34 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/alert-checks.js scripts/tests/pipeline-alerts.test.js
git commit -m "feat: add pipeline alert check functions with tests

Pure functions for: Brave API down, zero articles, stage failures,
high flag rate, source health, volume trends, satellite jobs.
Suppression logic with 24h/72h windows and 3-day escalation."
```

---

### Task 3: Main runner script

**Files:**
- Create: `scripts/pipeline-alerts.js`

- [ ] **Step 1: Create `scripts/pipeline-alerts.js`**

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
```

- [ ] **Step 2: Verify dry run works**

Run: `bun scripts/pipeline-alerts.js --dry-run`

Expected: Prints check results and formatted message to stdout without sending.

- [ ] **Step 3: Verify test mode sends to Telegram**

Run: `bun scripts/pipeline-alerts.js --test`

Expected: Test message appears in Telegram, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/pipeline-alerts.js
git commit -m "feat: add pipeline alerts runner with consolidated Telegram delivery

Reads pipeline output files, runs all health checks, applies
suppression, sends consolidated alerts via Zaphod.
CLI: --dry-run, --test, --check fetch|satellite, --reset"
```

---

### Task 4: launchd plist files

**Files:**
- Create: `com.sni.alerts-post-fetch.plist`
- Create: `com.sni.alerts-post-satellite.plist`

- [ ] **Step 1: Create `com.sni.alerts-post-fetch.plist`**

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

- [ ] **Step 2: Create `com.sni.alerts-post-satellite.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.sni.alerts-post-satellite</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/scott/.bun/bin/bun</string>
    <string>/Users/scott/Projects/sni-research-v2/scripts/pipeline-alerts.js</string>
    <string>--check</string>
    <string>satellite</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/scott/Projects/sni-research-v2</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
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

- [ ] **Step 3: Validate plist XML**

Run: `plutil -lint com.sni.alerts-post-fetch.plist && plutil -lint com.sni.alerts-post-satellite.plist`

Expected: Both `OK`.

- [ ] **Step 4: Commit**

```bash
git add com.sni.alerts-post-fetch.plist com.sni.alerts-post-satellite.plist
git commit -m "feat: add launchd jobs for pipeline alerts

Post-fetch alerts at 04:45, post-satellite at 08:00."
```

---

### Task 5: End-to-end verification

- [ ] **Step 1: Run unit tests**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun test scripts/tests/pipeline-alerts.test.js`

Expected: All 20 tests pass.

- [ ] **Step 2: Run live check (dry run)**

Run: `bun scripts/pipeline-alerts.js --dry-run`

Expected: Reads today's actual pipeline data, prints alerts (or "all clear"), no Telegram sent.

- [ ] **Step 3: Run live check (real)**

Run: `bun scripts/pipeline-alerts.js`

Expected: Sends consolidated alert to Telegram (or "all clear" if no issues). Check Telegram for message.

- [ ] **Step 4: Verify suppression works**

Run: `bun scripts/pipeline-alerts.js` (immediately again)

Expected: "All alerts suppressed" because all were just sent.

- [ ] **Step 5: Verify reset works**

Run: `bun scripts/pipeline-alerts.js --reset && bun scripts/pipeline-alerts.js --dry-run`

Expected: Reset clears state, dry run shows alerts would fire again.

- [ ] **Step 6: Install launchd jobs**

```bash
cp com.sni.alerts-post-fetch.plist ~/Library/LaunchAgents/
cp com.sni.alerts-post-satellite.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.sni.alerts-post-fetch.plist
launchctl load ~/Library/LaunchAgents/com.sni.alerts-post-satellite.plist
launchctl list | grep sni.alerts
```

Expected: Both jobs loaded and listed.
