import { useState } from 'react'
import EditorialChat from '../components/EditorialChat'
import { useArticles } from '../hooks/useArticles'
import { useFlaggedArticles } from '../hooks/useFlaggedArticles'
import { usePodcasts } from '../hooks/usePodcasts'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate, formatRelativeTime } from '../lib/format'
import { apiFetch, apiPatch, apiDelete, apiPost } from '../lib/api'
import TimeRangeSelector from '../components/shared/TimeRangeSelector'
import { getDateRange } from '../lib/dateRange'
import ManualIngestForm from '../components/ManualIngestForm'
import './Database.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

const TIER_LABELS = { 1: 'Tier 1', 2: 'Tier 2' }

export default function Database() {
  const [sector, setSector] = useState('')
  const [range, setRange] = useState('7d')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('articles')
  const [showIngest, setShowIngest] = useState(false)
  const [draftRequest, setDraftRequest] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  const debouncedSearch = useDebouncedValue(search, 300)

  const { startDate: dateFrom, endDate: dateTo } = getDateRange(range)
  const allResult = useArticles({ sector, dateFrom, dateTo, search: debouncedSearch })
  const flaggedResult = useFlaggedArticles()
  const podcastResult = usePodcasts()

  return (
    <div className="database-columns">
      <div className="database-content">
        <div className="page-header">
          <h2>Database</h2>
          <button
            className="btn btn-primary btn-md"
            onClick={() => setShowIngest(!showIngest)}
          >
            + Ingest Article
          </button>
        </div>

        {showIngest && <ManualIngestForm onSuccess={() => { setShowIngest(false); allResult.reload() }} />}

        <div className="tabs">
          <button className={`tab ${tab === 'articles' ? 'active' : ''}`} onClick={() => setTab('articles')}>
            Articles <span className="tab-count">({allResult.total ?? 0})</span>
          </button>
          <button className={`tab ${tab === 'podcasts' ? 'active' : ''}`} onClick={() => setTab('podcasts')}>
            Podcasts <span className="tab-count">({podcastResult.episodes.length})</span>
          </button>
          <button className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
            Flagged <span className="tab-count">({flaggedResult.total ?? 0})</span>
          </button>
        </div>

        {tab === 'articles' && (
          <>
            <div className="filter-bar">
              <select value={sector} onChange={e => setSector(e.target.value)}>
                <option value="">All sectors</option>
                {SECTORS.filter(Boolean).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <TimeRangeSelector value={range} onChange={setRange} />
              <input
                type="text"
                placeholder="Search articles..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="filter-search"
              />
              <label className="archive-toggle">
                <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                Show archived
              </label>
              {allResult.lastUpdated && (
                <span className="updated-indicator">
                  Updated {formatRelativeTime(new Date(allResult.lastUpdated).toISOString())}
                </span>
              )}
            </div>

            <div className="card card-flush">
              {allResult.loading ? (
                <div className="placeholder-text">Loading...</div>
              ) : allResult.error ? (
                <div className="placeholder-text">Failed to load articles: {allResult.error}</div>
              ) : (
                <ArticleTable
                  articles={showArchived ? allResult.articles : (allResult.articles || []).filter(a => !a.archived)}
                  tab="all"
                  onReload={() => { allResult.reload(); flaggedResult.reload?.() }}
                  onDraftInChat={setDraftRequest}
                />
              )}
            </div>
          </>
        )}

        {tab === 'podcasts' && (
          <PodcastsTab
            episodes={podcastResult.episodes}
            loading={podcastResult.loading}
            error={podcastResult.error}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            onDraftInChat={setDraftRequest}
            onReload={podcastResult.refetch}
          />
        )}

        {tab === 'flagged' && (
          <div className="card card-flush">
            {flaggedResult.loading ? (
              <div className="placeholder-text">Loading...</div>
            ) : flaggedResult.error ? (
              <div className="placeholder-text">Failed to load flagged articles: {flaggedResult.error}</div>
            ) : (
              <ArticleTable
                articles={flaggedResult.articles}
                tab="flagged"
                onReload={() => { allResult.reload(); flaggedResult.reload?.() }}
                onDraftInChat={setDraftRequest}
              />
            )}
          </div>
        )}
      </div>
      <EditorialChat
        tab={draftRequest ? 'draft' : tab}
        draftRequest={draftRequest}
        onDraftConsumed={() => setDraftRequest(null)}
      />
    </div>
  )
}

// ── Podcasts Tab ──────────────────────────────────────────

function PodcastsTab({ episodes, loading, error, showArchived, onShowArchivedChange, onDraftInChat, onReload }) {
  const [sourceFilter, setSourceFilter] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  const debouncedSearch = useDebouncedValue(searchQuery, 300)

  if (loading) return <div className="placeholder-text">Loading podcast episodes...</div>
  if (error) return <div className="placeholder-text">Failed to load podcasts: {error}</div>

  // Collect unique sources for filter dropdown
  const sources = [...new Set(episodes.map(e => e.source).filter(Boolean))].sort()

  let filtered = showArchived ? episodes : episodes.filter(e => !e.archived)
  if (sourceFilter) filtered = filtered.filter(e => e.source === sourceFilter)
  if (tierFilter) filtered = filtered.filter(e => String(e.tier) === tierFilter)
  if (debouncedSearch) {
    const q = debouncedSearch.toLowerCase()
    filtered = filtered.filter(ep => {
      const digest = ep.digest || {}
      const haystack = [
        ep.title, ep.source, digest.summary,
        ...(digest.key_stories || digest.stories || []).map(s => typeof s === 'string' ? s : s.headline || s.title || ''),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }

  return (
    <>
      <div className="filter-bar">
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
          <option value="">All sources</option>
          {sources.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div className="tier-pills">
          <button
            className={`tier-pill ${!tierFilter ? 'active' : ''}`}
            onClick={() => setTierFilter('')}
          >All</button>
          <button
            className={`tier-pill ${tierFilter === '1' ? 'active' : ''}`}
            onClick={() => setTierFilter('1')}
          >Tier 1</button>
          <button
            className={`tier-pill ${tierFilter === '2' ? 'active' : ''}`}
            onClick={() => setTierFilter('2')}
          >Tier 2</button>
        </div>
        <input
          type="text"
          placeholder="Search podcasts..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="filter-search"
        />
        <label className="archive-toggle">
          <input type="checkbox" checked={showArchived} onChange={e => onShowArchivedChange(e.target.checked)} />
          Show archived
        </label>
        <span className="filter-count">{filtered.length} episode{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder-text">No podcast episodes matching filters.</div>
      ) : (
        <div className="podcast-list">
          {filtered.map((ep, i) => (
            <PodcastCard
              key={ep.filename || i}
              episode={ep}
              expanded={expandedIdx === i}
              onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
              onDraftInChat={onDraftInChat}
              onReload={onReload}
            />
          ))}
        </div>
      )}
    </>
  )
}

function PodcastCard({ episode, expanded, onToggle, onDraftInChat, onReload }) {
  const ep = episode
  const digest = ep.digest || {}
  const storiesExtracted = digest.stories?.length || ep.storiesExtracted || 0
  const storiesFound = ep.storiesFound || 0
  const themes = digest.themes || ep.themes || []

  async function handleArchive(e) {
    e.stopPropagation()
    try {
      // digestPath format: data/podcasts/YYYY-MM-DD/source-slug/episode-slug.digest.json
      const parts = (ep.digestPath || '').split('/')
      if (parts.length >= 5) {
        const [, , date, source, file] = parts
        const slug = file.replace('.digest.json', '')
        await apiPatch(`/api/podcasts/${date}/${source}/${slug}`, { archived: !ep.archived })
        onReload?.()
      }
    } catch { /* ignore */ }
  }

  return (
    <div className={`podcast-card ${expanded ? 'expanded' : ''} ${ep.archived ? 'archived' : ''}`} onClick={onToggle}>
      <div className="podcast-card-header">
        <div className="podcast-card-title">
          {ep.title || ep.filename || 'Untitled episode'}
          {ep.archived && <span className="badge-archived">archived</span>}
        </div>
        <button className="btn-icon" title={ep.archived ? 'Restore' : 'Archive'} onClick={handleArchive}>
          {ep.archived ? '↩' : '📦'}
        </button>
        {ep.tier && (
          <span className={`badge badge-tier${ep.tier}`}>{TIER_LABELS[ep.tier] || `Tier ${ep.tier}`}</span>
        )}
      </div>
      <div className="podcast-card-meta">
        <span>{ep.source || 'Unknown source'}</span>
        {ep.host && <span> · {ep.host}</span>}
        {ep.date && <span> · {formatDate(ep.date)}</span>}
        {ep.week && <span> · Week {ep.week}</span>}
      </div>
      {themes.length > 0 && (
        <div className="podcast-card-themes">
          {themes.map((t, i) => {
            const label = typeof t === 'string' ? t : (t.name || t.code || 'Unknown')
            return (
              <span key={`${label}-${i}`} className="theme-pill">{label}</span>
            )
          })}
        </div>
      )}
      <div className="podcast-card-stats">
        Stories: {storiesExtracted} extracted
        {storiesFound > 0 && <> · {storiesFound} found</>}
      </div>

      {expanded && (
        <div className="podcast-card-detail">
          {digest.summary && (
            <div className="podcast-summary">{digest.summary}</div>
          )}
          {digest.stories?.length > 0 && (
            <div className="podcast-stories">
              <strong>Stories referenced:</strong>
              <ul>
                {digest.stories.map((s, i) => {
                  if (s == null) return null
                  const title = typeof s === 'string' ? s : (s.headline || s.title || 'Untitled')
                  return (
                    <li key={i}>
                      {title}
                      {typeof s === 'object' && s.matched && <span className="story-matched"> (matched)</span>}
                      {typeof s === 'object' && s.url && <span className="story-url"> — {s.url}</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <button
            className="draft-link"
            onClick={e => {
              e.stopPropagation()
              const stories = (digest.stories || digest.key_stories || [])
                .map(s => typeof s === 'string' ? s : s.headline || s.title || '')
                .filter(Boolean)
                .join('\n- ')
              onDraftInChat({
                message: `Draft a post about podcast: '${ep.title || 'Untitled'}' (${ep.source})\n\nGenerate THREE drafts in different formats, each ending with the in-the-end-at-the-end.`,
                sourceRefs: ep.filename ? [{ type: 'transcript', filename: ep.filename }] : [],
              })
            }}
          >
            ✏️ Draft in chat
          </button>
        </div>
      )}
    </div>
  )
}

// ── Article Table (carried forward from Articles.jsx) ─────

function ArticleTable({ articles, tab, onReload, onDraftInChat }) {
  const [expandedSlug, setExpandedSlug] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [actionError, setActionError] = useState(null)

  async function handleSectorChange(a, newSector) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { sector: newSector })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleFlagToggle(a) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { flagged: !a.flagged })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleDelete(a) {
    setActionError(null)
    try {
      await apiDelete(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`)
      setDeleteConfirm(null)
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleArchiveToggle(a) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { archived: !a.archived })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function handleRowClick(a) {
    const key = `${a.date_published}-${a.sector}-${a.slug}`
    setExpandedSlug(expandedSlug === key ? null : key)
  }

  function handleDraftInChat(a) {
    onDraftInChat({
      message: `Draft a post about: '${a.title}' (${a.source || 'unknown'}, ${a.sector})\n\nGenerate THREE drafts in different formats, each ending with the in-the-end-at-the-end.`,
      sourceRefs: [{ type: 'article', date: a.date_published, sector: a.sector, slug: a.slug }],
    })
  }

  return (
    <>
      {actionError && <div className="action-error">{actionError}</div>}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Sector</th>
              <th>Date</th>
              <th>Score</th>
              <th>{tab === 'flagged' ? 'Reason' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {articles.map(a => {
              const key = `${a.date_published}-${a.sector}-${a.slug}`
              const isExpanded = expandedSlug === key
              const isDeleting = deleteConfirm === key

              return (
                <ArticleRow
                  key={key}
                  article={a}
                  tab={tab}
                  isExpanded={isExpanded}
                  isDeleting={isDeleting}
                  onRowClick={() => handleRowClick(a)}
                  onSectorChange={(s) => handleSectorChange(a, s)}
                  onFlagToggle={() => handleFlagToggle(a)}
                  onArchiveToggle={() => handleArchiveToggle(a)}
                  onDeleteClick={() => setDeleteConfirm(key)}
                  onDeleteConfirm={() => handleDelete(a)}
                  onDeleteCancel={() => setDeleteConfirm(null)}
                  onDraftInChat={() => handleDraftInChat(a)}
                />
              )
            })}
            {articles.length === 0 && (
              <tr>
                <td colSpan={5} className="placeholder-text">No articles found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ArticleRow({
  article: a, tab, isExpanded, isDeleting,
  onRowClick, onSectorChange, onFlagToggle, onArchiveToggle,
  onDeleteClick, onDeleteConfirm, onDeleteCancel, onDraftInChat
}) {
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(null)

  async function loadDetail() {
    if (detail) return
    setDetailLoading(true)
    setDetailError(null)
    try {
      const data = await apiFetch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`)
      setDetail(data)
    } catch (err) {
      setDetailError(err.message)
    }
    setDetailLoading(false)
  }

  function handleClick() {
    onRowClick()
    if (!isExpanded) loadDetail()
  }

  if (isDeleting) {
    return (
      <tr className="delete-confirm-row">
        <td colSpan={5}>
          <span>Delete &ldquo;{a.title}&rdquo;?</span>
          <button className="btn btn-danger btn-sm" onClick={onDeleteConfirm}>Yes, delete</button>
          <button className="btn btn-ghost btn-sm" onClick={onDeleteCancel}>Cancel</button>
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className={`article-row ${isExpanded ? 'expanded' : ''} ${a.archived ? 'archived' : ''}`} onClick={handleClick}>
        <td>
          <div className="article-title">
            {a.title}
            {a.archived && <span className="badge-archived">archived</span>}
          </div>
          <div className="article-source">{a.source}</div>
        </td>
        <td><SectorBadge sector={a.sector} /></td>
        <td className="cell-meta">{formatDate(a.date_published)}</td>
        <td>
          <span className={`score ${scoreClass(a.score)}`}>
            {a.score != null ? a.score : (a.source_type === 'manual' ? 'manual' : '\u2014')}
          </span>
        </td>
        <td className="cell-actions" onClick={e => e.stopPropagation()}>
          {tab === 'flagged' ? (
            <span className="cell-meta">{a.reason || '\u2014'}</span>
          ) : (
            <div className="row-actions">
              <select
                className="action-sector-select"
                value={a.sector}
                onChange={e => onSectorChange(e.target.value)}
              >
                {SECTORS.filter(Boolean).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <button
                className={`action-btn flag-btn ${a.flagged ? 'flagged' : ''}`}
                onClick={onFlagToggle}
                title={a.flagged ? 'Unflag' : 'Flag for review'}
              >
                {a.flagged ? '\u2691' : '\u2690'}
              </button>
              <button
                className="btn-icon"
                title={a.archived ? 'Restore' : 'Archive'}
                onClick={e => { e.stopPropagation(); onArchiveToggle() }}
              >
                {a.archived ? '↩' : '📦'}
              </button>
              <button
                className="btn-icon draft-chat-btn"
                title="Draft in chat"
                onClick={e => { e.stopPropagation(); onDraftInChat() }}
              >
                ✏️ Draft
              </button>
              <button className="action-btn delete-btn" onClick={onDeleteClick} title="Delete">
                \u2715
              </button>
            </div>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <ArticleDetail article={a} detail={detail} loading={detailLoading} error={detailError} />
          </td>
        </tr>
      )}
    </>
  )
}

function ArticleDetail({ article, detail, loading, error }) {
  if (loading) return <div className="detail-panel"><div className="placeholder-text">Loading...</div></div>
  if (error) return <div className="detail-panel"><div className="action-error">Failed to load details: {error}</div></div>
  const d = detail || article

  return (
    <div className="detail-panel">
      <div className="detail-grid">
        <div className="detail-text">
          <h4>Full text</h4>
          <div className="detail-fulltext">{d.full_text || 'No text available'}</div>
        </div>
        <div className="detail-meta">
          <h4>Metadata</h4>
          <dl>
            <dt>Source</dt><dd>{d.source}</dd>
            <dt>URL</dt><dd><a href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a></dd>
            <dt>Published</dt><dd>{d.date_published}</dd>
            <dt>Confidence</dt><dd>{d.date_confidence || '\u2014'}</dd>
            <dt>Method</dt><dd>{d.date_verified_method || '\u2014'}</dd>
            <dt>Scraped</dt><dd>{d.scraped_at ? formatDate(d.scraped_at) : '\u2014'}</dd>
            <dt>Type</dt><dd>{d.source_type || 'automated'}</dd>
            {d.score != null && <><dt>Score reason</dt><dd>{d.score_reason || '\u2014'}</dd></>}
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
          </dl>
          {d.keywords_matched?.length > 0 && (
            <div className="detail-keywords">
              <h4>Keywords</h4>
              <div className="keyword-pills">
                {d.keywords_matched.map(k => <span key={k} className="keyword-pill">{k}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Ingest Form ───────────────────────────────────────────

function IngestForm({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [sectorOverride, setSectorOverride] = useState('')
  const [status, setStatus] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return

    setStatus({ type: 'loading', message: 'Scraping...' })

    try {
      const body = { url: url.trim() }
      if (sectorOverride) body.sectorOverride = sectorOverride

      const result = await apiPost('/api/articles/ingest', body)

      if (result.status === 'duplicate') {
        setStatus({ type: 'duplicate', message: `Already exists: ${result.title}` })
      } else if (result.off_limits_warning) {
        setStatus({ type: 'warning', message: `Saved with warning: ${result.off_limits_warning}` })
        setTimeout(() => onSuccess(), 3000)
      } else {
        setStatus({ type: 'success', message: `Added: ${result.title} (${result.sector})` })
        setTimeout(() => onSuccess(), 2000)
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message })
    }
  }

  return (
    <form className="ingest-form" onSubmit={handleSubmit}>
      <input
        type="url"
        placeholder="Paste article URL..."
        value={url}
        onChange={e => setUrl(e.target.value)}
        className="ingest-url"
        required
        disabled={status?.type === 'loading'}
      />
      <select
        value={sectorOverride}
        onChange={e => setSectorOverride(e.target.value)}
        className="ingest-sector"
        disabled={status?.type === 'loading'}
      >
        <option value="">Auto-classify</option>
        {SECTORS.filter(Boolean).map(s => (
          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary btn-md"
        disabled={status?.type === 'loading'}
      >
        {status?.type === 'loading' ? status.message : 'Ingest'}
      </button>
      {status && status.type !== 'loading' && (
        <div className={`ingest-banner ingest-${status.type}`}>{status.message}</div>
      )}
    </form>
  )
}

function scoreClass(score) {
  if (score == null) return ''
  if (score >= 8) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}
