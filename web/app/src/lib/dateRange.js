/**
 * Date range utilities for time-range filtering.
 * All dates are YYYY-MM-DD strings. Works client-side only.
 *
 * IMPORTANT: fmt() uses local-time getters, NOT toISOString() (which is UTC).
 * Using UTC caused every date to shift back by one day after DST spring-forward.
 */

function fmt(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function getDateRange(preset) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDate = fmt(today)

  switch (preset) {
    case 'week': {
      const day = today.getDay()
      // Editorial week starts Friday: Fri=0 back, Sat=1 back, ..., Thu=6 back
      const diff = (day + 2) % 7
      const friday = addDays(today, -diff)
      return { startDate: fmt(friday), endDate }
    }
    case '7d':
      return { startDate: fmt(addDays(today, -6)), endDate }
    case '30d':
      return { startDate: fmt(addDays(today, -29)), endDate }
    case 'all':
      return { startDate: null, endDate: null }
    default:
      return { startDate: null, endDate: null }
  }
}

export function filterByDateEntries(byDate, startDate, endDate) {
  const result = {}
  for (const [date, count] of Object.entries(byDate)) {
    if (startDate && date < startDate) continue
    if (endDate && date > endDate) continue
    result[date] = count
  }
  return result
}

export function fillCalendarGaps(byDate) {
  const dates = Object.keys(byDate).sort()
  if (dates.length === 0) return []
  if (dates.length === 1) return [[dates[0], byDate[dates[0]]]]

  const result = []
  const start = new Date(dates[0] + 'T12:00:00')
  const end = new Date(dates[dates.length - 1] + 'T12:00:00')

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = fmt(d)
    result.push([key, byDate[key] || 0])
  }
  return result
}

/**
 * Get ISO week number for a date string.
 * Uses editorial week mapping: Fri-Thu → same week (advance to Thursday first).
 * Returns { year, week } to avoid cross-year collisions.
 */
function editorialWeekInfo(dateStr) {
  const date = new Date(dateStr + 'T12:00:00')
  const day = date.getDay() // 0=Sun
  // Days until next Thursday (or 0 if already Thursday)
  const daysToThu = (4 - day + 7) % 7
  const thu = new Date(date)
  thu.setDate(date.getDate() + daysToThu)
  // ISO week of that Thursday
  const d = new Date(Date.UTC(thu.getFullYear(), thu.getMonth(), thu.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return { year: d.getUTCFullYear(), week }
}

/**
 * Aggregate daily entries into editorial weeks.
 * Operates on sparse data directly — does NOT require fillCalendarGaps first.
 * Keys include year to prevent cross-year week collisions.
 */
export function aggregateToWeeks(entries) {
  if (entries.length === 0) return []
  const weeks = new Map()
  for (const [date, count] of entries) {
    const { year, week } = editorialWeekInfo(date)
    // Short year suffix for display: "W10" for current year, "W49 '24" for others
    const currentYear = new Date().getFullYear()
    const label = year === currentYear
      ? `W${week}`
      : `W${week} '${String(year).slice(2)}`
    const sortKey = `${year}-${String(week).padStart(2, '0')}`
    if (!weeks.has(sortKey)) weeks.set(sortKey, { label, count: 0 })
    weeks.get(sortKey).count += count
  }
  // Sort by sortKey and return [label, count] pairs
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { label, count }]) => [label, count])
}
