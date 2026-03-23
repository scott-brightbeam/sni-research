import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Use an isolated temp directory so tests never touch production data/editorial/
const TEST_DIR = join(tmpdir(), `sni-editorial-trigger-test-${process.pid}`)
process.env.SNI_EDITORIAL_DIR = TEST_DIR
// CRITICAL: prevent tests from spawning real pipeline scripts that hit the Opus API
process.env.SNI_TEST_MODE = '1'

// Import AFTER setting env var so the module picks up the override
const {
  postTriggerAnalyse,
  postTriggerDiscover,
  postTriggerDraft,
  postTriggerTrack,
  putBacklogStatus,
  putAnalysisArchive,
  putThemeArchive,
  postDecision,
  putDecisionArchive,
  getEditorialState,
} = await import('../routes/editorial.js')

const testState = {
  counters: { nextSession: 16, nextDocument: 126, nextPost: 92 },
  analysisIndex: {
    '120': {
      title: 'Test Analysis Entry',
      source: 'AI Daily Brief',
      host: 'Nathaniel Whittemore',
      date: '20 March 2026',
      session: 15,
      tier: 1,
      themes: ['T01', 'T03'],
      summary: 'Test summary',
      postPotential: 'medium',
    },
    '121': {
      title: 'Archived Entry',
      source: 'Moonshots',
      session: 14,
      tier: 2,
      themes: [],
      summary: 'Old content',
      archived: true,
    },
  },
  themeRegistry: {
    'T01': {
      name: 'Enterprise Diffusion Gap',
      evidence: [
        { session: 14, source: 'No Priors', content: 'Evidence A' },
        { session: 15, source: 'AI Daily Brief', content: 'Evidence B' },
      ],
      crossConnections: [{ theme: 'T03', reasoning: 'Both about adoption' }],
      documentCount: 8,
    },
    'T03': {
      name: 'Agentic Systems',
      evidence: [{ session: 12, source: 'Lex Fridman', content: 'Older evidence' }],
      crossConnections: [],
      documentCount: 5,
      archived: true,
    },
  },
  postBacklog: {
    '88': {
      title: 'The Benefits Are Real, the Fears Are Imagined',
      status: 'suggested',
      dateAdded: '2026-03-20',
      session: 15,
      coreArgument: 'Anthropic survey found experiential benefits.',
      format: 'news-decoder',
      priority: 'high',
    },
    '91': {
      title: 'The Contract Clause Nobody Is Talking About',
      status: 'suggested',
      dateAdded: '2026-03-20',
      session: 15,
      coreArgument: 'All-lawful-use contract language.',
      format: 'quiet-observation',
      priority: 'immediate',
    },
  },
  decisionLog: [
    { id: '15.1', session: 15, title: 'Post sequencing', decision: 'Publish #88 first', reasoning: 'Timely' },
    { id: '15.2', session: 15, title: 'Archived decision', decision: 'Drop T05', reasoning: 'Stale', archived: true },
  ],
  corpusStats: {},
}

// ── Setup / Teardown ─────────────────────────────────────

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true })
  writeFileSync(join(TEST_DIR, 'state.json'), JSON.stringify(testState))
})

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

// ── Trigger tests ────────────────────────────────────────

describe('POST /api/editorial/trigger/analyse', () => {
  it('returns ok when no lock exists', async () => {
    const result = await postTriggerAnalyse()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('analyse')
    expect(result.pid).toBe(-1) // test mode returns fake PID
  })

  it('returns conflict when lock exists and not stale', async () => {
    writeFileSync(
      join(TEST_DIR, '.analyse.lock'),
      JSON.stringify({ pid: 99999, timestamp: new Date().toISOString(), current: 3, total: 18 })
    )
    const result = await postTriggerAnalyse()
    expect(result._conflict).toBe(true)
    expect(result.error).toBe('Stage already running')
    expect(result.stage).toBe('analyse')
    expect(result.progress.pid).toBe(99999)
    expect(result.progress.current).toBe(3)
  })

  it('ignores stale lock (>30 min old)', async () => {
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    writeFileSync(
      join(TEST_DIR, '.analyse.lock'),
      JSON.stringify({ pid: 99999, timestamp: staleTime, current: 3, total: 18 })
    )
    const result = await postTriggerAnalyse()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('analyse')
    // Stale lock file should have been cleaned up
    expect(existsSync(join(TEST_DIR, '.analyse.lock'))).toBe(false)
  })
})

describe('POST /api/editorial/trigger/discover', () => {
  it('returns ok when no lock exists', async () => {
    const result = await postTriggerDiscover()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('discover')
    expect(result.pid).toBe(-1) // test mode returns fake PID
  })

  it('returns conflict when lock exists and not stale', async () => {
    writeFileSync(
      join(TEST_DIR, '.discover.lock'),
      JSON.stringify({ pid: 88888, timestamp: new Date().toISOString(), current: 10, total: 42 })
    )
    const result = await postTriggerDiscover()
    expect(result._conflict).toBe(true)
    expect(result.error).toBe('Stage already running')
    expect(result.stage).toBe('discover')
  })
})

describe('POST /api/editorial/trigger/draft', () => {
  it('returns ok when no lock exists', async () => {
    const result = await postTriggerDraft()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('draft')
    expect(result.pid).toBe(-1) // test mode returns fake PID
  })

  it('returns conflict when lock exists and not stale', async () => {
    writeFileSync(
      join(TEST_DIR, '.draft.lock'),
      JSON.stringify({ pid: 77777, timestamp: new Date().toISOString(), current: 1, total: 3 })
    )
    const result = await postTriggerDraft()
    expect(result._conflict).toBe(true)
    expect(result.error).toBe('Stage already running')
    expect(result.stage).toBe('draft')
  })
})

describe('POST /api/editorial/trigger/track', () => {
  it('always returns ok (no lock check)', async () => {
    const result = await postTriggerTrack()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('track')
    expect(result.pid).toBe(-1) // test mode returns fake PID
  })
})

// ── Backlog status tests ─────────────────────────────────

describe('PUT /api/editorial/backlog/:id/status', () => {
  it('updates status of an existing post', async () => {
    const result = await putBacklogStatus('88', { status: 'approved' })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('88')
    expect(result.status).toBe('approved')

    // Verify written to disk
    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    expect(state.postBacklog['88'].status).toBe('approved')
  })

  it('sets publishedDate when status is published', async () => {
    const result = await putBacklogStatus('91', { status: 'published' })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('published')

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    expect(state.postBacklog['91'].status).toBe('published')
    expect(state.postBacklog['91'].publishedDate).toBe(new Date().toISOString().split('T')[0])
  })

  it('returns 404 for unknown post id', async () => {
    try {
      await putBacklogStatus('999', { status: 'approved' })
      expect(true).toBe(false) // should not reach
    } catch (err) {
      expect(err.status).toBe(404)
      expect(err.message).toContain('999')
    }
  })

  it('returns 404 when no state exists', async () => {
    rmSync(join(TEST_DIR, 'state.json'))
    try {
      await putBacklogStatus('88', { status: 'approved' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('validates status values', async () => {
    try {
      await putBacklogStatus('88', { status: 'invalid-status' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('Invalid status')
    }
  })

  it('returns 400 when status is missing', async () => {
    try {
      await putBacklogStatus('88', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('required')
    }
  })

  it('accepts all valid status values', async () => {
    const validStatuses = ['suggested', 'approved', 'in-progress', 'published', 'rejected', 'archived']
    for (const status of validStatuses) {
      // Reset state before each
      writeFileSync(join(TEST_DIR, 'state.json'), JSON.stringify(testState))
      const result = await putBacklogStatus('88', { status })
      expect(result.ok).toBe(true)
      expect(result.status).toBe(status)
    }
  })

  it('creates .bak file during write', async () => {
    await putBacklogStatus('88', { status: 'approved' })
    // .bak should exist after the write
    expect(existsSync(join(TEST_DIR, 'state.json.bak'))).toBe(true)
  })
})

// ── Analysis archive tests ──────────────────────────────

describe('PUT /api/editorial/analysis/:id/archive', () => {
  it('archives an analysis entry', async () => {
    const result = await putAnalysisArchive('120', { archived: true })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    expect(state.analysisIndex['120'].archived).toBe(true)
  })

  it('restores an archived entry', async () => {
    const result = await putAnalysisArchive('121', { archived: false })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(false)

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    expect(state.analysisIndex['121'].archived).toBe(false)
  })

  it('returns 404 for non-existent entry', async () => {
    try {
      await putAnalysisArchive('999', { archived: true })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('filters archived entries by default in getEditorialState', async () => {
    const result = await getEditorialState({ section: 'analysisIndex' })
    // Entry 121 is archived, should be excluded
    expect(result.entries.length).toBe(1)
    expect(result.entries[0].id).toBe(120)
  })

  it('includes archived entries when showArchived=true', async () => {
    const result = await getEditorialState({ section: 'analysisIndex', showArchived: 'true' })
    expect(result.entries.length).toBe(2)
  })

  it('rejects when ANALYSE lock exists', async () => {
    writeFileSync(
      join(TEST_DIR, '.analyse.lock'),
      JSON.stringify({ pid: 99999, timestamp: new Date().toISOString() })
    )
    try {
      await putAnalysisArchive('120', { archived: true })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(409)
      expect(err.message).toContain('ANALYSE')
    }
  })
})

// ── Theme archive tests ─────────────────────────────────

describe('PUT /api/editorial/themes/:code/archive', () => {
  it('archives a theme', async () => {
    const result = await putThemeArchive('T01', { archived: true })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    expect(state.themeRegistry['T01'].archived).toBe(true)
  })

  it('restores an archived theme', async () => {
    const result = await putThemeArchive('T03', { archived: false })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(false)
  })

  it('returns 404 for non-existent theme', async () => {
    try {
      await putThemeArchive('T99', { archived: true })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('filters archived themes by default', async () => {
    const result = await getEditorialState({ section: 'themeRegistry' })
    // T03 is archived, should be excluded
    expect(result.themes.length).toBe(1)
    expect(result.themes[0].code).toBe('T01')
  })
})

// ── Decision creation tests ─────────────────────────────

describe('POST /api/editorial/decisions', () => {
  it('creates a decision with all fields', async () => {
    const result = await postDecision({
      title: 'Test decision',
      decision: 'We decided to do X',
      reasoning: 'Because Y',
    })
    expect(result.ok).toBe(true)
    expect(result.session).toBe(15)
    expect(result.id).toBe('15.3') // 2 existing decisions for session 15

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    const created = state.decisionLog.find(d => d.id === '15.3')
    expect(created.title).toBe('Test decision')
    expect(created.decision).toBe('We decided to do X')
    expect(created.reasoning).toBe('Because Y')
  })

  it('creates a decision without reasoning', async () => {
    const result = await postDecision({
      title: 'Quick decision',
      decision: 'Just do it',
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('15.3')

    const state = JSON.parse(readFileSync(join(TEST_DIR, 'state.json'), 'utf-8'))
    const created = state.decisionLog.find(d => d.id === '15.3')
    expect(created.reasoning).toBe('')
  })

  it('returns 400 when title is missing', async () => {
    try {
      await postDecision({ decision: 'No title' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('title')
    }
  })

  it('returns 400 when decision is missing', async () => {
    try {
      await postDecision({ title: 'No decision text' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('decision')
    }
  })
})

// ── Decision archive tests ──────────────────────────────

describe('PUT /api/editorial/decisions/:id/archive', () => {
  it('archives a decision', async () => {
    const result = await putDecisionArchive('15.1', { archived: true })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)
  })

  it('restores an archived decision', async () => {
    const result = await putDecisionArchive('15.2', { archived: false })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(false)
  })

  it('returns 404 for non-existent decision', async () => {
    try {
      await putDecisionArchive('99.99', { archived: true })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('filters archived decisions by default', async () => {
    const result = await getEditorialState({ section: 'decisionLog' })
    // Decision 15.2 is archived, should be excluded
    expect(result.decisions.length).toBe(1)
    expect(result.decisions[0].id).toBe('15.1')
  })
})
