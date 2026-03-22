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
        'L1: query2': { results: 15, new: 10, saved: 6, errors: 0 },
        'L2: query3': { results: 10, new: 8, saved: 3, errors: 1 },
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
