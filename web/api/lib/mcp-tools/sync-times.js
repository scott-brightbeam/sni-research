const SLOTS = [[7, 40], [13, 0], [22, 0]]

/**
 * Returns the next 07:40/13:00/22:00 UK-time sync slot as a UTC ISO string.
 * DST-aware: BST → +01:00 in summer, GMT → +00:00 in winter.
 */
export function nextSyncTimestamp(now = new Date(), zone = 'Europe/London') {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const ukParts = parts(fmt, now)
  const todayMins = ukParts.hour * 60 + ukParts.minute

  for (const [h, m] of SLOTS) {
    if (h * 60 + m > todayMins) {
      return ukSlotToISO(ukParts.year, ukParts.month, ukParts.day, h, m, zone)
    }
  }
  // All slots passed today — first slot tomorrow
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  const tParts = parts(fmt, tomorrow)
  return ukSlotToISO(tParts.year, tParts.month, tParts.day, SLOTS[0][0], SLOTS[0][1], zone)
}

function parts(fmt, date) {
  const obj = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]))
  return {
    year: +obj.year, month: +obj.month, day: +obj.day,
    hour: +obj.hour, minute: +obj.minute,
  }
}

/**
 * Convert a UK wall-clock (yyyy-mm-dd hh:mm) to a UTC ISO string.
 * Uses Intl to compute the offset in effect for that wall-clock instant.
 */
function ukSlotToISO(yyyy, mm, dd, hh, min, zone) {
  // Construct a tentative UTC date, then check what wall-clock it produces
  // in the target zone, and adjust by the difference. Two iterations cover
  // the DST-transition edge cases (one hour disappears in spring, repeats
  // in autumn — the fallthrough on the second pass handles both).
  const utc = Date.UTC(yyyy, mm - 1, dd, hh, min, 0)
  let result = new Date(utc)
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    })
    const p = parts(fmt, result)
    const targetMins = hh * 60 + min
    const actualMins = p.hour * 60 + p.minute
    const diffMins = targetMins - actualMins
    if (diffMins === 0) return result.toISOString()
    result = new Date(result.getTime() + diffMins * 60 * 1000)
  }
  // If we still didn't converge (DST-gap edge case), return what we have —
  // the caller's "queuedFor" hint can be off by an hour during the spring
  // forward window; documented in the SKILL lag note.
  return result.toISOString()
}
