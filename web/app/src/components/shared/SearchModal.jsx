import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { apiFetch } from '../../lib/api'
import './SearchModal.css'

const TYPE_TO_ROUTE = {
  analysis: '/editorial',
  theme: '/editorial',
  post: '/editorial',
}

const TYPE_TAB_PARAMS = {
  analysis: '?tab=state',
  theme: '?tab=themes',
  post: '?tab=backlog',
}

const GROUP_ORDER = ['analysis', 'theme', 'post']

function groupResults(results) {
  const groups = {}
  for (const r of results) {
    const type = (r.type || 'post').toLowerCase()
    if (!groups[type]) groups[type] = []
    groups[type].push(r)
  }
  return groups
}

function flattenResults(grouped) {
  const flat = []
  for (const type of GROUP_ORDER) {
    if (grouped[type]) {
      for (const item of grouped[type]) {
        flat.push({ ...item, type })
      }
    }
  }
  // Include any types not in GROUP_ORDER
  for (const [type, items] of Object.entries(grouped)) {
    if (!GROUP_ORDER.includes(type)) {
      for (const item of items) {
        flat.push({ ...item, type })
      }
    }
  }
  return flat
}

export default function SearchModal({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const mountedRef = useRef(true)
  const navigate = useNavigate()

  const debouncedQuery = useDebouncedValue(query, 200)

  // Reset state when modal opens/closes
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setError(null)
      setActiveIndex(0)
      // Focus input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  // Track mounted state
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Search when debounced query changes
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.trim().length === 0) {
      setResults([])
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)

    apiFetch(`/api/editorial/search?q=${encodeURIComponent(debouncedQuery.trim())}`)
      .then(data => {
        if (cancelled || !mountedRef.current) return
        setResults(data.results || [])
        setActiveIndex(0)
        setError(null)
      })
      .catch(err => {
        if (cancelled || !mountedRef.current) return
        // Gracefully handle missing endpoint
        setResults([])
        setError(err.status === 404 ? null : err.message)
      })
      .finally(() => {
        if (!cancelled && mountedRef.current) setLoading(false)
      })

    return () => { cancelled = true }
  }, [debouncedQuery])

  const grouped = useMemo(() => groupResults(results), [results])
  const flatList = useMemo(() => flattenResults(grouped), [grouped])

  const selectResult = useCallback((item) => {
    const route = TYPE_TO_ROUTE[item.type] || '/editorial'
    const params = TYPE_TAB_PARAMS[item.type] || ''
    onClose()
    navigate(route + params)
  }, [navigate, onClose])

  // Keyboard navigation within results
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, flatList.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flatList.length > 0) {
      e.preventDefault()
      selectResult(flatList[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }, [flatList, activeIndex, selectResult, onClose])

  // Click on backdrop closes
  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  if (!open) return null

  const hasQuery = query.trim().length > 0
  const hasResults = flatList.length > 0

  return (
    <div className="search-overlay" onClick={handleOverlayClick}>
      <div className="search-modal" role="dialog" aria-label="Search">
        <div className="search-input-row">
          <span className="search-icon">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className="search-modal-input"
            type="text"
            placeholder="Search editorial..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="search-shortcut-hint">&#8984;K</span>
        </div>

        <div className="search-results">
          {!hasQuery && (
            <div className="search-empty">Type to search...</div>
          )}

          {hasQuery && loading && (
            <div className="search-empty">Searching...</div>
          )}

          {hasQuery && !loading && !hasResults && !error && (
            <div className="search-empty">No results</div>
          )}

          {hasQuery && error && (
            <div className="search-empty">{error}</div>
          )}

          {hasResults && GROUP_ORDER.map(type => {
            const items = grouped[type]
            if (!items || items.length === 0) return null
            const groupLabel = type.charAt(0).toUpperCase() + type.slice(1)
            return (
              <div key={type}>
                <div className="search-group-label">{groupLabel}</div>
                {items.map((item, i) => {
                  const flatIdx = flatList.findIndex(
                    f => f.type === type && f.title === item.title && f.id === item.id
                  )
                  return (
                    <div
                      key={item.id || `${type}-${i}`}
                      className={`search-result-item${flatIdx === activeIndex ? ' active' : ''}`}
                      onClick={() => selectResult({ ...item, type })}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                    >
                      <span className="search-result-type">{type}</span>
                      <span className="search-result-title">{item.title}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div className="search-footer">
          <span><kbd>&uarr;</kbd><kbd>&darr;</kbd> navigate</span>
          <span><kbd>&crarr;</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
