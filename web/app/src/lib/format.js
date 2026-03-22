export const SECTOR_COLOURS = {
  general:       { color: 'var(--terra)',   bg: 'var(--terra-15)' },
  biopharma:     { color: 'var(--sage)',    bg: 'var(--sage-15)' },
  medtech:       { color: 'var(--blue)',    bg: 'var(--blue-15)' },
  manufacturing: { color: 'var(--brown)',   bg: 'var(--brown-15)' },
  insurance:     { color: 'var(--purple)',  bg: 'var(--purple-15)' },
}

export const SECTOR_LABELS = {
  general: 'General',
  biopharma: 'Biopharma',
  medtech: 'MedTech',
  manufacturing: 'Mfg',
  insurance: 'Insurance',
}

export function formatDuration(ms) {
  if (!ms) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  if (Number.isNaN(diff)) return '—'
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "Fri 7", "Sat 1" — short day label for dashboard bars */
export function formatDayLabel(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString('en-GB', { weekday: 'short' })
  return `${day} ${d.getDate()}`
}

/** Generate YYYY-MM-DD dates from start to end (inclusive) */
export function getDateRange(startStr, endStr) {
  const dates = []
  const d = new Date(startStr + 'T00:00:00')
  const end = new Date(endStr + 'T00:00:00')
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return dates
}
