import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { walkArticleDir, walkArticleDirAsync } from '../lib/walk.js'
import { getISOWeek } from '../lib/week.js'
import config from '../lib/config.js'

const ROOT = config.ROOT

// Stale-while-revalidate cache for getStatus(). The full computation walks
// 4576+ verified articles synchronously, which blocks the event loop for tens
// of seconds on Fly's persistent volume. Three strategies stack:
//   1. 5-minute TTL (articles change at most a few times per hour)
//   2. SWR — serve stale immediately, refresh in background, so only the very
//      first request after startup pays the cold-walk cost
//   3. Startup warm in server.js pre-populates the cache before accepting
//      traffic, so that first cold walk happens outside the user's request path
const STATUS_CACHE_TTL_MS = 5 * 60_000
let _statusCache = null
let _statusCacheAt = 0
let _statusInflight = null

async function computeStatus() {
  const lastFullRunAt = getLastFullRunAt()
  return {
    lastRun: getLastRun(),
    lastFullRunAt,
    articles: await getArticleCountsAsync(lastFullRunAt),
    availableWeeks: getAvailableWeeks(),
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors(),
    ingestServer: await getIngestHealth(),
    podcastImport: getPodcastImport(),
  }
}

async function refreshStatusCache() {
  try {
    const result = await computeStatus()
    _statusCache = result
    _statusCacheAt = Date.now()
    return result
  } finally {
    _statusInflight = null
  }
}

export async function getStatus() {
  // Tests create fixtures between calls and expect fresh reads; skip the cache.
  if (process.env.SNI_TEST_MODE === '1') return computeStatus()

  const now = Date.now()

  // Fresh cache: return immediately
  if (_statusCache && (now - _statusCacheAt) < STATUS_CACHE_TTL_MS) {
    return _statusCache
  }

  // Stale cache: return stale now, refresh in background. Keeps the dashboard
  // responsive while the walk runs. The cache updates on completion.
  if (_statusCache) {
    if (!_statusInflight) {
      _statusInflight = refreshStatusCache()
      _statusInflight.catch(err => console.error('[status] background refresh failed:', err.message))
    }
    return _statusCache
  }

  // Cold start: block on the walk. Startup warm in server.js usually pays this
  // cost before accepting real traffic. Concurrent cold callers share one walk.
  if (!_statusInflight) {
    _statusInflight = refreshStatusCache()
  }
  return _statusInflight
}

/**
 * Force-clear the status cache. Used by mutation endpoints (manual ingest,
 * archive toggle) to ensure the next dashboard read is fresh.
 */
export function invalidateStatusCache() {
  _statusCache = null
  _statusCacheAt = 0
}

async function getIngestHealth() {
  // In test mode, short-circuit the 2-second fetch timeout. Tests don't run
  // the ingest server and shouldn't pay the timeout cost on every call.
  if (process.env.SNI_TEST_MODE === '1') return { online: false }
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch('http://127.0.0.1:3847/health', { signal: controller.signal })
    clearTimeout(timeout)
    return { online: res.ok }
  } catch {
    return { online: false }
  }
}

function getAvailableWeeks() {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return []

  const weeks = new Set()
  try {
    for (const dateDir of readdirSync(verifiedDir)) {
      // Date directories are YYYY-MM-DD
      const match = dateDir.match(/^\d{4}-\d{2}-\d{2}$/)
      if (!match) continue
      const d = new Date(dateDir + 'T12:00:00Z') // noon UTC to avoid timezone edge cases
      if (isNaN(d.getTime())) continue
      weeks.add(getISOWeek(d))
    }
  } catch { /* ignore read errors */ }

  return [...weeks].sort((a, b) => a - b)
}

function getLastRun() {
  const runsDir = join(ROOT, 'output/runs')
  if (!existsSync(runsDir)) return null

  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.json'))
    .sort()
    .reverse()

  if (files.length === 0) return null

  try {
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    return {
      runId: data.runId,
      mode: data.mode,
      weekNumber: data.weekNumber,
      year: data.year,
      dateWindow: data.dateWindow,
      stages: (data.stages || []).map(s => ({
        name: s.name,
        status: s.status,
        duration: s.duration,
        stats: s.stats || {},
        errors: s.errors || []
      })),
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      totalDuration: data.totalDuration
    }
  } catch {
    return null
  }
}

function getArticleCounts(fullRunCutoff) {
  const acc = createCountsAccumulator(fullRunCutoff)
  walkArticleDir('verified', (raw, ctx) => acc.add(raw, ctx))
  return acc.result()
}

/**
 * Async version of getArticleCounts that yields the event loop every 50
 * articles via walkArticleDirAsync. Use this from request handlers to avoid
 * blocking the health check while walking 4576+ articles.
 */
async function getArticleCountsAsync(fullRunCutoff) {
  const acc = createCountsAccumulator(fullRunCutoff)
  await walkArticleDirAsync('verified', (raw, ctx) => acc.add(raw, ctx))
  return acc.result()
}

/**
 * Shared accumulator for sync + async counters. Single source of truth for
 * the per-article math; the only difference between the two callers is whether
 * the walker yields between files.
 */
function createCountsAccumulator(fullRunCutoff) {
  const byDate = {}
  const bySector = {}
  const byDateBySector = {}
  let total = 0

  const weekByDate = {}
  const weekBySector = {}
  const weekByDateBySector = {}
  let weekTotal = 0

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  let addedToday = 0

  return {
    add(raw, { date, sector }) {
      byDate[date] = (byDate[date] || 0) + 1
      bySector[sector] = (bySector[sector] || 0) + 1
      if (!byDateBySector[date]) byDateBySector[date] = {}
      byDateBySector[date][sector] = (byDateBySector[date][sector] || 0) + 1
      total++

      if (raw.scraped_at && raw.scraped_at.startsWith(today)) {
        addedToday++
      }

      if (fullRunCutoff && raw.scraped_at && raw.scraped_at > fullRunCutoff) {
        weekByDate[date] = (weekByDate[date] || 0) + 1
        weekBySector[sector] = (weekBySector[sector] || 0) + 1
        if (!weekByDateBySector[date]) weekByDateBySector[date] = {}
        weekByDateBySector[date][sector] = (weekByDateBySector[date][sector] || 0) + 1
        weekTotal++
      }
    },
    result() {
      return {
        today: addedToday,
        total,
        byDate,
        bySector,
        byDateBySector,
        weekArticles: {
          total: weekTotal,
          byDate: weekByDate,
          bySector: weekBySector,
          byDateBySector: weekByDateBySector,
        },
      }
    },
  }
}

function getLastFullRunAt() {
  const runsDir = join(ROOT, 'output/runs')
  if (!existsSync(runsDir)) return null

  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.json'))
    .sort()
    .reverse()

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(runsDir, file), 'utf-8'))
      if ((data.mode === 'full' || data.mode === 'friday') && data.completedAt) {
        return data.completedAt
      }
    } catch { /* skip */ }
  }

  return null
}

function getNextPipeline() {
  // Thursday at 13:00 is the full pipeline run
  const now = new Date()
  const day = now.getDay() // 0=Sun, 4=Thu
  let daysUntilThursday = (4 - day + 7) % 7
  if (daysUntilThursday === 0) {
    // It's Thursday — check if pipeline already ran or will run today
    const hour = now.getHours()
    if (hour >= 14) daysUntilThursday = 7 // Past 2pm, assume it ran; next Thursday
  }

  const nextFull = new Date(now)
  nextFull.setDate(now.getDate() + daysUntilThursday)
  nextFull.setHours(13, 0, 0, 0)

  // Next daily fetch at 04:00
  const nextDaily = new Date(now)
  if (now.getHours() < 4) {
    nextDaily.setHours(4, 0, 0, 0)
  } else {
    nextDaily.setDate(now.getDate() + 1)
    nextDaily.setHours(4, 0, 0, 0)
  }

  return {
    nextFull: nextFull.toISOString(),
    nextDaily: nextDaily.toISOString()
  }
}

function getRecentErrors() {
  const logPaths = [
    join(ROOT, 'logs/fetch-error.log'),
    join(ROOT, 'logs/pipeline-error.log')
  ]

  const errors = []
  for (const p of logPaths) {
    if (!existsSync(p)) continue
    try {
      const content = readFileSync(p, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean).slice(-10)
      errors.push(...lines)
    } catch { /* ignore */ }
  }
  return errors.slice(-20)
}

/**
 * Read the verification-failed sentinel flag written by editorial-verify-draft.js
 * when a draft fails the hallucination gate. Used by the dashboard to warn Scott.
 */
export function getVerificationStatus() {
  const flagPath = join(ROOT, 'data/editorial/drafts/VERIFICATION-FAILED.flag')
  if (!existsSync(flagPath)) {
    return { failed: false }
  }
  try {
    const flag = JSON.parse(readFileSync(flagPath, 'utf-8'))
    return {
      failed: true,
      failedAt: flag.failedAt || null,
      week: flag.week || null,
      reportPath: flag.reportPath || null,
    }
  } catch {
    return { failed: true, parseError: true }
  }
}

export function getPodcastImport() {
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) return null

  // Count episodes this week by scanning date directories directly
  // (more robust than relying on manifest.json which can get corrupted)
  const now = new Date()
  const currentWeek = getISOWeek(now)
  const currentYear = now.getFullYear()
  let episodesThisWeek = 0
  let latestDigestTime = null

  try {
    const dirs = readdirSync(podcastDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    for (const dateDir of dirs) {
      const d = new Date(dateDir + 'T12:00:00Z')
      if (isNaN(d.getTime())) continue
      const isThisWeek = getISOWeek(d) === currentWeek && d.getFullYear() === currentYear

      // Scan for .digest.json files in source subdirectories
      const datePath = join(podcastDir, dateDir)
      try {
        const sources = readdirSync(datePath)
        for (const source of sources) {
          const sourcePath = join(datePath, source)
          try {
            const files = readdirSync(sourcePath)
            const digests = files.filter(f => f.endsWith('.digest.json'))
            if (isThisWeek) episodesThisWeek += digests.length
          } catch { /* not a directory, skip */ }
        }
      } catch { /* skip */ }
    }

    // Find last import time from most recently modified date directory
    const sortedDirs = dirs.sort().reverse()
    for (const dateDir of sortedDirs) {
      const datePath = join(podcastDir, dateDir)
      try {
        const stat = statSync(datePath)
        latestDigestTime = stat.mtime.toISOString()
        break
      } catch { /* skip */ }
    }
  } catch { /* ignore read errors */ }

  // Also check run files for storiesGapFilled and warnings
  let storiesGapFilled = 0
  let warnings = []
  const runsDir = join(ROOT, 'output/runs')
  if (existsSync(runsDir)) {
    const runFiles = readdirSync(runsDir)
      .filter(f => f.startsWith('podcast-import-') && f.endsWith('.json'))
      .sort()

    if (runFiles.length > 0) {
      try {
        const data = JSON.parse(readFileSync(join(runsDir, runFiles[runFiles.length - 1]), 'utf-8'))
        storiesGapFilled = data.storiesGapFilled ?? data.stories_gap_filled ?? 0
        warnings = data.warnings || []
        // Use run file timestamp if newer
        const runTime = data.completedAt || data.startedAt
        if (runTime && (!latestDigestTime || runTime > latestDigestTime)) {
          latestDigestTime = runTime
        }
      } catch { /* skip */ }
    }
  }

  if (episodesThisWeek === 0 && !latestDigestTime) return null

  return {
    lastRun: latestDigestTime,
    episodesThisWeek,
    storiesGapFilled,
    warnings,
  }
}
