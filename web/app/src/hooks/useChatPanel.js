import { useState, useCallback, useRef } from 'react'
import { apiFetch, apiStream } from '../lib/api'

export function useChatPanel(week) {
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [articleRef, setArticleRef] = useState(null)
  const abortRef = useRef(null)

  const sendMessage = useCallback(async (text, draftContent) => {
    if (sending || !text.trim()) return
    setSending(true)
    setError(null)

    const userMsg = { id: `local_${Date.now()}`, role: 'user', content: text, model, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    const assistantId = `local_${Date.now() + 1}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', model, timestamp: new Date().toISOString(), usage: null }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await apiStream('/api/chat', {
        message: text,
        model,
        ephemeral: true,
        draftContext: draftContent || '',
        articleRef,
      }, controller.signal)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'delta') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + data.text } : m
              ))
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, id: data.id, usage: data.usage } : m
              ))
            } else if (data.type === 'error') {
              setError(data.message)
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      setArticleRef(null)
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }, [sending, model, articleRef])

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      setSending(false)
    }
  }, [])

  const pinMessage = useCallback(async (messageId) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      await apiFetch('/api/chat/pin', {
        method: 'POST',
        body: JSON.stringify({
          week,
          threadId: 'ephemeral',
          messageId,
          text: msg.content,
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [messages, week])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages, sending, error, model, articleRef,
    setModel, setArticleRef, sendMessage, cancelStream, pinMessage, clearMessages,
  }
}
