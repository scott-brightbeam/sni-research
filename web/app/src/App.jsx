import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Shell from './components/layout/Shell'
import Dashboard from './pages/Dashboard'
import Database from './pages/Database'
import Editorial from './pages/Editorial'
import Copilot from './pages/Copilot'
import Config from './pages/Config'
import Sources from './pages/Sources'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/database" element={<Database />} />
          <Route path="/articles" element={<Navigate to="/database" replace />} />
          <Route path="/draft" element={<Navigate to="/editorial?tab=newsletter" replace />} />
          <Route path="/editorial" element={<Editorial />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/config" element={<Config />} />
          <Route path="/sources" element={<Sources />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
