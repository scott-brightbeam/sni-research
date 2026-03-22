import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Hook for fetching editorial notifications (post candidates, alerts).
 * Polls at a configurable interval.
 *
 * @param {number} pollIntervalMs — polling interval in ms (default 60s)
 * @returns {{ notifications, loading, error, dismiss, refetch }}
 */
export function useNotifications(pollIntervalMs = 60000) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const data = await apiFetch('/api/editorial/notifications')
      if (!mountedRef.current) return
      setNotifications(data.notifications || data || [])
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Poll for new notifications
  useEffect(() => {
    if (!pollIntervalMs) return
    const interval = setInterval(load, pollIntervalMs)
    return () => clearInterval(interval)
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
