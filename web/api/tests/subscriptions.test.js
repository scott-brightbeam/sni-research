import { describe, it, expect } from 'bun:test'

describe('GET /api/subscriptions', () => {
  it('returns configured sources', async () => {
    const resp = await fetch('http://localhost:3900/api/subscriptions')
    const data = await resp.json()
    expect(Array.isArray(data.sources)).toBe(true)
    expect(data.sources.length).toBeGreaterThan(0)
    expect(data.sources[0].name).toBeDefined()
  })

  it('each source has expected fields', async () => {
    const resp = await fetch('http://localhost:3900/api/subscriptions')
    const data = await resp.json()
    for (const s of data.sources) {
      expect(s.name).toBeDefined()
      expect(s.type).toBeDefined()
      expect(typeof s.hasCredentials).toBe('boolean')
      // lastRun may be null
      if (s.lastRun) {
        expect(s.lastRun.date).toBeDefined()
        expect(typeof s.lastRun.success).toBe('boolean')
      }
    }
  })
})

describe('PUT /api/subscriptions/credentials', () => {
  it('rejects missing sources array with 400', async () => {
    const resp = await fetch('http://localhost:3900/api/subscriptions/credentials', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    })
    expect(resp.status).toBe(400)
    const data = await resp.json()
    expect(data.error).toContain('sources array required')
  })
})

describe('POST /api/subscriptions/fetch', () => {
  it('accepts empty body gracefully', async () => {
    // Sending POST with no body should not throw — triggerFetch handles missing source
    const resp = await fetch('http://localhost:3900/api/subscriptions/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    // May return started:true or fail if node/script missing — but should not be 500 from JSON parse
    expect(resp.status).not.toBe(500)
  })
})
