import { describe, it, expect } from 'bun:test'
import { getDraft } from './routes/draft.js'

describe('getDraft', () => {
  it('returns draft bundle for latest week when no week specified', async () => {
    const result = await getDraft({})
    expect(result).toHaveProperty('week')
    expect(typeof result.week).toBe('number')
    expect(typeof result.draft).toBe('string')
    expect(result.draft.length).toBeGreaterThan(0)
    expect(result).toHaveProperty('review')
    expect(result).toHaveProperty('links')
    expect(result).toHaveProperty('evaluate')
    expect(Array.isArray(result.availableWeeks)).toBe(true)
    expect(result.availableWeeks.length).toBeGreaterThan(0)
  })

  it('returns draft for specific week', async () => {
    const result = await getDraft({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.draft).toContain('SNI')
  })

  it('returns 404 error for non-existent week', async () => {
    try {
      await getDraft({ week: '999' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('not found')
    }
  })

  it('returns null for missing companion files', async () => {
    const result = await getDraft({ week: '9' })
    // evaluate-week-9.json doesn't exist, should be null
    expect(result.evaluate).toBeNull()
  })

  it('review contains prohibited_found array when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.review) {
      expect(result.review).toHaveProperty('overall_pass')
      expect(Array.isArray(result.review.prohibited_found)).toBe(true)
    }
  })

  it('links contains summary and results when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.links) {
      expect(result.links).toHaveProperty('summary')
      expect(Array.isArray(result.links.results)).toBe(true)
    }
  })

  it('availableWeeks is sorted ascending', async () => {
    const result = await getDraft({})
    const sorted = [...result.availableWeeks].sort((a, b) => a - b)
    expect(result.availableWeeks).toEqual(sorted)
  })

  it('rejects invalid week param', async () => {
    try {
      await getDraft({ week: '../etc/passwd' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})
