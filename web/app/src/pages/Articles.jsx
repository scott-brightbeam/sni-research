import { useState } from 'react'
import { useArticles } from '../hooks/useArticles'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate } from '../lib/format'
import './Articles.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function Articles() {
  const [sector, setSector] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const { articles, total, loading } = useArticles(
    tab === 'all' ? { sector, date, search } : {}
  )

  return (
    <div>
      <div className="page-header">
        <h2>Articles</h2>
        <button className="btn btn-primary">+ Ingest URL</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All articles <span className="tab-count">({total})</span>
        </button>
        <button className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged
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
            style={{ flex: 1 }}
          />
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading" style={{ padding: 40 }}>Loading...</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Sector</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Confidence</th>
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
                        {a.score ?? '—'}
                      </span>
                    </td>
                    <td className="cell-meta cell-confidence">
                      {a.date_confidence || '—'}
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--cloudy)' }}>
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
