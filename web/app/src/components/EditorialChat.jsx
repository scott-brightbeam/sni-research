import { useState, useRef, useEffect } from 'react'
import { useEditorialChat } from '../hooks/useEditorialChat'
import './EditorialChat.css'

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
  const { messages, loading, error, send, clear, model, setModel } = useEditorialChat(tab)
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Handle incoming draft requests
  useEffect(() => {
    if (draftRequest) {
      setModel('opus')
      setCollapsed(false)
      send(draftRequest)
      onDraftConsumed?.()
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

  const tabSuggestions = SUGGESTIONS[tab] || []

  return (
    <div className="editorial-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <h3>Editorial AI</h3>
          <span className="chat-context-tag">{TAB_LABELS[tab] || tab}</span>
        </div>
        <div className="chat-header-actions">
          <button
            className={`model-toggle ${model === 'opus' ? 'model-opus' : 'model-sonnet'}`}
            onClick={() => setModel(m => m === 'sonnet' ? 'opus' : 'sonnet')}
            title={model === 'sonnet' ? 'Switch to Opus' : 'Switch to Sonnet'}
          >
            {model === 'sonnet' ? 'S' : 'O'}
          </button>
          <button className="chat-btn" onClick={clear} title="Clear conversation">
            ↺
          </button>
          <button className="chat-btn" onClick={() => setCollapsed(true)} title="Collapse">
            ▶
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>Ask about {TAB_LABELS[tab]?.toLowerCase() || 'editorial state'} — I have full context loaded.</p>
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
            <div className="message-content">{msg.content || (loading && msg.role === 'assistant' ? '...' : '')}</div>
            {msg.contextTokens && (
              <div className="message-meta">~{msg.contextTokens} context tokens</div>
            )}
          </div>
        ))}

        {error?.status === 503 ? (
          <div className="editorial-chat-error migration-banner">Chat has moved to Claude Code.</div>
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
          placeholder={`Ask about ${TAB_LABELS[tab]?.toLowerCase() || 'editorial state'}...`}
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
