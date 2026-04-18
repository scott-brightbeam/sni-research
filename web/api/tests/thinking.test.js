import { describe, it, expect } from 'bun:test'
import { isExtendedThinkingCapable, thinkingFor, maxTokensWithThinking } from '../lib/thinking.js'

describe('isExtendedThinkingCapable', () => {
  it('returns true for Opus 4 models', () => {
    expect(isExtendedThinkingCapable('claude-opus-4-6')).toBe(true)
    expect(isExtendedThinkingCapable('claude-opus-4-1')).toBe(true)
    expect(isExtendedThinkingCapable('claude-opus-4-6-20260101')).toBe(true)
  })

  it('returns false for Sonnet, Haiku and unknown models', () => {
    expect(isExtendedThinkingCapable('claude-sonnet-4-20250514')).toBe(false)
    expect(isExtendedThinkingCapable('claude-haiku-4-20250414')).toBe(false)
    expect(isExtendedThinkingCapable('gpt-4')).toBe(false)
    expect(isExtendedThinkingCapable('')).toBe(false)
    expect(isExtendedThinkingCapable(null)).toBe(false)
    expect(isExtendedThinkingCapable(undefined)).toBe(false)
  })
})

describe('thinkingFor', () => {
  it('returns empty object for non-Opus', () => {
    expect(thinkingFor('claude-sonnet-4-20250514')).toEqual({})
    expect(thinkingFor('claude-haiku-4-20250414')).toEqual({})
  })

  it('returns ADAPTIVE thinking for Opus 4.6 (not the deprecated enabled+budget)', () => {
    // Anthropic deprecated thinking.type=enabled for claude-opus-4-6 and
    // recommends thinking.type=adaptive. Using the deprecated form was
    // causing ECONNRESET on revision calls.
    expect(thinkingFor('claude-opus-4-6')).toEqual({
      thinking: { type: 'adaptive' },
    })
  })

  it('adaptive config does NOT include budget_tokens', () => {
    const out = thinkingFor('claude-opus-4-6')
    expect(out.thinking.budget_tokens).toBeUndefined()
  })
})

describe('maxTokensWithThinking', () => {
  it('returns baseOutput unchanged for non-Opus', () => {
    expect(maxTokensWithThinking('claude-sonnet-4-20250514', 16384)).toBe(16384)
  })

  it('adds the thinking budget to baseOutput for Opus', () => {
    expect(maxTokensWithThinking('claude-opus-4-6', 16384)).toBe(24384)
  })

  it('honours custom budget', () => {
    expect(maxTokensWithThinking('claude-opus-4-6', 16384, { budget: 4000 })).toBe(20384)
  })
})
