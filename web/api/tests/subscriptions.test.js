import { describe, it, expect } from 'bun:test'

describe('GET /api/subscriptions', () => {
  it('returns configured sources', async () => {
    const resp = await fetch('http://localhost:3900/api/subscriptions')
    const data = await resp.json()
    expect(Array.isArray(data.sources)).toBe(true)
    expect(data.sources.length).toBeGreaterThan(0)
    expect(data.sources[0].name).toBeDefined()
  })
})
