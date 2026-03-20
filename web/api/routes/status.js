import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { walkArticleDir } from '../lib/walk.js'
import { getISOWeek } from '../lib/week.js'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getStatus() {
  const lastFullRunAt = getLastFullRunAt()
  return {
    lastRun: getLastRun(),
    lastFullRunAt,
    articles: getArticleCounts(lastFullRunAt),
    availableWeeks: getAvailableWeeks(),
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors(),
    ingestServer: await getIngestHealth(),
    podcastImport: getPodcastImport(),
  }
}

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
  const byDate = {}
  const bySector = {}
  const byDateBySector = {}
  let total = 0

  // Week-filtered counts (articles scraped after last full pipeline run)
  const weekByDate = {}
  const weekBySector = {}
  const weekByDateBySector = {}
  let weekTotal = 0

  walkArticleDir('verified', (raw, { date, sector }) => {
    // All-time counts
    byDate[date] = (byDate[date] || 0) + 1
    bySector[sector] = (bySector[sector] || 0) + 1
    if (!byDateBySector[date]) byDateBySector[date] = {}
    byDateBySector[date][sector] = (byDateBySector[date][sector] || 0) + 1
    total++

    // Week counts: only articles scraped after last full pipeline run
    if (fullRunCutoff && raw.scraped_at && raw.scraped_at > fullRunCutoff) {
      weekByDate[date] = (weekByDate[date] || 0) + 1
      weekBySector[sector] = (weekBySector[sector] || 0) + 1
      if (!weekByDateBySector[date]) weekByDateBySector[date] = {}
      weekByDateBySector[date][sector] = (weekByDateBySector[date][sector] || 0) + 1
      weekTotal++
    }
  })

  const today = new Date().toISOString().split('T')[0]
  return {
    today: byDate[today] || 0,
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

function getPodcastImport() {
  const runsDir = join(ROOT, 'output/runs')
  if (!existsSync(runsDir)) return null

  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('podcast-import-') && f.endsWith('.json'))
    .sort()

  if (files.length === 0) return null

  const lastFile = files[files.length - 1]

  try {
    const data = JSON.parse(readFileSync(join(runsDir, lastFile), 'utf-8'))

    // Count episodes for current week from manifest
    let episodesThisWeek = 0
    const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
        const now = new Date()
        const currentWeek = getISOWeek(now)
        const currentYear = now.getFullYear()

        const episodes = manifest.episodes || manifest || []
        if (Array.isArray(episodes)) {
          episodesThisWeek = episodes.filter(ep => {
            if (!ep.date_published) return false
            const d = new Date(ep.date_published + 'T12:00:00Z')
            return getISOWeek(d) === currentWeek && d.getFullYear() === currentYear
          }).length
        }
      } catch { /* ignore manifest parse errors */ }
    }

    return {
      lastRun: data.completedAt || data.startedAt || null,
      episodesThisWeek,
      storiesGapFilled: data.storiesGapFilled ?? data.stories_gap_filled ?? 0,
      warnings: data.warnings || [],
    }
  } catch {
    return null
  }
}
