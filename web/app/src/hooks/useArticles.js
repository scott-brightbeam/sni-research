import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useArticles(filters = {}) {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const lastFetchTs = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.sector) params.set('sector', filters.sector)
      if (filters.date) params.set('date', filters.date)
      if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
      if (filters.dateTo) params.set('dateTo', filters.dateTo)
      if (filters.search) params.set('search', filters.search)

      const qs = params.toString()
      const data = await apiFetch(`/api/articles${qs ? '?' + qs : ''}`)
      if (!mountedRef.current) return
      setArticles(data.articles)
      setTotal(data.total)
      setLoading(false)
      lastFetchTs.current = Date.now()
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
      setLoading(false)
    }
  }, [filters.sector, filters.date, filters.dateFrom, filters.dateTo, filters.search])

  useEffect(() => { load() }, [load])

  // Poll for changes every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { timestamp } = await apiFetch('/api/articles/last-updated')
        if (!mountedRef.current) return
        setLastUpdated(timestamp)
        if (timestamp > lastFetchTs.current) {
          load()
        }
      } catch { /* ignore polling errors */ }
    }, 15000)

    // Refetch on tab visibility. Background tabs get their setInterval
    // throttled by the browser, so a tab that was hidden overnight can show
    // state from many hours ago when Scott returns to it. visibilitychange
    // fires immediately on the first tab focus and forces a fresh load.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  return { articles, total, loading, error, reload: load, lastUpdated }
}
