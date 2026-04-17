import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks } from './dateRange.js'

// Pin "today" to Wednesday 2026-03-04 for deterministic tests
const REAL_DATE = globalThis.Date
const FAKE_NOW = new Date('2026-03-04T12:00:00Z')

beforeEach(() => {
  globalThis.Date = class extends REAL_DATE {
    constructor(...args) {
      if (args.length === 0) return super(FAKE_NOW.getTime())
      return super(...args)
    }
    static now() { return FAKE_NOW.getTime() }
  }
})

afterEach(() => {
  globalThis.Date = REAL_DATE
})

describe('getDateRange', () => {
  it('week returns Friday of the current editorial week to today', () => {
    const { startDate, endDate } = getDateRange('week')
    // Editorial week starts Friday (newsletter window Fri–Thu).
    // 2026-03-04 is Wednesday -> last Friday is 2026-02-27.
    expect(startDate).toBe('2026-02-27')
    expect(endDate).toBe('2026-03-04')
  })

  it('7d returns today minus 6 days to today', () => {
    const { startDate, endDate } = getDateRange('7d')
    expect(startDate).toBe('2026-02-26')
    expect(endDate).toBe('2026-03-04')
  })

  it('30d returns today minus 29 days to today', () => {
    const { startDate, endDate } = getDateRange('30d')
    expect(startDate).toBe('2026-02-03')
    expect(endDate).toBe('2026-03-04')
  })

  it('all returns null bounds', () => {
    const { startDate, endDate } = getDateRange('all')
    expect(startDate).toBeNull()
    expect(endDate).toBeNull()
  })
})

describe('filterByDateEntries', () => {
  const byDate = {
    '2026-02-28': 3,
    '2026-03-01': 5,
    '2026-03-02': 2,
    '2026-03-03': 7,
    '2026-03-04': 1,
  }

  it('filters to range', () => {
    const result = filterByDateEntries(byDate, '2026-03-01', '2026-03-03')
    expect(result).toEqual({ '2026-03-01': 5, '2026-03-02': 2, '2026-03-03': 7 })
  })

  it('null bounds returns everything', () => {
    const result = filterByDateEntries(byDate, null, null)
    expect(result).toEqual(byDate)
  })

  it('null startDate returns up to endDate', () => {
    const result = filterByDateEntries(byDate, null, '2026-03-01')
    expect(result).toEqual({ '2026-02-28': 3, '2026-03-01': 5 })
  })

  it('null endDate returns from startDate onward', () => {
    const result = filterByDateEntries(byDate, '2026-03-03', null)
    expect(result).toEqual({ '2026-03-03': 7, '2026-03-04': 1 })
  })

  it('empty object returns empty', () => {
    expect(filterByDateEntries({}, '2026-03-01', '2026-03-04')).toEqual({})
  })
})

describe('fillCalendarGaps', () => {
  it('fills missing days with zero', () => {
    const result = fillCalendarGaps({ '2026-03-01': 5, '2026-03-04': 2 })
    expect(result).toEqual([
      ['2026-03-01', 5],
      ['2026-03-02', 0],
      ['2026-03-03', 0],
      ['2026-03-04', 2],
    ])
  })

  it('single entry returns single entry', () => {
    const result = fillCalendarGaps({ '2026-03-01': 3 })
    expect(result).toEqual([['2026-03-01', 3]])
  })

  it('empty object returns empty array', () => {
    expect(fillCalendarGaps({})).toEqual([])
  })

  it('already contiguous returns sorted entries', () => {
    const result = fillCalendarGaps({ '2026-03-02': 1, '2026-03-01': 2 })
    expect(result).toEqual([['2026-03-01', 2], ['2026-03-02', 1]])
  })
})

describe('aggregateToWeeks', () => {
  it('aggregates daily entries into ISO week buckets', () => {
    // 2026-03-02 is W10 Monday, 2026-03-09 is W11 Monday
    const entries = [
      ['2026-03-02', 3], // W10
      ['2026-03-03', 2], // W10
      ['2026-03-04', 1], // W10
      ['2026-03-09', 5], // W11
      ['2026-03-10', 4], // W11
    ]
    const result = aggregateToWeeks(entries)
    expect(result).toEqual([
      ['W10', 6],
      ['W11', 9],
    ])
  })

  it('empty input returns empty array', () => {
    expect(aggregateToWeeks([])).toEqual([])
  })
})
