import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiStream, readSSEStream } from '../lib/api'

export function useChat(week) {
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [articleRef, setArticleRef] = useState(null)
  const [podcastRef, setPodcastRef] = useState(null)
  const [dailyUsage, setDailyUsage] = useState(null)
  const abortRef = useRef(null)

  // Load threads for the week
  const loadThreads = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/chat/threads?week=${week}`)
      setThreads(data)
    } catch (err) {
      setError(err.message)
    }
  }, [week])

  // Load usage
  const loadUsage = useCallback(async () => {
    try {
      const data = await apiFetch('/api/chat/usage?period=today')
      setDailyUsage(data)
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadUsage() }, [loadUsage])

  // Create a new thread
  const createThread = useCallback(async (name) => {
    try {
      const data = await apiFetch('/api/chat/threads', {
        method: 'POST',
        body: JSON.stringify({ week, name }),
      })
      await loadThreads()
      setActiveThread(data.id)
      setMessages([])
      return data
    } catch (err) {
      setError(err.message)
    }
  }, [week, loadThreads])

  // Select a thread and load its history
  const selectThread = useCallback(async (threadId) => {
    setActiveThread(threadId)
    setMessages([])
    try {
      const data = await apiFetch(`/api/chat/history?week=${week}&thread=${threadId}`)
      setMessages(data)
    } catch (err) {
      setError(err.message)
    }
  }, [week])

  // Rename a thread
  const renameThread = useCallback(async (threadId, name) => {
    try {
      await apiFetch(`/api/chat/threads?id=${threadId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      await loadThreads()
    } catch (err) {
      setError(err.message)
    }
  }, [loadThreads])

  // Send a message (SSE streaming)
  const sendMessage = useCallback(async (text) => {
    if (sending || !text.trim()) return
    setSending(true)
    setError(null)

    // Add user message to UI immediately
    const userMsg = { id: `local_${Date.now()}`, role: 'user', content: text, model, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    // Prepare streaming assistant message
    const assistantId = `local_${Date.now() + 1}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', model, timestamp: new Date().toISOString(), usage: null }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await apiStream('/api/chat', {
        message: text,
        model,
        threadId: activeThread,
        ephemeral: false,
        week,
        articleRef,
        podcastRef,
      }, controller.signal)

      await readSSEStream(res.body.getReader(), (data) => {
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
      })

      // Clear refs after sending
      setArticleRef(null)
      setPodcastRef(null)
      // Reload threads (to get updated stats) and usage
      await loadThreads()
      await loadUsage()
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }, [sending, model, activeThread, week, articleRef, podcastRef, loadThreads, loadUsage])

  // Cancel streaming
  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      setSending(false)
    }
  }, [])

  // Pin a message
  const pinMessage = useCallback(async (messageId) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      await apiFetch('/api/chat/pin', {
        method: 'POST',
        body: JSON.stringify({
          week,
          threadId: activeThread,
          messageId,
          text: msg.content,
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [messages, week, activeThread])

  return {
    threads, activeThread, messages, sending, error, model, articleRef, podcastRef, dailyUsage,
    setModel, setArticleRef, setPodcastRef, sendMessage, cancelStream, createThread, selectThread,
    renameThread, pinMessage, loadUsage,
  }
}
