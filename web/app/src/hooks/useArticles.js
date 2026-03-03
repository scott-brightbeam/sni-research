import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useArticles(filters = {}) {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.sector) params.set('sector', filters.sector)
      if (filters.date) params.set('date', filters.date)
      if (filters.search) params.set('search', filters.search)

      const qs = params.toString()
      const data = await apiFetch(`/api/articles${qs ? '?' + qs : ''}`)
      setArticles(data.articles)
      setTotal(data.total)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [filters.sector, filters.date, filters.search])

  useEffect(() => { load() }, [load])

  return { articles, total, loading, error, reload: load }
}
