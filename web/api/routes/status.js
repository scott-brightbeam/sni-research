import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getStatus() {
  return {
    lastRun: getLastRun(),
    articles: getArticleCounts(),
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors()
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

function getArticleCounts() {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { today: 0, total: 0, byDate: {}, bySector: {} }

  const byDate = {}
  const bySector = {}
  let total = 0

  const dates = readdirSync(verifiedDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))

  for (const date of dates) {
    const datePath = join(verifiedDir, date)
    if (!statSync(datePath).isDirectory()) continue

    let dateCount = 0
    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const sector of sectors) {
      const sectorPath = join(datePath, sector)
      const articles = readdirSync(sectorPath).filter(f => f.endsWith('.json'))
      dateCount += articles.length
      bySector[sector] = (bySector[sector] || 0) + articles.length
    }

    byDate[date] = dateCount
    total += dateCount
  }

  const today = new Date().toISOString().split('T')[0]

  return {
    today: byDate[today] || 0,
    total,
    byDate,
    bySector
  }
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

  // Next daily fetch at 04:00 tomorrow
  const nextDaily = new Date(now)
  nextDaily.setDate(now.getDate() + 1)
  nextDaily.setHours(4, 0, 0, 0)

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
