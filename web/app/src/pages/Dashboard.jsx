import { useStatus } from '../hooks/useStatus'
import { useEditorialState, useEditorialCost } from '../hooks/useEditorialState'
import { useNotifications } from '../hooks/useNotifications'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import DraftLink from '../components/shared/DraftLink'
import Skeleton from '../components/shared/Skeleton'
import TimeRangeSelector from '../components/shared/TimeRangeSelector'
import { getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks } from '../lib/dateRange'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDuration, formatRelativeTime } from '../lib/format'
import './Dashboard.css'

function formatTimestamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function Dashboard() {
  const { status, loading, error } = useStatus()
  const [chartRange, setChartRange] = useState('7d')

  if (loading) return (
    <div>
      <div className="page-header"><h2>Dashboard</h2></div>
      <div className="dashboard-grid"><Skeleton.StatCards count={4} /></div>
      <div className="dashboard-panels"><Skeleton.Cards count={2} /></div>
    </div>
  )
  if (error) return <div className="empty">Failed to load: {error}</div>
  if (!status) return <div className="empty">No data available</div>

  const { lastRun, articles, nextPipeline, podcastImport } = status

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
          value={nextPipeline ? formatNextRunDate(nextPipeline.nextFull) : '—'}
          detail={nextPipeline ? `at ${formatTime(nextPipeline.nextFull)}` : ''}
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

      <PodcastStatusCard podcastImport={podcastImport} />

      <div className="dashboard-editorial">
        <EditorialSummaryCard />
        <PostCandidatesCard />
        <CostSummaryCard />
      </div>
    </div>
  )
}

function PodcastStatusCard({ podcastImport }) {
  const [warningsOpen, setWarningsOpen] = useState(false)

  if (!podcastImport) {
    return (
      <div className="card podcast-status-card">
        <div className="card-title">Podcast import</div>
        <div className="empty">No podcast imports yet</div>
      </div>
    )
  }

  const { lastRun, episodesThisWeek, storiesGapFilled, warnings } = podcastImport
  const hasWarnings = warnings && warnings.length > 0

  return (
    <div className="card podcast-status-card">
      <div className="card-title">Podcast import</div>
      <div className="podcast-stats">
        <div className="podcast-stat">
          <div className="podcast-stat-value">{episodesThisWeek}</div>
          <div className="podcast-stat-label">Episodes this week</div>
        </div>
        <div className="podcast-stat">
          <div className="podcast-stat-value">{storiesGapFilled}</div>
          <div className="podcast-stat-label">Stories gap-filled</div>
        </div>
      </div>
      <div className="podcast-meta">
        Last import: {formatTimestamp(lastRun)}
      </div>
      {hasWarnings && (
        <div className="podcast-warnings">
          <button
            className="podcast-warnings-toggle"
            onClick={() => setWarningsOpen(w => !w)}
          >
            {warningsOpen ? '▾' : '▸'} {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
          </button>
          {warningsOpen && (
            <ul className="podcast-warnings-list">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
    return stage.status === 'success' ? 'done' : 'full run only'
  }
  if (s.saved !== undefined) return `${s.saved} saved`
  if (s.kept !== undefined) return `${s.kept} kept, ${s.moved || 0} flagged`
  return 'done'
}

// ── Editorial summary card ────────────────────────────────

function EditorialSummaryCard() {
  const { data, loading, error } = useEditorialState()

  if (loading) return (
    <div className="card editorial-summary-card">
      <div className="card-title">Editorial intelligence</div>
      <div className="empty">Loading...</div>
    </div>
  )

  if (error || !data) return (
    <div className="card editorial-summary-card">
      <div className="card-title">Editorial intelligence</div>
      <div className="empty">No editorial state available</div>
    </div>
  )

  const entryCount = data.entries?.length || data.analysisIndex?.entries?.length || 0
  const themeCount = data.themes?.length || data.themeRegistry?.themes?.length || 0
  const postCount = data.posts?.length || data.postBacklog?.posts?.length || 0
  const session = data.session || data.lastSession || null

  return (
    <div className="card editorial-summary-card">
      <div className="card-header">
        <div className="card-title">Editorial intelligence</div>
        <Link to="/editorial" className="card-link">View all</Link>
      </div>
      <div className="editorial-summary-stats">
        <div className="editorial-stat">
          <div className="editorial-stat-value">{entryCount}</div>
          <div className="editorial-stat-label">Documents</div>
        </div>
        <div className="editorial-stat">
          <div className="editorial-stat-value">{themeCount}</div>
          <div className="editorial-stat-label">Themes</div>
        </div>
        <div className="editorial-stat">
          <div className="editorial-stat-value">{postCount}</div>
          <div className="editorial-stat-label">Post candidates</div>
        </div>
      </div>
      {session && (
        <div className="editorial-session">Session {session}</div>
      )}
    </div>
  )
}

// ── Post candidates card ──────────────────────────────────

function PostCandidatesCard() {
  const { notifications, loading } = useNotifications(0) // No polling on dashboard

  const candidates = (notifications || []).filter(n =>
    n.priority === 'high' || n.priority === 'immediate'
  )

  if (loading) return null
  if (candidates.length === 0) return null

  return (
    <div className="card post-candidates-card">
      <div className="card-header">
        <div className="card-title">Post candidates</div>
        <span className="candidates-count">{candidates.length} ready</span>
      </div>
      <div className="candidates-list">
        {candidates.slice(0, 5).map((c, i) => (
          <div key={c.id || i} className="candidate-item">
            <span className={`candidate-priority priority-${c.priority}`}>
              {c.priority === 'immediate' ? '!!' : '!'}
            </span>
            <span className="candidate-title">{c.title || c.message}</span>
            <DraftLink
              label="Draft"
              source={{ type: 'post', id: c.id, title: c.title || c.message }}
              content={{ coreArgument: c.detail, format: c.format }}
            />
          </div>
        ))}
        {candidates.length > 5 && (
          <Link to="/editorial" className="candidates-more">
            +{candidates.length - 5} more
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Cost summary card ─────────────────────────────────────

function CostSummaryCard() {
  const { data, loading, error } = useEditorialCost()

  if (loading || error || !data) return null

  const spent = data.weeklyTotal || 0
  const budget = data.budget || 50
  const pct = Math.min(100, (spent / budget) * 100)
  const level = pct >= 80 ? 'danger' : pct >= 60 ? 'warning' : 'ok'

  return (
    <div className="card cost-summary-card">
      <div className="card-title">Weekly AI cost</div>
      <div className="cost-summary-display">
        <span className={`cost-summary-value cost-${level}`}>${spent.toFixed(2)}</span>
        <span className="cost-summary-budget"> of ${budget}</span>
        <span className="cost-summary-pct">({Math.round(pct)}%)</span>
      </div>
      <div className="cost-summary-bar">
        <div className={`cost-summary-fill cost-${level}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
