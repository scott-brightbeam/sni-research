import { SECTOR_COLOURS, SECTOR_LABELS } from '../../lib/format'

export default function SectorBadge({ sector }) {
  const { color, bg } = SECTOR_COLOURS[sector] || SECTOR_COLOURS.general
  const label = SECTOR_LABELS[sector] || sector

  return (
    <span
      className="badge"
      style={{ background: bg, color, display: 'inline-block', fontSize: 11, fontFamily: "'Poppins', sans-serif", fontWeight: 600, padding: '2px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.3 }}
    >
      {label}
    </span>
  )
}
