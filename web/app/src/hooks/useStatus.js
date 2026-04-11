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

    // Refetch when the tab becomes visible again. Chrome throttles setInterval
    // aggressively on backgrounded tabs (to once every few minutes or less), so
    // a tab that was backgrounded overnight can show state from many hours ago
    // when the user returns. Listening on visibilitychange forces a fresh pull
    // the moment Scott switches back to the tab.
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mounted = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pollInterval])

  return { status, loading, error }
}
