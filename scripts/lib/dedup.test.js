import { describe, it, expect } from 'bun:test'
import { textSimilarity, loadThresholds } from './dedup.js'

describe('textSimilarity', () => {
  it('returns 1.0 for identical texts', () => {
    expect(textSimilarity('hello world', 'hello world')).toBe(1.0)
  })

  it('returns 0.0 for completely different texts', () => {
    expect(textSimilarity('apple banana cherry', 'xylophone zebra quilt')).toBe(0.0)
  })

  it('returns value between 0 and 1 for partial overlap', () => {
    const score = textSimilarity(
      'OpenAI launched GPT-5 for enterprise customers',
      'OpenAI released GPT-5 targeting enterprise market'
    )
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(1)
  })

  it('ignores stop words', () => {
    const withStops = textSimilarity('the OpenAI is in the market', 'OpenAI market')
    expect(withStops).toBeGreaterThan(0.5)
  })

  it('handles empty strings', () => {
    expect(textSimilarity('', '')).toBe(0)
    expect(textSimilarity('hello', '')).toBe(0)
    expect(textSimilarity('', 'hello')).toBe(0)
  })

  it('is case insensitive', () => {
    expect(textSimilarity('OpenAI GPT', 'openai gpt')).toBe(1.0)
  })
})

describe('loadThresholds', () => {
  it('returns tier1 and tier2 numeric values', () => {
    const t = loadThresholds()
    expect(typeof t.tier1).toBe('number')
    expect(typeof t.tier2).toBe('number')
    expect(t.tier1).toBeGreaterThan(0)
    expect(t.tier1).toBeLessThan(1)
    expect(t.tier2).toBeGreaterThan(0)
    expect(t.tier2).toBeLessThan(1)
  })
})
