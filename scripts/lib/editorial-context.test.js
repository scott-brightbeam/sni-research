/**
 * editorial-context.test.js — Tests for the editorial context assembly module
 *
 * Tests token estimation, budget trimming, system prompt composition,
 * and context assembly for ANALYSE, DRAFT, and CHAT modes.
 */

import { describe, test, expect } from 'bun:test'
import {
  estimateTokens,
  trimToTokenBudget,
  buildSystemPrompt,
  BUDGETS,
} from './editorial-context.js'

// ── estimateTokens ────────────────────────────────────────

describe('estimateTokens', () => {
  test('returns 0 for empty or null input', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens(null)).toBe(0)
    expect(estimateTokens(undefined)).toBe(0)
  })

  test('estimates roughly 1 token per 4 chars', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })

  test('rounds up for non-exact multiples', () => {
    const text = 'a'.repeat(401)
    expect(estimateTokens(text)).toBe(101) // ceil(401/4)
  })
})

// ── trimToTokenBudget ─────────────────────────────────────

describe('trimToTokenBudget', () => {
  test('returns empty string for null input', () => {
    expect(trimToTokenBudget(null, 100)).toBe('')
    expect(trimToTokenBudget('', 100)).toBe('')
  })

  test('returns text unchanged when within budget', () => {
    const text = 'Hello world'
    expect(trimToTokenBudget(text, 100)).toBe(text)
  })

  test('trims text that exceeds budget', () => {
    const text = 'a'.repeat(2000) // 500 tokens
    const result = trimToTokenBudget(text, 100) // budget = 100 tokens = 400 chars
    expect(result.length).toBeLessThan(text.length)
    expect(result).toContain('[...truncated to fit context budget]')
  })

  test('trimmed text starts with original content', () => {
    const text = 'The quick brown fox ' + 'x'.repeat(2000)
    const result = trimToTokenBudget(text, 10) // 10 tokens = 40 chars
    expect(result.startsWith('The quick brown fox ')).toBe(true)
  })
})

// ── buildSystemPrompt ─────────────────────────────────────

describe('buildSystemPrompt', () => {
  test('includes editorial context for all modes', () => {
    for (const mode of ['analyse', 'draft', 'chat']) {
      const prompt = buildSystemPrompt(mode)
      // Should contain the editorial voice prompt (phrasing updated Apr 2026)
      expect(prompt).toContain('LinkedIn post generator')
      // Should contain mode indicator
      expect(prompt).toContain(`MODE: ${mode.toUpperCase()}`)
    }
  })

  test('analyse mode includes JSON schema from analyse prompt', () => {
    const prompt = buildSystemPrompt('analyse')
    expect(prompt).toContain('analysisEntries')
    expect(prompt).toContain('themeUpdates')
    expect(prompt).toContain('storyReferences')
    expect(prompt).toContain('postCandidates')
    expect(prompt).toContain('crossConnections')
  })

  test('analyse mode includes quality rules', () => {
    const prompt = buildSystemPrompt('analyse')
    expect(prompt).toContain('Evidence quality')
    expect(prompt).toContain('Theme codes')
    expect(prompt).toContain('Post candidates')
  })

  test('draft mode includes newsletter structure', () => {
    const prompt = buildSystemPrompt('draft')
    // Newsletter name: Sector News Intelligence (renamed from Second Nature Intelligence)
    expect(prompt).toContain('Sector News Intelligence')
    expect(prompt).toContain('UK English')
  })

  test('chat mode includes editorial assistant role', () => {
    const prompt = buildSystemPrompt('chat')
    expect(prompt).toContain('editorial assistant')
    expect(prompt).toContain('theme codes')
  })

  test('prompt is within budget for analyse mode', () => {
    const prompt = buildSystemPrompt('analyse')
    const tokens = estimateTokens(prompt)
    expect(tokens).toBeLessThan(BUDGETS.analyse.systemPrompt)
  })
})

// ── BUDGETS ──────────────────────────────────────────────

describe('BUDGETS', () => {
  test('analyse budget totals to 65k (reduced from 80k Mar 2026)', () => {
    expect(BUDGETS.analyse.total).toBe(65000)
  })

  test('draft budget matches the BUDGETS.draft.total constant', () => {
    // Total is defined in scripts/lib/editorial-context.js — bump this
    // assertion when the source constant is bumped. Currently 150k.
    expect(BUDGETS.draft.total).toBe(150000)
  })

  test('chat budgets have all expected tabs', () => {
    expect(BUDGETS.chat.state).toBeDefined()
    expect(BUDGETS.chat.themes).toBeDefined()
    expect(BUDGETS.chat.backlog).toBeDefined()
    expect(BUDGETS.chat.decisions).toBeDefined()
    expect(BUDGETS.chat.activity).toBeDefined()
  })
})
