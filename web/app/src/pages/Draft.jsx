import { useState, useEffect, useMemo } from 'react'
import Markdown from 'react-markdown'
import { useDraft } from '../hooks/useDraft'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import DraftChatPanel from '../components/DraftChatPanel'
import { usePublished } from '../hooks/usePublished'
import './Draft.css'

export default function Draft() {
  const {
    draft, review, links, evaluate,
    week, availableWeeks,
    loading, error, saving, saveError, savedAt, dirty,
    setDraft, save, goToWeek,
  } = useDraft()

  const [showFlags, setShowFlags] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const debouncedDraft = useDebouncedValue(draft, 300)
  const [showPublished, setShowPublished] = useState(false)
  const pub = usePublished(week)

  const wordCount = useMemo(() => {
    if (!draft) return 0
    return draft.trim().split(/\s+/).filter(Boolean).length
  }, [draft])

  // Build link status map: url -> { status, httpStatus, responseTimeMs }
  const linkMap = useMemo(() => {
    if (!links?.results) return {}
    const map = {}
    for (const r of links.results) {
      map[r.url] = r
    }
    return map
  }, [links])

  // Build prohibited terms list
  const prohibitedTerms = useMemo(() => {
    if (!review?.prohibited_found) return []
    return review.prohibited_found.map(p => p.term)
  }, [review])

  const reviewIssueCount = review?.prohibited_found?.length ?? 0
  const reviewPass = review?.overall_pass ?? true

  // Unsaved changes guard for week nav
  const handleWeekNav = (w) => {
    if (dirty && !confirm('You have unsaved changes. Discard and navigate?')) return
    goToWeek(w)
  }

  const weekIdx = availableWeeks.indexOf(week)
  const hasPrev = weekIdx > 0
  const hasNext = weekIdx < availableWeeks.length - 1

  // Save button label
  const saveLabel = saving ? 'Saving...' : (savedAt && Date.now() - savedAt < 2000) ? 'Saved' : 'Save'
  const saveClass = `btn-save${(savedAt && Date.now() - savedAt < 2000) ? ' saved' : ''}`

  const hasDraft = draft !== null && draft !== undefined

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>

  // Custom renderers for react-markdown
  const components = {
    a: ({ href, children }) => {
      const info = linkMap[href]
      return (
        <>
          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          {info && (
            <span
              className={`link-badge ${info.status === 'ok' ? 'ok' : 'dead'}`}
              title={`${info.httpStatus} — ${info.responseTimeMs}ms`}
            >
              {info.status === 'ok' ? '✓' : '✗'}
            </span>
          )}
        </>
      )
    },
    p: ({ children }) => {
      if (!showFlags || prohibitedTerms.length === 0) return <p>{children}</p>
      return <p>{highlightTerms(children, prohibitedTerms)}</p>
    },
    li: ({ children }) => {
      if (!showFlags || prohibitedTerms.length === 0) return <li>{children}</li>
      return <li>{highlightTerms(children, prohibitedTerms)}</li>
    },
  }

  return (
    <div>
      <div className="draft-toolbar">
        <h2>Draft</h2>
        <div className="week-nav">
          <button disabled={!hasPrev} onClick={() => handleWeekNav(availableWeeks[weekIdx - 1])}>◀</button>
          <span>Week {week}</span>
          <button disabled={!hasNext} onClick={() => handleWeekNav(availableWeeks[weekIdx + 1])}>▶</button>
        </div>
        <button className={saveClass} disabled={!hasDraft || !dirty || saving} onClick={save}>
          {saveLabel}
        </button>
        {saveError && <span className="save-error">{saveError}</span>}
        {review && (
          <button
            className={`review-pill ${reviewPass ? 'pass' : 'fail'}`}
            onClick={() => setShowFlags(f => !f)}
            title={showFlags ? 'Click to hide review flags' : 'Click to show review flags'}
          >
            {reviewPass ? 'Pass' : `${reviewIssueCount} issue${reviewIssueCount !== 1 ? 's' : ''}`}
          </button>
        )}
        <button
          className={`draft-published-toggle ${showPublished ? 'active' : ''}`}
          onClick={() => setShowPublished(!showPublished)}
        >
          Published
        </button>
        <button
          className={`draft-chat-toggle${panelOpen ? ' active' : ''}`}
          disabled={!hasDraft}
          onClick={() => setPanelOpen(p => !p)}
          title="Toggle draft assistant"
        >
          Chat
        </button>
      </div>

      {hasDraft ? (
        <>
          <div className="draft-panes">
            <div className="draft-editor">
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="draft-preview">
              <Markdown components={components}>{debouncedDraft}</Markdown>
            </div>
          </div>

          <div className="draft-footer">
            <span>
              {evaluate
                ? `Eval: ${JSON.stringify(evaluate).slice(0, 80)}`
                : 'Evaluation: No data available'
              }
            </span>
            <span>{wordCount.toLocaleString()} words</span>
          </div>
        </>
      ) : (
        <div className="draft-panes">
          <div className="draft-empty-state">No draft found for week {week}</div>
        </div>
      )}

      {showPublished && (
        <PublishedPanel week={week} pub={pub} />
      )}

      <DraftChatPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        draftContent={draft}
        week={week}
      />
    </div>
  )
}

function PublishedPanel({ week, pub }) {
  const [content, setContent] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [saveMsg, setSaveMsg] = useState(null)

  // Sync from loaded published data
  useEffect(() => {
    if (pub.published) {
      setContent(pub.published.content || '')
      setLinkedinUrl(pub.published.meta?.linkedinUrl || '')
    }
  }, [pub.published])

  async function handleSave() {
    if (!content.trim()) return
    setSaveMsg(null)
    await pub.save(content, { linkedinUrl })
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(null), 3000)
  }

  if (pub.loading) return <div className="published-panel"><div className="placeholder-text">Loading...</div></div>

  return (
    <div className="published-panel">
      <div className="published-header">
        <h3>Published — Week {week}</h3>
        {pub.published?.meta?.wordCount && (
          <span className="published-meta">
            {pub.published.meta.wordCount} words · {pub.published.meta.sectionCount} sections
          </span>
        )}
      </div>

      <label className="published-label">LinkedIn URL</label>
      <input
        type="url"
        className="published-url"
        placeholder="https://linkedin.com/posts/..."
        value={linkedinUrl}
        onChange={e => setLinkedinUrl(e.target.value)}
      />

      <label className="published-label">Newsletter content</label>
      <textarea
        className="published-content"
        placeholder="Paste your published newsletter markdown here..."
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={12}
      />

      {pub.published?.meta?.sections?.length > 0 && (
        <div className="published-sections">
          {pub.published.meta.sections.map((s, i) => (
            <span key={i} className="published-section-badge">
              {s.heading} <small>({s.wordCount}w)</small>
            </span>
          ))}
        </div>
      )}

      <div className="published-actions">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={pub.saving || !content.trim()}
        >
          {pub.saving ? 'Saving...' : 'Save published'}
        </button>
        {saveMsg && <span className="published-save-msg">{saveMsg}</span>}
        {pub.error && <span className="published-error">{pub.error}</span>}
      </div>
    </div>
  )
}

/**
 * Walk React children and highlight any text that contains prohibited terms.
 * Returns new children with <mark> wrappers around matched terms.
 */
function highlightTerms(children, terms) {
  if (!children) return children
  if (typeof children === 'string') {
    return highlightString(children, terms)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') return <span key={i}>{highlightString(child, terms)}</span>
      return child
    })
  }
  return children
}

function highlightString(text, terms) {
  if (!terms.length) return text
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    pattern.test(part)
      ? <mark key={i} className="review-mark" title={`Prohibited: "${part}"`}>{part}</mark>
      : part
  )
}
