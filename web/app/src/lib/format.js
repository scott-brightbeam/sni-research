export const SECTOR_COLOURS = {
  general: { color: 'var(--terra)', bg: 'rgba(212, 113, 78, 0.15)' },
  biopharma: { color: 'var(--sage)', bg: 'rgba(111, 165, 132, 0.15)' },
  medtech: { color: 'var(--blue)', bg: 'rgba(124, 173, 214, 0.15)' },
  manufacturing: { color: 'var(--brown)', bg: 'rgba(160, 139, 109, 0.15)' },
  insurance: { color: 'var(--purple)', bg: 'rgba(173, 160, 208, 0.15)' },
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
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
