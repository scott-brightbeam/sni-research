import { useState, useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import Markdown from 'react-markdown'
import { useDraft } from '../hooks/useDraft'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useOverlapCheck } from '../hooks/useOverlapCheck'
import { useEditorialDraft } from '../hooks/useEditorialDraft'
import { useChatPanel } from '../hooks/useChatPanel'
import { usePublished } from '../hooks/usePublished'
import { useExclusions } from '../hooks/useExclusions'
import { downloadFile } from '../lib/download'
import { toast } from '../components/shared/Toast'
import DownloadIcon from '../components/shared/DownloadIcon'
import './Draft.css'

const RIGHT_TABS = [
  { key: 'preview', label: 'Preview' },
  { key: 'critique', label: 'AI Critique' },
  { key: 'review', label: 'Review' },
  { key: 'links', label: 'Links' },
  { key: 'chat', label: 'Chat' },
]

export default function Draft({ embedded = false }) {
  const {
    draft, review, links, evaluate,
    week, availableWeeks,
    loading, error, saving, saveError, savedAt, dirty,
    setDraft, save, goToWeek,
  } = useDraft()

  const editorialDraft = useEditorialDraft()
  const chat = useChatPanel(week)

  const location = useLocation()
  const [draftSource, setDraftSource] = useState(null)

  const [rightTab, setRightTab] = useState('preview')
  const [showFlags, setShowFlags] = useState(true)
  const [showPublished, setShowPublished] = useState(false)
  const [showOverlap, setShowOverlap] = useState(false)

  useEffect(() => {
    if (!location.state) return
    const { source, content } = location.state
    if (!source) return
    setDraftSource(source)

    // Auto-switch to chat tab when navigating from editorial elements
    if (source.type === 'post' || source.type === 'theme') {
      setRightTab('chat')
    }

    // Clear the state so refresh doesn't replay
    window.history.replaceState({}, '')
  }, [location.key]) // Re-fire on each navigation (React Router generates a new key)

  const debouncedDraft = useDebouncedValue(draft, 300)
  const pub = usePublished(week)
  const excl = useExclusions(week)
  const overlap = useOverlapCheck(week)

  const wordCount = useMemo(() => {
    if (!draft) return 0
    return draft.trim().split(/\s+/).filter(Boolean).length
  }, [draft])

  const linkMap = useMemo(() => {
    if (!links?.results) return {}
    const map = {}
    for (const r of links.results) {
      map[r.url] = r
    }
    return map
  }, [links])

  const prohibitedTerms = useMemo(() => {
    if (!review?.prohibited_found) return []
    return review.prohibited_found.map(p => p.term)
  }, [review])

  const reviewIssueCount = review?.prohibited_found?.length ?? 0
  const reviewPass = review?.overall_pass ?? true

  function handleWeekNav(w) {
    if (dirty && !confirm('You have unsaved changes. Discard and navigate?')) return
    goToWeek(w)
  }

  const weekIdx = availableWeeks.indexOf(week)
  const hasPrev = weekIdx > 0
  const hasNext = weekIdx < availableWeeks.length - 1

  const recentlySaved = savedAt && Date.now() - savedAt < 2000
  const saveLabel = saving ? 'Saving...' : recentlySaved ? 'Saved' : 'Save'
  const hasDraft = draft !== null && draft !== undefined

  function handleExportDraft() {
    if (!hasDraft) return
    try {
      const filename = `draft-week-${week}.md`
      downloadFile(draft, filename, 'text/markdown')
      toast(`Exported ${filename}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // Custom renderers for react-markdown (preview tab)
  // Must be before early returns to satisfy Rules of Hooks
  const components = useMemo(() => ({
    a: ({ href, children }) => {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
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
  }), [linkMap, showFlags, prohibitedTerms])

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>

  return (
    <div className={embedded ? 'draft-embedded' : 'draft-page'}>
      {/* ── Three-zone toolbar ─────────────────────────── */}
      <div className="draft-toolbar">
        <div className="toolbar-left">
          <h2>Draft</h2>
          <div className="week-nav">
            <button disabled={!hasPrev} onClick={() => handleWeekNav(availableWeeks[weekIdx - 1])} aria-label="Previous week">◀</button>
            <span>Week {week}</span>
            <button disabled={!hasNext} onClick={() => handleWeekNav(availableWeeks[weekIdx + 1])} aria-label="Next week">▶</button>
          </div>
          {draftSource && (
            <span className="draft-source-tag">
              {draftSource.type === 'post' ? `Post #${draftSource.id}` :
               draftSource.type === 'theme' ? draftSource.code :
               draftSource.type === 'analysis' ? `#${draftSource.id}` :
               'External'}
            </span>
          )}
        </div>

        <div className="toolbar-centre">
          {review && (
            <button
              className={`review-pill ${reviewPass ? 'pass' : 'fail'}`}
              onClick={() => setShowFlags(f => !f)}
              title={showFlags ? 'Hide review flags' : 'Show review flags'}
            >
              {reviewPass ? 'Pass' : `${reviewIssueCount} issue${reviewIssueCount !== 1 ? 's' : ''}`}
            </button>
          )}
          <span className="word-count-badge">{wordCount.toLocaleString()} words</span>
        </div>

        <div className="toolbar-right">
          <button
            className={`btn btn-secondary btn-md${overlap.results ? ' has-overlap-results' : ''}`}
            disabled={!hasDraft || overlap.loading}
            onClick={() => {
              if (overlap.results) {
                setShowOverlap(o => !o)
              } else {
                overlap.check().then(() => setShowOverlap(true))
              }
            }}
          >
            {overlap.loading ? 'Checking...' : overlap.results ? `Overlap (${overlap.results.length})` : 'Compare pipeline'}
          </button>
          <button
            className={`btn btn-ghost btn-md draft-publish-btn${showPublished ? ' active' : ''}`}
            onClick={() => setShowPublished(!showPublished)}
          >
            {pub.published ? 'Published ✓' : 'Publish'}
          </button>
          <button
            className="btn btn-ghost btn-md"
            disabled={!hasDraft}
            onClick={handleExportDraft}
          >
            <DownloadIcon /> Export
          </button>
          <button
            className={`btn btn-primary btn-md${recentlySaved ? ' saved' : ''}`}
            disabled={!hasDraft || !dirty || saving}
            onClick={save}
          >
            {saveLabel}
          </button>
          {saveError && <span className="save-error">{saveError}</span>}
        </div>
      </div>

      {/* ── Main content: editor + tabbed panel ────────── */}
      {hasDraft ? (
        <div className="draft-panes">
          <div className="draft-editor">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              spellCheck={false}
              aria-label="Draft editor"
            />
          </div>

          <div className="draft-right-panel">
            <div className="panel-tabs">
              {RIGHT_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  className={`panel-tab${rightTab === key ? ' active' : ''}`}
                  onClick={() => setRightTab(key)}
                >
                  {label}
                  {key === 'review' && !reviewPass && <span className="tab-dot" />}
                  {key === 'links' && links?.results?.length > 0 && (
                    <span className="tab-count">{links.results.length}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="panel-content">
              {rightTab === 'critique' && (
                <CritiquePanel data={editorialDraft.data} loading={editorialDraft.loading} error={editorialDraft.error} />
              )}
              {rightTab === 'preview' && (
                <div className="draft-preview">
                  <Markdown components={components}>{debouncedDraft}</Markdown>
                </div>
              )}
              {rightTab === 'review' && (
                <ReviewPanel review={review} evaluate={evaluate} />
              )}
              {rightTab === 'links' && (
                <LinksPanel links={links} />
              )}
              {rightTab === 'chat' && (
                <InlineDraftChat chat={chat} draft={draft} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="draft-panes">
          <div className="draft-empty-state">No draft found for week {week}</div>
        </div>
      )}

      {/* ── Below-content panels ───────────────────────── */}
      {showPublished && (
        <PublishedPanel week={week} pub={pub} draft={draft} excl={excl} />
      )}

      <OverlapPanel
        open={showOverlap && !!(overlap.results || overlap.error)}
        results={overlap.results}
        stats={overlap.stats}
        error={overlap.error}
        onClose={() => setShowOverlap(false)}
      />
    </div>
  )
}

// ── AI Critique Panel ──────────────────────────────────────

function CritiquePanel({ data, loading, error }) {
  if (loading) return <div className="panel-placeholder">Loading editorial draft...</div>

  if (error) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon">⚠</div>
        <p>Failed to load critique</p>
        <p className="placeholder-detail">{error}</p>
      </div>
    )
  }

  if (!data?.critique) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon">✎</div>
        <p>No AI critique available</p>
        <p className="placeholder-detail">
          Critique data will appear here after the editorial DRAFT pipeline stage runs.
        </p>
      </div>
    )
  }

  const { critique, metrics } = data
  const models = critique.models || []
  const summary = critique.summary || {}

  return (
    <div className="critique-panel">
      <div className="critique-summary">
        <span className="critique-stats">
          {summary.accepted || 0} accepted · {summary.rejected || 0} rejected
        </span>
        <span className={`critique-verdict ${(summary.verdict || '').toLowerCase()}`}>
          {summary.verdict || 'PENDING'}
        </span>
      </div>

      <div className="critique-models">
        {models.map((model, mi) => (
          <div key={mi} className="critique-model">
            <h4>{model.name}</h4>
            {(model.points || []).map((point, pi) => (
              <div key={pi} className={`critique-point ${point.status || 'pending'}`}>
                {point.passage && (
                  <blockquote className="critique-passage">{point.passage}</blockquote>
                )}
                <p className="critique-text">{point.critique}</p>
                <span className={`critique-status-badge ${point.status}`}>
                  {point.status === 'accepted' ? '✓ Accepted' : point.status === 'rejected' ? '✗ Rejected' : '· Pending'}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {metrics && (
        <div className="critique-metrics">
          <h4>Quality metrics</h4>
          <div className="metrics-grid">
            {Object.entries(metrics).map(([key, value]) => (
              <div key={key} className="metric-item">
                <span className="metric-label">{key.replace(/_/g, ' ')}</span>
                <span className="metric-value">
                  {typeof value === 'number' ? value.toFixed(1) : String(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review Panel ───────────────────────────────────────────

function ReviewPanel({ review, evaluate }) {
  if (!review && !evaluate) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon">◉</div>
        <p>No review data available</p>
        <p className="placeholder-detail">
          Review results appear after the pipeline review stage completes.
        </p>
      </div>
    )
  }

  const issues = review?.prohibited_found || []
  const pass = review?.overall_pass ?? true

  return (
    <div className="review-panel">
      <div className="review-summary-bar">
        <span className={`review-verdict-badge ${pass ? 'pass' : 'fail'}`}>
          {pass ? '✓ Pass' : `✗ ${issues.length} issue${issues.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {issues.length > 0 && (
        <div className="review-issues-list">
          <h4>Prohibited terms</h4>
          {issues.map((issue, i) => (
            <div key={i} className="review-issue-item">
              <span className="review-term-badge">{issue.term}</span>
              {issue.context && <span className="review-context">{issue.context}</span>}
            </div>
          ))}
        </div>
      )}

      {evaluate && (
        <div className="review-eval-section">
          <h4>Evaluation</h4>
          <pre className="eval-json">{JSON.stringify(evaluate, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

// ── Links Panel ────────────────────────────────────────────

function LinksPanel({ links }) {
  if (!links?.results || links.results.length === 0) {
    return (
      <div className="panel-placeholder">
        <div className="placeholder-icon">⊘</div>
        <p>No link data available</p>
        <p className="placeholder-detail">
          Link verification results appear after the pipeline link-check stage.
        </p>
      </div>
    )
  }

  const okCount = links.results.filter(l => l.status === 'ok').length
  const deadCount = links.results.length - okCount

  return (
    <div className="links-panel">
      <div className="links-summary-bar">
        <span className="links-ok-count">{okCount} OK</span>
        {deadCount > 0 && <span className="links-dead-count">{deadCount} broken</span>}
      </div>

      <div className="links-list">
        {links.results.map((link, i) => (
          <div key={i} className={`link-item ${link.status === 'ok' ? 'ok' : 'dead'}`}>
            <span className="link-status-dot">{link.status === 'ok' ? '✓' : '✗'}</span>
            <div className="link-detail">
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="link-url-text">
                {truncateUrl(link.url)}
              </a>
              <span className="link-response-meta">
                {link.httpStatus} · {link.responseTimeMs}ms
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function truncateUrl(url) {
  if (!url || url.length <= 55) return url
  return url.slice(0, 55) + '\u2026'
}

// ── Inline Draft Chat ──────────────────────────────────────

function InlineDraftChat({ chat, draft }) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages])

  const handleSend = () => {
    if (!input.trim() || chat.sending) return
    chat.sendMessage(input, draft)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="inline-chat">
      {chat.error && <div className="inline-chat-error">{chat.error}</div>}

      <div className="inline-chat-messages">
        {chat.messages.length === 0 && (
          <div className="inline-chat-empty">
            Ask about the current draft. The assistant can see your markdown.
          </div>
        )}
        {chat.messages.map(msg => (
          <div key={msg.id} className={`inline-chat-msg ${msg.role}`}>
            {msg.role === 'assistant' ? (
              <Markdown>{msg.content || '\u200B'}</Markdown>
            ) : (
              <p>{msg.content}</p>
            )}
            {msg.role === 'assistant' && msg.content && (
              <div className="inline-chat-msg-footer">
                <span className="inline-chat-model-badge">
                  {msg.model?.includes('opus') ? 'O' : 'S'}
                </span>
                {msg.usage && (
                  <span className="token-count">
                    {msg.usage.input_tokens + msg.usage.output_tokens} tok
                  </span>
                )}
                <button className="inline-chat-btn-pin" onClick={() => chat.pinMessage(msg.id)}>Pin</button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="inline-chat-input-bar">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the draft..."
          aria-label="Chat message"
          rows={1}
        />
        <div className="inline-chat-controls">
          <div className="inline-model-toggle">
            <button
              className={chat.model.includes('sonnet') ? 'active' : ''}
              onClick={() => chat.setModel('claude-sonnet-4-20250514')}
            >S</button>
            <button
              className={chat.model.includes('opus') ? 'active' : ''}
              onClick={() => chat.setModel('claude-opus-4-6')}
            >O</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={chat.clearMessages}>Clear</button>
          {chat.sending ? (
            <button className="btn btn-danger btn-sm" onClick={chat.cancelStream}>Stop</button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={!input.trim()} onClick={handleSend}>Send</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Published Panel ────────────────────────────────────────

function PublishedPanel({ week, pub, draft, excl }) {
  const [publishError, setPublishError] = useState(null)
  const [justPublished, setJustPublished] = useState(false)

  const isPublished = !!pub.published

  async function handlePublish() {
    if (!draft?.trim()) return
    setPublishError(null)
    setJustPublished(false)
    const result = await pub.save(draft)
    if (result.ok) {
      setJustPublished(true)
      setTimeout(() => setJustPublished(false), 3000)
    } else {
      setPublishError(result.error || 'Failed to publish')
    }
  }

  if (pub.loading) return <div className="published-panel"><div className="panel-placeholder">Loading...</div></div>

  return (
    <div className="published-panel">
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
              className="btn btn-primary btn-md"
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

      {isPublished && (
        <div className="exclusions-step">
          <div className="exclusions-step-header">
            <h3>Step 2: Extract off-limits entries</h3>
            {excl.entries && <span className="exclusions-count">{excl.entries.length} entries</span>}
          </div>

          <div className="exclusions-actions">
            <button
              className="btn btn-secondary btn-md"
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
                <button className="btn btn-ghost btn-sm" onClick={excl.addEntry}>+ Add entry</button>
              </div>

              <div className="exclusions-save-row">
                <button
                  className="btn btn-primary btn-md"
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

// ── Overlap Panel ──────────────────────────────────────────

function OverlapPanel({ open, results, stats, error, onClose }) {
  const durationLabel = stats?.durationMs != null
    ? ` · Checked in ${(stats.durationMs / 1000).toFixed(1)}s`
    : ''
  const editionCount = stats?.archivedWeeks?.length ?? 0

  return (
    <div className={`overlap-panel${open ? ' open' : ''}`}>
      <div className="overlap-panel-header">
        <h3>Overlap check</h3>
        {results && results.length > 0 && (
          <span className="overlap-count">
            {results.length} overlap{results.length !== 1 ? 's' : ''} across {editionCount} edition{editionCount !== 1 ? 's' : ''}{durationLabel}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>

      <div className="overlap-body">
        {error && (
          <div className="overlap-error">{error}</div>
        )}

        {!error && stats?.tier2FailedCount > 0 && (
          <div className="overlap-warning">
            {stats.tier2FailedCount} of {stats.tier2CheckedCount} comparison{stats.tier2CheckedCount !== 1 ? 's' : ''} failed — results may be incomplete. Try running the check again.
          </div>
        )}

        {!error && (!results || results.length === 0) && (
          <div className="overlap-empty">No overlapping content detected across {editionCount} edition{editionCount !== 1 ? 's' : ''}{durationLabel}.</div>
        )}

        {!error && results && results.length > 0 && (
          <div className="overlap-results">
            {results.map((r, i) => (
              <div key={i} className="overlap-result">
                <div className="overlap-result-header">
                  <span className="overlap-current-heading">{r.currentHeading}</span>
                  <span className={`overlap-confidence ${confidenceLevel(r.tier2Confidence)}`}>
                    {Math.round(r.tier2Confidence * 100)}%
                  </span>
                </div>
                <div className="overlap-matched">
                  Matches: <strong>{r.archivedHeading}</strong> (week {r.archivedWeek})
                </div>
                {r.explanation && (
                  <div className="overlap-explanation">{r.explanation}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function confidenceLevel(confidence) {
  if (confidence == null) return ''
  if (confidence >= 0.85) return 'high'
  if (confidence >= 0.7) return 'medium'
  return 'low'
}

// ── Highlight utilities ────────────────────────────────────

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
