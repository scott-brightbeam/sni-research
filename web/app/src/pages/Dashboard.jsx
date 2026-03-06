import { useState, useEffect, useCallback } from 'react'
import { useStatus } from '../hooks/useStatus'
import { apiFetch } from '../lib/api'
import SectorBadge from '../components/shared/SectorBadge'
import { SECTOR_COLOURS, formatDuration, formatRelativeTime, formatDayLabel, getDateRange } from '../lib/format'
import './Dashboard.css'

const CHART_RANGES = [
  { key: 'week', label: 'This week' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'all', label: 'All time' },
]

const COST_PERIODS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
]

const MODEL_SHORT = {
  'claude-sonnet-4-20250514': 'Sonnet',
  'claude-opus-4-6': 'Opus 4.6',
}

export default function Dashboard() {
  const { status, loading, error } = useStatus()

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>
  if (!status) return <div className="empty">No data available</div>

  const { lastRun, articles, nextPipeline, lastFridayRunAt } = status
  const weekArticles = articles.weekArticles || {}

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      <div className="dashboard-grid">
        <StatCard
          label="Articles today"
          value={articles.today}
          detail={`${articles.total} total across all dates`}
        />
        <TokenCostCard />
        <NextPipelineCard nextPipeline={nextPipeline} />
      </div>

      <div className="dashboard-panels">
        <div className="card">
          <ArticleChart
            articles={articles}
            weekArticles={weekArticles}
            lastFridayRunAt={lastFridayRunAt}
          />
        </div>

        <div className="card">
          <div className="card-title">Last pipeline run</div>
          {lastRun ? (
            <>
              <div className="stages">
                {lastRun.stages.map(stage => (
                  <div key={stage.name} className={`stage-row ${stage.status === 'success' ? '' : 'pending'}`}>
                    <div className={`stage-icon ${stage.status === 'success' ? 'ok' : 'off'}`}>
                      {stage.status === 'success' ? '✓' : '·'}
                    </div>
                    <div className="stage-name">{stage.name}</div>
                    <div className="stage-stat">
                      {summariseStageStats(stage)}
                    </div>
                    <div className="stage-time">{formatDuration(stage.duration)}</div>
                  </div>
                ))}
              </div>
              <div className="run-footer">
                {lastRun.mode} mode · completed {formatRelativeTime(lastRun.completedAt)} · {formatDuration(lastRun.totalDuration)} total
              </div>
            </>
          ) : (
            <div className="empty">No runs found</div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Token Cost Card ──────────────────────────────────────────────────────────

function TokenCostCard() {
  const [period, setPeriod] = useState('month')
  const [usage, setUsage] = useState(null)
  const [loadingUsage, setLoadingUsage] = useState(true)

  const load = useCallback(async () => {
    setLoadingUsage(true)
    try {
      const data = await apiFetch(`/api/usage?period=${period}`)
      setUsage(data)
    } catch { /* ignore */ }
    setLoadingUsage(false)
  }, [period])

  useEffect(() => { load() }, [load])

  const totalCost = usage?.totalCost || 0
  const models = Object.entries(usage?.byModel || {})

  return (
    <div className="stat-card token-cost-card">
      <div className="stat-label">Token cost</div>
      <div className="stat-value">{loadingUsage ? '...' : formatCostDisplay(totalCost)}</div>
      <div className="cost-models">
        {models.map(([model, stats]) => (
          <span key={model} className="cost-model-row">
            {MODEL_SHORT[model] || model}: {formatCostDisplay(stats.cost)}
          </span>
        ))}
        {models.length === 0 && !loadingUsage && (
          <span className="cost-model-row">No usage</span>
        )}
      </div>
      <div className="cost-toggles">
        {COST_PERIODS.map(p => (
          <button
            key={p.key}
            className={`cost-toggle ${period === p.key ? 'active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function formatCostDisplay(cost) {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

// ─── Next Pipeline Card ───────────────────────────────────────────────────────

function NextPipelineCard({ nextPipeline }) {
  if (!nextPipeline) {
    return (
      <div className="stat-card">
        <div className="stat-label">Next pipeline</div>
        <div className="stat-value small">—</div>
      </div>
    )
  }

  return (
    <div className="stat-card next-pipeline-card">
      <div className="stat-label">Next pipeline</div>
      <div className="pipeline-schedule">
        <div className="pipeline-row">
          <span className="pipeline-type">Scrape</span>
          <span className="pipeline-time">{formatNextRunFull(nextPipeline.nextDaily)}</span>
        </div>
        <div className="pipeline-row">
          <span className="pipeline-type">Full run</span>
          <span className="pipeline-time">{formatNextRunFull(nextPipeline.nextFriday)}</span>
        </div>
      </div>
    </div>
  )
}

function formatNextRunFull(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' })
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${dd}/${mm} · ${time}`
}

// ─── Article Chart ────────────────────────────────────────────────────────────

function ArticleChart({ articles, weekArticles, lastFridayRunAt }) {
  const [range, setRange] = useState('week')
  const [activeSector, setActiveSector] = useState(null)

  // Pick data source based on range
  const isWeek = range === 'week'

  // Compute date entries for the week bar chart
  const weekDates = (() => {
    if (!isWeek || !lastFridayRunAt) return []
    const fridayDate = lastFridayRunAt.split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    return getDateRange(fridayDate, today)
  })()

  // Data sources
  const weekByDate = weekArticles.byDate || {}
  const weekByDateBySector = weekArticles.byDateBySector || {}
  const weekBySector = weekArticles.bySector || {}

  const allByDate = articles.byDate || {}
  const allBySector = articles.bySector || {}

  // Aggregate for "Last 30 days"
  const thirtyDayData = (() => {
    if (range !== '30d') return { total: 0, bySector: {} }
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const cutoffStr = cutoff.toISOString().split('T')[0]
    const bySector = {}
    let total = 0
    for (const [date, count] of Object.entries(allByDate)) {
      if (date >= cutoffStr) {
        total += count
        const dateSectors = articles.byDateBySector?.[date] || {}
        for (const [s, c] of Object.entries(dateSectors)) {
          bySector[s] = (bySector[s] || 0) + c
        }
      }
    }
    return { total, bySector }
  })()

  // Active aggregate data for non-week views
  const aggregateBySector = range === '30d' ? thirtyDayData.bySector : allBySector
  const aggregateTotal = range === '30d' ? thirtyDayData.total : articles.total

  // Current sector totals shown in badges
  const badgeSectors = isWeek ? weekBySector : aggregateBySector
  const badgeTotal = isWeek
    ? Object.values(weekBySector).reduce((a, b) => a + b, 0)
    : aggregateTotal

  return (
    <>
      <div className="card-title-row">
        <div className="card-title">Articles</div>
        <div className="chart-range-toggles">
          {CHART_RANGES.map(r => (
            <button
              key={r.key}
              className={`cost-toggle ${range === r.key ? 'active' : ''}`}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {isWeek ? (
        <WeekBarChart
          dates={weekDates}
          byDate={weekByDate}
          byDateBySector={weekByDateBySector}
          activeSector={activeSector}
        />
      ) : (
        <AggregateView
          total={aggregateTotal}
          bySector={aggregateBySector}
          activeSector={activeSector}
        />
      )}

      <div className="sector-badges">
        <button
          className={`sector-filter-btn ${activeSector === null ? 'active' : ''}`}
          onClick={() => setActiveSector(null)}
        >
          All {badgeTotal}
        </button>
        {Object.keys(badgeSectors).sort().map(sector => (
          <button
            key={sector}
            className={`sector-filter-btn ${activeSector === sector ? 'active' : ''}`}
            onClick={() => setActiveSector(activeSector === sector ? null : sector)}
          >
            <SectorBadge sector={sector} /> {badgeSectors[sector]}
          </button>
        ))}
      </div>
    </>
  )
}

function WeekBarChart({ dates, byDate, byDateBySector, activeSector }) {
  const getCounts = (date) => {
    if (activeSector) return byDateBySector[date]?.[activeSector] || 0
    return byDate[date] || 0
  }

  const counts = dates.map(d => getCounts(d))
  const max = Math.max(...counts, 1)

  const barColour = activeSector
    ? SECTOR_COLOURS[activeSector]?.color || 'var(--terra)'
    : 'var(--terra)'

  if (dates.length === 0) {
    return <div className="chart-empty">No Friday pipeline run found</div>
  }

  return (
    <div className="bar-chart">
      {dates.map((date) => {
        const count = getCounts(date)
        return (
          <div key={date} className="bar-group">
            <div
              className="bar"
              style={{ height: `${(count / max) * 70}px`, background: barColour }}
              title={`${date}: ${count} articles${activeSector ? ` (${activeSector})` : ''}`}
            />
            <div className="bar-label">{formatDayLabel(date)}</div>
          </div>
        )
      })}
    </div>
  )
}

function AggregateView({ total, bySector, activeSector }) {
  const displayTotal = activeSector
    ? (bySector[activeSector] || 0)
    : total

  return (
    <div className="aggregate-view">
      <div className="aggregate-total">{displayTotal}</div>
      <div className="aggregate-label">articles</div>
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function StatCard({ label, value, detail, smallValue }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${smallValue ? 'small' : ''}`}>{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  )
}

function summariseStageStats(stage) {
  const s = stage.stats
  if (!s || Object.keys(s).length === 0) {
    return stage.status === 'success' ? 'done' : 'friday only'
  }
  if (s.saved !== undefined) return `${s.saved} saved`
  if (s.kept !== undefined) return `${s.kept} kept, ${s.moved || 0} flagged`
  return 'done'
}
