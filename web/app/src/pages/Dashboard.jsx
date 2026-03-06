import { useStatus } from '../hooks/useStatus'
import { useState } from 'react'
import TimeRangeSelector from '../components/shared/TimeRangeSelector'
import { getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks } from '../lib/dateRange'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDuration, formatRelativeTime } from '../lib/format'
import './Dashboard.css'

export default function Dashboard() {
  const { status, loading, error } = useStatus()
  const [chartRange, setChartRange] = useState('7d')

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>
  if (!status) return <div className="empty">No data available</div>

  const { lastRun, articles, nextPipeline } = status

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
        <StatCard
          label="Sectors"
          value={Object.keys(articles.bySector || {}).length}
          detail={Object.entries(articles.bySector || {}).map(([s, n]) => `${s}: ${n}`).join(' · ')}
        />
        <StatCard
          label="Next full run"
          value={nextPipeline ? formatNextRunDate(nextPipeline.nextFriday) : '—'}
          detail={nextPipeline ? `at ${formatTime(nextPipeline.nextFriday)}` : ''}
          smallValue
        />
        <StatCard
          label="Next retrieval"
          value={nextPipeline ? formatNextRunDate(nextPipeline.nextDaily) : '—'}
          detail={nextPipeline ? `at ${formatTime(nextPipeline.nextDaily)}` : ''}
          smallValue
        />
      </div>

      <div className="dashboard-panels">
        <div className="card">
          <div className="card-header">
            <div className="card-title">Articles by date</div>
            <TimeRangeSelector value={chartRange} onChange={setChartRange} />
          </div>
          <BarChart byDate={articles.byDate || {}} range={chartRange} />
          <div className="sector-badges">
            {Object.entries(articles.bySector || {}).map(([sector, count]) => (
              <span key={sector} className="sector-count">
                <SectorBadge sector={sector} /> {count}
              </span>
            ))}
          </div>
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

function StatCard({ label, value, detail, smallValue }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${smallValue ? 'small' : ''}`}>{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  )
}

function BarChart({ byDate, range }) {
  const { startDate, endDate } = getDateRange(range)
  const filtered = filterByDateEntries(byDate, startDate, endDate)
  const filled = fillCalendarGaps(filtered)

  if (filled.length === 0) {
    return <div className="bar-chart-empty">No articles in this period</div>
  }

  // Aggregate to weeks if >14 data points
  const entries = filled.length > 14 ? aggregateToWeeks(filled) : filled
  const isWeekly = filled.length > 14
  const max = Math.max(...entries.map(([, n]) => n), 1)

  return (
    <div className="bar-chart">
      {entries.map(([key, count]) => {
        let label
        if (isWeekly) {
          label = key // "W10"
        } else {
          const d = new Date(key + 'T00:00:00')
          const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' })
          const day = String(d.getDate()).padStart(2, '0')
          label = `${weekday} ${day}`
        }
        return (
          <div key={key} className="bar-group">
            <div
              className="bar"
              style={{
                '--bar-h': `${(count / max) * 70}px`,
                '--bar-bg': count > 0 ? 'var(--terra)' : 'var(--light-gray)',
              }}
              title={`${key}: ${count} articles`}
            />
            <div className="bar-label">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function formatNextRunDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' + d.getDate()
}

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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
