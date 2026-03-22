import './Skeleton.css'

/**
 * Reusable skeleton loading placeholders.
 * Usage: <Skeleton.StatCards count={4} /> or <Skeleton.List count={5} />
 */

function StatCards({ count = 4 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-stat-card">
          <div className="skeleton skeleton-stat-label" />
          <div className="skeleton skeleton-stat-value" />
          <div className="skeleton skeleton-stat-detail" />
        </div>
      ))}
    </>
  )
}

function List({ count = 5 }) {
  return (
    <div className="skeleton-list">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-list-item">
          <div className="skeleton skeleton-badge" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-meta" />
        </div>
      ))}
    </div>
  )
}

function Card() {
  return (
    <div className="skeleton-card">
      <div className="skeleton skeleton-heading" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text" />
      <div className="skeleton skeleton-text-sm" />
    </div>
  )
}

function Cards({ count = 2 }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} />
      ))}
    </>
  )
}

function Text({ lines = 3, width }) {
  return (
    <div>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={`skeleton skeleton-text${!width && i === lines - 1 ? ' skeleton-text-short' : ''}`}
        />
      ))}
    </div>
  )
}

const Skeleton = { StatCards, List, Card, Cards, Text }
export default Skeleton
