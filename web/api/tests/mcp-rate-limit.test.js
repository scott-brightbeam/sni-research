import { describe, it, expect, beforeEach, afterAll } from 'bun:test'
import { rateLimitCheck, _resetRateLimitForTests } from '../lib/mcp-rate-limit.js'

beforeEach(() => {
  _resetRateLimitForTests()
})

describe('rateLimitCheck', () => {
  it('allows up to 60 calls per minute per user', () => {
    const user = 'alice@brightbeam.com'
    for (let i = 0; i < 60; i++) {
      const r = rateLimitCheck(user)
      expect(r.ok).toBe(true)
    }
    const r = rateLimitCheck(user)
    expect(r.ok).toBe(false)
  })

  it('returns retryAfterSec when over limit', () => {
    const user = 'bob@brightbeam.com'
    for (let i = 0; i < 60; i++) rateLimitCheck(user)
    const r = rateLimitCheck(user)
    expect(r.ok).toBe(false)
    expect(typeof r.retryAfterSec).toBe('number')
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(r.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('separate users have independent buckets', () => {
    const a = 'a@brightbeam.com'
    const b = 'b@brightbeam.com'
    for (let i = 0; i < 60; i++) rateLimitCheck(a)
    expect(rateLimitCheck(a).ok).toBe(false)
    // b is still fresh
    for (let i = 0; i < 60; i++) {
      expect(rateLimitCheck(b).ok).toBe(true)
    }
  })

  it('window slides correctly past the minute boundary', () => {
    const user = 'slider@brightbeam.com'
    const realNow = Date.now
    let nowMs = 1_700_000_000_000
    Date.now = () => nowMs

    try {
      // Burn the bucket
      for (let i = 0; i < 60; i++) rateLimitCheck(user)
      expect(rateLimitCheck(user).ok).toBe(false)

      // Advance past the window
      nowMs += 61_000
      const r = rateLimitCheck(user)
      expect(r.ok).toBe(true)
    } finally {
      Date.now = realNow
    }
  })
})

afterAll(() => {
  _resetRateLimitForTests()
})
