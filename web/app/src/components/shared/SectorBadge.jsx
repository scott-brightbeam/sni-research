import { SECTOR_COLOURS, SECTOR_LABELS } from '../../lib/format'
import './SectorBadge.css'

export default function SectorBadge({ sector }) {
  const { color, bg } = SECTOR_COLOURS[sector] || SECTOR_COLOURS.general
  const label = SECTOR_LABELS[sector] || sector

  return (
    <span
      className="sector-badge"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}
