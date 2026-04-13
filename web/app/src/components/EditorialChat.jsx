import { useState, useRef, useEffect } from 'react'
import { useEditorialChat } from '../hooks/useEditorialChat'
import { formatRelativeTime } from '../lib/format'
import './EditorialChat.css'

const TOOL_LABELS = {
  get_analysis_entry: 'Fetching entry',
  get_theme_detail: 'Fetching theme',
  get_backlog_item: 'Fetching post',
  search_editorial: 'Searching',
}

const TAB_LABELS = {
  state: 'Analysis',
  themes: 'Themes',
  backlog: 'Backlog',
  ideate: 'Ideate',
  draft: 'Draft',
  decisions: 'Notes',
  activity: 'Activity',
  newsletter: 'Newsletter',
  articles: 'Articles',
  podcasts: 'Podcasts',
  flagged: 'Flagged',
}

const SUGGESTIONS = {
  state: [
    'What are the key themes this week?',
    'Which entries have the highest post potential?',
  ],
  themes: [
    'Which themes have the most cross-connections?',
    'Are any themes going stale?',
  ],
  backlog: [
    'Which posts are ready to move to in-progress?',
    'Suggest a fresh angle for the top-priority post.',
  ],
  ideate: [
    'Generate 5 post ideas based on this week\'s strongest themes.',
    'What contrarian angles could we explore from recent podcasts?',
    'Which themes are under-served in the current backlog?',
  ],
  draft: [
    'Draft the top-priority post from the backlog.',
    'Write a quiet-observation post about the enterprise diffusion gap.',
  ],
  decisions: [
    'Summarise recent editorial notes and decisions.',
  ],
  activity: [
    'How much has the pipeline cost this week?',
  ],
  newsletter: [
    'Review the current draft for quality and consistency.',
    'Suggest improvements to the opening section.',
  ],
  articles: [
    'What are the key themes across this week\'s articles?',
    'Which sectors have the most coverage?',
  ],
  podcasts: [
    'Summarise the main stories from this week\'s podcasts.',
    'Which podcast episodes cover similar topics?',
  ],
  flagged: [
    'Why were these articles flagged?',
    'Which flagged articles are most relevant to current themes?',
  ],
}

/**
 * Editorial contextual chat panel — 380px sidebar with streaming AI responses.
 * Receives the current editorial tab to provide tab-specific context.
 */
export default function EditorialChat({ tab, draftRequest, onDraftConsumed }) {
  // Internal chat tab — follows parent tab, but pins to 'draft' independently when a draft request arrives
  const [chatTab, setChatTab] = useState(tab)
  const { messages, loading, error, send, clear, model, setModel, recentThreads, activeThreadId, selectThread, createNewThread } = useEditorialChat(chatTab)
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Sync chatTab with parent tab when user navigates (but not during draft streaming)
  const prevTabRef = useRef(tab)
  useEffect(() => {
    if (tab !== prevTabRef.current) {
      setChatTab(tab)
      prevTabRef.current = tab
    }
  }, [tab])

  // Handle incoming draft requests — pin chat to 'draft' context independently of parent tab
  useEffect(() => {
    if (draftRequest) {
      setChatTab('draft')
      setModel('opus')
      setCollapsed(false)
      const msg = typeof draftRequest === 'string' ? draftRequest : draftRequest?.message
      const refs = draftRequest && typeof draftRequest === 'object' ? draftRequest.sourceRefs : null
      send(msg, refs, 'opus', 'draft')  // pass tab override — setChatTab is async, send's closure captures old tab
      onDraftConsumed?.()  // consume immediately — chatTab stays on 'draft' independently
    }
  }, [draftRequest]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel expands (skip initial mount)
  const wasCollapsedRef = useRef(collapsed)
  useEffect(() => {
    if (wasCollapsedRef.current && !collapsed) {
      inputRef.current?.focus()
    }
    wasCollapsedRef.current = collapsed
  }, [collapsed])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!input.trim() || loading) return
    send(input)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  if (collapsed) {
    return (
      <div className="editorial-chat-collapsed">
        <button
          className="chat-expand-btn"
          onClick={() => setCollapsed(false)}
          title="Open AI chat"
        >
          AI
        </button>
      </div>
    )
  }

  const tabSuggestions = SUGGESTIONS[chatTab] || []

  return (
    <div className="editorial-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <h3>Editorial AI</h3>
          <span className={`chat-context-tag${chatTab === 'draft' ? ' draft-mode' : ''}`}>{TAB_LABELS[chatTab] || chatTab}</span>
        </div>
        <div className="chat-header-actions">
          <button
            className={`model-toggle ${model === 'opus' ? 'model-opus' : 'model-sonnet'}`}
            onClick={() => setModel(m => m === 'sonnet' ? 'opus' : 'sonnet')}
            title={model === 'sonnet' ? 'Switch to Opus' : 'Switch to Sonnet'}
            aria-label={model === 'sonnet' ? 'Switch to Opus' : 'Switch to Sonnet'}
          >
            {model === 'sonnet' ? 'S' : 'O'}
          </button>
          <button className="chat-btn" onClick={clear} title="Clear conversation" aria-label="Clear conversation">
            ↺
          </button>
          <button className="chat-btn" onClick={() => setCollapsed(true)} title="Collapse" aria-label="Collapse chat">
            ▶
          </button>
        </div>
      </div>

      {recentThreads.length > 0 && (
        <div className="ec-recents">
          <div className="ec-recents-header">
            <span>Recents</span>
            <button className="ec-new-chat" onClick={createNewThread} title="New chat">+</button>
          </div>
          <div className="ec-recents-list">
            {recentThreads.slice(0, 15).map(t => (
              <button
                key={t.id}
                className={`ec-recent-item ${t.id === activeThreadId ? 'active' : ''}`}
                onClick={() => selectThread(t.id)}
                title={t.name}
              >
                <span className="ec-recent-name">{t.name}</span>
                <span className="ec-recent-time">{formatRelativeTime(t.updated)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>Ask about {TAB_LABELS[chatTab]?.toLowerCase() || 'editorial state'} — I have full context loaded.</p>
            <div className="chat-suggestions">
              {tabSuggestions.map(text => (
                <Suggestion key={text} text={text} onClick={send} disabled={loading} />
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`chat-message chat-${msg.role}`}>
            <div className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
            {msg.toolCalls?.length > 0 && (
              <div className="tool-calls">
                {msg.toolCalls.map((tc, i) => (
                  <span key={i} className={`tool-indicator ${tc.status}`}>
                    {tc.status === 'running' ? '⟳' : '✓'} {TOOL_LABELS[tc.name] || tc.name}
                  </span>
                ))}
              </div>
            )}
            <div className="message-content">{msg.content || (loading && msg.role === 'assistant' ? '...' : '')}</div>
            {msg.contextTokens && (
              <div className="message-meta">~{msg.contextTokens} context tokens</div>
            )}
          </div>
        ))}

        {error?.status === 503 ? (
          <div className="editorial-chat-error">Chat has moved to Claude Code.</div>
        ) : error ? (
          <div className="editorial-chat-error">{error.message || error}</div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-area" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Ask about ${TAB_LABELS[chatTab]?.toLowerCase() || 'editorial state'}...`}
          rows={2}
          disabled={loading}
        />
        <button type="submit" className="chat-send" disabled={!input.trim() || loading}>
          {loading ? '...' : '→'}
        </button>
      </form>
    </div>
  )
}

function Suggestion({ text, onClick, disabled }) {
  return (
    <button className="chat-suggestion" onClick={() => onClick(text)} disabled={disabled}>
      {text}
    </button>
  )
}
