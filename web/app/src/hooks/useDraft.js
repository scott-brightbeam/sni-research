import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useDraft(initialWeek = null) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [editorContent, setEditorContent] = useState('')
  const [week, setWeek] = useState(initialWeek)

  const load = useCallback(async (w) => {
    setLoading(true)
    setError(null)
    try {
      const qs = w ? `?week=${w}` : ''
      const result = await apiFetch(`/api/draft${qs}`)
      setData(result)
      setEditorContent(result.draft)
      setWeek(result.week)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(week) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!week) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await apiFetch(`/api/draft?week=${week}`, {
        method: 'PUT',
        body: JSON.stringify({ draft: editorContent }),
      })
      setData(result)
      setSavedAt(Date.now())
      setSaving(false)
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }, [week, editorContent])

  const goToWeek = useCallback((w) => {
    setWeek(w)
    load(w)
  }, [load])

  const dirty = data ? editorContent !== data.draft : false

  return {
    // Data
    draft: editorContent,
    review: data?.review ?? null,
    links: data?.links ?? null,
    evaluate: data?.evaluate ?? null,
    week: data?.week ?? week,
    availableWeeks: data?.availableWeeks ?? [],
    // State
    loading,
    error,
    saving,
    saveError,
    savedAt,
    dirty,
    // Actions
    setDraft: setEditorContent,
    save,
    goToWeek,
    reload: () => load(week),
  }
}
