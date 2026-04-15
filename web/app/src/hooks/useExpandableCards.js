import { useState, useCallback, useEffect, useRef } from 'react'

/**
 * Shared hook for card-list expansion behaviour.
 *
 * Rules (consistent across the whole app):
 *   1. Clicking a card toggles just that card's expanded state.
 *   2. Any number of cards can be open at once.
 *   3. Clicking inside an already-expanded card's panel body does
 *      nothing (the card wraps the panel with onClick={e => e.stopPropagation()}
 *      so children like links and buttons work normally).
 *   4. Clicking outside every card in this list closes ALL expanded
 *      cards in this list.
 *
 * Usage:
 *
 *   function MyList({ items }) {
 *     const { isExpanded, toggle, listRef } = useExpandableCards()
 *     return (
 *       <div ref={listRef} className="card-list">
 *         {items.map(item => (
 *           <MyCard
 *             key={item.id}
 *             expanded={isExpanded(item.id)}
 *             onToggle={() => toggle(item.id)}
 *             item={item}
 *           />
 *         ))}
 *       </div>
 *     )
 *   }
 *
 *   function MyCard({ item, expanded, onToggle }) {
 *     return (
 *       <div className={`my-card ${expanded ? 'expanded' : ''}`} onClick={onToggle}>
 *         <div className="my-card-header">...</div>
 *         {expanded && (
 *           <div className="my-card-body" onClick={e => e.stopPropagation()}>
 *             ...links, buttons, anything clickable goes here...
 *           </div>
 *         )}
 *       </div>
 *     )
 *   }
 *
 * Notes:
 *   - Keys can be anything hashable (string, number, or a composite key).
 *   - listRef must be attached to a single element that wraps ALL cards
 *     in the list. Clicks outside that element collapse everything.
 */
export function useExpandableCards() {
  const [expanded, setExpanded] = useState(() => new Set())
  const listRef = useRef(null)

  const toggle = useCallback((key) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const collapseAll = useCallback(() => {
    setExpanded(prev => (prev.size === 0 ? prev : new Set()))
  }, [])

  const isExpanded = useCallback((key) => expanded.has(key), [expanded])

  useEffect(() => {
    if (expanded.size === 0) return
    function onMouseDown(e) {
      if (listRef.current && !listRef.current.contains(e.target)) {
        collapseAll()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [expanded.size, collapseAll])

  return { isExpanded, toggle, collapseAll, listRef }
}

/**
 * Companion hook for card lists where each card self-manages its own
 * `expanded` state (e.g. Editorial.jsx's AnalysisEntry / ThemeCard /
 * PostCard — which already support multiple-open because state is per
 * card). Provides the same outside-click-to-close-all behaviour without
 * requiring state lifting.
 *
 * Usage in the parent list:
 *   const { closeSignal, listRef } = useOutsideClickSignal()
 *   <div ref={listRef}>
 *     {items.map(i => <Card key={i.id} item={i} closeSignal={closeSignal} />)}
 *   </div>
 *
 * Usage inside each card:
 *   const [expanded, setExpanded] = useState(false)
 *   useCloseOnSignal(closeSignal, () => setExpanded(false))
 *
 * The signal is a monotonically-increasing integer — children re-run
 * their close effect each time it changes.
 */
export function useOutsideClickSignal() {
  const [closeSignal, setCloseSignal] = useState(0)
  const listRef = useRef(null)

  useEffect(() => {
    function onMouseDown(e) {
      if (listRef.current && !listRef.current.contains(e.target)) {
        setCloseSignal(s => s + 1)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  return { closeSignal, listRef }
}

export function useCloseOnSignal(signal, onClose) {
  useEffect(() => {
    if (signal > 0) onClose()
    // onClose identity isn't stable across renders in most call sites;
    // depending on `signal` alone is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signal])
}
