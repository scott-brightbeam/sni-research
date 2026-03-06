import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(import.meta.dir, '../../../data')

export async function getOverview() {
  const runs = loadAllRuns()
  const health = loadHealth()
  return { runs, health }
}

function loadAllRuns() {
  const files = []
  try {
    for (const f of readdirSync(DATA_DIR)) {
      const m = f.match(/^last-run-(\d{4}-\d{2}-\d{2})\.json$/)
      if (m) files.push({ date: m[1], path: join(DATA_DIR, f) })
    }
  } catch { return [] }

  files.sort((a, b) => b.date.localeCompare(a.date))

  return files.map(({ date, path }) => {
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      return {
        date,
        saved: raw.saved ?? 0,
        flagged: raw.flagged ?? 0,
        fetchErrors: raw.fetchErrors ?? 0,
        paywalled: raw.paywalled ?? 0,
        elapsed: raw.elapsed ?? null,
        layerTotals: aggregateLayers(raw),
      }
    } catch {
      return { date, saved: 0, flagged: 0, fetchErrors: 0, paywalled: 0, elapsed: null, layerTotals: null }
    }
  })
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

function loadHealth() {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, 'source-health.json'), 'utf8'))
  } catch {
    return {}
  }
}
