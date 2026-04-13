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
        // Dedicated endpoint returns full entry including transcript
        const found = await apiFetch(`/api/editorial/entry/${id}`)
        if (!found || found.error) {
          setError(found?.error || `Entry #${id} not found`)
          setLoading(false)
          return
        }
        // Parse themes if stored as JSON string
        if (typeof found.themes === 'string') {
          try { found.themes = JSON.parse(found.themes) } catch { found.themes = [] }
        }
        setEntry(found)

        // Fetch theme details
        if (found.themes?.length) {
          const rawT = await apiFetch(`/api/editorial/state?section=themeRegistry&showArchived=true`)
          const themeList = rawT?.themes || (Array.isArray(rawT) ? rawT : null)
          let relevant = []
          if (Array.isArray(themeList)) {
            relevant = themeList.filter(t => found.themes.includes(t.code))
          } else if (rawT && typeof rawT === 'object') {
            relevant = Object.entries(rawT)
              .filter(([code]) => found.themes.includes(code))
              .map(([code, t]) => ({ ...t, code }))
          }
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

  const themesCodes = Array.isArray(entry.themes) ? entry.themes : []

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
          <div><strong>Themes</strong><br />{themesCodes.length > 0
            ? themesCodes.map((t, i) => <span key={t}>{i > 0 && ', '}<a href={`/theme/${t}`} target="_blank" rel="noopener noreferrer" className="source-link">{t}</a></span>)
            : 'None'
          }</div>
          <div><strong>Key Themes</strong><br />{entry.key_themes || entry.keyThemes || 'N/A'}</div>
          <div><strong>Post Potential</strong><br />{entry.post_potential || entry.postPotential || 'N/A'}</div>
          <div><strong>Status</strong><br />{entry.status}</div>
          <div><strong>Date Processed</strong><br />{entry.date_processed || entry.dateProcessed || 'N/A'}</div>
          {entry.filename && <div><strong>Filename</strong><br />{entry.filename}</div>}
        </div>
      </section>

      {(entry.post_potential_reasoning || entry.postPotentialReasoning) && (
        <section className="sv-section">
          <h2>Post Potential Reasoning</h2>
          <p>{entry.post_potential_reasoning || entry.postPotentialReasoning}</p>
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
                  {t.evidence.map((ev, i) => (
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

      {entry.transcript && (
        <section className="sv-section sv-transcript">
          <h2>Full Transcript</h2>
          <div className="sv-transcript-content">
            {entry.transcript.split('\n').map((line, i) =>
              line.trim() === '' ? <br key={i} /> : <p key={i}>{line}</p>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
