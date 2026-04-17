/**
 * StyleFeedback — lets the user submit the final/published version
 * of a draft so the system can learn from the edits.
 *
 * The server diffs the draft vs the final, extracts editorial rules
 * via an LLM pass, and appends them to the vocabulary fingerprint's
 * learned_rules array. Future drafts see these rules in the system prompt.
 */
import { useState } from 'react'
import { apiPost } from '../lib/api'
import './StyleFeedback.css'

export default function StyleFeedback({ draftText, threadId }) {
  const [open, setOpen] = useState(false)
  const [finalText, setFinalText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (finalText.trim().length < 50) {
      setError('Paste the final version (at least 50 characters)')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const r = await apiPost('/api/editorial/style-edit', {
        threadId,
        draftText,
        finalText: finalText.trim(),
        extractRules: true,
      })
      setResult(r)
    } catch (err) {
      setError(err.message || 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  if (!draftText || draftText.length < 200) return null

  if (!open) {
    return (
      <button className="sf-trigger" onClick={() => setOpen(true)} title="Train the system by submitting the final published version">
        📝 Teach system from edits
      </button>
    )
  }

  if (result) {
    const rules = result.extracted?.rules || []
    return (
      <div className="sf-panel sf-result">
        <div className="sf-result-header">
          ✓ {rules.length} rule{rules.length !== 1 ? 's' : ''} learned
        </div>
        {rules.length > 0 && (
          <ul className="sf-rules">
            {rules.map((r, i) => (
              <li key={i}>
                <strong>{r.pattern}</strong>
                {r.rationale && <div className="sf-rationale">{r.rationale}</div>}
              </li>
            ))}
          </ul>
        )}
        <button className="sf-close" onClick={() => { setOpen(false); setResult(null); setFinalText('') }}>Close</button>
      </div>
    )
  }

  return (
    <div className="sf-panel">
      <form onSubmit={handleSubmit}>
        <div className="sf-label">Paste the final published version. The system will diff it against the draft and learn the patterns.</div>
        <textarea
          className="sf-textarea"
          value={finalText}
          onChange={e => setFinalText(e.target.value)}
          placeholder="Paste the final version here..."
          rows={8}
          disabled={submitting}
        />
        {error && <div className="sf-error">{error}</div>}
        <div className="sf-actions">
          <button type="button" onClick={() => setOpen(false)} disabled={submitting} className="sf-cancel">Cancel</button>
          <button type="submit" disabled={submitting || finalText.trim().length < 50} className="sf-submit">
            {submitting ? 'Extracting rules…' : 'Learn from this edit'}
          </button>
        </div>
      </form>
    </div>
  )
}
