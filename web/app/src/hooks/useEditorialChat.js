import { useState, useRef, useCallback, useEffect } from 'react'
import { apiStream, readSSEStream } from '../lib/api'

let nextId = 1

/**
 * Hook for editorial contextual chat with SSE streaming.
 * Maintains per-tab conversation threads — switching tabs preserves messages.
 * Context (editorial state) is only injected on the first message per tab.
 *
 * @param {string} tab — current editorial tab for context assembly
 * @returns {{ messages, loading, error, send, clear }}
 */
export function useEditorialChat(tab = 'state') {
  // Map of tab -> messages[]
  const [threads, setThreads] = useState({})
  const [model, setModel] = useState('sonnet')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const abortRef = useRef(null)
  const mountedRef = useRef(true)
  const loadingRef = useRef(false)
  const threadsRef = useRef({})

  // Current tab's messages
  const messages = threads[tab] || []

  // Keep refs in sync with state
  useEffect(() => { threadsRef.current = threads }, [threads])
  useEffect(() => { loadingRef.current = loading }, [loading])

  // Mounted guard + abort cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const send = useCallback(async (text, sourceRefs = null) => {
    if (!text) return
    const trimmed = text.trim()
    if (!trimmed || loadingRef.current) return

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const currentThread = threadsRef.current[tab] || []
    const isFirstMessage = currentThread.length === 0

    const userMsg = { id: `msg_${nextId++}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const assistantId = `msg_${nextId++}`
    const assistantMsg = { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString() }

    // Update thread map
    setThreads(prev => ({
      ...prev,
      [tab]: [...(prev[tab] || []), userMsg, assistantMsg]
    }))
    setLoading(true)
    setError(null)

    try {
      const currentHistory = currentThread
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await apiStream('/api/editorial/chat', {
        message: trimmed,
        tab,
        model,
        injectContext: isFirstMessage,
        history: currentHistory,
        ...(sourceRefs ? { sourceRefs } : {}),
      }, controller.signal)

      let fullText = ''

      await readSSEStream(res.body.getReader(), (data) => {
        if (!mountedRef.current) return false

        if (data.type === 'delta') {
          fullText += data.text
          setThreads(prev => ({
            ...prev,
            [tab]: (prev[tab] || []).map(m =>
              m.id === assistantId ? { ...m, content: fullText } : m
            )
          }))
        } else if (data.type === 'done') {
          setThreads(prev => ({
            ...prev,
            [tab]: (prev[tab] || []).map(m =>
              m.id === assistantId
                ? { ...m, content: data.text || fullText, contextTokens: data.contextTokens }
                : m
            )
          }))
        } else if (data.type === 'error') {
          if (mountedRef.current) setError(data.error)
        }
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      if (!mountedRef.current) return
      setError({ message: err.message, status: err.status })
      // Remove the empty assistant message on error
      setThreads(prev => ({
        ...prev,
        [tab]: (prev[tab] || []).filter(m => m.id !== assistantId)
      }))
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
      abortRef.current = null
    }
  }, [tab, model])

  const clear = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setThreads(prev => ({ ...prev, [tab]: [] }))
    setError(null)
    setLoading(false)
  }, [tab])

  return { messages, loading, error, send, clear, model, setModel }
}
