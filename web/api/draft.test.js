import { describe, it, expect } from 'bun:test'
import { existsSync } from 'fs'
import { join } from 'path'
import { getDraft, saveDraft, getDraftHistory } from './routes/draft.js'

// These tests depend on locally-generated fixtures under output/drafts/
// (gitignored). Skip when the fixture directory is absent, most notably
// on CI. Run the drafting pipeline locally first if you want them to
// execute.
const DRAFTS_DIR = join(import.meta.dir, '..', '..', 'output', 'drafts')
const hasFixtures = existsSync(DRAFTS_DIR)
const itLocal = hasFixtures ? it : it.skip

describe('getDraft', () => {
  itLocal('returns draft bundle for latest week when no week specified', async () => {
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

  itLocal('returns draft for specific week', async () => {
    const result = await getDraft({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.draft).toContain('SNI')
  })

  itLocal('returns null draft for week without draft file', async () => {
    const result = await getDraft({ week: '999' })
    expect(result.week).toBe(999)
    expect(result.draft).toBeNull()
    expect(result.review).toBeNull()
    expect(result.links).toBeNull()
    expect(result.evaluate).toBeNull()
    expect(Array.isArray(result.availableWeeks)).toBe(true)
  })

  itLocal('returns null for missing companion files', async () => {
    const result = await getDraft({ week: '9' })
    // evaluate-week-9.json doesn't exist, should be null
    expect(result.evaluate).toBeNull()
  })

  itLocal('review contains prohibited_found array when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.review) {
      expect(result.review).toHaveProperty('overall_pass')
      expect(Array.isArray(result.review.prohibited_found)).toBe(true)
    }
  })

  itLocal('links contains summary and results when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.links) {
      expect(result.links).toHaveProperty('summary')
      expect(Array.isArray(result.links.results)).toBe(true)
    }
  })

  itLocal('availableWeeks is sorted ascending', async () => {
    const result = await getDraft({})
    const sorted = [...result.availableWeeks].sort((a, b) => a - b)
    expect(result.availableWeeks).toEqual(sorted)
  })

  itLocal('rejects invalid week param', async () => {
    try {
      await getDraft({ week: '../etc/passwd' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})

describe('saveDraft', () => {
  itLocal('saves draft and returns full bundle', async () => {
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

  itLocal('rejects save to non-existent week', async () => {
    try {
      await saveDraft({ week: '999' }, { draft: 'test' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('not found')
    }
  })

  itLocal('rejects empty draft content', async () => {
    try {
      await saveDraft({ week: '9' }, { draft: '' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('empty')
    }
  })

  itLocal('rejects missing draft field', async () => {
    try {
      await saveDraft({ week: '9' }, {})
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('draft')
    }
  })
})

describe('getDraftHistory', () => {
  itLocal('returns artifact existence map', async () => {
    const result = await getDraftHistory({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.artifacts.draft).toBe(true)
    expect(result.artifacts.review).toBe(true)
    expect(result.artifacts.links).toBe(true)
    expect(result.artifacts.evaluate).toBe(false)
  })

  itLocal('rejects invalid week', async () => {
    try {
      await getDraftHistory({ week: 'abc' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})
