import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useEditorialState, useEditorialActivity, useEditorialSearch, useEditorialCost } from '../hooks/useEditorialState'
import { useEditorialStatus } from '../hooks/useEditorialStatus'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { formatRelativeTime } from '../lib/format'
import { apiFetch, apiPut, apiPost } from '../lib/api'
import { downloadFile } from '../lib/download'
import { toast } from '../components/shared/Toast'
import Draft from './Draft'
import EditorialChat from '../components/EditorialChat'
import DownloadIcon from '../components/shared/DownloadIcon'
import Skeleton from '../components/shared/Skeleton'
import EmptyState from '../components/shared/EmptyState'
import '../components/shared/DraftLink.css'
import './Editorial.css'

function buildDraftRequest(source, content) {
  const sourceRefs = content?.sourceRefs || []
  let message = ''

  if (source?.type === 'post') {
    message = `Draft LinkedIn post #${source.id}: '${source.title}'\n\nCore argument: ${content?.coreArgument || 'Not specified'}\nRecommended format: ${content?.format || 'Not specified'}\nNotes: ${content?.notes || 'None'}`
  } else if (source?.type === 'theme') {
    message = `Draft a LinkedIn post exploring theme ${source.code}: '${source.name}'`
  } else if (source?.type === 'analysis') {
    message = `Draft a LinkedIn post based on analysis entry #${source.id}: '${source.title}'\n\nSummary: ${content?.summary || ''}\nThemes: ${content?.themes?.join(', ') || 'None'}`
  } else if (source?.type === 'article') {
    message = `Draft a post about: '${source.title}' (${source.source})`
  } else if (source?.type === 'podcast') {
    message = `Draft a post about podcast: '${source.title}' (${source.source})`
  } else {
    message = `Draft a LinkedIn post about: ${source?.title || 'untitled'}`
  }

  message += '\n\nGenerate THREE complete drafts, each using a different LinkedIn format. Every draft must end with the in-the-end-at-the-end.'

  return { message, sourceRefs }
}

const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'ideate', label: 'Ideate' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'decisions', label: 'Notes & Decisions' },
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
              {tab === 'ideate' && <IdeateTab />}
              {tab === 'decisions' && <DecisionsTab />}
              {tab === 'activity' && <ActivityTab />}
              {tab === 'newsletter' && <Draft embedded />}
            </>
          )}
        </div>
        <EditorialChat
          tab={draftRequest ? 'draft' : tab}
          draftRequest={draftRequest}
          onDraftConsumed={() => setDraftRequest(null)}
        />
      </div>
    </div>
  )
}

// ── Analysis Tab ──────────────────────────────────────────

function AnalysisTab({ onDraftRequest }) {
  const [showArchived, setShowArchived] = useState(false)
  const { data, loading, error, refetch } = useEditorialState('analysisIndex', {
    showArchived: showArchived ? 'true' : '',
  })
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
              style={{ '--cost-pct': `${Math.min(100, ((costData.data.weeklyTotal || 0) / (costData.data.budget || 50)) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <div className="section-header">
        <h3>Analysis Index</h3>
        <span className="count-badge">{entries.length} entries</span>
        <label className="filter-toggle">
          <input type="checkbox" checked={showArchived} onChange={() => setShowArchived(!showArchived)} />
          Show archived
        </label>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon="📄" title="No analysis entries" description="Run ANALYSE to process transcripts and populate the index." />
      ) : (
        <div className="analysis-list">
          {entries.map(entry => (
            <AnalysisEntry key={entry.id} entry={entry} onDraftRequest={onDraftRequest} refetch={refetch} />
          ))}
        </div>
      )}
    </div>
  )
}

function AnalysisEntry({ entry, onDraftRequest, refetch }) {
  const [expanded, setExpanded] = useState(false)

  async function handleArchiveToggle(e) {
    e.stopPropagation()
    try {
      await apiPut(`/api/editorial/analysis/${entry.id}/archive`, { archived: !entry.archived })
      refetch?.()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className={`analysis-entry${entry.archived ? ' archived' : ''}`} onClick={() => setExpanded(!expanded)}>
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
        <div className="entry-actions" onClick={e => e.stopPropagation()}>
          <button
            className="draft-link"
            onClick={() => onDraftRequest(buildDraftRequest(
              { type: 'analysis', id: entry.id, title: entry.title },
              { summary: entry.summary, themes: entry.themes,
                sourceRefs: entry.filename ? [{ type: 'transcript', filename: entry.filename }] :
                            entry.url ? [{ type: 'url', url: entry.url }] : [] }
            ))}
          >
            Draft in chat
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleArchiveToggle}>
            {entry.archived ? 'Restore' : 'Archive'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Themes Tab ───────────────────────────────────────────

function ThemesTab({ onDraftRequest }) {
  const [showStale, setShowStale] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const filters = {
    ...(showStale ? { stale: 'true' } : { active: 'true' }),
    showArchived: showArchived ? 'true' : '',
  }
  const { data, loading, error, refetch } = useEditorialState('themeRegistry', filters)

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
        <label className="filter-toggle">
          <input type="checkbox" checked={showArchived} onChange={() => setShowArchived(!showArchived)} />
          Show archived
        </label>
      </div>

      {allThemes.length === 0 ? (
        <EmptyState icon="🔗" title="No themes registered" description="Themes are discovered automatically during DISCOVER stage." />
      ) : (
        <div className="theme-list">
          {allThemes.map(theme => (
            <ThemeCard key={theme.code} theme={theme} onDraftRequest={onDraftRequest} refetch={refetch} />
          ))}
        </div>
      )}
    </div>
  )
}

function ThemeCard({ theme, onDraftRequest, refetch }) {
  const [expanded, setExpanded] = useState(false)

  async function handleArchiveToggle(e) {
    e.stopPropagation()
    try {
      await apiPut(`/api/editorial/themes/${theme.code}/archive`, { archived: !theme.archived })
      refetch?.()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  return (
    <div className={`theme-card${theme.archived ? ' archived' : ''}`} onClick={() => setExpanded(!expanded)}>
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
            <div key={`${ev.session}-${ev.source || i}`} className="evidence-item">
              <span className="evidence-source">Session {ev.session} · {ev.source}</span>
              <p className="evidence-content">{ev.content}</p>
            </div>
          ))}
          {theme.crossConnections?.length > 0 && (
            <div className="cross-connections">
              <strong>Cross-connections:</strong>
              {theme.crossConnections.map((cc, i) => (
                <span key={cc.theme || i} className="cross-link">{cc.theme}</span>
              ))}
            </div>
          )}
          <div className="entry-actions" onClick={e => e.stopPropagation()}>
            <button
              className="draft-link"
              onClick={() => onDraftRequest(buildDraftRequest(
                { type: 'theme', code: theme.code, name: theme.name },
                { sourceRefs: [{ type: 'theme', code: theme.code }] }
              ))}
            >
              Draft {theme.code} in chat
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleArchiveToggle}>
              {theme.archived ? 'Restore' : 'Archive'}
            </button>
          </div>
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

  // Client-side filtering — hide archived by default unless explicitly viewing archived status
  if (filter.status) {
    posts = posts.filter(p => p.status === filter.status)
  } else {
    posts = posts.filter(p => p.status !== 'archived')
  }
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
                onDraftRequest(buildDraftRequest(
                  { type: 'post', id: post.id, title: post.title || post.workingTitle },
                  { coreArgument: post.coreArgument, format: post.format, notes: post.notes,
                    sourceRefs: (post.sourceDocuments || []).map(sd =>
                      (typeof sd === 'number' || /^\d+$/.test(sd)) ? { type: 'entry', id: String(sd) } : { type: 'source_name', name: String(sd) }
                    ).concat((post.sourceUrls || []).map(u => ({ type: 'url', url: u }))) }
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

// ── Ideate Tab ──────────────────────────────────────────

function IdeateTab() {
  return (
    <div className="card card-flush">
      <div className="placeholder-text">
        <h3>Ideate Mode</h3>
        <p>Use the AI panel to generate LinkedIn post ideas. Ask it to:</p>
        <ul>
          <li>Generate ideas based on this week's strongest themes</li>
          <li>Find contrarian angles from recent podcast analysis</li>
          <li>Identify under-served themes in the current backlog</li>
          <li>Suggest timely angles tied to recent news</li>
        </ul>
        <p>Ideas you approve can be added to the Backlog from the chat.</p>
      </div>
    </div>
  )
}

// ── Decisions Tab ────────────────────────────────────────

function DecisionsTab() {
  const [showArchived, setShowArchived] = useState(false)
  const { data, loading, error, refetch } = useEditorialState('decisionLog', {
    showArchived: showArchived ? 'true' : '',
  })
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ title: '', decision: '', reasoning: '' })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await apiPost('/api/editorial/decisions', formData)
      setShowForm(false)
      setFormData({ title: '', decision: '', reasoning: '' })
      refetch()
      toast('Decision recorded')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleArchiveToggle(d) {
    try {
      await apiPut(`/api/editorial/decisions/${d.id}/archive`, { archived: !d.archived })
      refetch()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  if (loading) return <Skeleton.List count={4} />
  if (error) return <div className="error-state">{error}</div>

  const decisions = data?.decisions || []

  return (
    <div className="tab-content">
      <div className="section-header">
        <h3>Decision Log</h3>
        <span className="count-badge">{decisions.length} decisions</span>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ Decision'}
        </button>
        <label className="filter-toggle">
          <input type="checkbox" checked={showArchived} onChange={() => setShowArchived(!showArchived)} />
          Show archived
        </label>
      </div>

      {showForm && (
        <div className="decision-form">
          <input
            type="text"
            className="form-input"
            placeholder="Decision title"
            value={formData.title}
            onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
          />
          <textarea
            className="form-textarea"
            placeholder="What was decided?"
            value={formData.decision}
            onChange={e => setFormData(f => ({ ...f, decision: e.target.value }))}
          />
          <textarea
            className="form-textarea"
            placeholder="Reasoning (optional)"
            value={formData.reasoning}
            onChange={e => setFormData(f => ({ ...f, reasoning: e.target.value }))}
          />
          <div className="form-actions">
            <button
              className="btn btn-primary btn-sm"
              disabled={submitting || !formData.title.trim() || !formData.decision.trim()}
              onClick={handleSubmit}
            >
              {submitting ? 'Saving...' : 'Save Decision'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowForm(false); setFormData({ title: '', decision: '', reasoning: '' }) }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {decisions.length === 0 ? (
        <EmptyState icon="⚖" title="No decisions recorded" description="Record editorial decisions to guide content and framing." />
      ) : (
        <div className="decision-list">
          {decisions.map((d, i) => (
            <div key={d.id || i} className={`decision-item${d.archived ? ' archived' : ''}`}>
              <div className="decision-header">
                <span className="decision-id">#{d.id}</span>
                <span className="decision-title">{d.title}</span>
                <span className="decision-session">S{d.session}</span>
              </div>
              <div className="decision-content">{d.decision || d.content || d.summary}</div>
              {d.reasoning && <div className="decision-reasoning">{d.reasoning}</div>}
              <div className="entry-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => handleArchiveToggle(d)}>
                  {d.archived ? 'Restore' : 'Archive'}
                </button>
              </div>
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
            <div key={a.timestamp || i} className={`activity-item activity-${a.stage || a.type || 'info'}`}>
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
            <div key={r.id || r.code || i} className="search-result">
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
