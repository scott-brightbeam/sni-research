import { useState, useMemo } from 'react'
import { useEditorialState, useEditorialActivity, useEditorialSearch, useEditorialCost } from '../hooks/useEditorialState'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { formatRelativeTime } from '../lib/format'
import './Editorial.css'

const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity', label: 'Activity' },
]

const STATUS_COLOURS = {
  suggested: 'var(--color-text-secondary)',
  approved: 'var(--color-accent)',
  'in-progress': 'var(--color-warning)',
  published: 'var(--color-success)',
  rejected: 'var(--color-danger)',
  archived: 'var(--color-text-secondary)',
}

const PRIORITY_LABELS = { high: '🔴', medium: '🟡', low: '⚪' }

export default function Editorial() {
  const [tab, setTab] = useState('state')
  const [search, setSearch] = useState('')
  const [backlogFilter, setBacklogFilter] = useState({ status: '', priority: '' })

  const debouncedSearch = useDebouncedValue(search, 300)

  return (
    <div className="editorial-page">
      <div className="page-header">
        <h2>Editorial Intelligence</h2>
        <div className="header-actions">
          <input
            type="text"
            className="search-input"
            placeholder="Search state..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {debouncedSearch ? (
        <SearchResults query={debouncedSearch} />
      ) : (
        <>
          {tab === 'state' && <AnalysisTab />}
          {tab === 'themes' && <ThemesTab />}
          {tab === 'backlog' && <BacklogTab filter={backlogFilter} setFilter={setBacklogFilter} />}
          {tab === 'decisions' && <DecisionsTab />}
          {tab === 'activity' && <ActivityTab />}
        </>
      )}
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────

function AnalysisTab() {
  const { data, loading, error } = useEditorialState('analysisIndex')
  const costData = useEditorialCost()

  if (loading) return <div className="loading-state">Loading analysis index...</div>
  if (error) return <div className="error-state">{error}</div>

  const entries = data?.entries || []

  return (
    <div className="tab-content">
      {costData.data && (
        <div className="cost-bar">
          <span className="cost-label">Weekly spend:</span>
          <span className="cost-value">${costData.data.weeklyTotal?.toFixed(2) || '0.00'}</span>
          <span className="cost-budget">/ ${costData.data.budget || 50}</span>
          <div className="cost-progress">
            <div
              className="cost-fill"
              style={{ width: `${Math.min(100, ((costData.data.weeklyTotal || 0) / (costData.data.budget || 50)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="section-header">
        <h3>Analysis Index</h3>
        <span className="count-badge">{entries.length} entries</span>
      </div>

      {entries.length === 0 ? (
        <div className="empty-state">No analysis entries yet. Run editorial-analyse.js to populate.</div>
      ) : (
        <div className="analysis-list">
          {entries.map(entry => (
            <AnalysisEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnalysisEntry({ entry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="analysis-entry" onClick={() => setExpanded(!expanded)}>
      <div className="entry-header">
        <span className="entry-id">#{entry.id}</span>
        <span className="entry-title">{entry.title}</span>
        <span className={`entry-tier tier-${entry.tier}`}>T{entry.tier}</span>
      </div>
      <div className="entry-meta">
        <span>{entry.source}</span>
        {entry.host && <span> · {entry.host}</span>}
        <span> · Session {entry.session}</span>
        {entry.postPotential && <span> · Post: {entry.postPotential}</span>}
      </div>
      {entry.themes?.length > 0 && (
        <div className="entry-themes">
          {entry.themes.map(t => (
            <span key={t} className="theme-tag">{t}</span>
          ))}
        </div>
      )}
      {expanded && entry.summary && (
        <div className="entry-summary">{entry.summary}</div>
      )}
    </div>
  )
}

// ── Themes Tab ───────────────────────────────────────────

function ThemesTab() {
  const [showStale, setShowStale] = useState(false)
  const filters = showStale ? { stale: 'true' } : { active: 'true' }
  const { data, loading, error } = useEditorialState('themeRegistry')

  if (loading) return <div className="loading-state">Loading themes...</div>
  if (error) return <div className="error-state">{error}</div>

  const allThemes = data?.themes || []

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Theme Registry</h3>
        <span className="count-badge">{allThemes.length} themes</span>
        <label className="filter-toggle">
          <input type="checkbox" checked={showStale} onChange={() => setShowStale(!showStale)} />
          Show stale only
        </label>
      </div>

      {allThemes.length === 0 ? (
        <div className="empty-state">No themes registered yet.</div>
      ) : (
        <div className="theme-list">
          {allThemes.map(theme => (
            <ThemeCard key={theme.code} theme={theme} />
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeCard({ theme }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="theme-card" onClick={() => setExpanded(!expanded)}>
      <div className="theme-header">
        <span className="theme-code">{theme.code}</span>
        <span className="theme-name">{theme.name}</span>
        <span className="theme-docs">{theme.documentCount} docs</span>
      </div>
      {theme.lastUpdated && (
        <div className="theme-meta">Last updated: {theme.lastUpdated}</div>
      )}
      {expanded && (
        <div className="theme-details">
          {(theme.evidence || []).slice(-3).map((ev, i) => (
            <div key={i} className="evidence-item">
              <span className="evidence-source">Session {ev.session} · {ev.source}</span>
              <p className="evidence-content">{ev.content}</p>
            </div>
          ))}
          {theme.crossConnections?.length > 0 && (
            <div className="cross-connections">
              <strong>Cross-connections:</strong>
              {theme.crossConnections.map((cc, i) => (
                <span key={i} className="cross-link">{cc.theme}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Backlog Tab ──────────────────────────────────────────

function BacklogTab({ filter, setFilter }) {
  const { data, loading, error } = useEditorialState('postBacklog')

  if (loading) return <div className="loading-state">Loading backlog...</div>
  if (error) return <div className="error-state">{error}</div>

  let posts = data?.posts || []

  // Client-side filtering
  if (filter.status) posts = posts.filter(p => p.status === filter.status)
  if (filter.priority) posts = posts.filter(p => p.priority === filter.priority)

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Post Backlog</h3>
        <span className="count-badge">{posts.length} posts</span>
      </div>

      <div className="filter-bar">
        <select value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          <option value="suggested">Suggested</option>
          <option value="approved">Approved</option>
          <option value="in-progress">In progress</option>
          <option value="published">Published</option>
          <option value="rejected">Rejected</option>
          <option value="archived">Archived</option>
        </select>
        <select value={filter.priority} onChange={e => setFilter(f => ({ ...f, priority: e.target.value }))}>
          <option value="">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {posts.length === 0 ? (
        <div className="empty-state">No posts matching filters.</div>
      ) : (
        <div className="backlog-list">
          {posts.map(post => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

function PostCard({ post }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="post-card" onClick={() => setExpanded(!expanded)}>
      <div className="post-header">
        <span className="post-id">#{post.id}</span>
        <span className="post-priority">{PRIORITY_LABELS[post.priority] || ''}</span>
        <span className="post-title">{post.title || post.workingTitle || '(untitled)'}</span>
        <span className="post-status" style={{ color: STATUS_COLOURS[post.status] || 'inherit' }}>
          {post.status}
        </span>
      </div>
      <div className="post-meta">
        {post.format && <span className="post-format">{post.format}</span>}
        {post.suggestedDate && <span> · Target: {post.suggestedDate}</span>}
        {post.themes?.length > 0 && (
          <span> · Themes: {post.themes.join(', ')}</span>
        )}
      </div>
      {expanded && (
        <div className="post-details">
          {post.coreArgument && (
            <div className="post-argument">
              <strong>Core argument:</strong> {post.coreArgument}
            </div>
          )}
          {post.notes && (
            <div className="post-notes">
              <strong>Notes:</strong> {post.notes}
            </div>
          )}
          {post.sourceDocuments?.length > 0 && (
            <div className="post-sources">
              <strong>Sources:</strong> {post.sourceDocuments.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Decisions Tab ────────────────────────────────────────

function DecisionsTab() {
  const { data, loading, error } = useEditorialState('decisionLog')

  if (loading) return <div className="loading-state">Loading decisions...</div>
  if (error) return <div className="error-state">{error}</div>

  const decisions = data?.decisions || []

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Decision Log</h3>
        <span className="count-badge">{decisions.length} decisions</span>
      </div>

      {decisions.length === 0 ? (
        <div className="empty-state">No editorial decisions recorded yet.</div>
      ) : (
        <div className="decision-list">
          {decisions.map((d, i) => (
            <div key={i} className="decision-item">
              <div className="decision-header">
                <span className="decision-type">{d.type || 'decision'}</span>
                <span className="decision-date">{d.date || d.timestamp}</span>
              </div>
              <div className="decision-content">{d.decision || d.content || d.summary}</div>
              {d.reasoning && <div className="decision-reasoning">{d.reasoning}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Activity Tab ─────────────────────────────────────────

function ActivityTab() {
  const { data: activities, loading, error, refetch } = useEditorialActivity(50)

  if (loading) return <div className="loading-state">Loading activity...</div>
  if (error) return <div className="error-state">{error}</div>

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Activity Log</h3>
        <span className="count-badge">{activities.length} entries</span>
        <button className="btn-sm" onClick={refetch}>Refresh</button>
      </div>

      {activities.length === 0 ? (
        <div className="empty-state">No pipeline activity recorded yet.</div>
      ) : (
        <div className="activity-list">
          {activities.map((a, i) => (
            <div key={i} className={`activity-item activity-${a.stage || a.type || 'info'}`}>
              <div className="activity-header">
                <span className="activity-stage">{a.stage || a.type}</span>
                <span className="activity-time">{formatRelativeTime(a.timestamp)}</span>
              </div>
              <div className="activity-message">{a.message}</div>
              {a.detail && <div className="activity-detail">{a.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Search Results ───────────────────────────────────────

function SearchResults({ query }) {
  const { results, loading, error } = useEditorialSearch(query)

  if (loading) return <div className="loading-state">Searching...</div>
  if (error) return <div className="error-state">{error}</div>

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Search results for "{query}"</h3>
        <span className="count-badge">{results.length} results</span>
      </div>

      {results.length === 0 ? (
        <div className="empty-state">No results found.</div>
      ) : (
        <div className="search-results">
          {results.map((r, i) => (
            <div key={i} className="search-result">
              <span className="result-type">{r.type}</span>
              <span className="result-title">{r.title || r.name || `#${r.id || r.code}`}</span>
              {r.source && <span className="result-source">{r.source}</span>}
              {r.status && <span className="result-status">{r.status}</span>}
              {r.tier && <span className={`entry-tier tier-${r.tier}`}>T{r.tier}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
