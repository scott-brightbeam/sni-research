import { useState } from 'react'
import { useSources } from '../hooks/useSources'
import './Sources.css'

export default function Sources() {
  const { overview, selectedRun, detail, loading, detailLoading, error, selectRun } = useSources()

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load sources: {error}</div>

  const runs = overview?.runs ?? []

  return (
    <div>
      <div className="page-header">
        <h2>Sources</h2>
        {runs.length > 0 && (
          <RunSelector
            runs={runs}
            selected={selectedRun?.date}
            onSelect={selectRun}
          />
        )}
      </div>

      {runs.length === 0 && (
        <div className="placeholder-text">No pipeline runs found. The fetch pipeline needs to run at least once to generate source data.</div>
      )}

      {selectedRun && <RunSummary run={selectedRun} />}

      <ArticlesChart runs={runs} />

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
            <span className="legend-dot" data-layer={k === 'headlines' ? 'headlines' : k} />
            {LAYER_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  )
}

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

  // Parse query rows from queryStats
  let rows = Object.entries(detail.queryStats).map(([label, stats]) => {
    const layer = label.match(/^(L[1-4]):/)?.[1] || 'HL'
    return { label, layer, ...stats }
  })

  // Add aggregate headline row from headlineStats
  if (detail?.headlineStats) {
    const hl = detail.headlineStats
    rows.push({
      label: `HL: ${hl.sources ?? 0} sources \u2014 ${hl.headlines ?? 0} headlines scraped, ${hl.searched ?? 0} searched`,
      layer: 'HL',
      results: hl.found ?? 0,
      new: hl.headlines ?? 0,
      saved: hl.searched ?? 0,
      paywalled: 0,
      errors: hl.errors ?? 0,
    })
    // Per-source headline rows (populated from pipeline perSource tracking)
    if (hl.perSource) {
      for (const [name, s] of Object.entries(hl.perSource)) {
        rows.push({
          label: `HL: ${name}`,
          layer: 'HL',
          results: s.found ?? 0,
          new: s.headlines ?? 0,
          saved: s.searched ?? 0,
          paywalled: 0,
          errors: s.errors ?? 0,
        })
      }
    }
  }

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
      <div className="card-title card-flush-title">Source health</div>
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
