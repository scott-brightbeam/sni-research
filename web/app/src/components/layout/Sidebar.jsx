import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { formatRelativeTime } from '../../lib/format'
import './Sidebar.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'grid' },
  { to: '/database', label: 'Database', icon: 'database' },
  { to: '/editorial', label: 'Editorial', icon: 'book', badge: true },
  { to: '/sources', label: 'Sources', icon: 'layers' },
  { to: '/bugs', label: 'Bugs', icon: 'bug' },
  { to: '/config', label: 'Config', icon: 'settings' },
]

const ICONS = {
  grid: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  database: <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>,
  edit: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  book: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>,
  chat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
  settings: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  layers: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>,
  bug: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
}

/**
 * Strip common boilerplate prefixes from chat thread names so users can
 * distinguish them at a glance. "Draft LinkedIn post #265: 'Nvidia's Real
 * Moat'" becomes "Nvidia's Real Moat".
 */
function trimThreadName(name) {
  if (!name) return '(untitled)'
  return name
    .replace(/^Draft (?:a )?(?:LinkedIn )?post (?:about )?(?:#\d+[:\s]*)?(?:['"])?/i, '')
    .replace(/^Please draft (?:a )?(?:LinkedIn )?post (?:around )?(?:item )?(?:#?\d+[:\s]*[-–—]\s*)?(?:the )?/i, '')
    .replace(/^Draft (?:a )?post (?:about )?(?:podcast: )?(?:['"])?/i, '')
    .replace(/^Draft (?:a )?(?:LinkedIn )?post (?:based on )?(?:analysis )?(?:entry )?(?:#?\d+[:\s]*)?(?:['"])?/i, '')
    .replace(/^do you have context for /i, '')
    .replace(/^Which posts are /i, 'Posts: ')
    .replace(/['"]$/, '')
    .replace(/^['"]/, '')
    .trim() || name
}

export default function Sidebar({ status, editorialStatus = null, notificationCount = 0, chatThreads = [] }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <h1>SNI Research</h1>
        <span>Editorial Intelligence</span>
      </div>

      <div className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{ICONS[icon]}</span>
            {label}
            {badge && notificationCount > 0 && (
              <span className="nav-badge">{notificationCount}</span>
            )}
          </NavLink>
        ))}
      </div>

      {chatThreads.length > 0 && (
        <div className="sidebar-threads">
          <div className="sidebar-threads-header">
            <span>Recent chats</span>
          </div>
          <div className="sidebar-threads-list">
            {chatThreads.slice(0, 12).map(t => (
              <button
                key={t.id}
                className="sidebar-thread-item"
                onClick={() => navigate('/editorial')}
                title={t.name}
              >
                <span className="sidebar-thread-name">{trimThreadName(t.name)}</span>
                <span className="sidebar-thread-time">{formatRelativeTime(t.updated)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="sidebar-footer">
        {user && (
          <div className="sidebar-user">
            {user.picture && <img src={user.picture} alt="" className="user-avatar" />}
            <span className="user-name">{user.name || user.email}</span>
            <button onClick={logout} className="logout-btn">Sign out</button>
          </div>
        )}
        <div className="sidebar-status-item">
          <span className="status-dot status-ok" />
          <span className="status-text">
            {status
              ? `Pipeline healthy · ${status}`
              : 'Checking...'}
          </span>
        </div>
        {editorialStatus && (
          <div className="sidebar-status-item">
            <span className="status-dot status-running" />
            <span className="status-text status-text-active">
              {editorialStatus}
            </span>
          </div>
        )}
      </div>
    </nav>
  )
}
