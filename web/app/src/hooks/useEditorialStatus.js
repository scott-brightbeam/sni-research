import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch, apiPost } from '../lib/api'

/**
 * Hook for polling editorial pipeline status (lock files + progress).
 * Polls every `interval` ms while any stage is running, otherwise every 10s.
 *
 * Uses setTimeout chaining (not setInterval) so the polling interval
 * adapts naturally when lock state changes without tearing down the effect.
 *
 * Returns { status, loading, error, trigger, refetch }
 * - status.locks: { analyse: bool, discover: bool, draft: bool }
 * - status.progress: { [stage]: { pid, startedAt, current, total } }
 * - trigger(stage): fires POST /api/editorial/trigger/{stage}, returns { ok, error }
 *
 * @param {number} [interval=3000] — polling interval in ms when a stage is running
 */
export function useEditorialStatus(interval = 3000) {
  const [status, setStatus] = useState({ locks: {}, progress: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const timerRef = useRef(null)
  const statusRef = useRef(status)

  // Keep a ref in sync so the timeout callback reads the latest value
  statusRef.current = status

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch('/api/editorial/status')
      if (!mountedRef.current) return
      setStatus(res)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    fetchStatus()

    // setTimeout chaining — adapts interval based on current lock state
    function scheduleNext() {
      const anyRunning = Object.values(statusRef.current.locks || {}).some(Boolean)
      const pollMs = anyRunning ? interval : 10000
      timerRef.current = setTimeout(async () => {
        await fetchStatus()
        if (mountedRef.current) scheduleNext()
      }, pollMs)
    }
    scheduleNext()

    // Force a fresh fetch on tab visibility — background tab throttling can
    // stretch setTimeout delays to several minutes, leaving the UI out of date.
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchStatus()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchStatus, interval])

  const trigger = useCallback(async (stage) => {
    // Optimistic lock update — prevents double-click spawning duplicate processes
    setStatus(prev => ({
      ...prev,
      locks: { ...prev.locks, [stage]: true },
    }))
    try {
      const res = await apiPost(`/api/editorial/trigger/${stage}`)
      // Refetch to get real lock state from server
      fetchStatus()
      return res
    } catch (err) {
      // Revert optimistic update on failure
      fetchStatus()
      return { ok: false, error: err.message, status: err.status }
    }
  }, [fetchStatus])

  return { status, loading, error, trigger, refetch: fetchStatus }
}
