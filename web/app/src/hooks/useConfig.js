import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useConfig(name) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/config/${name}`)
      setData(result)
      setLoading(false)
    } catch (err) {
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
      setData(result)
      setSaving(false)
      return result
    } catch (err) {
      setError(err.message)
      setSaving(false)
      throw err
    }
  }, [name])

  return { data, loading, error, saving, save, reload: load }
}
