import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useArticles(filters = {}) {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const lastFetchTs = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.sector) params.set('sector', filters.sector)
      if (filters.date) params.set('date', filters.date)
      if (filters.from) params.set('from', filters.from)
      if (filters.to) params.set('to', filters.to)
      if (filters.search) params.set('search', filters.search)

      const qs = params.toString()
      const data = await apiFetch(`/api/articles${qs ? '?' + qs : ''}`)
      setArticles(data.articles)
      setTotal(data.total)
      setLoading(false)
      lastFetchTs.current = Date.now()
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [filters.sector, filters.date, filters.from, filters.to, filters.search])

  useEffect(() => { load() }, [load])

  // Poll for changes every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { timestamp } = await apiFetch('/api/articles/last-updated')
        setLastUpdated(timestamp)
        if (timestamp > lastFetchTs.current) {
          load()
        }
      } catch { /* ignore polling errors */ }
    }, 15000)
    return () => clearInterval(interval)
  }, [load])

  return { articles, total, loading, error, reload: load, lastUpdated }
}
