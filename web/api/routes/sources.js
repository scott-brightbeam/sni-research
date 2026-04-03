import { readFileSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import config from '../lib/config.js'

const DATA_DIR = join(config.ROOT, 'data')
const RUNS_DIR = join(config.ROOT, 'output/runs')

export async function getOverview() {
  const runs = loadAllRuns()
  const health = loadHealth()
  return { runs, health }
}

function loadAllRuns() {
  // Merge two sources: data/last-run-*.json (basic counters) and output/runs/pipeline-*.json (detailed stats)
  const dateMap = new Map()

  // 1. Read data/last-run-*.json for basic counters
  try {
    for (const f of readdirSync(DATA_DIR)) {
      const m = f.match(/^last-run-(\d{4}-\d{2}-\d{2})\.json$/)
      if (m) {
        try {
          const raw = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'))
          dateMap.set(m[1], {
            date: m[1],
            saved: raw.saved ?? 0,
            flagged: raw.flagged ?? 0,
            fetchErrors: raw.fetchErrors ?? 0,
            paywalled: raw.paywalled ?? 0,
            elapsed: raw.elapsed ?? null,
            queryStats: raw.queryStats ?? null,
            headlineStats: raw.headlineStats ?? null,
          })
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    console.warn('sources: could not read data dir:', err.message)
  }

  // 2. Enrich with output/runs/pipeline-*.json (has detailed queryStats in stages)
  if (existsSync(RUNS_DIR)) {
    try {
      for (const f of readdirSync(RUNS_DIR)) {
        const m = f.match(/^pipeline-(\d{4}-\d{2}-\d{2})\.json$/)
        if (!m) continue
        try {
          const raw = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf8'))
          const fetchStage = (raw.stages || []).find(s => s.name === 'fetch')
          if (!fetchStage) continue
          const stats = fetchStage.stats || {}
          const existing = dateMap.get(m[1]) || { date: m[1] }
          // Pipeline file has richer data — use it to fill gaps
          dateMap.set(m[1], {
            ...existing,
            date: m[1],
            saved: existing.saved || stats.saved || 0,
            flagged: existing.flagged || stats.flagged || 0,
            fetchErrors: existing.fetchErrors || stats.fetchErrors || 0,
            paywalled: existing.paywalled || stats.paywalled || 0,
            elapsed: existing.elapsed || raw.totalDuration || null,
            queryStats: existing.queryStats || stats.queryStats || null,
            headlineStats: existing.headlineStats || stats.headlineStats || null,
            mode: raw.mode || null,
          })
        } catch { /* skip malformed */ }
      }
    } catch (err) {
      console.warn('sources: could not read runs dir:', err.message)
    }
  }

  // Sort newest first, compute layer totals
  const runs = [...dateMap.values()].sort((a, b) => b.date.localeCompare(a.date))
  return runs.map(run => ({
    date: run.date,
    saved: run.saved,
    flagged: run.flagged,
    fetchErrors: run.fetchErrors,
    paywalled: run.paywalled,
    elapsed: run.elapsed,
    mode: run.mode || null,
    layerTotals: aggregateLayers(run),
  }))
}

function aggregateLayers(raw) {
  if (!raw.queryStats) return null

  const layers = {
    L1: { queries: 0, saved: 0, errors: 0 },
    L2: { queries: 0, saved: 0, errors: 0 },
    L3: { queries: 0, saved: 0, errors: 0 },
    L4: { queries: 0, saved: 0, errors: 0 },
  }

  for (const [key, val] of Object.entries(raw.queryStats)) {
    const prefix = key.match(/^(L[1-4]):/)?.[1]
    if (prefix && layers[prefix]) {
      layers[prefix].queries++
      layers[prefix].saved += val.saved ?? 0
      layers[prefix].errors += val.errors ?? 0
    }
  }

  // Headlines from separate headlineStats object
  const hl = raw.headlineStats
  layers.headlines = hl
    ? { sources: hl.sources ?? 0, found: hl.found ?? 0, errors: hl.errors ?? 0 }
    : { sources: 0, found: 0, errors: 0 }

  // RSS: total saved minus query-attributed saves
  const querySaved = Object.values(layers).reduce((sum, l) => sum + (l.saved || 0) + (l.found || 0), 0)
  const rssSaved = Math.max(0, (raw.saved ?? 0) - querySaved)
  layers.rss = { saved: rssSaved, errors: 0 }

  return layers
}

export async function getRunDetail(date) {
  // Try pipeline file first (has detailed stats), fall back to last-run
  const pipelinePath = join(RUNS_DIR, `pipeline-${date}.json`)
  const lastRunPath = join(DATA_DIR, `last-run-${date}.json`)

  let queryStats = null
  let headlineStats = null
  let saved = 0
  let window = null

  // Pipeline file (detailed)
  if (existsSync(pipelinePath)) {
    try {
      const raw = JSON.parse(readFileSync(pipelinePath, 'utf8'))
      const fetchStage = (raw.stages || []).find(s => s.name === 'fetch')
      if (fetchStage?.stats) {
        queryStats = fetchStage.stats.queryStats ?? null
        headlineStats = fetchStage.stats.headlineStats ?? null
        saved = fetchStage.stats.saved ?? 0
        window = raw.dateWindow ?? null
      }
    } catch { /* fall through to last-run */ }
  }

  // Last-run file (basic, may have queryStats on older runs)
  if (existsSync(lastRunPath)) {
    try {
      const raw = JSON.parse(readFileSync(lastRunPath, 'utf8'))
      saved = saved || raw.saved || 0
      window = window || raw.window || null
      queryStats = queryStats || raw.queryStats || null
      headlineStats = headlineStats || raw.headlineStats || null
    } catch { /* ignore */ }
  }

  if (!saved && !queryStats) return null

  return { date, saved, window, queryStats, headlineStats }
}

function loadHealth() {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'source-health.json'), 'utf8'))
  } catch (err) {
    console.warn('sources: could not load health file:', err.message)
    return {}
  }
}
