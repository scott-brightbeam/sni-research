import { describe, it, expect } from 'bun:test'
import { getDraft, saveDraft, getDraftHistory } from './routes/draft.js'

describe('getDraft', () => {
  it('returns draft bundle for latest week when no week specified', async () => {
    const result = await getDraft({})
    expect(result).toHaveProperty('week')
    expect(typeof result.week).toBe('number')
    // draft may be null for weeks with articles but no draft file
    expect(result.draft === null || typeof result.draft === 'string').toBe(true)
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

  it('returns null draft for week without draft file', async () => {
    const result = await getDraft({ week: '999' })
    expect(result.week).toBe(999)
    expect(result.draft).toBeNull()
    expect(result.review).toBeNull()
    expect(result.links).toBeNull()
    expect(result.evaluate).toBeNull()
    expect(Array.isArray(result.availableWeeks)).toBe(true)
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

describe('saveDraft', () => {
  it('saves draft and returns full bundle', async () => {
    // Read original first so we can restore it
    const original = await getDraft({ week: '9' })
    const testContent = original.draft + '\n<!-- test edit -->'

    const result = await saveDraft({ week: '9' }, { draft: testContent })
    expect(result.week).toBe(9)
    expect(result.draft).toContain('<!-- test edit -->')
    expect(result).toHaveProperty('review')
    expect(result).toHaveProperty('links')
    expect(result).toHaveProperty('availableWeeks')

    // Restore original
    await saveDraft({ week: '9' }, { draft: original.draft })
  })

  it('rejects save to non-existent week', async () => {
    try {
      await saveDraft({ week: '999' }, { draft: 'test' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('not found')
    }
  })

  it('rejects empty draft content', async () => {
    try {
      await saveDraft({ week: '9' }, { draft: '' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('empty')
    }
  })

  it('rejects missing draft field', async () => {
    try {
      await saveDraft({ week: '9' }, {})
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('draft')
    }
  })
})

describe('getDraftHistory', () => {
  it('returns artifact existence map', async () => {
    const result = await getDraftHistory({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.artifacts.draft).toBe(true)
    expect(result.artifacts.review).toBe(true)
    expect(result.artifacts.links).toBe(true)
    expect(result.artifacts.evaluate).toBe(false)
  })

  it('rejects invalid week', async () => {
    try {
      await getDraftHistory({ week: 'abc' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})
