import { useState } from 'react'
import { useArticles } from '../hooks/useArticles'
import { useFlaggedArticles } from '../hooks/useFlaggedArticles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate } from '../lib/format'
import './Articles.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function Articles() {
  const [sector, setSector] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const debouncedSearch = useDebouncedValue(search, 300)

  const allResult = useArticles({ sector, date, search: debouncedSearch })
  const flaggedResult = useFlaggedArticles()

  const { articles, total, loading, error } = tab === 'all' ? allResult : flaggedResult

  return (
    <div>
      <div className="page-header">
        <h2>Articles</h2>
        <button className="btn btn-primary" disabled>+ Ingest URL (coming soon)</button>
      </div>

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
        </div>
      )}

      <div className="card card-flush">
        {loading ? (
          <div className="placeholder-text">Loading...</div>
        ) : error ? (
          <div className="placeholder-text">Failed to load articles: {error}</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Sector</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>{tab === 'flagged' ? 'Reason' : 'Confidence'}</th>
                </tr>
              </thead>
              <tbody>
                {articles.map(a => (
                  <tr key={`${a.date_published}-${a.sector}-${a.slug}`}>
                    <td>
                      <div className="article-title">{a.title}</div>
                      <div className="article-source">{a.source}</div>
                    </td>
                    <td><SectorBadge sector={a.sector} /></td>
                    <td className="cell-meta">{formatDate(a.date_published)}</td>
                    <td>
                      <span className={`score ${scoreClass(a.score)}`}>
                        {a.score ?? '\u2014'}
                      </span>
                    </td>
                    <td className="cell-meta cell-confidence">
                      {tab === 'flagged' ? (a.reason || '\u2014') : (a.date_confidence || '\u2014')}
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="placeholder-text">
                      No articles found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function scoreClass(score) {
  if (score == null) return ''
  if (score >= 8) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}
