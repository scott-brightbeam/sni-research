import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Hook for fetching editorial notifications (post candidates, alerts).
 * Polls at a configurable interval with backoff on consecutive failures.
 *
 * @param {number} pollIntervalMs — polling interval in ms (0 to disable, default 60s)
 * @returns {{ notifications, loading, error, dismiss, refetch }}
 */
export function useNotifications(pollIntervalMs = 60000) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const failCountRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/editorial/notifications')
      if (!mountedRef.current) return
      const items = Array.isArray(data?.notifications) ? data.notifications
        : Array.isArray(data) ? data
        : []
      setNotifications(items)
      setError(null)
      failCountRef.current = 0
    } catch (err) {
      if (!mountedRef.current) return
      failCountRef.current++
      setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll with automatic stop after 5 consecutive failures
  useEffect(() => {
    if (!pollIntervalMs) return
    const interval = setInterval(() => {
      if (failCountRef.current >= 5) return
      load()
    }, pollIntervalMs)

    // Refetch on tab visibility — background tabs get their timers throttled,
    // so this guarantees fresh notifications the moment the tab regains focus.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        failCountRef.current = 0 // reset failure count so polling resumes
        load()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, pollIntervalMs])

  const dismiss = useCallback(async (id) => {
    try {
      await apiFetch(`/api/editorial/notifications/${id}/dismiss`, {
        method: 'PUT',
      })
      if (!mountedRef.current) return
      setNotifications(prev => prev.filter(n => n.id !== id))
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
    }
  }, [])

  return { notifications, loading, error, dismiss, refetch: load }
}
