import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import ToastContainer from '../shared/Toast'
import { useStatus } from '../../hooks/useStatus'
import { useEditorialStatus } from '../../hooks/useEditorialStatus'
import { formatRelativeTime } from '../../lib/format'
import './Shell.css'

export default function Shell() {
  const { status, error } = useStatus()
  const editorial = useEditorialStatus()

  let statusText = null
  if (error) statusText = 'API error'
  else if (status?.lastRun?.completedAt)
    statusText = `Last run ${formatRelativeTime(status.lastRun.completedAt)}`

  // Build editorial status summary for sidebar
  const runningStages = Object.entries(editorial.status.locks || {})
    .filter(([, locked]) => locked)
    .map(([stage]) => stage)
  const editorialStatusText = runningStages.length > 0
    ? `Running: ${runningStages.join(', ')}`
    : null

  return (
    <div className="shell">
      <Sidebar status={statusText} editorialStatus={editorialStatusText} />
      <main className="main">
        <Outlet />
      </main>
      <ToastContainer />
    </div>
  )
}
