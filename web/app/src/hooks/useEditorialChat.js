import { useState, useRef, useCallback } from 'react'

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

  const send = useCallback(async (text) => {
    if (!text.trim() || loading) return

    // Abort any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const userMsg = { role: 'user', content: text.trim(), timestamp: new Date().toISOString() }
    const assistantMsg = { role: 'assistant', content: '', timestamp: new Date().toISOString() }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/editorial/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          tab,
          history: messages.filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE lines
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'delta') {
              fullText += data.text
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: fullText,
                }
                return updated
              })
            }

            if (data.type === 'done') {
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: data.text || fullText,
                  contextTokens: data.contextTokens,
                }
                return updated
              })
            }

            if (data.type === 'error') {
              setError(data.error)
            }
          } catch {
            // Skip unparseable SSE lines
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message)
      // Remove the empty assistant message on error
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }, [tab, messages, loading])

  const clear = useCallback(() => {
    if (abortRef.current) abortRef.current.abort()
    setMessages([])
    setError(null)
    setLoading(false)
  }, [])

  return { messages, loading, error, send, clear }
}
