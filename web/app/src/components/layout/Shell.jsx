import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import './Shell.css'

export default function Shell({ statusText }) {
  return (
    <div className="shell">
      <Sidebar status={statusText} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
