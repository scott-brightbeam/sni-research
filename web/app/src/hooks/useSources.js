import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useSources() {
  const [overview, setOverview] = useState(null)
  const [selectedDate, setSelectedDate] = useState(null)
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState(null)
  const detailCache = useRef(new Map())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Load overview on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch('/api/sources/overview')
        if (!mountedRef.current) return
        setOverview(data)
        // Auto-select newest run
        if (data.runs.length > 0) {
          setSelectedDate(data.runs[0].date)
        }
        setLoading(false)
      } catch (err) {
        if (!mountedRef.current) return
        setError(err.message)
        setLoading(false)
      }
    }
    load()
  }, [])

  // Load detail when selected date changes
  useEffect(() => {
    if (!selectedDate || !overview) return

    const run = overview.runs.find(r => r.date === selectedDate)
    if (!run || run.layerTotals === null) {
      setDetail(null)
      return
    }

    // Check cache
    if (detailCache.current.has(selectedDate)) {
      setDetail(detailCache.current.get(selectedDate))
      return
    }

    async function loadDetail() {
      setDetailLoading(true)
      try {
        const data = await apiFetch(`/api/sources/runs/${selectedDate}`)
        if (!mountedRef.current) return
        detailCache.current.set(selectedDate, data)
        setDetail(data)
      } catch (err) {
        if (!mountedRef.current) return
        setDetail(null)
      }
      if (mountedRef.current) setDetailLoading(false)
    }
    loadDetail()
  }, [selectedDate, overview])

  const selectRun = useCallback((date) => {
    setSelectedDate(date)
  }, [])

  const selectedRun = overview?.runs.find(r => r.date === selectedDate) ?? null

  return {
    overview,
    selectedRun,
    detail,
    loading,
    detailLoading,
    error,
    selectRun,
  }
}
