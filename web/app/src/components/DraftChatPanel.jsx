import { useState, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import { useChatPanel } from '../hooks/useChatPanel'
import './DraftChatPanel.css'

export default function DraftChatPanel({ open, onClose, draftContent, week }) {
  const chat = useChatPanel(week)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)
  const textareaRef = useRef(null)

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chat.messages])

  // Focus input when panel opens
  useEffect(() => {
    if (open) textareaRef.current?.focus()
  }, [open])

  const handleSend = () => {
    if (!input.trim() || chat.sending) return
    chat.sendMessage(input, draftContent)
    setInput('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className={`draft-chat-panel${open ? ' open' : ''}`}>
      <div className="panel-header">
        <h3>Draft Assistant</h3>
        <button className="btn-panel-action" onClick={chat.clearMessages}>Clear</button>
        <button className="btn-panel-action" onClick={onClose}>Close</button>
      </div>

      {chat.error && (
        <div className="chat-error panel-chat-error">{chat.error}</div>
      )}

      <div className="panel-messages">
        {chat.messages.length === 0 && (
          <div className="panel-empty">
            Ask about the current draft. The assistant can see your markdown.
          </div>
        )}
        {chat.messages.map(msg => (
          <div key={msg.id} className={`panel-message ${msg.role}`}>
            {msg.role === 'assistant' ? (
              <Markdown>{msg.content || '\u200B'}</Markdown>
            ) : (
              <p>{msg.content}</p>
            )}
            {msg.role === 'assistant' && msg.content && (
              <div className="panel-message-footer">
                <span className="model-badge">
                  {msg.model?.includes('opus') ? 'O' : 'S'}
                </span>
                {msg.usage && (
                  <span>{msg.usage.input_tokens + msg.usage.output_tokens} tok</span>
                )}
                <button className="btn-pin" onClick={() => chat.pinMessage(msg.id)}>Pin</button>
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="panel-input-bar">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about the draft..."
          rows={1}
        />
        <div className="panel-input-controls">
          <div className="panel-model-toggle">
            <button
              className={chat.model.includes('sonnet') ? 'active' : ''}
              onClick={() => chat.setModel('claude-sonnet-4-20250514')}
            >S</button>
            <button
              className={chat.model.includes('opus') ? 'active' : ''}
              onClick={() => chat.setModel('claude-opus-4-6')}
            >O</button>
          </div>

          {chat.sending ? (
            <button className="btn-stop" onClick={chat.cancelStream}>Stop</button>
          ) : (
            <button className="btn-send" disabled={!input.trim()} onClick={handleSend}>Send</button>
          )}
        </div>
      </div>
    </div>
  )
}
