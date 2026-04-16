import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Lightweight hook for the sidebar's chat thread list.
 * Fetches recent threads from the API independently of the
 * editorial chat component. Polls every 30s to stay fresh.
 */
export function useChatThreads() {
  const [threads, setThreads] = useState([])

  const refresh = useCallback(() => {
    apiFetch('/api/editorial/chat/threads')
      .then(setThreads)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  return { threads, refresh }
}
