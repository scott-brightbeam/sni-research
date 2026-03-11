/**
 * week.js — ISO 8601 week number calculation
 *
 * Proper implementation: week 1 is the week containing the first Thursday of the year.
 * This avoids the naive day-of-year/7 bug in scripts/report.js.
 */

export function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // Calculate week number
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

export function getWeekDateRange(week, year = new Date().getFullYear()) {
  // Editorial week: Friday (Mon-3) through Thursday (Mon+3)
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1)

  // Monday of target ISO week
  const monday = new Date(mondayWeek1)
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)

  // Friday of previous week = Monday - 3
  const friday = new Date(monday)
  friday.setUTCDate(monday.getUTCDate() - 3)

  // Thursday = Monday + 3
  const thursday = new Date(monday)
  thursday.setUTCDate(monday.getUTCDate() + 3)

  const fmt = d => d.toISOString().slice(0, 10)
  return { start: fmt(friday), end: fmt(thursday) }
}
