import { useState, useEffect, useCallback } from 'react'
import './Toast.css'

let addToastGlobal = null
let nextToastId = 0

export function toast(message, type = 'success') {
  if (addToastGlobal) {
    addToastGlobal({ message, type, id: ++nextToastId })
  } else if (import.meta.env?.DEV) {
    console.warn('[Toast] toast() called but no ToastContainer is mounted. Message:', message)
  }
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((t) => {
    setToasts(prev => [...prev, t])
  }, [])

  useEffect(() => {
    addToastGlobal = addToast
    return () => { addToastGlobal = null }
  }, [addToast])

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast: t, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(t.id), 5000)
    return () => clearTimeout(timer)
  }, [t.id, onDismiss])

  return (
    <div className={`toast toast-${t.type}`} role="alert">
      <span className="toast-icon">
        {t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}
      </span>
      <span className="toast-message">{t.message}</span>
      <button className="toast-close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
