import { useState, useRef, useEffect } from 'react'
import { useEditorialChat } from '../hooks/useEditorialChat'
import './EditorialChat.css'

const TAB_LABELS = {
  state: 'Analysis',
  themes: 'Themes',
  backlog: 'Backlog',
  decisions: 'Decisions',
  activity: 'Activity',
}

/**
 * Editorial contextual chat panel — 380px sidebar with streaming AI responses.
 * Receives the current editorial tab to provide tab-specific context.
 */
export default function EditorialChat({ tab, isOpen, onClose }) {
  const { messages, loading, error, send, clear } = useEditorialChat(tab)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

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

  if (!isOpen) return null

  return (
    <div className="editorial-chat">
      <div className="chat-header">
        <div className="chat-header-left">
          <h3>Editorial AI</h3>
          <span className="chat-context-tag">{TAB_LABELS[tab] || tab}</span>
        </div>
        <div className="chat-header-actions">
          <button className="chat-btn" onClick={clear} title="Clear conversation">
            ↺
          </button>
          <button className="chat-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>Ask about {TAB_LABELS[tab]?.toLowerCase() || 'editorial state'} — I have full context loaded.</p>
            <div className="chat-suggestions">
              {tab === 'state' && <Suggestion text="What are the key themes this week?" onClick={send} />}
              {tab === 'state' && <Suggestion text="Which entries have the highest post potential?" onClick={send} />}
              {tab === 'themes' && <Suggestion text="Which themes have the most cross-connections?" onClick={send} />}
              {tab === 'themes' && <Suggestion text="Are any themes going stale?" onClick={send} />}
              {tab === 'backlog' && <Suggestion text="Which posts are ready to move to in-progress?" onClick={send} />}
              {tab === 'backlog' && <Suggestion text="Suggest a fresh angle for the top-priority post." onClick={send} />}
              {tab === 'decisions' && <Suggestion text="Summarise recent editorial decisions." onClick={send} />}
              {tab === 'activity' && <Suggestion text="How much has the pipeline cost this week?" onClick={send} />}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-${msg.role}`}>
            <div className="message-role">{msg.role === 'user' ? 'You' : 'AI'}</div>
            <div className="message-content">{msg.content || (loading && i === messages.length - 1 ? '...' : '')}</div>
            {msg.contextTokens && (
              <div className="message-meta">~{msg.contextTokens} context tokens</div>
            )}
          </div>
        ))}

        {error && (
          <div className="chat-error">{error}</div>
        )}

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

function Suggestion({ text, onClick }) {
  return (
    <button className="chat-suggestion" onClick={() => onClick(text)}>
      {text}
    </button>
  )
}
