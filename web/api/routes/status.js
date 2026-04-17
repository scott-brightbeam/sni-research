import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { getISOWeek } from '../lib/week.js'
import { getDb } from '../lib/db.js'
import { getArticleCounts } from '../lib/article-queries.js'

const ROOT = process.env.SNI_ROOT || resolve(import.meta.dir, '../../..')

export function getVerificationStatus() {
  const flagPath = join(ROOT, 'data/editorial/drafts/VERIFICATION-FAILED.flag')
  if (!existsSync(flagPath)) return { failed: false }
  try {
    const flag = JSON.parse(readFileSync(flagPath, 'utf-8'))
    return { failed: true, failedAt: flag.failedAt || null, week: flag.week || null, reportPath: flag.reportPath || null }
  } catch { return { failed: true, parseError: true } }
}

export async function getStatus() {
  const lastFridayRunAt = getLastFridayRunAt()

  // Article counts from DB — returns arrays, needs converting to object maps
  const db = getDb()
  const dbCounts = await getArticleCounts(db, {
    scrapedSince: lastFridayRunAt || undefined,
  })
  const articles = convertCountsToObjectMaps(dbCounts)

  // Available weeks from DB
  const availableWeeks = await getAvailableWeeksFromDb(db)

  return {
    lastRun: getLastRun(),
    lastFridayRunAt,
    articles,
    availableWeeks,
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors(),
    ingestServer: await getIngestHealth(),
    podcastImport: getPodcastImport(),
  }
}

// ---------------------------------------------------------------------------
// DB-based helpers
// ---------------------------------------------------------------------------

/**
 * Convert the array-based counts from article-queries.js to the object-map
 * format the UI expects.
 *
 * DB returns:  { byDate: [{date, count}], bySector: [{sector, count}], byDateBySector: [{date, sector, count}] }
 * UI expects:  { byDate: {date: count}, bySector: {sector: count}, byDateBySector: {date: {sector: count}} }
 */
function convertCountsToObjectMaps(dbCounts) {
  const byDate = {}
  for (const { date, count } of dbCounts.byDate) {
    byDate[date] = count
  }

  const bySector = {}
  for (const { sector, count } of dbCounts.bySector) {
    bySector[sector] = count
  }

  const byDateBySector = {}
  for (const { date, sector, count } of dbCounts.byDateBySector) {
    if (!byDateBySector[date]) byDateBySector[date] = {}
    byDateBySector[date][sector] = count
  }

  const result = {
    today: dbCounts.today,
    total: dbCounts.total,
    byDate,
    bySector,
    byDateBySector,
  }

  // Week-filtered counts
  if (dbCounts.weekArticles) {
    const weekByDate = {}
    for (const { date, count } of dbCounts.weekArticles.byDate) {
      weekByDate[date] = count
    }

    const weekBySector = {}
    for (const { sector, count } of dbCounts.weekArticles.bySector) {
      weekBySector[sector] = count
    }

    const weekByDateBySector = {}
    for (const { date, sector, count } of dbCounts.weekArticles.byDateBySector) {
      if (!weekByDateBySector[date]) weekByDateBySector[date] = {}
      weekByDateBySector[date][sector] = count
    }

    result.weekArticles = {
      total: dbCounts.weekArticles.total,
      byDate: weekByDate,
      bySector: weekBySector,
      byDateBySector: weekByDateBySector,
    }
  } else {
    result.weekArticles = {
      total: 0,
      byDate: {},
      bySector: {},
      byDateBySector: {},
    }
  }

  return result
}

/**
 * Get available weeks from the DB instead of walking filesystem directories.
 */
async function getAvailableWeeksFromDb(db) {
  const result = await db.execute(
    `SELECT DISTINCT date_published FROM articles
     WHERE deleted_at IS NULL AND date_published IS NOT NULL
     ORDER BY date_published`
  )

  const weeks = new Set()
  for (const row of result.rows) {
    const d = new Date(row.date_published + 'T12:00:00Z')
    if (!isNaN(d.getTime())) {
      weeks.add(getISOWeek(d))
    }
  }

  return [...weeks].sort((a, b) => a - b)
}

// ---------------------------------------------------------------------------
// Filesystem-based helpers (pipeline metadata — stays on filesystem)
// ---------------------------------------------------------------------------

async function getIngestHealth() {
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

function getLastFridayRunAt() {
  const runsDir = join(ROOT, 'output/runs')
  if (!existsSync(runsDir)) return null

  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.json'))
    .sort()
    .reverse()

  for (const file of files) {
    try {
      const data = JSON.parse(readFileSync(join(runsDir, file), 'utf-8'))
      if (data.mode === 'friday' && data.completedAt) {
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

export function getPodcastImport() {
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) return null

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

      const datePath = join(podcastDir, dateDir)
      try {
        const sources = readdirSync(datePath)
        for (const source of sources) {
          const sourcePath = join(datePath, source)
          try {
            const files = readdirSync(sourcePath)
            const digests = files.filter(f => f.endsWith('.digest.json'))
            if (isThisWeek) episodesThisWeek += digests.length
          } catch { /* not a directory */ }
        }
      } catch { /* skip */ }
    }

    const sortedDirs = dirs.sort().reverse()
    for (const dateDir of sortedDirs) {
      const datePath = join(podcastDir, dateDir)
      try {
        const stat = statSync(datePath)
        latestDigestTime = stat.mtime.toISOString()
        break
      } catch { /* skip */ }
    }
  } catch { /* ignore */ }

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
