import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useStatus } from '../../hooks/useStatus'
import { formatRelativeTime } from '../../lib/format'
import './Shell.css'

export default function Shell() {
  const { status, error } = useStatus()

  let statusText = null
  if (error) statusText = 'API error'
  else if (status?.lastRun?.completedAt)
    statusText = `Last run ${formatRelativeTime(status.lastRun.completedAt)}`

  return (
    <div className="shell">
      <Sidebar status={statusText} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
