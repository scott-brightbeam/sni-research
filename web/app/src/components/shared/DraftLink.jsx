import { useNavigate } from 'react-router-dom'
import './DraftLink.css'

export default function DraftLink({ label = 'Open in Draft', source, content, className = '' }) {
  const navigate = useNavigate()

  function handleClick(e) {
    e.preventDefault()
    e.stopPropagation()
    navigate('/draft', { state: { source, content } })
  }

  return (
    <a href="/draft" className={`draft-link ${className}`} onClick={handleClick}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      {label}
    </a>
  )
}
