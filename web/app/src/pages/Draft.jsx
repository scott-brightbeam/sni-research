import { useState, useEffect, useMemo } from 'react'
import Markdown from 'react-markdown'
import { useDraft } from '../hooks/useDraft'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import DraftChatPanel from '../components/DraftChatPanel'
import { usePublished } from '../hooks/usePublished'
import { useExclusions } from '../hooks/useExclusions'
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
  const excl = useExclusions(week)

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
          {pub.published ? 'Published ✓' : 'Published'}
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
        <PublishedPanel week={week} pub={pub} draft={draft} excl={excl} />
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

function PublishedPanel({ week, pub, draft, excl }) {
  const [publishError, setPublishError] = useState(null)
  const [justPublished, setJustPublished] = useState(false)

  const isPublished = !!pub.published

  async function handlePublish() {
    if (!draft?.trim()) return
    setPublishError(null)
    setJustPublished(false)
    const ok = await pub.save(draft)
    if (ok) {
      setJustPublished(true)
      setTimeout(() => setJustPublished(null), 3000)
    } else {
      setPublishError(pub.error || 'Failed to publish')
    }
  }

  if (pub.loading) return <div className="published-panel"><div className="placeholder-text">Loading...</div></div>

  return (
    <div className="published-panel">
      {/* Step 1: Publish */}
      <div className="publish-step">
        <div className="publish-step-header">
          <h3>Step 1: Publish draft</h3>
          {isPublished && (
            <span className="publish-status">
              Published {pub.published.meta?.wordCount && `· ${pub.published.meta.wordCount} words`}
              {pub.published.meta?.sectionCount && ` · ${pub.published.meta.sectionCount} sections`}
            </span>
          )}
        </div>

        {!draft?.trim() && (
          <p className="publish-hint">No draft content to publish for week {week}.</p>
        )}

        {draft?.trim() && (
          <div className="publish-actions">
            <button
              className="btn btn-primary"
              onClick={handlePublish}
              disabled={pub.saving}
            >
              {pub.saving ? 'Publishing...' : isPublished ? 'Re-publish draft' : 'Publish draft'}
            </button>
            {justPublished && <span className="publish-saved">Published ✓</span>}
            {publishError && <span className="publish-error">{publishError}</span>}
          </div>
        )}
      </div>

      {/* Step 2: Extract exclusions — only shown after publishing */}
      {isPublished && (
        <div className="exclusions-step">
          <div className="exclusions-step-header">
            <h3>Step 2: Extract off-limits entries</h3>
            {excl.entries && <span className="exclusions-count">{excl.entries.length} entries</span>}
          </div>

          <div className="exclusions-actions">
            <button
              className="btn-secondary"
              onClick={excl.extract}
              disabled={excl.extracting}
            >
              {excl.extracting ? 'Extracting...' : excl.entries ? 'Re-extract' : 'Extract from published'}
            </button>
            {excl.extractError && <span className="exclusions-error">{excl.extractError}</span>}
          </div>

          {excl.entries && excl.entries.length > 0 && (
            <>
              <table className="exclusions-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Topic</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {excl.entries.map((entry, i) => (
                    <tr key={i}>
                      <td>
                        <input
                          className="exclusion-input"
                          value={entry.company}
                          onChange={e => excl.updateEntry(i, 'company', e.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className="exclusion-input"
                          value={entry.topic}
                          onChange={e => excl.updateEntry(i, 'topic', e.target.value)}
                        />
                      </td>
                      <td>
                        <button
                          className="btn-icon btn-remove"
                          onClick={() => excl.removeEntry(i)}
                          title="Remove entry"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="exclusions-table-actions">
                <button className="btn-sm btn-ghost" onClick={excl.addEntry}>+ Add entry</button>
              </div>

              <div className="exclusions-save-row">
                <button
                  className="btn btn-primary"
                  onClick={excl.saveToOffLimits}
                  disabled={excl.saving || excl.entries.length === 0}
                >
                  {excl.saving ? 'Saving...' : `Save ${excl.entries.length} entries to off-limits`}
                </button>
                {excl.savedAt && <span className="exclusions-saved">Saved to off-limits ✓</span>}
                {excl.saveError && <span className="exclusions-error">{excl.saveError}</span>}
              </div>
            </>
          )}

          {excl.entries && excl.entries.length === 0 && (
            <p className="publish-hint">No entries extracted. Try re-extracting or add entries manually.</p>
          )}
        </div>
      )}
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
  const splitter = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(splitter)
  if (parts.length === 1) return text
  // Use a fresh non-global regex for testing each part (avoids lastIndex bug)
  const tester = new RegExp(`^(?:${escaped.join('|')})$`, 'i')
  return parts.map((part, i) =>
    tester.test(part)
      ? <mark key={i} className="review-mark" title={`Prohibited: "${part}"`}>{part}</mark>
      : part
  )
}
