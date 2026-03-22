import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'

/**
 * Hook for fetching editorial state data.
 * Returns { data, loading, error } following project convention.
 *
 * @param {string} section — one of: null (summary), analysisIndex, themeRegistry, postBacklog, decisionLog
 * @param {object} [filters] — optional filters (priority, status, format for backlog; active, stale for themes)
 */
export function useEditorialState(section = null, filters = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let url = '/api/editorial/state'
      const params = new URLSearchParams()
      if (section) params.set('section', section)
      for (const [k, v] of Object.entries(filters)) {
        if (v != null && v !== '') params.set(k, v)
      }
      const qs = params.toString()
      if (qs) url += `?${qs}`

      const res = await apiFetch(url)
      if (!mountedRef.current) return

      if (res.error) {
        setError(res.error)
        setData(null)
      } else {
        setData(res)
        setError(null)
      }
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
      setData(null)
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [section, JSON.stringify(filters)])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    return () => { mountedRef.current = false }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

/**
 * Hook for editorial activity log.
 * @param {number} [limit=20] — max entries
 */
export function useEditorialActivity(limit = 20) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/editorial/activity?limit=${limit}`)
      if (!mountedRef.current) return
      setData(res.activities || [])
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
      setData([])
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [limit])

  useEffect(() => {
    mountedRef.current = true
    fetchData()
    return () => { mountedRef.current = false }
  }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

/**
 * Hook for editorial search.
 * @param {string} query — search term (empty string = no search)
 */
export function useEditorialSearch(query) {
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!query || query.trim().length < 2) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    apiFetch(`/api/editorial/search?q=${encodeURIComponent(query.trim())}`)
      .then(res => {
        if (!mountedRef.current) return
        setResults(res.results || [])
        setLoading(false)
      })
      .catch(err => {
        if (!mountedRef.current) return
        setResults([])
        setError(err.message)
        setLoading(false)
      })

    return () => { mountedRef.current = false }
  }, [query])

  return { results, loading, error }
}

/**
 * Hook for editorial cost data.
 * @param {string} [week] — specific week key (e.g. '2026-W12'), or null for latest
 */
export function useEditorialCost(week = null) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    setError(null)

    const url = week ? `/api/editorial/cost?week=${week}` : '/api/editorial/cost'
    apiFetch(url)
      .then(res => {
        if (!mountedRef.current) return
        setData(res)
        setError(null)
        setLoading(false)
      })
      .catch(err => {
        if (!mountedRef.current) return
        setError(err.message)
        setData(null)
        setLoading(false)
      })

    return () => { mountedRef.current = false }
  }, [week])

  return { data, loading, error }
}
