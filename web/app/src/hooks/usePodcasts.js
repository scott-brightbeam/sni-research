import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../lib/api.js'

export function usePodcasts(week) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    if (!week) { setLoading(false); return }
    const fetchPodcasts = async () => {
      try {
        setLoading(true)
        const response = await apiFetch(`/api/podcasts?week=${week}`)
        if (mountedRef.current) setData(response)
      } catch (err) {
        if (mountedRef.current) setError(err.message)
      } finally {
        if (mountedRef.current) setLoading(false)
      }
    }
    fetchPodcasts()
    return () => { mountedRef.current = false }
  }, [week])

  return { data, loading, error }
}
