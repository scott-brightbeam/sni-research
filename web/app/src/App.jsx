import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Shell from './components/layout/Shell'
import Dashboard from './pages/Dashboard'
import Articles from './pages/Articles'
import Draft from './pages/Draft'
import Copilot from './pages/Copilot'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/copilot" element={<Copilot />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
