import { describe, it, expect } from 'bun:test'
import { getISOWeek, getWeekDateRange } from './lib/week.js'

describe('getISOWeek', () => {
  it('returns week 1 for Jan 1 2026 (Thursday)', () => {
    expect(getISOWeek(new Date('2026-01-01'))).toBe(1)
  })

  it('returns week 9 for Feb 23 2026 (Monday)', () => {
    expect(getISOWeek(new Date('2026-02-23'))).toBe(9)
  })

  it('returns week 10 for Mar 4 2026 (Wednesday)', () => {
    expect(getISOWeek(new Date('2026-03-04'))).toBe(10)
  })

  it('handles year boundary — Dec 31 2025 (Wednesday) is week 1 of 2026', () => {
    expect(getISOWeek(new Date('2025-12-31'))).toBe(1)
  })

  it('handles year boundary — Dec 29 2025 (Monday) is week 1 of 2026', () => {
    expect(getISOWeek(new Date('2025-12-29'))).toBe(1)
  })

  it('returns current week when called with no args', () => {
    const result = getISOWeek()
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(53)
  })
})

describe('getWeekDateRange', () => {
  it('returns Friday-Thursday for week 9 2026', () => {
    const { start, end } = getWeekDateRange(9, 2026)
    expect(start).toBe('2026-02-20')  // Friday
    expect(end).toBe('2026-02-26')    // Thursday
  })

  it('returns Friday-Thursday for week 10 2026', () => {
    const { start, end } = getWeekDateRange(10, 2026)
    expect(start).toBe('2026-02-27')  // Friday
    expect(end).toBe('2026-03-05')    // Thursday
  })

  it('handles year boundary — week 1 of 2026', () => {
    const { start, end } = getWeekDateRange(1, 2026)
    expect(start).toBe('2025-12-26')  // Friday
    expect(end).toBe('2026-01-01')    // Thursday
  })
})
