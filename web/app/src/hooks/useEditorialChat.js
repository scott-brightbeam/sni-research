import { useState, useRef, useCallback, useEffect } from 'react'
import { apiStream } from '../lib/api'

let nextId = 1

/**
 * Hook for editorial contextual chat with SSE streaming.
 * Similar pattern to useChat but specific to editorial page context.
 *
 * @param {string} tab — current editorial tab for context assembly
 * @returns {{ messages, loading, error, send, clear }}
 */
export function useEditorialChat(tab = 'state') {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const mountedRef = useRef(true)
  const messagesRef = useRef([])
  const loadingRef = useRef(false)

  // Keep refs in sync with state
  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { loadingRef.current = loading }, [loading])

  // Mounted guard + abort cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const send = useCallback(async (text) => {
    const trimmed = text.trim()
    if (!trimmed || loadingRef.current) return

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg = { id: `msg_${nextId++}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const assistantId = `msg_${nextId++}`
    const assistantMsg = { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString() }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setLoading(true)
    setError(null)

    try {
      const res = await apiStream('/api/editorial/chat', {
        message: trimmed,
        tab,
        history: messagesRef.current.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
      }, controller.signal)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!mountedRef.current) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE lines
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue

          let data
          try {
            data = JSON.parse(line.slice(6))
          } catch {
            // Skip unparseable SSE lines only
            continue
          }

          if (data.type === 'delta') {
            fullText += data.text
            if (!mountedRef.current) continue
            setMessages(prev => prev.map(m =>
              m.id === assistantId ? { ...m, content: fullText } : m
            ))
          }

          if (data.type === 'done') {
            if (!mountedRef.current) continue
            setMessages(prev => prev.map(m =>
              m.id === assistantId
                ? { ...m, content: data.text || fullText, contextTokens: data.contextTokens }
                : m
            ))
          }

          if (data.type === 'error') {
            if (!mountedRef.current) continue
            setError(data.error)
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      if (!mountedRef.current) return
      setError(err.message)
      // Remove the empty assistant message on error
      setMessages(prev => prev.filter(m => m.id !== assistantId))
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
      abortRef.current = null
    }
  }, [tab])

  const clear = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setError(null)
    setLoading(false)
  }, [])

  return { messages, loading, error, send, clear }
}
