import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getISOWeek } from '../lib/week.js'
import { getDb } from '../lib/db.js'
import { getArticleCounts } from '../lib/article-queries.js'

const ROOT = resolve(import.meta.dir, '../../..')

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
  // Friday at 05:30 is the full pipeline run
  const now = new Date()
  const day = now.getDay() // 0=Sun, 5=Fri
  let daysUntilFriday = (5 - day + 7) % 7
  if (daysUntilFriday === 0) {
    // It's Friday — check if pipeline already ran today
    const hour = now.getHours()
    if (hour >= 6) daysUntilFriday = 7 // Already ran, next Friday
  }

  const nextFriday = new Date(now)
  nextFriday.setDate(now.getDate() + daysUntilFriday)
  nextFriday.setHours(5, 30, 0, 0)

  // Next daily fetch at 04:00
  const nextDaily = new Date(now)
  if (now.getHours() < 4) {
    nextDaily.setHours(4, 0, 0, 0)       // today at 4am
  } else {
    nextDaily.setDate(now.getDate() + 1)
    nextDaily.setHours(4, 0, 0, 0)       // tomorrow at 4am
  }

  return {
    nextFriday: nextFriday.toISOString(),
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
