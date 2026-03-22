import { useState, useCallback, useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import ErrorBoundary from '../shared/ErrorBoundary'
import SearchModal from '../shared/SearchModal'
import ToastContainer from '../shared/Toast'
import { useStatus } from '../../hooks/useStatus'
import { useEditorialStatus } from '../../hooks/useEditorialStatus'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { formatRelativeTime } from '../../lib/format'
import './Shell.css'

const NAV_ROUTES = [
  '/',           // 1 = Dashboard
  '/database',   // 2 = Database (Articles)
  '/draft',      // 3 = Draft
  '/editorial',  // 4 = Editorial
  '/copilot',    // 5 = Co-pilot
  '/sources',    // 6 = Sources
  '/config',     // 7 = Config
]

export default function Shell() {
  const { status, error } = useStatus()
  const editorial = useEditorialStatus()
  const [searchOpen, setSearchOpen] = useState(false)
  const navigate = useNavigate()

  const toggleSearch = useCallback(() => {
    setSearchOpen(prev => !prev)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
  }, [])

  const shortcuts = useMemo(() => {
    const map = {
      'cmd+k': toggleSearch,
    }
    NAV_ROUTES.forEach((route, i) => {
      map[`cmd+${i + 1}`] = () => navigate(route)
    })
    return map
  }, [toggleSearch, navigate])

  useKeyboardShortcuts(shortcuts)

  let statusText = null
  if (error) statusText = 'API error'
  else if (status?.lastRun?.completedAt)
    statusText = `Last run ${formatRelativeTime(status.lastRun.completedAt)}`

  // Build editorial status summary for sidebar
  let editorialStatusText = null
  if (editorial.error) {
    editorialStatusText = 'Editorial status unavailable'
  } else {
    const runningStages = Object.entries(editorial.status.locks || {})
      .filter(([, locked]) => locked)
      .map(([stage]) => stage)
    if (runningStages.length > 0) {
      editorialStatusText = `Running: ${runningStages.join(', ')}`
    }
  }

  return (
    <div className="shell">
      <Sidebar status={statusText} editorialStatus={editorialStatusText} />
      <main className="main">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </main>
      <ToastContainer />
      <SearchModal open={searchOpen} onClose={closeSearch} />
    </div>
  )
}
