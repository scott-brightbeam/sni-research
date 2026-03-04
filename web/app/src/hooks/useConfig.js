import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useConfig(name) {
  const mountedRef = useRef(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/config/${name}`)
      if (!mountedRef.current) return
      setData(result)
      setLoading(false)
    } catch (err) {
      if (!mountedRef.current) return
      setError(err.message)
      setLoading(false)
    }
  }, [name])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (newData) => {
    setSaving(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/config/${name}`, {
        method: 'PUT',
        body: JSON.stringify(newData),
      })
      if (!mountedRef.current) return result
      setData(result)
      setSaving(false)
      return result
    } catch (err) {
      if (!mountedRef.current) throw err
      setError(err.message)
      setSaving(false)
      throw err
    }
  }, [name])

  return { data, loading, error, saving, save, reload: load }
}
