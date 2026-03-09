import './TimeRangeSelector.css'

const PRESETS = [
  { key: 'week', label: 'This week' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
  { key: 'all', label: 'All time' },
]

export default function TimeRangeSelector({ value, onChange }) {
  return (
    <div className="time-range-selector">
      {PRESETS.map(({ key, label }) => (
        <button
          key={key}
          className={`time-pill ${value === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
