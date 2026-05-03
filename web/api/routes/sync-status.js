import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import config from '../lib/config.js'

/**
 * GET /api/status/sync — summary of the latest sync runs.
 *
 * PUBLIC ENDPOINT (no auth) — see middleware/auth.js PUBLIC_PATHS.
 * Returns operational metadata only (timestamps, outcomes, counts).
 * Does NOT expose contribution UUIDs, sha hashes, or user emails.
 *
 * Reads tail of data/editorial/sync-log.jsonl from the configured ROOT.
 * On Fly, that's /app/data/editorial/sync-log.jsonl, populated by
 * syncOutputFiles uploading the local file via SFTP after each sync.
 */
export async function getSyncStatus() {
  const path = join(process.env.SNI_ROOT || config.ROOT, 'data/editorial/sync-log.jsonl')

  if (!existsSync(path)) {
    return {
      lastSync: null,
      reason: 'no sync-log.jsonl on disk yet',
    }
  }

  // Tail the last 20 lines (cheap, file is small — ~1KB/sync × 3/day × 365 = ~1MB/year)
  let lines
  try {
    lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean).slice(-20)
  } catch (e) {
    return { lastSync: null, error: `read failed: ${e.message}` }
  }

  const entries = lines
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)

  if (entries.length === 0) {
    return { lastSync: null, reason: 'sync-log.jsonl is empty' }
  }

  const last = entries[entries.length - 1]

  // Summarise the last 24h of runs
  const oneDayAgoMs = Date.now() - 24 * 60 * 60 * 1000
  const recent = entries.filter(e => {
    const ts = new Date(e.ts).getTime()
    return Number.isFinite(ts) && ts >= oneDayAgoMs
  })

  const outcomes = {}
  for (const e of recent) {
    outcomes[e.outcome] = (outcomes[e.outcome] || 0) + 1
  }

  return {
    lastSync: {
      ts: last.ts,
      outcome: last.outcome,
      mergedCount: Array.isArray(last.merged) ? last.merged.length : 0,
      skippedDuplicates: last.skippedDuplicates ?? 0,
      quarantined: last.quarantined ?? 0,
      elapsedMs: last.elapsedMs ?? null,
      // Deliberately omit: merged[] UUIDs, preStateSha, postStateSha, syncRunId
      ...(last.failedPhase ? { failedPhase: last.failedPhase } : {}),
      ...(Array.isArray(last.warnings) && last.warnings.length > 0 ? { warningsCount: last.warnings.length } : {}),
    },
    last24h: {
      runCount: recent.length,
      outcomesCount: outcomes,
    },
  }
}
