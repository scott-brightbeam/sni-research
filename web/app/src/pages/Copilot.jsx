import { useState, useEffect, useRef, useMemo } from 'react'
import Markdown from 'react-markdown'
import { useChat } from '../hooks/useChat'
import { apiFetch } from '../lib/api'
import './Copilot.css'

export default function Copilot() {
  const [week, setWeek] = useState(null)
  const [availableWeeks, setAvailableWeeks] = useState([])
  const [input, setInput] = useState('')
  const [showArticlePicker, setShowArticlePicker] = useState(false)
  const [articles, setArticles] = useState([])
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Load available weeks from status
  useEffect(() => {
    apiFetch('/api/status').then(status => {
      const weeks = status.availableWeeks || []
      setAvailableWeeks(weeks)
      if (weeks.length > 0) setWeek(weeks[weeks.length - 1])
    }).catch(() => {})
  }, [])

  const chat = useChat(week)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages])

  // Load articles for picker
  useEffect(() => {
    if (!week) return
    apiFetch(`/api/articles?week=${week}`).then(setArticles).catch(() => {})
  }, [week])

  // Week nav
  const weekIdx = availableWeeks.indexOf(week)
  const hasPrev = weekIdx > 0
  const hasNext = weekIdx < availableWeeks.length - 1

  const handleSend = () => {
    if (!input.trim() || chat.sending) return
    chat.sendMessage(input)
    setInput('')
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleArticleSelect = (article) => {
    chat.setArticleRef({ date: article.date, sector: article.sector, slug: article.slug })
    setShowArticlePicker(false)
  }

  // Usage percentage
  const usagePct = chat.dailyUsage
    ? ((chat.dailyUsage.inputTokens + chat.dailyUsage.outputTokens) / chat.dailyUsage.ceiling * 100)
    : 0

  if (!week) return <div className="loading">Loading...</div>

  return (
    <div className="copilot-page">
      <div className="copilot-toolbar">
        <h2>Co-pilot</h2>
        <div className="week-nav">
          <button disabled={!hasPrev} onClick={() => setWeek(availableWeeks[weekIdx - 1])}>&#9664;</button>
          <span>Week {week}</span>
          <button disabled={!hasNext} onClick={() => setWeek(availableWeeks[weekIdx + 1])}>&#9654;</button>
        </div>
        {chat.dailyUsage && (
          <div className="usage-display">
            <div className="usage-bar">
              <div
                className={`usage-bar-fill${usagePct >= 80 ? ' warning' : ''}`}
                style={{ width: `${Math.min(usagePct, 100)}%` }}
              />
            </div>
            <span>{Math.round(usagePct)}% daily</span>
          </div>
        )}
      </div>

      {chat.error && <div className="chat-error">{chat.error}</div>}

      <div className="copilot-body">
        <div className="thread-sidebar">
          <div className="thread-sidebar-header">
            <span>Threads</span>
            <button className="btn-new-thread" onClick={() => chat.createThread()}>New</button>
          </div>
          <div className="thread-list">
            {chat.threads.map(t => (
              <button
                key={t.id}
                className={`thread-item${chat.activeThread === t.id ? ' active' : ''}`}
                onClick={() => chat.selectThread(t.id)}
              >
                <span className="thread-item-name">{t.name}</span>
                <span className="thread-item-meta">{t.messageCount} msgs</span>
              </button>
            ))}
            {chat.threads.length === 0 && (
              <div className="chat-empty chat-empty-sm">
                No threads yet
              </div>
            )}
          </div>
        </div>

        <div className="chat-area">
          {!chat.activeThread ? (
            <div className="chat-empty">Select or create a thread to start chatting</div>
          ) : (
            <>
              <div className="message-list">
                {chat.messages.map(msg => (
                  <div key={msg.id} className={`message ${msg.role}`}>
                    {msg.role === 'assistant' ? (
                      <Markdown>{msg.content || '\u200B'}</Markdown>
                    ) : (
                      <p>{msg.content}</p>
                    )}
                    <div className="message-footer">
                      <span className="model-badge">
                        {msg.model?.includes('opus') ? 'O' : 'S'}
                      </span>
                      {msg.usage && (
                        <span>{msg.usage.input_tokens + msg.usage.output_tokens} tok</span>
                      )}
                      {msg.role === 'assistant' && msg.content && (
                        <span className="message-actions">
                          <button className="btn-pin" onClick={() => chat.pinMessage(msg.id)}>Pin</button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>

              <div className="chat-input-bar">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about this week's articles..."
                  rows={1}
                />
                <div className="chat-input-controls">
                  <div className="article-picker">
                    <button
                      className={`btn-article-ref${chat.articleRef ? ' active' : ''}`}
                      onClick={() => setShowArticlePicker(p => !p)}
                      title={chat.articleRef ? `Attached: ${chat.articleRef.slug}` : 'Attach article'}
                    >
                      {chat.articleRef ? chat.articleRef.slug.slice(0, 12) : '@'}
                    </button>
                    {showArticlePicker && (
                      <div className="article-picker-dropdown">
                        {articles.map(a => (
                          <button
                            key={`${a.date}-${a.sector}-${a.slug}`}
                            className="article-picker-item"
                            onClick={() => handleArticleSelect(a)}
                          >
                            {a.title}
                            <span className="article-picker-item-sector"> {a.sector}</span>
                          </button>
                        ))}
                        {articles.length === 0 && (
                          <div className="picker-empty">
                            No articles this week
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="model-toggle">
                    <button
                      className={chat.model.includes('sonnet') ? 'active' : ''}
                      onClick={() => chat.setModel('claude-sonnet-4-20250514')}
                    >S</button>
                    <button
                      className={chat.model.includes('opus') ? 'active' : ''}
                      onClick={() => chat.setModel('claude-opus-4-20250512')}
                    >O</button>
                  </div>

                  {chat.sending ? (
                    <button className="btn-stop" onClick={chat.cancelStream}>Stop</button>
                  ) : (
                    <button className="btn-send" disabled={!input.trim()} onClick={handleSend}>Send</button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
