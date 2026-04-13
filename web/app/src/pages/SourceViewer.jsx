import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import './SourceViewer.css'

export default function SourceViewer() {
  const { id } = useParams()
  const [entry, setEntry] = useState(null)
  const [themes, setThemes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        // Fetch the analysis entry
        const state = await apiFetch(`/api/editorial/state?section=analysisIndex&showArchived=true`)
        const found = (state || []).find(e => String(e.id) === String(id))
        if (!found) {
          setError(`Entry #${id} not found`)
          setLoading(false)
          return
        }
        setEntry(found)

        // Fetch theme details for each theme code
        if (found.themes?.length) {
          const themeData = await apiFetch(`/api/editorial/state?section=themeRegistry&showArchived=true`)
          const relevant = (themeData || []).filter(t => found.themes.includes(t.code))
          setThemes(relevant)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  if (loading) return <div className="source-viewer"><div className="sv-loading">Loading entry #{id}...</div></div>
  if (error) return <div className="source-viewer"><div className="sv-error">{error}</div></div>
  if (!entry) return null

  const themesStr = Array.isArray(entry.themes) ? entry.themes.join(', ') : (entry.themes || 'None')

  return (
    <div className="source-viewer">
      <div className="sv-header">
        <div className="sv-id">D{entry.id}</div>
        <h1>{entry.title}</h1>
        <div className="sv-meta">
          <span className="sv-source">{entry.source}</span>
          {entry.host && <span> · {entry.host}</span>}
          {entry.date && <span> · {entry.date}</span>}
          <span> · Tier {entry.tier}</span>
          <span> · Session {entry.session}</span>
        </div>
        {entry.url && (
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className="sv-url">
            {entry.url}
          </a>
        )}
      </div>

      <section className="sv-section">
        <h2>Summary</h2>
        <p className="sv-summary">{entry.summary || 'No summary available.'}</p>
      </section>

      <section className="sv-section">
        <h2>Metadata</h2>
        <div className="sv-grid">
          <div><strong>Themes</strong><br />{themesStr}</div>
          <div><strong>Key Themes</strong><br />{entry.keyThemes || 'N/A'}</div>
          <div><strong>Post Potential</strong><br />{entry.postPotential || 'N/A'}</div>
          <div><strong>Status</strong><br />{entry.status}</div>
          <div><strong>Date Processed</strong><br />{entry.dateProcessed || 'N/A'}</div>
          {entry.filename && <div><strong>Filename</strong><br />{entry.filename}</div>}
        </div>
      </section>

      {entry.postPotentialReasoning && (
        <section className="sv-section">
          <h2>Post Potential Reasoning</h2>
          <p>{entry.postPotentialReasoning}</p>
        </section>
      )}

      {themes.length > 0 && (
        <section className="sv-section">
          <h2>Related Themes</h2>
          {themes.map(t => (
            <div key={t.code} className="sv-theme">
              <h3>{t.code}: {t.name}</h3>
              {t.evidence?.length > 0 && (
                <div className="sv-evidence">
                  {t.evidence.slice(-3).map((ev, i) => (
                    <blockquote key={i}>
                      <strong>Session {ev.session} · {ev.source}</strong>
                      <br />
                      {ev.content}
                    </blockquote>
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
