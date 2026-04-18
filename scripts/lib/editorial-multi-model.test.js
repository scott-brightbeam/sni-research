/**
 * editorial-multi-model.test.js — Tests for the editorial multi-model module
 *
 * Tests cost tracking, provider validation, and session cost management.
 * Does NOT test API calls (require real keys).
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  getSessionCosts,
  resetSessionCosts,
  validateProviders,
  availableEditorialProviders,
  buildAnthropicCreateOpts,
  callOpus,
} from './editorial-multi-model.js'

// ── Cost tracking ─────────────────────────────────────────

describe('session cost tracking', () => {
  beforeEach(() => {
    resetSessionCosts()
  })

  test('resetSessionCosts zeroes all providers', () => {
    const costs = getSessionCosts()
    expect(costs.opus.calls).toBe(0)
    expect(costs.opus.cost).toBe(0)
    expect(costs.gemini.calls).toBe(0)
    expect(costs.openai.calls).toBe(0)
    expect(costs.total).toBe(0)
  })

  test('getSessionCosts returns total across all providers', () => {
    const costs = getSessionCosts()
    // Total should be sum of all provider costs
    expect(costs.total).toBe(costs.opus.cost + costs.gemini.cost + costs.openai.cost)
  })

  test('costs have expected shape', () => {
    const costs = getSessionCosts()
    for (const provider of ['opus', 'gemini', 'openai']) {
      expect(costs[provider]).toHaveProperty('calls')
      expect(costs[provider]).toHaveProperty('inputTokens')
      expect(costs[provider]).toHaveProperty('outputTokens')
      expect(costs[provider]).toHaveProperty('cost')
    }
    expect(costs).toHaveProperty('total')
  })
})

// ── Provider validation ───────────────────────────────────

describe('provider validation', () => {
  test('validateProviders returns ready and missing fields', () => {
    const result = validateProviders()
    expect(result).toHaveProperty('ready')
    expect(result).toHaveProperty('missing')
    expect(Array.isArray(result.missing)).toBe(true)
  })

  test('availableEditorialProviders returns provider map', () => {
    const providers = availableEditorialProviders()
    expect(providers).toHaveProperty('anthropic')
    expect(providers).toHaveProperty('openai')
    expect(providers).toHaveProperty('gemini')
    expect(typeof providers.anthropic).toBe('boolean')
  })
})

// ── 1M-context beta header opt-in ─────────────────────────

describe('buildAnthropicCreateOpts', () => {
  test('returns undefined when no contextWindow passed', () => {
    expect(buildAnthropicCreateOpts(undefined)).toBeUndefined()
    expect(buildAnthropicCreateOpts(null)).toBeUndefined()
    expect(buildAnthropicCreateOpts('')).toBeUndefined()
  })

  test('returns the anthropic-beta header when contextWindow is "1m"', () => {
    const opts = buildAnthropicCreateOpts('1m')
    expect(opts).toBeDefined()
    expect(opts.headers).toBeDefined()
    expect(opts.headers['anthropic-beta']).toBe('context-1m-2025-08-07')
  })

  test('returns undefined for unknown contextWindow values', () => {
    expect(buildAnthropicCreateOpts('2m')).toBeUndefined()
    expect(buildAnthropicCreateOpts('large')).toBeUndefined()
  })
})

// ── SNI_TEST_MODE guard ───────────────────────────────────

describe('callOpus SNI_TEST_MODE guard', () => {
  test('throws when SNI_TEST_MODE=1, never hits the API', async () => {
    const prev = process.env.SNI_TEST_MODE
    process.env.SNI_TEST_MODE = '1'
    try {
      await expect(callOpus('hello')).rejects.toThrow(/SNI_TEST_MODE=1/)
    } finally {
      if (prev === undefined) delete process.env.SNI_TEST_MODE
      else process.env.SNI_TEST_MODE = prev
    }
  })
})
