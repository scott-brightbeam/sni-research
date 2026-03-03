import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useFlaggedArticles() {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/articles/flagged')
      setArticles(data.articles)
      setTotal(data.total)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { articles, total, loading, error, reload: load }
}
