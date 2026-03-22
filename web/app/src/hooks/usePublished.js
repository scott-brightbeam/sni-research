import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiPut } from '../lib/api'

export function usePublished(week) {
  const [published, setPublished] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!week) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/published/week-${week}`)
      if (mountedRef.current) setPublished(data)
    } catch (err) {
      if (mountedRef.current) {
        // 404 = no published version yet — not an error
        if (err.status === 404) {
          setPublished(null)
        } else {
          setError(err.message)
        }
      }
    }
    if (mountedRef.current) setLoading(false)
  }, [week])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (content, meta = {}) => {
    if (!week) return { ok: false, error: 'No week specified' }
    setSaving(true)
    setError(null)
    try {
      const result = await apiPut(`/api/published/week-${week}`, { content, meta })
      if (mountedRef.current) {
        setPublished({ content, meta: result.meta })
        setSaving(false)
      }
      return { ok: true }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message)
        setSaving(false)
      }
      return { ok: false, error: err.message || 'Failed to save' }
    }
  }, [week])

  return { published, loading, saving, error, save, reload: load }
}
