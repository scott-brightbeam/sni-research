import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEditorialState, useEditorialActivity, useEditorialSearch, useEditorialCost } from '../hooks/useEditorialState'
import { useEditorialStatus } from '../hooks/useEditorialStatus'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { formatRelativeTime } from '../lib/format'
import { apiFetch, apiPut } from '../lib/api'
import { downloadFile } from '../lib/download'
import { toast } from '../components/shared/Toast'
import Draft from './Draft'
import EditorialChat from '../components/EditorialChat'
import DownloadIcon from '../components/shared/DownloadIcon'
import Skeleton from '../components/shared/Skeleton'
import EmptyState from '../components/shared/EmptyState'
import '../components/shared/DraftLink.css'
import './Editorial.css'

function buildDraftPrompt(source, content) {
  if (source?.type === 'post') {
    return `Draft post #${source.id}: '${source.title}'\n\nCore argument: ${content?.coreArgument || 'Not specified'}\nFormat: ${content?.format || 'Not specified'}\nSource documents: ${content?.sources?.join(', ') || 'None'}\nNotes: ${content?.notes || 'None'}\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options as specified in the LinkedIn post guidelines.`
  }
  if (source?.type === 'theme') {
    return `Draft an analysis post for theme ${source.code}: '${source.name}'\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options.`
  }
  if (source?.type === 'analysis') {
    return `Draft a post based on analysis entry #${source.id}: '${source.title}'\n\nSummary: ${content?.summary || ''}\nThemes: ${content?.themes?.join(', ') || 'None'}\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options.`
  }
  return `Draft a post about: ${source?.title || 'untitled'}`
}

const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity', label: 'Activity' },
]

const STATUS_CSS = {
  suggested: 'status-suggested',
  approved: 'status-approved',
  'in-progress': 'status-in-progress',
  published: 'status-published',
  rejected: 'status-rejected',
  archived: 'status-archived',
}

const PRIORITY_LABELS = { high: '🔴', medium: '🟡', low: '⚪' }

export default function Editorial() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') || 'state'
  const [tab, setTab] = useState(TABS.find(t => t.key === initialTab) ? initialTab : 'state')
  const [search, setSearch] = useState('')
  const [backlogFilter, setBacklogFilter] = useState({ status: '', priority: '' })
  const [draftRequest, setDraftRequest] = useState(null)

  const debouncedSearch = useDebouncedValue(search, 300)

  function handleTabChange(key) {
    setTab(key)
    setSearchParams(key === 'state' ? {} : { tab: key })
  }

  async function handleExportState() {
    try {
      const data = await apiFetch('/api/editorial/state')
      const date = new Date().toISOString().slice(0, 10)
      const filename = `editorial-state-${date}.json`
      downloadFile(JSON.stringify(data, null, 2), filename, 'application/json')
      toast(`Exported ${filename}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

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
          <button className="btn btn-ghost btn-sm" onClick={handleExportState}>
            <DownloadIcon /> Export
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            className={`tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => handleTabChange(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="editorial-columns">
        <div className="editorial-content">
          {debouncedSearch ? (
            <SearchResults query={debouncedSearch} />
          ) : (
            <>
              {tab === 'state' && <AnalysisTab onDraftRequest={setDraftRequest} />}
              {tab === 'themes' && <ThemesTab onDraftRequest={setDraftRequest} />}
              {tab === 'backlog' && <BacklogTab filter={backlogFilter} setFilter={setBacklogFilter} onDraftRequest={setDraftRequest} />}
              {tab === 'decisions' && <DecisionsTab />}
              {tab === 'activity' && <ActivityTab />}
              {tab === 'newsletter' && <Draft embedded />}
            </>
          )}
        </div>
        <EditorialChat
          tab={tab}
          draftRequest={draftRequest}
          onDraftConsumed={() => setDraftRequest(null)}
        />
      </div>
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────

function AnalysisTab({ onDraftRequest }) {
  const { data, loading, error } = useEditorialState('analysisIndex')
  const costData = useEditorialCost()

  if (loading) return <Skeleton.List count={8} />
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
        <EmptyState icon="📄" title="No analysis entries" description="Run ANALYSE to process transcripts and populate the index." />
      ) : (
        <div className="analysis-list">
          {entries.map(entry => (
            <AnalysisEntry key={entry.id} entry={entry} onDraftRequest={onDraftRequest} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnalysisEntry({ entry, onDraftRequest }) {
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
      {expanded && (
        <button
          className="draft-link"
          onClick={(e) => {
            e.stopPropagation()
            onDraftRequest(buildDraftPrompt(
              { type: 'analysis', id: entry.id, title: entry.title },
              { summary: entry.summary, themes: entry.themes }
            ))
          }}
        >
          Draft in chat
        </button>
      )}
    </div>
  )
}

// ── Themes Tab ───────────────────────────────────────────

function ThemesTab({ onDraftRequest }) {
  const [showStale, setShowStale] = useState(false)
  const filters = showStale ? { stale: 'true' } : { active: 'true' }
  const { data, loading, error } = useEditorialState('themeRegistry', filters)

  if (loading) return <Skeleton.List count={6} />
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
        <EmptyState icon="🔗" title="No themes registered" description="Themes are discovered automatically during DISCOVER stage." />
      ) : (
        <div className="theme-list">
          {allThemes.map(theme => (
            <ThemeCard key={theme.code} theme={theme} onDraftRequest={onDraftRequest} />
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeCard({ theme, onDraftRequest }) {
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
          <button
            className="draft-link"
            onClick={(e) => {
              e.stopPropagation()
              onDraftRequest(buildDraftPrompt(
                { type: 'theme', code: theme.code, name: theme.name },
                { evidence: theme.evidence, crossConnections: theme.crossConnections }
              ))
            }}
          >
            Draft {theme.code} in chat
          </button>
        </div>
      )}
    </div>
  )
}

// ── Backlog Tab ──────────────────────────────────────────

function BacklogTab({ filter, setFilter, onDraftRequest }) {
  const { data, loading, error, refetch } = useEditorialState('postBacklog')

  async function handleExportBacklog() {
    try {
      const res = await apiFetch('/api/editorial/backlog')
      const allPosts = res.posts || []
      const date = new Date().toISOString().slice(0, 10)
      const lines = [`# Post Backlog — Exported ${date}`, '']
      for (const post of allPosts) {
        lines.push(`## #${post.id}: ${post.title || post.workingTitle || '(untitled)'}`)
        lines.push(`- **Status:** ${post.status || 'unknown'}`)
        lines.push(`- **Priority:** ${post.priority || 'unset'}`)
        lines.push(`- **Format:** ${post.format || 'unset'}`)
        lines.push(`- **Core argument:** ${post.coreArgument || ''}`)
        lines.push(`- **Source documents:** ${(post.sourceDocuments || []).join(', ')}`)
        lines.push(`- **Notes:** ${post.notes || ''}`)
        lines.push('')
        lines.push('---')
        lines.push('')
      }
      const filename = `editorial-backlog-${date}.md`
      downloadFile(lines.join('\n'), filename, 'text/markdown')
      toast(`Exported ${filename}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  if (loading) return <Skeleton.List count={6} />
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
        <button className="btn btn-ghost btn-sm" onClick={handleExportBacklog}>
          <DownloadIcon /> Export
        </button>
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
        <EmptyState icon="📝" title="No posts match filters" description="Try adjusting the priority or format filters." />
      ) : (
        <div className="backlog-list">
          {posts.map(post => (
            <PostCard key={post.id} post={post} onStatusChange={refetch} onDraftRequest={onDraftRequest} />
          ))}
        </div>
      )}
    </div>
  )
}

function PostCard({ post, onStatusChange, onDraftRequest }) {
  const [expanded, setExpanded] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState(null)

  async function handleStatusChange(newStatus) {
    setUpdating(true)
    setUpdateError(null)
    try {
      await apiPut(`/api/editorial/backlog/${post.id}/status`, { status: newStatus })
      onStatusChange?.()
    } catch (err) {
      setUpdateError(err.message)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <div className="post-card" onClick={() => setExpanded(!expanded)}>
      <div className="post-header">
        <span className="post-id">#{post.id}</span>
        <span className="post-priority">{PRIORITY_LABELS[post.priority] || ''}</span>
        <span className="post-title">{post.title || post.workingTitle || '(untitled)'}</span>
        <span className={`post-status ${STATUS_CSS[post.status] || ''}`}>
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
          <div className="post-actions" onClick={e => e.stopPropagation()}>
            <button
              className="draft-link"
              onClick={(e) => {
                e.stopPropagation()
                onDraftRequest(buildDraftPrompt(
                  { type: 'post', id: post.id, title: post.title || post.workingTitle },
                  { coreArgument: post.coreArgument, format: post.format, sources: post.sourceDocuments, notes: post.notes }
                ))
              }}
            >
              Draft this post
            </button>
            {post.status !== 'published' && (
              <button
                className="btn btn-primary btn-sm"
                disabled={updating}
                onClick={() => handleStatusChange('published')}
              >
                Mark Published
              </button>
            )}
            {post.status !== 'archived' && (
              <button
                className="btn btn-ghost btn-sm"
                disabled={updating}
                onClick={() => handleStatusChange('archived')}
              >
                Archive
              </button>
            )}
            {updateError && <span className="trigger-error">{updateError}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Decisions Tab ────────────────────────────────────────

function DecisionsTab() {
  const { data, loading, error } = useEditorialState('decisionLog')

  if (loading) return <Skeleton.List count={4} />
  if (error) return <div className="error-state">{error}</div>

  const decisions = data?.decisions || []

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Decision Log</h3>
        <span className="count-badge">{decisions.length} decisions</span>
      </div>

      {decisions.length === 0 ? (
        <EmptyState icon="⚖" title="No decisions recorded" description="Editorial decisions appear as the pipeline runs." />
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
  const { status, trigger } = useEditorialStatus()
  const [triggerError, setTriggerError] = useState(null)

  async function handleTrigger(stage) {
    setTriggerError(null)
    const res = await trigger(stage)
    if (!res.ok) {
      setTriggerError(res.error || `Failed to start ${stage}`)
    }
    refetch()
  }

  if (loading) return <Skeleton.List count={5} />
  if (error) return <div className="error-state">{error}</div>

  return (
    <div className="tab-content">
      <div className="trigger-bar">
        <button
          className="btn btn-primary btn-sm"
          disabled={status.locks?.analyse}
          onClick={() => handleTrigger('analyse')}
        >
          {status.locks?.analyse ? 'ANALYSE running...' : 'Run ANALYSE'}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={status.locks?.discover}
          onClick={() => handleTrigger('discover')}
        >
          {status.locks?.discover ? 'DISCOVER running...' : 'Run DISCOVER'}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={status.locks?.draft}
          onClick={() => handleTrigger('draft')}
        >
          {status.locks?.draft ? 'DRAFT running...' : 'Run DRAFT'}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => handleTrigger('track')}
        >
          Run TRACK
        </button>
        {triggerError && <span className="trigger-error">{triggerError}</span>}
      </div>

      <div className="section-header">
        <h3>Activity Log</h3>
        <span className="count-badge">{activities.length} entries</span>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>Refresh</button>
      </div>

      {activities.length === 0 ? (
        <EmptyState icon="📊" title="No activity recorded" description="Activity appears as pipeline stages run." />
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
        <EmptyState icon="🔍" title="No results found" description="Try a different search term." />
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
