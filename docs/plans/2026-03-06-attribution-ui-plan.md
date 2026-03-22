# Attribution UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Sources page showing query/layer productivity across all pipeline runs, plus found_by badges in the article detail panel.

**Architecture:** Two new API endpoints in `web/api/routes/sources.js` serve aggregated run data and drill-down detail. A new React page `Sources.jsx` with a `useSources` hook displays a stacked area chart, layer summary cards, sortable query table, and source health table. Minor addition to `Articles.jsx` for found_by badges.

**Tech Stack:** Bun API server, React SPA, inline SVG charting (no library), CSS custom properties for layer colours.

**Design doc:** `docs/plans/2026-03-06-attribution-ui-design.md`

---

## Task 1: Add layer colour tokens

**Files:**
- Modify: `web/app/src/styles/tokens.css:1-43` (add tokens inside `:root`)

**Step 1: Add the six layer colour tokens plus 15% opacity variants**

Add after line 25 (after `--terra-15`, `--sage-15`, etc.) in the `:root` block:

```css
  --layer-l1: #7CADD6;
  --layer-l2: #5BA4A4;
  --layer-l3: #ADA0D0;
  --layer-l4: #D4914E;
  --layer-hl: #D47BA0;
  --layer-rss: #6FA584;
  --layer-l1-15: rgba(124, 173, 214, 0.15);
  --layer-l2-15: rgba(91, 164, 164, 0.15);
  --layer-l3-15: rgba(173, 160, 208, 0.15);
  --layer-l4-15: rgba(212, 145, 78, 0.15);
  --layer-hl-15: rgba(212, 123, 160, 0.15);
  --layer-rss-15: rgba(111, 165, 132, 0.15);
```

Note: `--layer-l1` reuses existing `--blue` value. `--layer-l3` reuses `--purple`. `--layer-l4` is a warmer orange than `--terra`. `--layer-rss` reuses `--sage`. `--layer-l2` is a new teal. `--layer-hl` is a new pink.

**Step 2: Verify Vite build still works**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors

**Step 3: Commit**

```bash
git add web/app/src/styles/tokens.css
git commit -m "feat: add layer colour tokens for Sources page"
```

---

## Task 2: API — getOverview endpoint (TDD)

**Files:**
- Create: `web/api/routes/sources.js`
- Create: `web/api/sources.test.js`

**Step 1: Write the failing test for getOverview**

Create `web/api/sources.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { getOverview } from './routes/sources.js'

describe('getOverview', () => {
  it('returns runs array and health object', async () => {
    const result = await getOverview()
    expect(result).toHaveProperty('runs')
    expect(result).toHaveProperty('health')
    expect(Array.isArray(result.runs)).toBe(true)
  })

  it('runs are sorted newest first', async () => {
    const { runs } = await getOverview()
    if (runs.length >= 2) {
      expect(runs[0].date >= runs[1].date).toBe(true)
    }
  })

  it('each run has date, saved, fetchErrors, paywalled, elapsed', async () => {
    const { runs } = await getOverview()
    if (runs.length > 0) {
      const run = runs[0]
      expect(run).toHaveProperty('date')
      expect(typeof run.saved).toBe('number')
      expect(typeof run.fetchErrors).toBe('number')
      expect(typeof run.paywalled).toBe('number')
      expect(run).toHaveProperty('elapsed')
    }
  })

  it('new-format run has layerTotals with L1-L4 + headlines + rss', async () => {
    const { runs } = await getOverview()
    const newRun = runs.find(r => r.layerTotals !== null)
    if (newRun) {
      expect(newRun.layerTotals).toHaveProperty('L1')
      expect(newRun.layerTotals).toHaveProperty('L2')
      expect(newRun.layerTotals).toHaveProperty('L3')
      expect(newRun.layerTotals).toHaveProperty('L4')
      expect(newRun.layerTotals).toHaveProperty('headlines')
      expect(newRun.layerTotals).toHaveProperty('rss')
      expect(typeof newRun.layerTotals.L1.queries).toBe('number')
      expect(typeof newRun.layerTotals.L1.saved).toBe('number')
      expect(typeof newRun.layerTotals.L1.errors).toBe('number')
    }
  })

  it('old-format run has layerTotals: null', async () => {
    const { runs } = await getOverview()
    const oldRun = runs.find(r => r.layerTotals === null)
    if (oldRun) {
      expect(oldRun.layerTotals).toBe(null)
      expect(typeof oldRun.saved).toBe('number')
    }
  })

  it('health contains source objects with lastSuccess, consecutiveFailures, lastError', async () => {
    const { health } = await getOverview()
    const keys = Object.keys(health)
    if (keys.length > 0) {
      const source = health[keys[0]]
      expect(source).toHaveProperty('lastSuccess')
      expect(source).toHaveProperty('consecutiveFailures')
      expect(source).toHaveProperty('lastError')
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/api && bun test sources.test.js`
Expected: FAIL — module `./routes/sources.js` not found

**Step 3: Implement getOverview**

Create `web/api/routes/sources.js`:

```js
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
```

**Key decisions:**
- `queryStats` keys are prefixed `"L1: "`, `"L2: "`, `"L3: "`, `"L4: "` — parse with regex `^(L[1-4]):`
- No `"HL:"` keys — headline data comes from `raw.headlineStats` object directly
- RSS saved = total saved minus all query-attributed + headline found (remainder)
- Old-format runs (no `queryStats` key) return `layerTotals: null`

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/api && bun test sources.test.js`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add web/api/routes/sources.js web/api/sources.test.js
git commit -m "feat: add getOverview API for Sources page"
```

---

## Task 3: API — getRunDetail endpoint (TDD)

**Files:**
- Modify: `web/api/routes/sources.js` (add export)
- Modify: `web/api/sources.test.js` (add tests)

**Step 1: Write the failing test for getRunDetail**

Append to `web/api/sources.test.js`:

```js
import { getRunDetail } from './routes/sources.js'

describe('getRunDetail', () => {
  it('returns date, saved, queryStats, headlineStats for a valid date', async () => {
    const result = await getRunDetail('2026-03-05')
    if (result) {
      expect(result).toHaveProperty('date')
      expect(result).toHaveProperty('saved')
    }
  })

  it('returns queryStats as object for new-format run', async () => {
    const result = await getRunDetail('2026-03-05')
    if (result && result.queryStats) {
      expect(typeof result.queryStats).toBe('object')
      const firstKey = Object.keys(result.queryStats)[0]
      if (firstKey) {
        const val = result.queryStats[firstKey]
        expect(val).toHaveProperty('results')
        expect(val).toHaveProperty('saved')
      }
    }
  })

  it('returns null queryStats for old-format run', async () => {
    const result = await getRunDetail('2026-03-02')
    if (result) {
      expect(result.queryStats).toBe(null)
      expect(result.headlineStats).toBe(null)
    }
  })

  it('returns null for non-existent date', async () => {
    const result = await getRunDetail('1999-01-01')
    expect(result).toBe(null)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/api && bun test sources.test.js`
Expected: FAIL — `getRunDetail` is not exported

**Step 3: Add getRunDetail to sources.js**

Add to `web/api/routes/sources.js`:

```js
export async function getRunDetail(date) {
  const filePath = join(DATA_DIR, `last-run-${date}.json`)
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'))
    return {
      date,
      saved: raw.saved ?? 0,
      window: raw.window ?? null,
      queryStats: raw.queryStats ?? null,
      headlineStats: raw.headlineStats ?? null,
    }
  } catch {
    return null
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/api && bun test sources.test.js`
Expected: All tests PASS (10 total)

**Step 5: Commit**

```bash
git add web/api/routes/sources.js web/api/sources.test.js
git commit -m "feat: add getRunDetail API for Sources drill-down"
```

---

## Task 4: Wire source routes into server.js

**Files:**
- Modify: `web/api/server.js:1-6` (add import) and `~line 148` (add route blocks)

**Step 1: Add import at top of server.js**

After line 5 (`import { getConfig, putConfig } from './routes/config.js'`), add:

```js
import { getOverview, getRunDetail } from './routes/sources.js'
```

**Step 2: Add route handlers before the Health section**

Before the `// --- Health ---` comment (~line 159), add:

```js
      // --- Sources ---
      if (path === '/api/sources/overview' && req.method === 'GET') {
        return json(await getOverview())
      }

      const sourceRunMatch = path.match(/^\/api\/sources\/runs\/(\d{4}-\d{2}-\d{2})$/)
      if (sourceRunMatch && req.method === 'GET') {
        const detail = await getRunDetail(sourceRunMatch[1])
        if (!detail) return json({ error: 'Run not found' }, 404)
        return json(detail)
      }
```

**Step 3: Manually test endpoints**

Run (ensure API server is running): `curl -s http://localhost:3900/api/sources/overview | head -c 200`
Expected: JSON with `runs` array and `health` object

Run: `curl -s http://localhost:3900/api/sources/runs/2026-03-05 | head -c 200`
Expected: JSON with `queryStats` object

Run: `curl -s http://localhost:3900/api/sources/runs/1999-01-01`
Expected: `{"error":"Run not found"}`

**Step 4: Commit**

```bash
git add web/api/server.js
git commit -m "feat: wire source routes into API server"
```

---

## Task 5: Create useSources hook

**Files:**
- Create: `web/app/src/hooks/useSources.js`

**Step 1: Implement the hook**

Create `web/app/src/hooks/useSources.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useSources() {
  const [overview, setOverview] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState(null)
  const detailCache = useRef(new Map())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Load overview on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/api/sources/overview')
        if (!mountedRef.current) return
        setOverview(data)
        // Auto-select newest run
        if (data.runs.length > 0) {
          setSelectedDate(data.runs[0].date)
        }
        setLoading(false)
      } catch (err) {
        if (!mountedRef.current) return
        setError(err.message)
        setLoading(false)
      }
    }
    load()
  }, [])

  // Load detail when selected date changes
  useEffect(() => {
    if (!selectedDate || !overview) return

    const run = overview.runs.find(r => r.date === selectedDate)
    if (!run || run.layerTotals === null) {
      setDetail(null)
      return
    }

    // Check cache
    if (detailCache.current.has(selectedDate)) {
      setDetail(detailCache.current.get(selectedDate))
      return
    }

    async function loadDetail() {
      setDetailLoading(true)
      try {
        const data = await apiFetch(`/api/sources/runs/${selectedDate}`)
        if (!mountedRef.current) return
        detailCache.current.set(selectedDate, data)
        setDetail(data)
      } catch (err) {
        if (!mountedRef.current) return
        setDetail(null)
      }
      if (mountedRef.current) setDetailLoading(false)
    }
    loadDetail()
  }, [selectedDate, overview])

  const selectRun = useCallback((date) => {
    setSelectedDate(date)
  }, [])

  const selectedRun = overview?.runs.find(r => r.date === selectedDate) ?? null

  return {
    overview,
    selectedRun,
    detail,
    loading,
    detailLoading,
    error,
    selectRun,
  }
}
```

**Key patterns followed:**
- `mountedRef` guard for post-await state updates (from `useArticles` pattern)
- Cache drill-down responses in `useRef(new Map())` to avoid refetching
- Auto-select newest run on mount
- Skip detail fetch for old-format runs (`layerTotals === null`)

**Step 2: Verify Vite build**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors (unused hook is tree-shaken)

**Step 3: Commit**

```bash
git add web/app/src/hooks/useSources.js
git commit -m "feat: add useSources hook with drill-down caching"
```

---

## Task 6: Create Sources page

This is the largest task. Build incrementally — each section is a sub-step.

**Files:**
- Create: `web/app/src/pages/Sources.jsx`
- Create: `web/app/src/pages/Sources.css`

### Step 1: Scaffold page with header + run selector

Create `web/app/src/pages/Sources.jsx`:

```jsx
import { useState } from 'react'
import { useSources } from '../hooks/useSources'
import './Sources.css'

export default function Sources() {
  const { overview, selectedRun, detail, loading, detailLoading, error, selectRun } = useSources()

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load sources: {error}</div>

  return (
    <div>
      <div className="page-header">
        <h2>Sources</h2>
        <RunSelector
          runs={overview?.runs ?? []}
          selected={selectedRun?.date}
          onSelect={selectRun}
        />
      </div>

      {selectedRun && <RunSummary run={selectedRun} />}

      <ArticlesChart runs={overview?.runs ?? []} />

      <LayerCards layerTotals={selectedRun?.layerTotals} />

      <QueryTable
        detail={detail}
        loading={detailLoading}
        isLegacy={selectedRun?.layerTotals === null}
      />

      <HealthTable health={overview?.health ?? {}} />
    </div>
  )
}
```

Then add each sub-component inline below the default export.

### Step 2: RunSelector + RunSummary components

```jsx
function RunSelector({ runs, selected, onSelect }) {
  return (
    <select
      className="run-selector"
      value={selected || ''}
      onChange={e => onSelect(e.target.value)}
    >
      {runs.map(r => (
        <option key={r.date} value={r.date}>{r.date}</option>
      ))}
    </select>
  )
}

function RunSummary({ run }) {
  const parts = [`${run.saved} saved`, `${run.fetchErrors} errors`, `${run.paywalled} paywalled`]
  const time = formatElapsed(run.elapsed)
  const legacy = run.layerTotals === null ? ' (legacy run)' : ''
  return (
    <div className="run-summary">
      {parts.join(', ')} {time ? `\u2014 ${time}` : ''}{legacy}
    </div>
  )
}

function formatElapsed(elapsed) {
  if (!elapsed) return null
  const s = typeof elapsed === 'string' ? parseInt(elapsed) : elapsed
  if (isNaN(s)) return elapsed
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}
```

### Step 3: ArticlesChart (stacked area, inline SVG)

```jsx
const LAYER_KEYS = ['L1', 'L2', 'L3', 'L4', 'headlines', 'rss']
const LAYER_COLOURS = {
  L1: 'var(--layer-l1)',
  L2: 'var(--layer-l2)',
  L3: 'var(--layer-l3)',
  L4: 'var(--layer-l4)',
  headlines: 'var(--layer-hl)',
  rss: 'var(--layer-rss)',
}
const LAYER_LABELS = { L1: 'L1', L2: 'L2', L3: 'L3', L4: 'L4', headlines: 'Headlines', rss: 'RSS' }

function ArticlesChart({ runs }) {
  const [hoverIdx, setHoverIdx] = useState(null)

  if (runs.length === 0) return null

  // Reverse so oldest is left
  const sorted = [...runs].reverse()
  const W = 800
  const H = 200
  const PAD = { top: 10, right: 10, bottom: 30, left: 50 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  // Build stacked data
  const stacked = sorted.map(run => {
    if (!run.layerTotals) return { date: run.date, total: run.saved, layers: null }
    const layers = {}
    for (const k of LAYER_KEYS) {
      const lt = run.layerTotals[k]
      layers[k] = lt ? (lt.saved ?? lt.found ?? 0) : 0
    }
    return { date: run.date, total: run.saved, layers }
  })

  const maxY = Math.max(1, ...stacked.map(d => d.total))
  const xStep = sorted.length > 1 ? plotW / (sorted.length - 1) : plotW

  // Generate area paths (bottom-up stacking)
  const areas = []
  if (stacked.some(d => d.layers)) {
    for (let li = LAYER_KEYS.length - 1; li >= 0; li--) {
      const key = LAYER_KEYS[li]
      const topPoints = []
      const botPoints = []

      for (let i = 0; i < stacked.length; i++) {
        const x = PAD.left + (sorted.length > 1 ? i * xStep : plotW / 2)
        const d = stacked[i]
        if (!d.layers) {
          topPoints.push(`${x},${PAD.top + plotH}`)
          botPoints.push(`${x},${PAD.top + plotH}`)
          continue
        }
        // Sum layers below this one
        let below = 0
        for (let j = 0; j < li; j++) below += d.layers[LAYER_KEYS[j]] || 0
        const top = below + (d.layers[key] || 0)
        const yTop = PAD.top + plotH - (top / maxY) * plotH
        const yBot = PAD.top + plotH - (below / maxY) * plotH
        topPoints.push(`${x},${yTop}`)
        botPoints.push(`${x},${yBot}`)
      }

      const path = `M${topPoints.join(' L')} L${botPoints.reverse().join(' L')} Z`
      areas.push(
        <path key={key} d={path} fill={LAYER_COLOURS[key]} opacity="0.7" />
      )
    }
  }

  // Fallback: single grey area for all-legacy data
  if (!stacked.some(d => d.layers)) {
    const points = stacked.map((d, i) => {
      const x = PAD.left + (sorted.length > 1 ? i * xStep : plotW / 2)
      const y = PAD.top + plotH - (d.total / maxY) * plotH
      return `${x},${y}`
    })
    const baseline = `${PAD.left + (sorted.length > 1 ? (sorted.length - 1) * xStep : plotW / 2)},${PAD.top + plotH} ${PAD.left},${PAD.top + plotH}`
    areas.push(
      <path key="total" d={`M${points.join(' L')} L${baseline} Z`} fill="var(--cloudy)" opacity="0.3" />
    )
  }

  // Hover zones
  const hoverZones = sorted.map((_, i) => {
    const x = PAD.left + (sorted.length > 1 ? i * xStep : plotW / 2) - xStep / 2
    return (
      <rect
        key={i}
        x={Math.max(0, x)}
        y={PAD.top}
        width={xStep}
        height={plotH}
        fill="transparent"
        onMouseEnter={() => setHoverIdx(i)}
        onMouseLeave={() => setHoverIdx(null)}
      />
    )
  })

  // X-axis labels (show every Nth to avoid crowding)
  const labelEvery = Math.max(1, Math.floor(sorted.length / 8))
  const xLabels = sorted.map((r, i) => {
    if (i % labelEvery !== 0 && i !== sorted.length - 1) return null
    const x = PAD.left + (sorted.length > 1 ? i * xStep : plotW / 2)
    return (
      <text key={i} x={x} y={H - 5} textAnchor="middle" className="chart-label">
        {r.date.slice(5)}
      </text>
    )
  })

  // Tooltip
  const tooltip = hoverIdx !== null ? (() => {
    const d = stacked[hoverIdx]
    const x = PAD.left + (sorted.length > 1 ? hoverIdx * xStep : plotW / 2)
    const lines = [d.date, `Total: ${d.total}`]
    if (d.layers) {
      for (const k of LAYER_KEYS) {
        if (d.layers[k]) lines.push(`${LAYER_LABELS[k]}: ${d.layers[k]}`)
      }
    }
    return (
      <g>
        <line x1={x} y1={PAD.top} x2={x} y2={PAD.top + plotH} stroke="var(--cloudy)" strokeWidth="1" opacity="0.5" />
        <foreignObject x={x + 8} y={PAD.top} width="150" height="140">
          <div className="chart-tooltip">
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </foreignObject>
      </g>
    )
  })() : null

  return (
    <div className="card sources-chart-card">
      <div className="card-title">Articles over time</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sources-chart">
        {areas}
        {xLabels}
        {hoverZones}
        {tooltip}
      </svg>
      <div className="chart-legend">
        {LAYER_KEYS.map(k => (
          <span key={k} className="legend-item">
            <span className="legend-dot" style={{ background: LAYER_COLOURS[k] }} />
            {LAYER_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  )
}
```

Note: The legend dots use inline `style` for `background` because the colour is dynamic per-item. This is the one exception to the no-inline-styles rule — the CSS class handles everything else.

### Step 4: LayerCards component

```jsx
function LayerCards({ layerTotals }) {
  const cards = LAYER_KEYS.map(key => {
    const lt = layerTotals?.[key]
    const isHL = key === 'headlines'
    return (
      <div key={key} className={`layer-card ${!layerTotals ? 'layer-card-disabled' : ''}`}>
        <div className="layer-card-header">
          <span className="layer-badge" data-layer={key}>{LAYER_LABELS[key]}</span>
        </div>
        <div className="layer-card-stat">
          <span className="layer-card-value">{lt ? (isHL ? lt.found : lt.saved) : '\u2014'}</span>
          <span className="layer-card-label">{isHL ? 'found' : 'saved'}</span>
        </div>
        <div className="layer-card-sub">
          <span>{lt ? (isHL ? `${lt.sources} sources` : `${lt.queries ?? 0} queries`) : ''}</span>
          <span>{lt?.errors ? `${lt.errors} errors` : ''}</span>
        </div>
      </div>
    )
  })

  return <div className="layer-cards">{cards}</div>
}
```

### Step 5: QueryTable component

```jsx
function QueryTable({ detail, loading, isLegacy }) {
  const [search, setSearch] = useState('')
  const [layerFilter, setLayerFilter] = useState(new Set())
  const [sortKey, setSortKey] = useState('saved')
  const [sortAsc, setSortAsc] = useState(false)

  if (isLegacy) {
    return (
      <div className="card">
        <div className="card-title">Query detail</div>
        <div className="placeholder-text">No per-query data available for this run</div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="card">
        <div className="card-title">Query detail</div>
        <div className="placeholder-text">Loading query data...</div>
      </div>
    )
  }

  if (!detail?.queryStats) return null

  // Parse rows
  let rows = Object.entries(detail.queryStats).map(([label, stats]) => {
    const layer = label.match(/^(L[1-4]):/)?.[1] || 'HL'
    return { label, layer, ...stats }
  })

  // Filter
  if (search) {
    const q = search.toLowerCase()
    rows = rows.filter(r => r.label.toLowerCase().includes(q))
  }
  if (layerFilter.size > 0) {
    rows = rows.filter(r => layerFilter.has(r.layer))
  }

  // Sort
  rows.sort((a, b) => {
    const va = a[sortKey] ?? 0
    const vb = b[sortKey] ?? 0
    return sortAsc ? va - vb : vb - va
  })

  function toggleLayer(l) {
    setLayerFilter(prev => {
      const next = new Set(prev)
      next.has(l) ? next.delete(l) : next.add(l)
      return next
    })
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sortIndicator = (key) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : ''

  return (
    <div className="card card-flush">
      <div className="query-table-header">
        <span className="card-title">Query detail</span>
        <div className="query-filters">
          {['L1', 'L2', 'L3', 'L4', 'HL'].map(l => (
            <button
              key={l}
              className={`layer-filter-btn ${layerFilter.has(l) ? 'active' : ''}`}
              data-layer={l === 'HL' ? 'headlines' : l}
              onClick={() => toggleLayer(l)}
            >
              {l}
            </button>
          ))}
          <input
            type="text"
            placeholder="Search queries..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="query-search"
          />
        </div>
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Query</th>
              <th className="sortable" onClick={() => handleSort('results')}>Results{sortIndicator('results')}</th>
              <th className="sortable" onClick={() => handleSort('new')}>New{sortIndicator('new')}</th>
              <th className="sortable" onClick={() => handleSort('saved')}>Saved{sortIndicator('saved')}</th>
              <th className="sortable" onClick={() => handleSort('paywalled')}>Paywalled{sortIndicator('paywalled')}</th>
              <th className="sortable" onClick={() => handleSort('errors')}>Errors{sortIndicator('errors')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="query-row" data-layer={r.layer === 'HL' ? 'headlines' : r.layer}>
                <td>
                  <span className="query-layer-tag" data-layer={r.layer === 'HL' ? 'headlines' : r.layer}>{r.layer}</span>
                  <span className="query-label">{r.label.replace(/^L[1-4]: |^HL: /, '')}</span>
                </td>
                <td className="cell-num">{r.results ?? 0}</td>
                <td className="cell-num">{r.new ?? 0}</td>
                <td className="cell-num">{r.saved ?? 0}</td>
                <td className="cell-num">{r.paywalled ?? 0}</td>
                <td className="cell-num">{r.errors ?? 0}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="placeholder-text">No queries match filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

### Step 6: HealthTable component

```jsx
function HealthTable({ health }) {
  const sources = Object.entries(health)
  if (sources.length === 0) {
    return (
      <div className="card">
        <div className="card-title">Source health</div>
        <div className="placeholder-text">No health data available</div>
      </div>
    )
  }

  return (
    <div className="card card-flush">
      <div className="card-title" style={{ padding: '16px' }}>Source health</div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Status</th>
              <th>Last success</th>
              <th>Failures</th>
              <th>Last error</th>
            </tr>
          </thead>
          <tbody>
            {sources.map(([name, s]) => {
              const failures = s.consecutiveFailures ?? 0
              const statusClass = failures === 0 ? 'health-ok' : failures <= 2 ? 'health-warn' : 'health-error'
              return (
                <tr key={name}>
                  <td>{name}</td>
                  <td><span className={`health-dot ${statusClass}`} /></td>
                  <td className="cell-meta">{s.lastSuccess ? new Date(s.lastSuccess).toLocaleDateString() : '\u2014'}</td>
                  <td className="cell-num">{failures}</td>
                  <td className="cell-meta">{s.lastError || '\u2014'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

### Step 7: Create Sources.css

Create `web/app/src/pages/Sources.css`:

```css
/* --- Run selector + summary --- */
.run-selector {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  padding: 8px 14px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
}
.run-selector:focus { border-color: var(--terra); box-shadow: var(--focus-ring); }

.run-summary {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  color: var(--cloudy);
  margin-bottom: 20px;
}

/* --- Chart --- */
.sources-chart-card { padding: 16px; }
.sources-chart { width: 100%; height: auto; }
.chart-label { font-family: 'Poppins', sans-serif; font-size: 11px; fill: var(--cloudy); }
.chart-tooltip {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  background: var(--card-bg);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  padding: 6px 10px;
  color: var(--text-primary);
  line-height: 1.5;
}

.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--light-gray);
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}
.legend-dot { width: 10px; height: 10px; border-radius: 50%; }

/* --- Layer cards --- */
.layer-cards {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.layer-card {
  background: var(--card-bg);
  border-radius: var(--radius);
  padding: 14px;
  border-left: 3px solid transparent;
}

.layer-card[data-layer] { border-left-color: var(--layer-l1); }

/* Layer border colours via data attributes */
.layer-card:nth-child(1) { border-left-color: var(--layer-l1); }
.layer-card:nth-child(2) { border-left-color: var(--layer-l2); }
.layer-card:nth-child(3) { border-left-color: var(--layer-l3); }
.layer-card:nth-child(4) { border-left-color: var(--layer-l4); }
.layer-card:nth-child(5) { border-left-color: var(--layer-hl); }
.layer-card:nth-child(6) { border-left-color: var(--layer-rss); }

.layer-card-disabled { opacity: 0.35; }

.layer-card-header { margin-bottom: 8px; }

.layer-badge {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.layer-badge[data-layer="L1"] { color: var(--layer-l1); }
.layer-badge[data-layer="L2"] { color: var(--layer-l2); }
.layer-badge[data-layer="L3"] { color: var(--layer-l3); }
.layer-badge[data-layer="L4"] { color: var(--layer-l4); }
.layer-badge[data-layer="headlines"] { color: var(--layer-hl); }
.layer-badge[data-layer="rss"] { color: var(--layer-rss); }

.layer-card-stat { display: flex; align-items: baseline; gap: 6px; }
.layer-card-value {
  font-family: 'Poppins', sans-serif;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}
.layer-card-label {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}
.layer-card-sub {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  color: var(--cloudy);
}

/* --- Query table --- */
.query-table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  flex-wrap: wrap;
  gap: 10px;
}

.query-filters {
  display: flex;
  gap: 6px;
  align-items: center;
}

.layer-filter-btn {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--light-gray);
  background: var(--surface);
  color: var(--cloudy);
  cursor: pointer;
  transition: all 0.15s;
}
.layer-filter-btn:hover { color: var(--text-primary); }
.layer-filter-btn.active { border-color: var(--terra); color: var(--terra); background: var(--terra-bg); }

.layer-filter-btn[data-layer="L1"].active { border-color: var(--layer-l1); color: var(--layer-l1); background: var(--layer-l1-15); }
.layer-filter-btn[data-layer="L2"].active { border-color: var(--layer-l2); color: var(--layer-l2); background: var(--layer-l2-15); }
.layer-filter-btn[data-layer="L3"].active { border-color: var(--layer-l3); color: var(--layer-l3); background: var(--layer-l3-15); }
.layer-filter-btn[data-layer="L4"].active { border-color: var(--layer-l4); color: var(--layer-l4); background: var(--layer-l4-15); }
.layer-filter-btn[data-layer="headlines"].active { border-color: var(--layer-hl); color: var(--layer-hl); background: var(--layer-hl-15); }

.query-search {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  padding: 6px 12px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  outline: none;
  min-width: 180px;
}
.query-search:focus { border-color: var(--terra); box-shadow: var(--focus-ring); }

.query-row { border-left: 3px solid transparent; }
.query-row[data-layer="L1"] { border-left-color: var(--layer-l1); }
.query-row[data-layer="L2"] { border-left-color: var(--layer-l2); }
.query-row[data-layer="L3"] { border-left-color: var(--layer-l3); }
.query-row[data-layer="L4"] { border-left-color: var(--layer-l4); }
.query-row[data-layer="headlines"] { border-left-color: var(--layer-hl); }

.query-layer-tag {
  font-family: 'Poppins', sans-serif;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  margin-right: 8px;
  display: inline-block;
}
.query-layer-tag[data-layer="L1"] { background: var(--layer-l1-15); color: var(--layer-l1); }
.query-layer-tag[data-layer="L2"] { background: var(--layer-l2-15); color: var(--layer-l2); }
.query-layer-tag[data-layer="L3"] { background: var(--layer-l3-15); color: var(--layer-l3); }
.query-layer-tag[data-layer="L4"] { background: var(--layer-l4-15); color: var(--layer-l4); }
.query-layer-tag[data-layer="headlines"] { background: var(--layer-hl-15); color: var(--layer-hl); }

.query-label {
  font-size: 13px;
  color: var(--text-primary);
}

.cell-num {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.sortable { cursor: pointer; user-select: none; }
.sortable:hover { color: var(--text-primary); }

/* --- Health table --- */
.health-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
}
.health-ok { background: var(--success); }
.health-warn { background: var(--warning); }
.health-error { background: var(--danger); }

/* --- Responsive --- */
@media (max-width: 1100px) {
  .layer-cards { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 700px) {
  .layer-cards { grid-template-columns: repeat(2, 1fr); }
}
```

### Step 8: Verify build

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors (Sources is imported by App.jsx — not yet wired, so no import errors yet)

Actually, Sources.jsx won't be imported until Task 7. Build should still pass with just the file existing.

### Step 9: Commit

```bash
git add web/app/src/pages/Sources.jsx web/app/src/pages/Sources.css
git commit -m "feat: add Sources page with chart, layer cards, query table, health table"
```

---

## Task 7: Wire Sources into routing and navigation

**Files:**
- Modify: `web/app/src/App.jsx:1-23`
- Modify: `web/app/src/components/layout/Sidebar.jsx:1-18`

**Step 1: Add route to App.jsx**

Add import after line 6 (`import Config from './pages/Config'`):

```jsx
import Sources from './pages/Sources'
```

Add route after the `/config` route (line 18):

```jsx
              <Route path="/sources" element={<Sources />} />
```

**Step 2: Add nav item to Sidebar.jsx**

Add to `NAV_ITEMS` array after the Config entry (line 9):

```js
  { to: '/sources', label: 'Sources', icon: 'layers' },
```

Add to `ICONS` object after `settings` (line 17):

```jsx
  layers: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
```

This is a standard "layers" icon — three stacked chevrons.

**Step 3: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors

**Step 4: Verify in browser**

Start dev server and navigate to `http://localhost:5173/sources`. Should see:
- Header with "Sources" title and run selector dropdown
- Run summary line
- Stacked area chart (or grey area for legacy runs)
- Six layer cards
- Query table (for Mar 5 run)
- Source health table

**Step 5: Commit**

```bash
git add web/app/src/App.jsx web/app/src/components/layout/Sidebar.jsx
git commit -m "feat: add Sources route and nav item"
```

---

## Task 8: Add found_by badges to article detail panel

**Files:**
- Modify: `web/app/src/pages/Articles.jsx:289-298` (ArticleDetail metadata dl)
- Modify: `web/app/src/pages/Articles.css` (add badge styles)

**Step 1: Add found_by badges to ArticleDetail**

In `Articles.jsx`, in the `ArticleDetail` component, add after the score_reason `<>` block (after line 297, before the closing `</dl>`):

```jsx
            {d.found_by?.length > 0 && (
              <>
                <dt>Discovered by</dt>
                <dd>
                  <div className="found-by-badges">
                    {d.found_by.map((fb, i) => {
                      const layer = fb.match(/^(L[1-4]|RSS|HL):/)?.[1] || 'unknown'
                      const layerKey = layer === 'HL' ? 'headlines' : layer === 'RSS' ? 'rss' : layer
                      return (
                        <span key={i} className="found-by-badge" data-layer={layerKey} title={fb}>
                          {layer}
                        </span>
                      )
                    })}
                  </div>
                </dd>
              </>
            )}
            {(!d.found_by || d.found_by.length === 0) && d.source_type !== 'manual' && (
              <>
                <dt>Discovered by</dt>
                <dd className="cell-meta">Unknown</dd>
              </>
            )}
```

**Step 2: Add found_by badge styles to Articles.css**

Append to `web/app/src/pages/Articles.css`:

```css
/* --- Found-by badges --- */
.found-by-badges { display: flex; flex-wrap: wrap; gap: 4px; }
.found-by-badge {
  font-family: 'Poppins', sans-serif;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-lg);
  cursor: default;
}
.found-by-badge[data-layer="L1"] { background: var(--layer-l1-15); color: var(--layer-l1); }
.found-by-badge[data-layer="L2"] { background: var(--layer-l2-15); color: var(--layer-l2); }
.found-by-badge[data-layer="L3"] { background: var(--layer-l3-15); color: var(--layer-l3); }
.found-by-badge[data-layer="L4"] { background: var(--layer-l4-15); color: var(--layer-l4); }
.found-by-badge[data-layer="rss"] { background: var(--layer-rss-15); color: var(--layer-rss); }
.found-by-badge[data-layer="headlines"] { background: var(--layer-hl-15); color: var(--layer-hl); }
.found-by-badge[data-layer="unknown"] { background: var(--light-gray); color: var(--cloudy); }
```

**Step 3: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors

**Step 4: Verify in browser**

Navigate to Articles, expand an article from the Mar 5 run. Should see:
- "Discovered by" row in metadata with colour-coded layer badges
- Hover tooltip shows full query text
- Articles without `found_by` show "Unknown" in muted text
- Manually ingested articles don't show the field at all

**Step 5: Commit**

```bash
git add web/app/src/pages/Articles.jsx web/app/src/pages/Articles.css
git commit -m "feat: add found_by badges to article detail panel"
```

---

## Task 9: Run all tests + final build check

**Step 1: Run all API tests**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/api && bun test`
Expected: All tests pass (previous 68 + new sources tests)

**Step 2: Run Vite build**

Run: `cd /Users/scott/Projects/sni-research-v2/.claude/worktrees/lucid-sinoussi/web/app && bun run build`
Expected: 0 errors, 0 warnings

**Step 3: Verify endpoints and page visually**

- `curl http://localhost:3900/api/sources/overview` — returns valid JSON
- `curl http://localhost:3900/api/sources/runs/2026-03-05` — returns queryStats
- Browser: `/sources` page loads with all sections
- Browser: Articles detail shows found_by badges

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | tokens.css | Layer colour tokens |
| 2 | sources.js, sources.test.js | getOverview API (TDD) |
| 3 | sources.js, sources.test.js | getRunDetail API (TDD) |
| 4 | server.js | Wire routes |
| 5 | useSources.js | React hook |
| 6 | Sources.jsx, Sources.css | Full Sources page |
| 7 | App.jsx, Sidebar.jsx | Route + nav |
| 8 | Articles.jsx, Articles.css | found_by badges |
| 9 | — | Test + build verification |

**Parallel opportunities:** Tasks 1–3 are independent. Task 5 can be written in parallel with Task 4. Task 8 is independent of Tasks 5–7.
