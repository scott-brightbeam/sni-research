import { useStatus } from '../hooks/useStatus'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDuration, formatRelativeTime } from '../lib/format'
import './Dashboard.css'

export default function Dashboard() {
  const { status, loading } = useStatus()

  if (loading) return <div className="loading">Loading...</div>
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
          label="Next pipeline"
          value={nextPipeline ? formatNextRun(nextPipeline.nextFriday) : '—'}
          detail="Full friday run"
          smallValue
        />
      </div>

      <div className="dashboard-panels">
        <div className="card">
          <div className="card-title">Articles by date</div>
          <BarChart byDate={articles.byDate || {}} />
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

function BarChart({ byDate }) {
  const entries = Object.entries(byDate).sort().slice(-7)
  const max = Math.max(...entries.map(([, n]) => n), 1)

  return (
    <div className="bar-chart">
      {entries.map(([date, count]) => {
        const d = new Date(date + 'T00:00:00')
        const label = d.toLocaleDateString('en-GB', { weekday: 'short' })
        return (
          <div key={date} className="bar-group">
            <div
              className="bar"
              style={{ height: `${(count / max) * 70}px`, background: 'var(--terra)' }}
              title={`${date}: ${count} articles`}
            />
            <div className="bar-label">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function formatNextRun(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
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
