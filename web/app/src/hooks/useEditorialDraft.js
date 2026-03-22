import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Hook for fetching editorial AI draft data (critique, metrics).
 * Returns { data, loading, error, refetch } following project convention.
 *
 * @param {number|null} [session] — specific session number, or null for latest
 * @returns {{ data: { session, draft, critique, metrics } | null, loading, error, refetch }}
 */
export function useEditorialDraft(session = null) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)
  const abortRef = useRef(null)

  const fetchData = useCallback(async () => {
    // Abort any in-flight request before starting a new one
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    try {
      const url = session != null
        ? `/api/editorial/draft?session=${session}`
        : '/api/editorial/draft'
      const res = await apiFetch(url, { signal: controller.signal })
      if (!mountedRef.current) return
      setData(res)
    } catch (err) {
      if (err.name === 'AbortError') return
      if (!mountedRef.current) return
      // Missing data is not an error — just no editorial draft yet
      if (err.status === 404) {
        setData(null)
      } else {
        setError(err.message)
      }
    } finally {
      if (mountedRef.current && !controller.signal.aborted) setLoading(false)
    }
  }, [session])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}
