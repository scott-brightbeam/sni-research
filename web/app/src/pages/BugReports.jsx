import { useState } from 'react'
import { useBugReports } from '../hooks/useBugReports'
import { useExpandableCards } from '../hooks/useExpandableCards'
import { formatRelativeTime } from '../lib/format'
import './BugReports.css'

const STATUS_TABS = ['all', 'open', 'investigating', 'fixed', 'closed']
const STATUS_COLOURS = {
  open: 'var(--danger)',
  investigating: 'var(--warning)',
  fixed: 'var(--sage)',
  closed: 'var(--text-muted)',
  'wont-fix': 'var(--text-muted)',
}

const SEVERITY_CLASSES = {
  critical: 'badge-immediate',
  high: 'badge-high',
  medium: 'badge-medium-high',
  low: 'badge-low',
}

export default function BugReports() {
  const [activeTab, setActiveTab] = useState('all')
  const { isExpanded, toggle, collapseAll, listRef } = useExpandableCards()
  const statusFilter = activeTab === 'all' ? undefined : activeTab
  const { bugs, loading, error } = useBugReports(statusFilter)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load bugs: {error}</div>

  // Count per status for tab badges
  const counts = {}
  if (activeTab === 'all') {
    for (const b of bugs) {
      counts[b.status] = (counts[b.status] || 0) + 1
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Bug Reports</h2>
        <span className="bug-count">{bugs.length} {bugs.length === 1 ? 'bug' : 'bugs'}</span>
      </div>

      <div className="tabs">
        {STATUS_TABS.map(tab => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab); collapseAll() }}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
            {activeTab === 'all' && tab !== 'all' && counts[tab] > 0 && (
              <span className="tab-count">{counts[tab]}</span>
            )}
            {tab === 'all' && (
              <span className="tab-count">{bugs.length}</span>
            )}
          </button>
        ))}
      </div>

      {bugs.length === 0 && (
        <div className="placeholder-text">
          {activeTab === 'all'
            ? 'No bug reports yet. Use the bug button in the bottom-right corner to report one.'
            : `No bugs with status "${activeTab}".`}
        </div>
      )}

      <div ref={listRef} className="bug-list">
        {bugs.map(bug => (
          <div key={bug.id} className="bug-card" data-expanded={isExpanded(bug.id) || undefined}>
            <button className="bug-card-header" onClick={() => toggle(bug.id)}>
              <span className="bug-status-dot" style={{ background: STATUS_COLOURS[bug.status] || 'var(--text-muted)' }} />
              <span className="bug-title">{bug.title}</span>
              <span className="bug-meta">
                <span className={`badge ${SEVERITY_CLASSES[bug.severity] || 'badge-low'}`}>
                  {bug.severity}
                </span>
                <span className="bug-component-badge">{bug.component}</span>
                <span className="bug-time">{formatRelativeTime(bug.created_at)}</span>
              </span>
              <span className="bug-chevron">{isExpanded(bug.id) ? '\u25B2' : '\u25BC'}</span>
            </button>

            {isExpanded(bug.id) && (
              <div className="bug-detail" onClick={e => e.stopPropagation()}>
                <div className="bug-detail-row">
                  <span className="bug-detail-label">Status</span>
                  <span className="bug-detail-value" style={{ color: STATUS_COLOURS[bug.status] }}>
                    {bug.status}
                  </span>
                </div>
                {bug.reporter && (
                  <div className="bug-detail-row">
                    <span className="bug-detail-label">Reporter</span>
                    <span className="bug-detail-value">{bug.reporter}</span>
                  </div>
                )}
                {bug.description && (
                  <div className="bug-detail-section">
                    <span className="bug-detail-label">Description</span>
                    <p className="bug-detail-text">{bug.description}</p>
                  </div>
                )}
                {bug.triage_notes && (
                  <div className="bug-detail-section">
                    <span className="bug-detail-label">Triage Notes</span>
                    <p className="bug-detail-text">{bug.triage_notes}</p>
                  </div>
                )}
                {bug.resolution_notes && (
                  <div className="bug-detail-section">
                    <span className="bug-detail-label">Resolution</span>
                    <p className="bug-detail-text">{bug.resolution_notes}</p>
                  </div>
                )}
                {bug.updated_at && bug.updated_at !== bug.created_at && (
                  <div className="bug-detail-row">
                    <span className="bug-detail-label">Updated</span>
                    <span className="bug-detail-value">{formatRelativeTime(bug.updated_at)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
