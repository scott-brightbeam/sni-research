import { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../lib/api.js'

export function useOverlapCheck(week) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const check = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await apiFetch(`/api/draft/check-overlap?week=${week}`, { method: 'POST' })
      if (mountedRef.current) {
        setResults(response.overlaps || [])
        setStats({
          archivedWeeks: response.archivedWeeks || [],
          durationMs: response.durationMs ?? null,
          tier2FailedCount: response.tier2FailedCount ?? 0,
          tier2CheckedCount: response.tier2CheckedCount ?? 0,
        })
      }
    } catch (err) {
      if (mountedRef.current) setError(err.message)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }

  return { check, loading, results, stats, error }
}
