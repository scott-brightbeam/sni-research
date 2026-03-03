import { NavLink } from 'react-router-dom'
import './Sidebar.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'grid' },
  { to: '/articles', label: 'Articles', icon: 'list' },
  { to: '/draft', label: 'Draft', icon: 'edit' },
  { to: '/copilot', label: 'Co-pilot', icon: 'chat' },
]

const ICONS = {
  grid: <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  list: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>,
  edit: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  chat: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
}

export default function Sidebar({ status }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <h1>SNI Research</h1>
        <span>Editorial workbench</span>
      </div>

      <div className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{ICONS[icon]}</span>
            {label}
          </NavLink>
        ))}
      </div>

      <div className="sidebar-status">
        <span className="status-dot" />
        <span className="status-text">
          {status
            ? `Pipeline healthy · ${status}`
            : 'Checking...'
          }
        </span>
      </div>
    </nav>
  )
}
