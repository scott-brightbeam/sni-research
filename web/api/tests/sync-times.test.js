import { describe, it, expect } from 'bun:test'
import { nextSyncTimestamp } from '../lib/mcp-tools/sync-times.js'

// Helper: build a Date representing a specific UK wall-clock instant.
// BST=+01:00 in summer, GMT=+00:00 in winter. Subtract offsetH from
// UK wall-clock to get UTC.
function ukDate(yyyy, mm, dd, hh, min, isBST = false) {
  const offsetH = isBST ? -1 : 0
  return new Date(Date.UTC(yyyy, mm - 1, dd, hh + offsetH, min, 0))
}

describe('nextSyncTimestamp', () => {
  it('returns 07:40 today when called at 07:35 UK', () => {
    const now = ukDate(2026, 1, 15, 7, 35)  // 07:35 GMT (winter)
    const got = nextSyncTimestamp(now)
    expect(got).toMatch(/^2026-01-15T07:40:00/)
  })

  it('returns 13:00 today when called at 07:45 UK', () => {
    const now = ukDate(2026, 1, 15, 7, 45)
    const got = nextSyncTimestamp(now)
    expect(got).toMatch(/^2026-01-15T13:00:00/)
  })

  it('returns 07:40 next day when called at 23:00 UK', () => {
    const now = ukDate(2026, 1, 15, 23, 0)
    const got = nextSyncTimestamp(now)
    expect(got).toMatch(/^2026-01-16T07:40:00/)
  })

  it('handles BST→GMT autumn transition without throwing', () => {
    // Late October — BST → GMT happens last Sunday of October
    const now = new Date(Date.UTC(2026, 9, 25, 12, 0, 0))  // 25 Oct 2026 midday UTC
    const got = nextSyncTimestamp(now)
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})
