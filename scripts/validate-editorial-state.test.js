/**
 * Tests for validate-editorial-state.js
 * Run: bun test scripts/validate-editorial-state.test.js
 */

import { describe, it, expect } from 'bun:test'
import {
  validateEditorialState,
  validatePostBacklog,
  validateAnalysisIndex,
  validateThemeRegistry,
  validateCounters,
} from './validate-editorial-state.js'

// ── Factory ─────────────────────────────────────────────

function makeValidState(overrides = {}) {
  return {
    counters: { nextSession: 10, nextDocument: 20, nextPost: 15 },
    analysisIndex: {
      '1': {
        title: 'Test Analysis',
        source: 'Test Podcast',
        session: 5,
        tier: 1,
        status: 'active',
        themes: ['T01', 'T03'],
        summary: 'A detailed summary that is certainly longer than fifty characters for validation purposes.',
        filename: 'test-episode.md',
      },
    },
    themeRegistry: {
      'T01': {
        name: 'Enterprise Diffusion Gap',
        documentCount: 5,
        evidence: [
          { session: 5, source: 'Test Podcast', content: 'Evidence content that explains the theme.' },
        ],
      },
    },
    postBacklog: {
      '1': {
        title: 'Why AI adoption stalls at the enterprise level',
        status: 'suggested',
        priority: 'medium',
        format: 'Format 2: The News Decoder',
        freshness: 'timely',
        coreArgument: 'A sufficiently long core argument that exceeds the fifty character minimum.',
        notes: 'Editorial notes that also need to be longer than fifty characters to pass validation.',
        sourceDocuments: ['doc-1', 'doc-2'],
        session: 5,
      },
    },
    decisionLog: [{ session: 5, decision: 'Test decision' }],
    ...overrides,
  }
}

function hasError(result, code) {
  return result.errors.some(e => e.code === code)
}

function hasWarning(result, code) {
  return result.warnings.some(w => w.code === code)
}

// ── validateEditorialState (top-level) ──────────────────

describe('validateEditorialState', () => {
  it('valid state returns valid: true with 0 errors', () => {
    const result = validateEditorialState(makeValidState())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('null state returns valid: false', () => {
    const result = validateEditorialState(null)
    expect(result.valid).toBe(false)
    expect(hasError(result, 'STATE_NULL')).toBe(true)
  })

  it('missing required sections are flagged', () => {
    const result = validateEditorialState({})
    expect(result.valid).toBe(false)
    expect(result.errors.filter(e => e.code === 'SECTION_MISSING')).toHaveLength(5)
  })

  it('decisionLog that is not an array is flagged', () => {
    const state = makeValidState({ decisionLog: 'not an array' })
    const result = validateEditorialState(state)
    expect(hasError(result, 'DECISION_LOG_TYPE')).toBe(true)
  })
})

// ── validatePostBacklog ─────────────────────────────────

describe('validatePostBacklog', () => {
  it('valid post returns 0 errors', () => {
    const state = makeValidState()
    const result = validatePostBacklog(state.postBacklog)
    expect(result.errors).toHaveLength(0)
  })

  it('title > 100 chars triggers POST_TITLE_LENGTH', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        title: 'A'.repeat(142),
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_TITLE_LENGTH')).toBe(true)
    expect(result.errors[0].message).toContain('142 chars')
  })

  it('invalid format triggers POST_FORMAT', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        format: 'data-driven argument',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_FORMAT')).toBe(true)
  })

  it('null format on archived post is allowed', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        status: 'archived',
        format: null,
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_FORMAT')).toBe(false)
  })

  it('null format on non-archived post is allowed', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        format: null,
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_FORMAT')).toBe(false)
  })

  it('invalid freshness triggers POST_FRESHNESS', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        freshness: 'stale',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_FRESHNESS')).toBe(true)
  })

  it('null freshness is allowed', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        freshness: null,
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_FRESHNESS')).toBe(false)
  })

  it('invalid status triggers POST_STATUS', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        status: 'pending',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_STATUS')).toBe(true)
  })

  it('uppercase priority triggers POST_PRIORITY_CASE', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        priority: 'HIGH',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_PRIORITY_CASE')).toBe(true)
    expect(result.errors[0].message).toContain('should be lowercase')
  })

  it('completely invalid priority triggers POST_PRIORITY', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        priority: 'critical',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_PRIORITY')).toBe(true)
  })

  it('non-array sourceDocuments triggers POST_SOURCE_DOCS_TYPE', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        sourceDocuments: 'doc-1',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_SOURCE_DOCS_TYPE')).toBe(true)
  })

  it('non-string element in sourceDocuments triggers POST_SOURCE_DOCS_TYPE', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        sourceDocuments: ['doc-1', 42],
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_SOURCE_DOCS_TYPE')).toBe(true)
  })

  it('short coreArgument on non-archived triggers POST_CORE_ARGUMENT', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        coreArgument: 'Too short',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_CORE_ARGUMENT')).toBe(true)
  })

  it('short coreArgument on archived post is allowed', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        status: 'archived',
        coreArgument: 'Short',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_CORE_ARGUMENT')).toBe(false)
  })

  it('short notes on non-archived triggers POST_NOTES', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        notes: 'Brief',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_NOTES')).toBe(true)
  })

  it('short notes on archived post is allowed', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        status: 'archived',
        notes: 'Brief',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_NOTES')).toBe(false)
  })

  it('stale field present triggers POST_STALE_FIELD', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        sourceUrl: 'https://example.com',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_STALE_FIELD')).toBe(true)
    expect(result.errors[0].message).toContain('sourceUrl')
  })

  it('multiple stale fields each produce an error', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        sourceUrl: 'https://example.com',
        url: 'https://example.com',
        themes: ['T01'],
      },
    }
    const result = validatePostBacklog(posts)
    const staleErrors = result.errors.filter(e => e.code === 'POST_STALE_FIELD')
    expect(staleErrors).toHaveLength(3)
  })

  it('average title > 60 chars triggers POST_AVG_TITLE_LENGTH warning', () => {
    const posts = {}
    for (let i = 1; i <= 5; i++) {
      posts[String(i)] = {
        ...makeValidState().postBacklog['1'],
        title: 'A'.repeat(70), // all 70 chars → avg = 70
      }
    }
    const result = validatePostBacklog(posts)
    expect(hasWarning(result, 'POST_AVG_TITLE_LENGTH')).toBe(true)
  })

  it('average title <= 60 chars produces no warning', () => {
    const posts = {
      '1': {
        ...makeValidState().postBacklog['1'],
        title: 'Short title',
      },
    }
    const result = validatePostBacklog(posts)
    expect(hasWarning(result, 'POST_AVG_TITLE_LENGTH')).toBe(false)
  })

  it('missing postBacklog triggers POST_BACKLOG_MISSING', () => {
    const result = validatePostBacklog(null)
    expect(hasError(result, 'POST_BACKLOG_MISSING')).toBe(true)
  })
})

// ── validateAnalysisIndex ───────────────────────────────

describe('validateAnalysisIndex', () => {
  it('valid analysis returns 0 errors', () => {
    const state = makeValidState()
    const result = validateAnalysisIndex(state.analysisIndex)
    expect(result.errors).toHaveLength(0)
  })

  it('missing session triggers ANALYSIS_SESSION_MISSING', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], session: undefined },
    }
    delete index['1'].session
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_SESSION_MISSING')).toBe(true)
  })

  it('non-number session triggers ANALYSIS_SESSION_TYPE', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], session: '5' },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_SESSION_TYPE')).toBe(true)
  })

  it('invalid tier triggers ANALYSIS_TIER', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], tier: 3 },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_TIER')).toBe(true)
  })

  it('valid tiers -1, 0, 1, 2 all accepted', () => {
    for (const tier of [-1, 0, 1, 2]) {
      const index = {
        '1': { ...makeValidState().analysisIndex['1'], tier },
      }
      const result = validateAnalysisIndex(index)
      expect(hasError(result, 'ANALYSIS_TIER')).toBe(false)
    }
  })

  it('invalid analysis status triggers ANALYSIS_STATUS', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], status: 'suggested' },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_STATUS')).toBe(true)
  })

  it('valid analysis statuses all accepted', () => {
    for (const status of ['active', 'retired', 'stub', 'unknown']) {
      const index = {
        '1': { ...makeValidState().analysisIndex['1'], status },
      }
      const result = validateAnalysisIndex(index)
      expect(hasError(result, 'ANALYSIS_STATUS')).toBe(false)
    }
  })

  it('invalid theme code in analysis triggers ANALYSIS_THEME_CODE', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], themes: ['T01', 'INVALID'] },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_THEME_CODE')).toBe(true)
  })

  it('empty themes array is valid', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], themes: [] },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_THEME_CODE')).toBe(false)
  })

  it('short summary on tier-1 active triggers ANALYSIS_SUMMARY_SHORT', () => {
    const index = {
      '1': {
        ...makeValidState().analysisIndex['1'],
        tier: 1,
        status: 'active',
        summary: 'Too short',
      },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_SUMMARY_SHORT')).toBe(true)
  })

  it('short summary on tier-0 is allowed', () => {
    const index = {
      '1': {
        ...makeValidState().analysisIndex['1'],
        tier: 0,
        status: 'active',
        summary: 'Short',
      },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_SUMMARY_SHORT')).toBe(false)
  })

  it('duplicate filenames trigger ANALYSIS_DUPLICATE_FILENAME', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'], filename: 'episode.md' },
      '2': { ...makeValidState().analysisIndex['1'], filename: 'Episode.md', session: 6 },
    }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_DUPLICATE_FILENAME')).toBe(true)
  })

  it('entries without filename produce ANALYSIS_MISSING_FILENAME warning', () => {
    const index = {
      '1': { ...makeValidState().analysisIndex['1'] },
      '2': (() => {
        const e = { ...makeValidState().analysisIndex['1'], session: 6 }
        delete e.filename
        return e
      })(),
    }
    const result = validateAnalysisIndex(index)
    expect(hasWarning(result, 'ANALYSIS_MISSING_FILENAME')).toBe(true)
    expect(result.warnings[0].message).toContain('1 analysis entries missing filename')
  })

  it('missing analysisIndex triggers ANALYSIS_INDEX_MISSING', () => {
    const result = validateAnalysisIndex(null)
    expect(hasError(result, 'ANALYSIS_INDEX_MISSING')).toBe(true)
  })
})

// ── validateThemeRegistry ───────────────────────────────

describe('validateThemeRegistry', () => {
  it('valid theme returns 0 errors', () => {
    const state = makeValidState()
    const result = validateThemeRegistry(state.themeRegistry)
    expect(result.errors).toHaveLength(0)
  })

  it('theme code not matching T## pattern triggers THEME_CODE', () => {
    const registry = {
      'INVALID': {
        name: 'Bad Theme',
        documentCount: 1,
        evidence: [{ session: 1, source: 'test', content: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_CODE')).toBe(true)
  })

  it('theme with T100 (three digits) triggers THEME_CODE', () => {
    const registry = {
      'T100': {
        name: 'Three Digit Theme',
        documentCount: 1,
        evidence: [{ session: 1, source: 'test', content: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_CODE')).toBe(true)
  })

  it('missing theme name triggers THEME_NAME', () => {
    const registry = {
      'T01': {
        name: '',
        documentCount: 1,
        evidence: [{ session: 1, source: 'test', content: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_NAME')).toBe(true)
  })

  it('documentCount < evidence.length triggers THEME_DOC_COUNT', () => {
    const registry = {
      'T01': {
        name: 'Test Theme',
        documentCount: 1,
        evidence: [
          { session: 1, source: 'a', content: 'a' },
          { session: 2, source: 'b', content: 'b' },
          { session: 3, source: 'c', content: 'c' },
        ],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_DOC_COUNT')).toBe(true)
  })

  it('documentCount > evidence.length is allowed (evidence trimmed to 12)', () => {
    const registry = {
      'T01': {
        name: 'Test Theme',
        documentCount: 50,
        evidence: [
          { session: 1, source: 'a', content: 'a' },
        ],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_DOC_COUNT')).toBe(false)
  })

  it('evidence with missing session triggers THEME_EVIDENCE_SESSION', () => {
    const registry = {
      'T01': {
        name: 'Test Theme',
        documentCount: 1,
        evidence: [{ source: 'test', content: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_EVIDENCE_SESSION')).toBe(true)
  })

  it('evidence with missing source triggers THEME_EVIDENCE_SOURCE', () => {
    const registry = {
      'T01': {
        name: 'Test Theme',
        documentCount: 1,
        evidence: [{ session: 1, content: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_EVIDENCE_SOURCE')).toBe(true)
  })

  it('evidence with missing content triggers THEME_EVIDENCE_CONTENT', () => {
    const registry = {
      'T01': {
        name: 'Test Theme',
        documentCount: 1,
        evidence: [{ session: 1, source: 'test' }],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_EVIDENCE_CONTENT')).toBe(true)
  })

  it('stale theme produces THEME_STALE warning', () => {
    const registry = {
      'T01': {
        name: 'Stale Theme',
        documentCount: 2,
        evidence: [
          { session: 1, source: 'a', content: 'a' },
          { session: 2, source: 'b', content: 'b' },
        ],
      },
      'T02': {
        name: 'Fresh Theme',
        documentCount: 1,
        evidence: [
          { session: 50, source: 'c', content: 'c' },
        ],
      },
    }
    const result = validateThemeRegistry(registry)
    expect(hasWarning(result, 'THEME_STALE')).toBe(true)
    expect(result.warnings.find(w => w.code === 'THEME_STALE').id).toBe('T01')
  })

  it('missing themeRegistry triggers THEME_REGISTRY_MISSING', () => {
    const result = validateThemeRegistry(null)
    expect(hasError(result, 'THEME_REGISTRY_MISSING')).toBe(true)
  })
})

// ── validateCounters ────────────────────────────────────

describe('validateCounters', () => {
  it('valid counters return 0 errors', () => {
    const state = makeValidState()
    const result = validateCounters(state.counters, state.analysisIndex, state.postBacklog)
    expect(result.errors).toHaveLength(0)
  })

  it('missing counter field triggers COUNTER_MISSING', () => {
    const result = validateCounters(
      { nextSession: 10, nextDocument: 20 }, // missing nextPost
      {},
      {},
    )
    expect(hasError(result, 'COUNTER_MISSING')).toBe(true)
  })

  it('non-number counter triggers COUNTER_TYPE', () => {
    const result = validateCounters(
      { nextSession: '10', nextDocument: 20, nextPost: 15 },
      {},
      {},
    )
    expect(hasError(result, 'COUNTER_TYPE')).toBe(true)
  })

  it('zero counter triggers COUNTER_ZERO', () => {
    const result = validateCounters(
      { nextSession: 0, nextDocument: 20, nextPost: 15 },
      {},
      {},
    )
    expect(hasError(result, 'COUNTER_ZERO')).toBe(true)
  })

  it('nextDocument behind max analysis ID triggers COUNTER_BEHIND', () => {
    const result = validateCounters(
      { nextSession: 10, nextDocument: 5, nextPost: 15 },
      { '10': { session: 5 } },
      {},
    )
    expect(hasError(result, 'COUNTER_BEHIND')).toBe(true)
    expect(result.errors.find(e => e.code === 'COUNTER_BEHIND').id).toBe('nextDocument')
  })

  it('nextPost behind max post ID triggers COUNTER_BEHIND', () => {
    const result = validateCounters(
      { nextSession: 10, nextDocument: 20, nextPost: 5 },
      {},
      { '10': { status: 'suggested' } },
    )
    expect(hasError(result, 'COUNTER_BEHIND')).toBe(true)
    expect(result.errors.find(e => e.code === 'COUNTER_BEHIND').id).toBe('nextPost')
  })

  it('nextSession behind max session triggers COUNTER_BEHIND', () => {
    const result = validateCounters(
      { nextSession: 3, nextDocument: 20, nextPost: 15 },
      { '1': { session: 5 } },
      {},
    )
    expect(hasError(result, 'COUNTER_BEHIND')).toBe(true)
    expect(result.errors.find(e => e.code === 'COUNTER_BEHIND').id).toBe('nextSession')
  })

  it('counters exactly equal to max IDs trigger COUNTER_BEHIND', () => {
    const result = validateCounters(
      { nextSession: 5, nextDocument: 10, nextPost: 8 },
      { '10': { session: 5 } },
      { '8': { status: 'suggested' } },
    )
    // All three should be behind (need to be strictly greater)
    const behindErrors = result.errors.filter(e => e.code === 'COUNTER_BEHIND')
    expect(behindErrors.length).toBeGreaterThanOrEqual(2)
  })

  it('missing counters triggers COUNTERS_MISSING', () => {
    const result = validateCounters(null, {}, {})
    expect(hasError(result, 'COUNTERS_MISSING')).toBe(true)
  })
})

// ── Edge cases ──────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty objects gracefully', () => {
    const state = {
      counters: { nextSession: 1, nextDocument: 1, nextPost: 1 },
      analysisIndex: {},
      themeRegistry: {},
      postBacklog: {},
      decisionLog: [],
    }
    const result = validateEditorialState(state)
    expect(result.valid).toBe(true)
  })

  it('handles entries with undefined/null fields gracefully', () => {
    const state = makeValidState()
    state.postBacklog['1'].format = undefined
    state.postBacklog['1'].freshness = undefined
    state.postBacklog['1'].coreArgument = undefined
    state.postBacklog['1'].notes = undefined
    const result = validateEditorialState(state)
    // Should not crash
    expect(result).toBeDefined()
  })

  it('analysis entry that is not an object is flagged', () => {
    const index = { '1': 'not an object' }
    const result = validateAnalysisIndex(index)
    expect(hasError(result, 'ANALYSIS_INVALID')).toBe(true)
  })

  it('post that is not an object is flagged', () => {
    const posts = { '1': null }
    const result = validatePostBacklog(posts)
    expect(hasError(result, 'POST_INVALID')).toBe(true)
  })

  it('theme that is not an object is flagged', () => {
    const registry = { 'T01': null }
    const result = validateThemeRegistry(registry)
    expect(hasError(result, 'THEME_INVALID')).toBe(true)
  })
})
