import { useState, useRef, useEffect, useCallback } from 'react'
import { apiPost, apiFetch, apiPut } from '../lib/api'

export function useExclusions(week) {
  const mountedRef = useRef(true)
  const [entries, setEntries] = useState(null)       // null = not extracted, [] = empty result
  const [extracting, setExtracting] = useState(false)
  const [extractError, setExtractError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Reset state when week changes
  useEffect(() => {
    setEntries(null)
    setExtractError(null)
    setSaveError(null)
    setSavedAt(null)
  }, [week])

  const extract = useCallback(async () => {
    if (!week) return
    setExtracting(true)
    setExtractError(null)
    setEntries(null)
    try {
      const result = await apiPost(`/api/published/week-${week}/exclusions`)
      if (!mountedRef.current) return
      setEntries(result.entries || [])
    } catch (err) {
      if (!mountedRef.current) return
      setExtractError(err.message)
    }
    if (mountedRef.current) setExtracting(false)
  }, [week])

  const updateEntry = useCallback((idx, field, value) => {
    setEntries(prev => {
      if (!prev) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
    setSavedAt(null)
  }, [])

  const removeEntry = useCallback((idx) => {
    setEntries(prev => prev ? prev.filter((_, i) => i !== idx) : prev)
    setSavedAt(null)
  }, [])

  const addEntry = useCallback(() => {
    setEntries(prev => [...(prev || []), { company: '', topic: '' }])
    setSavedAt(null)
  }, [])

  const saveToOffLimits = useCallback(async () => {
    if (!week || !entries || entries.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      // Read current off-limits config
      const current = await apiFetch('/api/config/off-limits')

      // Off-limits uses underscore format: week_10
      const weekKey = `week_${week}`

      // Merge — replace any existing entries for this week
      const updated = { ...current, [weekKey]: entries }

      // Write back via PUT (server validates with write-validate-swap)
      await apiPut('/api/config/off-limits', updated)

      if (!mountedRef.current) return
      setSavedAt(Date.now())
    } catch (err) {
      if (!mountedRef.current) return
      setSaveError(err.message)
    }
    if (mountedRef.current) setSaving(false)
  }, [week, entries])

  return {
    entries, extracting, extractError,
    saving, saveError, savedAt,
    extract, updateEntry, removeEntry, addEntry, saveToOffLimits,
  }
}
