import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/layout/Shell'
import Dashboard from './pages/Dashboard'
import Database from './pages/Database'
import Editorial from './pages/Editorial'
// Copilot page removed — editorial chat sidebar handles all chat
import Config from './pages/Config'
import Sources from './pages/Sources'
import BugReports from './pages/BugReports'
import SourceViewer from './pages/SourceViewer'
import ThemeViewer from './pages/ThemeViewer'
import Login from './pages/Login'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import './App.css'

function AuthGuard({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="auth-loading">
        <span className="auth-loading-text">Loading...</span>
      </div>
    )
  }
  if (!user) return <Login />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AuthGuard><Shell /></AuthGuard>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/database" element={<Database />} />
            <Route path="/articles" element={<Navigate to="/database" replace />} />
            <Route path="/draft" element={<Navigate to="/editorial?tab=newsletter" replace />} />
            <Route path="/editorial" element={<Editorial />} />
            <Route path="/copilot" element={<Navigate to="/editorial" replace />} />
            <Route path="/config" element={<Config />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/bugs" element={<BugReports />} />
            <Route path="/source/:id" element={<SourceViewer />} />
            <Route path="/theme/:code" element={<ThemeViewer />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
