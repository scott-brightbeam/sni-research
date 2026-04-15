import { useState, useRef, useCallback, useEffect } from 'react'
import { apiFetch, apiStream, readSSEStream } from '../lib/api'

let nextId = 1

/**
 * Hook for editorial contextual chat with SSE streaming and thread persistence.
 * Maintains per-tab conversation threads — switching tabs preserves messages.
 * Context (editorial state) is only injected on the first message per tab.
 * Threads persist to disk via the editorial chat API.
 *
 * @param {string} tab — current editorial tab for context assembly
 * @returns {{ messages, loading, error, send, clear, model, setModel, recentThreads, activeThreadId, selectThread, createNewThread }}
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

  // Persistent thread management
  const [recentThreads, setRecentThreads] = useState([])
  const [activeThreadId, setActiveThreadId] = useState(null)
  const activeThreadIdRef = useRef(null)

  // Current tab's messages
  const messages = threads[tab] || []

  // Keep refs in sync with state
  useEffect(() => { threadsRef.current = threads }, [threads])
  useEffect(() => { loadingRef.current = loading }, [loading])
  useEffect(() => { activeThreadIdRef.current = activeThreadId }, [activeThreadId])

  // Load recent threads on mount
  useEffect(() => {
    apiFetch('/api/editorial/chat/threads')
      .then(setRecentThreads)
      .catch(() => {})
  }, [])

  // Mounted guard + abort cleanup on unmount
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  // Select a thread — load its history into the CURRENT tab
  const selectThread = useCallback(async (threadId) => {
    try {
      const history = await apiFetch(`/api/editorial/chat/history/${threadId}`)
      setActiveThreadId(threadId)
      // Load into current tab so messages render immediately
      setThreads(prev => ({
        ...prev,
        [tab]: history,
      }))
    } catch (err) {
      console.error('Failed to load thread:', err)
    }
  }, [tab])

  // Create new thread (clear current conversation)
  const createNewThread = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setActiveThreadId(null)
    setThreads(prev => ({ ...prev, [tab]: [] }))
    setError(null)
    setLoading(false)
  }, [tab])

  const send = useCallback(async (text, sourceRefs = null, modelOverride = null, tabOverride = null) => {
    if (!text || typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed || loadingRef.current) return
    const effectiveModel = modelOverride || model
    const effectiveTab = tabOverride || tab

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const currentThread = threadsRef.current[effectiveTab] || []
    const isFirstMessage = currentThread.length === 0

    const userMsg = { id: `msg_${nextId++}`, role: 'user', content: trimmed, timestamp: new Date().toISOString() }
    const assistantId = `msg_${nextId++}`
    const assistantMsg = { id: assistantId, role: 'assistant', content: '', timestamp: new Date().toISOString() }

    // Update thread map
    setThreads(prev => ({
      ...prev,
      [effectiveTab]: [...(prev[effectiveTab] || []), userMsg, assistantMsg]
    }))
    setLoading(true)
    setError(null)

    try {
      const currentHistory = currentThread
        .filter(m => m.content)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await apiStream('/api/editorial/chat', {
        message: trimmed,
        tab: effectiveTab,
        model: effectiveModel,
        injectContext: isFirstMessage,
        history: currentHistory,
        threadId: activeThreadIdRef.current || undefined,
        ...(sourceRefs ? { sourceRefs } : {}),
      }, controller.signal)

      let fullText = ''

      await readSSEStream(res.body.getReader(), (data) => {
        if (!mountedRef.current) return false

        if (data.type === 'delta') {
          fullText += data.text
          setThreads(prev => ({
            ...prev,
            [effectiveTab]: (prev[effectiveTab] || []).map(m =>
              m.id === assistantId ? { ...m, content: fullText } : m
            )
          }))
        } else if (data.type === 'tool_call') {
          setThreads(prev => ({
            ...prev,
            [effectiveTab]: (prev[effectiveTab] || []).map(m =>
              m.id === assistantId
                ? { ...m, toolCalls: [...(m.toolCalls || []), { name: data.name, status: 'running' }] }
                : m
            )
          }))
        } else if (data.type === 'warning') {
          // Server-side soft warning (e.g. editorial state unavailable).
          // Surface as a non-blocking note on the assistant message.
          setThreads(prev => ({
            ...prev,
            [effectiveTab]: (prev[effectiveTab] || []).map(m =>
              m.id === assistantId
                ? { ...m, warnings: [...(m.warnings || []), data.message] }
                : m
            )
          }))
        } else if (data.type === 'tool_result') {
          setThreads(prev => ({
            ...prev,
            [effectiveTab]: (prev[effectiveTab] || []).map(m => {
              if (m.id !== assistantId) return m
              const calls = (m.toolCalls || []).map(tc =>
                tc.name === data.name && tc.status === 'running'
                  ? { ...tc, status: 'done', preview: data.preview }
                  : tc
              )
              return { ...m, toolCalls: calls }
            })
          }))
        } else if (data.type === 'done') {
          setThreads(prev => ({
            ...prev,
            [effectiveTab]: (prev[effectiveTab] || []).map(m =>
              m.id === assistantId
                ? { ...m, content: data.text || fullText, contextTokens: data.contextTokens }
                : m
            )
          }))

          // Capture threadId from server and refresh thread list
          if (data.threadId && !activeThreadIdRef.current) {
            setActiveThreadId(data.threadId)
          }
          apiFetch('/api/editorial/chat/threads')
            .then(setRecentThreads)
            .catch(() => {})
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
        [effectiveTab]: (prev[effectiveTab] || []).filter(m => m.id !== assistantId)
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
    setActiveThreadId(null)
    setError(null)
    setLoading(false)
  }, [tab])

  return { messages, loading, error, send, clear, model, setModel, recentThreads, activeThreadId, selectThread, createNewThread }
}
