import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Isolate the editorial lock dir so trigger tests never touch production.
const TEST_DIR = join(tmpdir(), `sni-editorial-trigger-test-${process.pid}`)
process.env.SNI_EDITORIAL_DIR = TEST_DIR
// Prevent tests from spawning real pipeline scripts (Opus API) and force
// getDb() to the in-memory client.
process.env.SNI_TEST_MODE = '1'

// Import AFTER setting env so modules pick up the overrides.
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
const { getDb, migrateSchema, _resetDbSingleton } = await import('../lib/db.js')

// ── Fixture seeding ──────────────────────────────────────

async function seedDb(db) {
  // Counters — override the seeds migrateSchema inserts, so postDecision
  // can derive the current session (= nextSession - 1).
  await db.execute("INSERT OR REPLACE INTO counters (key, value) VALUES ('nextSession', 16)")
  await db.execute("INSERT OR REPLACE INTO counters (key, value) VALUES ('nextDocument', 126)")
  await db.execute("INSERT OR REPLACE INTO counters (key, value) VALUES ('nextPost', 92)")

  // Analysis entries: #120 active, #121 archived
  await db.execute({
    sql: `INSERT INTO analysis_entries (id, title, source, host, date, session, tier, status, themes, summary, post_potential, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 0)`,
    args: [120, 'Test Analysis Entry', 'AI Daily Brief', 'Nathaniel Whittemore', '20 March 2026',
           15, 1, JSON.stringify(['T01', 'T03']), 'Test summary', 'medium'],
  })
  await db.execute({
    sql: `INSERT INTO analysis_entries (id, title, source, session, tier, status, themes, summary, archived)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
    args: [121, 'Archived Entry', 'Moonshots', 14, 2, JSON.stringify([]), 'Old content'],
  })

  // Themes: T01 active, T03 archived (plus the cross-connection target)
  await db.execute({
    sql: `INSERT INTO themes (code, name, document_count, archived)
          VALUES (?, ?, ?, 0)`,
    args: ['T01', 'Enterprise Diffusion Gap', 8],
  })
  await db.execute({
    sql: `INSERT INTO themes (code, name, document_count, archived)
          VALUES (?, ?, ?, 1)`,
    args: ['T03', 'Agentic Systems', 5],
  })
  await db.execute({
    sql: `INSERT INTO theme_evidence (theme_code, session, source, content)
          VALUES ('T01', 14, 'No Priors', 'Evidence A')`,
  })
  await db.execute({
    sql: `INSERT INTO theme_evidence (theme_code, session, source, content)
          VALUES ('T01', 15, 'AI Daily Brief', 'Evidence B')`,
  })
  await db.execute({
    sql: `INSERT INTO theme_connections (from_code, to_code, reasoning)
          VALUES ('T01', 'T03', 'Both about adoption')`,
  })

  // Post backlog
  await db.execute({
    sql: `INSERT INTO posts (id, title, status, date_added, session, core_argument, format, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [88, 'The Benefits Are Real, the Fears Are Imagined', 'suggested',
           '2026-03-20', 15, 'Anthropic survey found experiential benefits.', 'news-decoder', 'high'],
  })
  await db.execute({
    sql: `INSERT INTO posts (id, title, status, date_added, session, core_argument, format, priority)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [91, 'The Contract Clause Nobody Is Talking About', 'suggested',
           '2026-03-20', 15, 'All-lawful-use contract language.', 'quiet-observation', 'immediate'],
  })

  // Decisions: 15.1 active, 15.2 archived
  await db.execute({
    sql: `INSERT INTO decisions (id, session, title, decision, reasoning, archived)
          VALUES (?, ?, ?, ?, ?, 0)`,
    args: ['15.1', 15, 'Post sequencing', 'Publish #88 first', 'Timely'],
  })
  await db.execute({
    sql: `INSERT INTO decisions (id, session, title, decision, reasoning, archived)
          VALUES (?, ?, ?, ?, ?, 1)`,
    args: ['15.2', 15, 'Archived decision', 'Drop T05', 'Stale'],
  })
}

beforeEach(async () => {
  mkdirSync(TEST_DIR, { recursive: true })
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  await seedDb(db)
})

afterEach(() => {
  _resetDbSingleton()
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true })
})

// ── Trigger tests (filesystem-lock based) ────────────────

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
    expect(existsSync(join(TEST_DIR, '.analyse.lock'))).toBe(false)
  })
})

describe('POST /api/editorial/trigger/discover', () => {
  it('returns ok when no lock exists', async () => {
    const result = await postTriggerDiscover()
    expect(result.ok).toBe(true)
    expect(result.stage).toBe('discover')
    expect(result.pid).toBe(-1)
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
    expect(result.pid).toBe(-1)
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
    expect(result.pid).toBe(-1)
  })
})

// ── Backlog status tests ─────────────────────────────────

describe('PUT /api/editorial/backlog/:id/status', () => {
  it('updates status of an existing post', async () => {
    const result = await putBacklogStatus('88', { status: 'approved' })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('88')
    expect(result.status).toBe('approved')

    // Verify written to DB
    const db = getDb()
    const r = await db.execute({ sql: 'SELECT status FROM posts WHERE id = ?', args: [88] })
    expect(r.rows[0].status).toBe('approved')
  })

  it('updates to published status', async () => {
    const result = await putBacklogStatus('91', { status: 'published' })
    expect(result.ok).toBe(true)
    expect(result.status).toBe('published')

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT status FROM posts WHERE id = ?', args: [91] })
    expect(r.rows[0].status).toBe('published')
  })

  it('returns 404 for unknown post id', async () => {
    try {
      await putBacklogStatus('999', { status: 'approved' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
      expect(err.message).toContain('999')
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
      const result = await putBacklogStatus('88', { status })
      expect(result.ok).toBe(true)
      expect(result.status).toBe(status)
    }
  })
})

// ── Analysis archive tests ──────────────────────────────

describe('PUT /api/editorial/analysis/:id/archive', () => {
  it('archives an analysis entry', async () => {
    const result = await putAnalysisArchive('120', { archived: true })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT archived FROM analysis_entries WHERE id = ?', args: [120] })
    expect(r.rows[0].archived).toBe(1)
  })

  it('restores an archived entry', async () => {
    const result = await putAnalysisArchive('121', { archived: false })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(false)

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT archived FROM analysis_entries WHERE id = ?', args: [121] })
    expect(r.rows[0].archived).toBe(0)
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
})

// ── Theme archive tests ─────────────────────────────────

describe('PUT /api/editorial/themes/:code/archive', () => {
  it('archives a theme', async () => {
    const result = await putThemeArchive('T01', { archived: true })
    expect(result.ok).toBe(true)
    expect(result.archived).toBe(true)

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT archived FROM themes WHERE code = ?', args: ['T01'] })
    expect(r.rows[0].archived).toBe(1)
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
    const activeCodes = result.themes.map(t => t.code).filter(c => c === 'T01' || c === 'T03')
    expect(activeCodes).toContain('T01')
    expect(activeCodes).not.toContain('T03')
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
    expect(result.id).toBeDefined() // id format is assigned by eq.addDecision

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT * FROM decisions WHERE id = ?', args: [result.id] })
    expect(r.rows[0].title).toBe('Test decision')
    expect(r.rows[0].decision).toBe('We decided to do X')
    expect(r.rows[0].reasoning).toBe('Because Y')
  })

  it('creates a decision without reasoning', async () => {
    const result = await postDecision({
      title: 'Quick decision',
      decision: 'Just do it',
    })
    expect(result.ok).toBe(true)

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT * FROM decisions WHERE id = ?', args: [result.id] })
    // reasoning may be null or '' depending on the addDecision implementation
    expect(r.rows[0].reasoning == null || r.rows[0].reasoning === '').toBe(true)
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

    const db = getDb()
    const r = await db.execute({ sql: 'SELECT archived FROM decisions WHERE id = ?', args: ['15.1'] })
    expect(r.rows[0].archived).toBe(1)
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
    const ids = result.decisions.map(d => d.id)
    expect(ids).toContain('15.1')
    expect(ids).not.toContain('15.2')
  })
})
