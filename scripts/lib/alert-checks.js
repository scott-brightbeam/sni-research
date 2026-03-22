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
      .replace(/^🚨\s*/, '')
      .replace(/^⚠️\s*/, '')
      .replace(/^🔄\s*/, '')
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
