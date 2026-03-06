import { useState } from 'react'
import { useArticles } from '../hooks/useArticles'
import { useFlaggedArticles } from '../hooks/useFlaggedArticles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useStatus } from '../hooks/useStatus'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate, formatRelativeTime } from '../lib/format'
import { apiFetch, apiPatch, apiDelete, apiPost } from '../lib/api'
import './Articles.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function Articles() {
  const [sector, setSector] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [showIngest, setShowIngest] = useState(false)

  const debouncedSearch = useDebouncedValue(search, 300)

  const allResult = useArticles({ sector, date, search: debouncedSearch })
  const flaggedResult = useFlaggedArticles()
  const { status } = useStatus()

  const ingestOnline = status?.ingestServer?.online ?? false

  const { articles, total, loading, error, reload, lastUpdated } = tab === 'all' ? allResult : flaggedResult

  return (
    <div>
      <div className="page-header">
        <h2>Articles</h2>
        <button
          className="btn btn-primary"
          disabled={!ingestOnline}
          onClick={() => setShowIngest(!showIngest)}
        >
          {ingestOnline ? '+ Ingest URL' : '+ Ingest (offline)'}
        </button>
      </div>

      {showIngest && <IngestForm onSuccess={() => { setShowIngest(false); reload() }} />}

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All articles <span className="tab-count">({allResult.total})</span>
        </button>
        <button className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged <span className="tab-count">({flaggedResult.total})</span>
        </button>
      </div>

      {tab === 'all' && (
        <div className="filter-bar">
          <select value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {SECTORS.filter(Boolean).map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="filter-search"
          />
          {lastUpdated && (
            <span className="updated-indicator">
              Updated {formatRelativeTime(new Date(lastUpdated).toISOString())}
            </span>
          )}
        </div>
      )}

      <div className="card card-flush">
        {loading ? (
          <div className="placeholder-text">Loading...</div>
        ) : error ? (
          <div className="placeholder-text">Failed to load articles: {error}</div>
        ) : (
          <ArticleTable
            articles={articles}
            tab={tab}
            onReload={() => { reload(); flaggedResult.reload?.() }}
          />
        )}
      </div>
    </div>
  )
}

function ArticleTable({ articles, tab, onReload }) {
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

  function handleRowClick(a) {
    const key = `${a.date_published}-${a.sector}-${a.slug}`
    setExpandedSlug(expandedSlug === key ? null : key)
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
                  onDeleteClick={() => setDeleteConfirm(key)}
                  onDeleteConfirm={() => handleDelete(a)}
                  onDeleteCancel={() => setDeleteConfirm(null)}
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
  onRowClick, onSectorChange, onFlagToggle,
  onDeleteClick, onDeleteConfirm, onDeleteCancel
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
      <tr className={`article-row ${isExpanded ? 'expanded' : ''}`} onClick={handleClick}>
        <td>
          <div className="article-title">{a.title}</div>
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
        className="btn btn-primary"
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
