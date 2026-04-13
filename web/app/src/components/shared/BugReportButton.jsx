import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import './BugReportButton.css'

const ROUTE_TO_COMPONENT = {
  '/': 'dashboard',
  '/database': 'database',
  '/editorial': 'editorial',
  '/sources': 'sources',
  '/config': 'config',
  '/bugs': 'other',
}

const COMPONENTS = ['dashboard', 'database', 'editorial', 'sources', 'config', 'pipeline', 'api', 'other']
const SEVERITIES = ['low', 'medium', 'high', 'critical']

const INITIAL_FORM = { title: '', description: '', component: '', severity: 'medium' }

export default function BugReportButton({ onSubmit }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const location = useLocation()
  const titleRef = useRef(null)

  // Pre-select component from current route when opening
  useEffect(() => {
    if (open) {
      const component = ROUTE_TO_COMPONENT[location.pathname] || 'other'
      setForm(prev => ({ ...prev, component }))
      // Focus title field after drawer animation
      setTimeout(() => titleRef.current?.focus(), 200)
    }
  }, [open, location.pathname])

  // Escape key closes drawer
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  function handleChange(e) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) return
    setSubmitting(true)
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim(),
        component: form.component,
        severity: form.severity,
      })
      setForm(INITIAL_FORM)
      setOpen(false)
    } catch (err) {
      // toast is handled by the onSubmit caller
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        className="bug-fab"
        onClick={() => setOpen(true)}
        aria-label="Report a bug"
        title="Report a bug"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </button>

      {open && (
        <>
          <div className="bug-backdrop" onClick={() => setOpen(false)} />
          <div className="bug-drawer">
            <form onSubmit={handleSubmit}>
              <div className="bug-drawer-header">
                <h3>Report a Bug</h3>
                <button type="button" className="bug-drawer-close" onClick={() => setOpen(false)} aria-label="Close">
                  &times;
                </button>
              </div>

              <div className="bug-field">
                <label htmlFor="bug-title">Title</label>
                <input
                  ref={titleRef}
                  id="bug-title"
                  name="title"
                  type="text"
                  value={form.title}
                  onChange={handleChange}
                  placeholder="Brief description of the issue"
                  required
                />
              </div>

              <div className="bug-field">
                <label htmlFor="bug-description">Description</label>
                <textarea
                  id="bug-description"
                  name="description"
                  rows="4"
                  value={form.description}
                  onChange={handleChange}
                  placeholder="Steps to reproduce, expected vs actual behaviour..."
                />
              </div>

              <div className="bug-field-row">
                <div className="bug-field">
                  <label htmlFor="bug-component">Component</label>
                  <select
                    id="bug-component"
                    name="component"
                    value={form.component}
                    onChange={handleChange}
                  >
                    {COMPONENTS.map(c => (
                      <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                    ))}
                  </select>
                </div>

                <div className="bug-field">
                  <label htmlFor="bug-severity">Severity</label>
                  <select
                    id="bug-severity"
                    name="severity"
                    value={form.severity}
                    onChange={handleChange}
                  >
                    {SEVERITIES.map(s => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="bug-actions">
                <button type="submit" className="btn btn-md btn-primary" disabled={submitting || !form.title.trim()}>
                  {submitting ? 'Submitting...' : 'Submit Bug'}
                </button>
                <button type="button" className="btn btn-md btn-ghost" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  )
}
