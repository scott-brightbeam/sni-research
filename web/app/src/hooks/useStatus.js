import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

export function useStatus(pollInterval = 30000) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const data = await apiFetch('/api/status')
        if (mounted) {
          setStatus(data)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err.message)
          setLoading(false)
        }
      }
    }

    load()
    const id = setInterval(load, pollInterval)
    return () => { mounted = false; clearInterval(id) }
  }, [pollInterval])

  return { status, loading, error }
}
