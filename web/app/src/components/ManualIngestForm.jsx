import { useState, useEffect, useRef } from 'react'
import { apiFetch, apiPost } from '../lib/api'
import './ManualIngestForm.css'

const SECTORS = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function ManualIngestForm({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [source, setSource] = useState('')
  const [sector, setSector] = useState('general')
  const [datePublished, setDatePublished] = useState(new Date().toISOString().split('T')[0])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allPublications, setAllPublications] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const sourceRef = useRef(null)

  useEffect(() => {
    apiFetch('/api/articles/publications')
      .then(data => setAllPublications(data.publications || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!source.trim()) {
      setSuggestions([])
      return
    }
    const q = source.toLowerCase()
    const matches = allPublications.filter(p =>
      p.toLowerCase().includes(q)
    ).slice(0, 8)
    setSuggestions(matches)
  }, [source, allPublications])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await apiPost('/api/articles/manual', {
        title, content, source, sector, url, date_published: datePublished,
      })
      setSuccess(true)
      setTitle('')
      setContent('')
      setUrl('')
      setSource('')
      setSector('general')
      if (onSuccess) onSuccess()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function selectSuggestion(pub) {
    setSource(pub)
    setShowSuggestions(false)
  }

  return (
    <form className="manual-ingest-form card" onSubmit={handleSubmit}>
      <div className="ingest-header">
        <h4>Manual Ingest</h4>
        <span className="ingest-hint">Saves directly — no ingest server needed</span>
      </div>

      <div className="ingest-row ingest-row-top">
        <div className="ingest-field">
          <label>URL <span className="optional">(optional)</span></label>
          <input type="text" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/article" />
        </div>
        <div className="ingest-field ingest-field-pub" ref={sourceRef}>
          <label>Publication</label>
          <input type="text" value={source}
            onChange={e => { setSource(e.target.value); setShowSuggestions(true) }}
            onFocus={() => source && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="e.g. Financial Times" />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="pub-suggestions">
              {suggestions.map(s => (
                <li key={s} onMouseDown={() => selectSuggestion(s)}
                  className={s.toLowerCase() === source.toLowerCase() ? 'highlighted' : ''}>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ingest-field">
          <label>Sector</label>
          <select value={sector} onChange={e => setSector(e.target.value)}>
            {SECTORS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="ingest-field">
          <label>Date published</label>
          <input type="date" value={datePublished} onChange={e => setDatePublished(e.target.value)} />
        </div>
      </div>

      <div className="ingest-field">
        <label>Title <span className="required">*</span></label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Article title" required />
      </div>

      <div className="ingest-field">
        <label>Content <span className="required">*</span></label>
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Paste the full article text here..."
          rows={6} required />
      </div>

      <div className="ingest-footer">
        <button type="submit" className="btn btn-primary btn-md" disabled={saving}>
          {saving ? 'Saving...' : 'Save Article'}
        </button>
        {error && <span className="ingest-error">{error}</span>}
        {success && <span className="ingest-success">Article saved</span>}
      </div>
    </form>
  )
}
