import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Hook for fetching podcast episodes from the API.
 * Optionally filters by editorial week number.
 *
 * @param {number|null} week — filter by week number (null/undefined for all)
 * @returns {{ episodes, lastRun, loading, error, refetch }}
 */
export function usePodcasts(week = null) {
  const [episodes, setEpisodes] = useState([])
  const [lastRun, setLastRun] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = week != null ? `?week=${week}` : ''
      const data = await apiFetch(`/api/podcasts${qs}`)
      if (!mountedRef.current) return
      setEpisodes(data.episodes || [])
      setLastRun(data.lastRun || null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [week])

  useEffect(() => { load() }, [load])

  return { episodes, lastRun, loading, error, refetch: load }
}
