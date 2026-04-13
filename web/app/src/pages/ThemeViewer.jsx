import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import './SourceViewer.css'

export default function ThemeViewer() {
  const { code } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const result = await apiFetch(`/api/editorial/theme/${code}`)
        if (!result || result.error) {
          setError(result?.error || `Theme ${code} not found`)
          setLoading(false)
          return
        }
        setData(result)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [code])

  if (loading) return <div className="source-viewer"><div className="sv-loading">Loading theme {code}...</div></div>
  if (error) return <div className="source-viewer"><div className="sv-error">{error}</div></div>
  if (!data) return null

  const theme = data.theme || {}
  const evidence = data.evidence || []
  const connections = data.connections || []
  const linkedEntries = data.linkedEntries || []

  return (
    <div className="source-viewer">
      <div className="sv-header">
        <div className="sv-id">{code}</div>
        <h1>{theme.name}</h1>
        <div className="sv-meta">
          <span>{theme.document_count || theme.documentCount} documents</span>
          <span> · Created: {theme.created_session || theme.createdSession || 'N/A'}</span>
          <span> · Last updated: {theme.last_updated_session || theme.lastUpdatedSession || 'N/A'}</span>
          {theme.archived ? <span className="sv-archived"> · Archived</span> : null}
        </div>
      </div>

      {connections.length > 0 && (
        <section className="sv-section">
          <h2>Cross-Connections</h2>
          <div className="sv-connections">
            {connections.map((cc, i) => {
              const otherCode = cc.from_code === code.toUpperCase() ? cc.to_code : cc.from_code
              return (
                <div key={i} className="sv-connection">
                  <a href={`/theme/${otherCode}`} target="_blank" rel="noopener noreferrer" className="source-link">
                    {otherCode}
                  </a>
                  {cc.reasoning && <span className="sv-connection-reason"> — {cc.reasoning}</span>}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="sv-section">
        <h2>Evidence ({evidence.length} entries)</h2>
        <div className="sv-evidence">
          {evidence.map((ev, i) => (
            <blockquote key={i}>
              <strong>Session {ev.session} · {ev.source}</strong>
              {ev.url && (
                <>
                  <br />
                  <a href={ev.url} target="_blank" rel="noopener noreferrer" className="sv-url">{ev.url}</a>
                </>
              )}
              <br />
              {ev.content}
            </blockquote>
          ))}
        </div>
      </section>

      {linkedEntries.length > 0 && (
        <section className="sv-section">
          <h2>Linked Analysis Entries ({linkedEntries.length})</h2>
          <div className="sv-linked-entries">
            {linkedEntries.map(e => (
              <div key={e.id} className="sv-linked-entry">
                <div className="sv-linked-header">
                  <a href={`/source/${e.id}`} target="_blank" rel="noopener noreferrer" className="source-link">
                    D{e.id}
                  </a>
                  <span className="sv-linked-title">{e.title}</span>
                  <span className="sv-linked-meta">{e.source} · {e.date} · T{e.tier} · S{e.session}</span>
                </div>
                {e.summary && <p className="sv-linked-summary">{e.summary}</p>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
