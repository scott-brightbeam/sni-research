import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiPost, apiPut } from '../lib/api'

export function useBugReports(statusFilter) {
  const [bugs, setBugs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      params.set('limit', '200')
      const path = `/api/bugs${params.toString() ? '?' + params : ''}`
      const data = await apiFetch(path)
      if (mountedRef.current) {
        setBugs(data.bugs || [])
        setLoading(false)
        setError(null)
      }
    } catch (err) {
      if (err._authRedirect) return
      if (mountedRef.current) {
        setError(err.message)
        setLoading(false)
      }
    }
  }, [statusFilter])

  useEffect(() => {
    mountedRef.current = true
    setLoading(true)
    load()

    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const reload = useCallback(() => load(), [load])

  const submitBug = useCallback(async (data) => {
    const result = await apiPost('/api/bugs', data)
    await load()
    return result
  }, [load])

  const updateBug = useCallback(async (id, data) => {
    const result = await apiPut(`/api/bugs/${id}`, data)
    await load()
    return result
  }, [load])

  return { bugs, loading, error, reload, submitBug, updateBug }
}
