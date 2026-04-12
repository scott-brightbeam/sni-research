import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'
import {
  getAnalysisEntries,
  getAnalysisEntry,
  getThemes,
  getThemeWithEvidence,
  getPosts,
  updatePostStatus,
  getDecisions,
  addDecision,
  getCounters,
  incrementCounter,
  getCorpusStats,
  searchEditorial,
  getActivity,
  addActivity,
  getNotifications,
  dismissNotification,
  setAnalysisArchived,
  setThemeArchived,
  setDecisionArchived,
} from '../lib/editorial-queries.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert an analysis entry directly via SQL. */
async function insertEntry(db, overrides = {}) {
  const defaults = {
    id: 1,
    title: 'Test Episode',
    source: 'Test Podcast',
    session: 10,
    tier: 1,
    status: 'active',
    summary: 'Summary of test episode',
    archived: 0,
  }
  const e = { ...defaults, ...overrides }
  await db.execute({
    sql: `INSERT INTO analysis_entries (id, title, source, session, tier, status, summary, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [e.id, e.title, e.source, e.session, e.tier, e.status, e.summary, e.archived],
  })
  return e
}

/** Insert a theme directly via SQL. */
async function insertTheme(db, overrides = {}) {
  const defaults = {
    code: 'test-theme',
    name: 'Test Theme',
    created_session: '10',
    last_updated_session: '10',
    document_count: 1,
    archived: 0,
  }
  const t = { ...defaults, ...overrides }
  await db.execute({
    sql: `INSERT INTO themes (code, name, created_session, last_updated_session, document_count, archived)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [t.code, t.name, t.created_session, t.last_updated_session, t.document_count, t.archived],
  })
  return t
}

/** Insert theme evidence directly via SQL. */
async function insertEvidence(db, overrides = {}) {
  const defaults = {
    theme_code: 'test-theme',
    session: 10,
    source: 'Test Source',
    content: 'Evidence content',
    url: 'https://example.com/evidence',
  }
  const ev = { ...defaults, ...overrides }
  await db.execute({
    sql: `INSERT INTO theme_evidence (theme_code, session, source, content, url)
          VALUES (?, ?, ?, ?, ?)`,
    args: [ev.theme_code, ev.session, ev.source, ev.content, ev.url],
  })
  return ev
}

/** Insert a theme connection directly via SQL. */
async function insertConnection(db, from_code, to_code, reasoning = 'Related') {
  await db.execute({
    sql: `INSERT INTO theme_connections (from_code, to_code, reasoning) VALUES (?, ?, ?)`,
    args: [from_code, to_code, reasoning],
  })
}

/** Insert a post directly via SQL. */
async function insertPost(db, overrides = {}) {
  const defaults = {
    id: 1,
    title: 'Test Post',
    status: 'suggested',
    format: 'linkedin',
    priority: 'medium',
    core_argument: 'The core argument for the post',
  }
  const p = { ...defaults, ...overrides }
  await db.execute({
    sql: `INSERT INTO posts (id, title, status, format, priority, core_argument)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [p.id, p.title, p.status, p.format, p.priority, p.core_argument],
  })
  return p
}

/** Insert a notification directly via SQL. */
async function insertNotification(db, overrides = {}) {
  const defaults = {
    id: 'notif-1',
    title: 'Test Notification',
    priority: 'medium',
    detail: 'Some detail',
    dismissed: 0,
  }
  const n = { ...defaults, ...overrides }
  await db.execute({
    sql: `INSERT INTO notifications (id, title, priority, detail, dismissed)
          VALUES (?, ?, ?, ?, ?)`,
    args: [n.id, n.title, n.priority, n.detail, n.dismissed],
  })
  return n
}

// ===========================================================================
// Tests
// ===========================================================================

describe('editorial-queries', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })

  afterAll(() => db.close())

  // -------------------------------------------------------------------------
  // 1. Analysis entries — insert + retrieve
  // -------------------------------------------------------------------------
  describe('getAnalysisEntries', () => {
    beforeAll(async () => {
      await insertEntry(db, { id: 100, title: 'Episode Alpha', source: 'Podcast A', session: 10, tier: 1, status: 'active' })
      await insertEntry(db, { id: 101, title: 'Episode Beta', source: 'Podcast B', session: 11, tier: 2, status: 'active' })
      await insertEntry(db, { id: 102, title: 'Episode Gamma', source: 'Podcast C', session: 10, tier: 1, status: 'retired' })
      await insertEntry(db, { id: 103, title: 'Episode Delta', source: 'Podcast D', session: 12, tier: 1, status: 'active', archived: 1 })
    })

    it('returns all non-archived entries sorted by id DESC', async () => {
      const entries = await getAnalysisEntries(db, {})
      expect(entries.length).toBeGreaterThanOrEqual(3)
      // Should NOT include archived entry 103
      const ids = entries.map(e => e.id)
      expect(ids).not.toContain(103)
      // Sorted by id DESC
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].id).toBeGreaterThan(entries[i].id)
      }
    })

    // -----------------------------------------------------------------------
    // 2. Filter by tier, status, archived
    // -----------------------------------------------------------------------
    it('filters by tier', async () => {
      const entries = await getAnalysisEntries(db, { tier: 2 })
      for (const e of entries) {
        expect(e.tier).toBe(2)
      }
      expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by status', async () => {
      const entries = await getAnalysisEntries(db, { status: 'retired' })
      for (const e of entries) {
        expect(e.status).toBe('retired')
      }
      expect(entries.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by session', async () => {
      const entries = await getAnalysisEntries(db, { session: 10 })
      for (const e of entries) {
        expect(e.session).toBe(10)
      }
    })

    it('includes archived when showArchived is true', async () => {
      const entries = await getAnalysisEntries(db, { showArchived: true })
      const ids = entries.map(e => e.id)
      expect(ids).toContain(103)
    })
  })

  describe('getAnalysisEntry', () => {
    it('returns a single entry by id', async () => {
      const entry = await getAnalysisEntry(db, 100)
      expect(entry).not.toBeNull()
      expect(entry.title).toBe('Episode Alpha')
    })

    it('returns null for non-existent id', async () => {
      const entry = await getAnalysisEntry(db, 99999)
      expect(entry).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 3. Themes — with evidence (insert theme, add evidence, retrieve with JOIN)
  // -------------------------------------------------------------------------
  describe('getThemes + getThemeWithEvidence', () => {
    beforeAll(async () => {
      // Current session is 12 for "active" calculation (last 3 = 10, 11, 12)
      await insertTheme(db, { code: 'ai-regulation', name: 'AI Regulation', last_updated_session: '12', document_count: 3 })
      await insertTheme(db, { code: 'llm-scaling', name: 'LLM Scaling', last_updated_session: '8', document_count: 2 })
      await insertTheme(db, { code: 'archived-theme', name: 'Archived Theme', last_updated_session: '12', archived: 1 })

      // Evidence for ai-regulation
      await insertEvidence(db, { theme_code: 'ai-regulation', session: 12, source: 'Podcast X', content: 'EU AI Act evidence' })
      await insertEvidence(db, { theme_code: 'ai-regulation', session: 11, source: 'Podcast Y', content: 'US regulation evidence' })
      // Evidence for llm-scaling — old session
      await insertEvidence(db, { theme_code: 'llm-scaling', session: 8, source: 'Podcast Z', content: 'Scaling law evidence' })

      // Connection between themes
      await insertConnection(db, 'ai-regulation', 'llm-scaling', 'Regulation affects scaling decisions')
    })

    // -----------------------------------------------------------------------
    // 4. Theme active/stale filtering
    // -----------------------------------------------------------------------
    it('returns active themes (evidence in last 3 sessions)', async () => {
      const themes = await getThemes(db, { active: true, currentSession: 12 })
      const codes = themes.map(t => t.code)
      expect(codes).toContain('ai-regulation')
      expect(codes).not.toContain('llm-scaling') // last evidence session 8, stale
    })

    it('returns stale themes (no evidence in last 3 sessions)', async () => {
      const themes = await getThemes(db, { stale: true, currentSession: 12 })
      const codes = themes.map(t => t.code)
      expect(codes).toContain('llm-scaling')
      expect(codes).not.toContain('ai-regulation')
    })

    it('excludes archived themes by default', async () => {
      const themes = await getThemes(db, {})
      const codes = themes.map(t => t.code)
      expect(codes).not.toContain('archived-theme')
    })

    it('includes archived themes when showArchived is true', async () => {
      const themes = await getThemes(db, { showArchived: true })
      const codes = themes.map(t => t.code)
      expect(codes).toContain('archived-theme')
    })

    it('includes evidence count', async () => {
      const themes = await getThemes(db, {})
      const regulation = themes.find(t => t.code === 'ai-regulation')
      expect(regulation).toBeTruthy()
      expect(regulation.evidence_count).toBe(2)
    })

    it('getThemeWithEvidence returns theme + evidence + connections', async () => {
      const result = await getThemeWithEvidence(db, 'ai-regulation')
      expect(result).not.toBeNull()
      expect(result.theme.code).toBe('ai-regulation')
      expect(result.theme.name).toBe('AI Regulation')
      expect(result.evidence.length).toBe(2)
      expect(result.evidence[0].content).toBeTruthy()
      expect(result.connections.length).toBeGreaterThanOrEqual(1)
      expect(result.connections[0].to_code).toBe('llm-scaling')
    })

    it('getThemeWithEvidence returns null for non-existent theme', async () => {
      const result = await getThemeWithEvidence(db, 'no-such-code')
      expect(result).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // 5. Posts — CRUD with status transitions
  // -------------------------------------------------------------------------
  describe('getPosts + updatePostStatus', () => {
    beforeAll(async () => {
      await insertPost(db, { id: 200, title: 'Post Alpha', status: 'suggested', format: 'linkedin', priority: 'high' })
      await insertPost(db, { id: 201, title: 'Post Beta', status: 'approved', format: 'newsletter', priority: 'medium' })
      await insertPost(db, { id: 202, title: 'Post Gamma', status: 'suggested', format: 'linkedin', priority: 'low' })
    })

    it('returns all posts sorted by id DESC', async () => {
      const posts = await getPosts(db, {})
      expect(posts.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < posts.length; i++) {
        expect(posts[i - 1].id).toBeGreaterThan(posts[i].id)
      }
    })

    it('filters by status', async () => {
      const posts = await getPosts(db, { status: 'approved' })
      for (const p of posts) {
        expect(p.status).toBe('approved')
      }
      expect(posts.length).toBeGreaterThanOrEqual(1)
    })

    it('filters by priority', async () => {
      const posts = await getPosts(db, { priority: 'high' })
      for (const p of posts) {
        expect(p.priority).toBe('high')
      }
    })

    it('filters by format', async () => {
      const posts = await getPosts(db, { format: 'linkedin' })
      for (const p of posts) {
        expect(p.format).toBe('linkedin')
      }
    })

    it('updatePostStatus changes status and sets updated_at', async () => {
      const updated = await updatePostStatus(db, 200, 'approved')
      expect(updated.status).toBe('approved')
      expect(updated.updated_at).toBeTruthy()
    })

    it('updatePostStatus sets date_published when status is published', async () => {
      const updated = await updatePostStatus(db, 201, 'published')
      expect(updated.status).toBe('published')
      expect(updated.date_published).toBeTruthy()
    })
  })

  // -------------------------------------------------------------------------
  // 6. Counters — get + increment
  // -------------------------------------------------------------------------
  describe('getCounters + incrementCounter', () => {
    it('returns all three counters with named keys', async () => {
      const counters = await getCounters(db)
      expect(counters).toHaveProperty('nextSession')
      expect(counters).toHaveProperty('nextDocument')
      expect(counters).toHaveProperty('nextPost')
      expect(typeof counters.nextSession).toBe('number')
    })

    it('incrementCounter increases value by 1 and returns new value', async () => {
      const before = await getCounters(db)
      const newVal = await incrementCounter(db, 'nextSession')
      expect(newVal).toBe(before.nextSession + 1)

      // Verify persisted
      const after = await getCounters(db)
      expect(after.nextSession).toBe(before.nextSession + 1)
    })
  })

  // -------------------------------------------------------------------------
  // 7. Corpus stats VIEW returns correct counts
  // -------------------------------------------------------------------------
  describe('getCorpusStats', () => {
    it('returns corpus stats from the view', async () => {
      const stats = await getCorpusStats(db)
      expect(stats).toHaveProperty('total_documents')
      expect(stats).toHaveProperty('active_tier1')
      expect(stats).toHaveProperty('active_tier2')
      expect(stats).toHaveProperty('retired')
      expect(stats).toHaveProperty('active_themes')
      expect(stats).toHaveProperty('total_posts')
      expect(stats).toHaveProperty('posts_published')
      // Values should reflect our test data
      expect(stats.total_documents).toBeGreaterThanOrEqual(4) // we inserted 4 entries
      expect(stats.active_themes).toBeGreaterThanOrEqual(2) // 2 non-archived themes
    })
  })

  // -------------------------------------------------------------------------
  // 8. Search across multiple tables
  // -------------------------------------------------------------------------
  describe('searchEditorial', () => {
    it('finds analysis entries by title', async () => {
      const results = await searchEditorial(db, 'Alpha')
      const entry = results.find(r => r.type === 'analysis' && r.title === 'Episode Alpha')
      expect(entry).toBeTruthy()
      expect(entry.id).toBe(100)
    })

    it('finds analysis entries by source', async () => {
      const results = await searchEditorial(db, 'Podcast B')
      const entry = results.find(r => r.type === 'analysis' && r.source === 'Podcast B')
      expect(entry).toBeTruthy()
    })

    it('finds themes by name', async () => {
      const results = await searchEditorial(db, 'Regulation')
      const theme = results.find(r => r.type === 'theme')
      expect(theme).toBeTruthy()
      expect(theme.title).toBe('AI Regulation')
    })

    it('finds posts by title', async () => {
      const results = await searchEditorial(db, 'Post Alpha')
      const post = results.find(r => r.type === 'post')
      expect(post).toBeTruthy()
    })

    it('finds posts by core_argument', async () => {
      const results = await searchEditorial(db, 'core argument')
      const post = results.find(r => r.type === 'post')
      expect(post).toBeTruthy()
    })

    it('is case-insensitive', async () => {
      const results = await searchEditorial(db, 'episode alpha')
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty array for no matches', async () => {
      const results = await searchEditorial(db, 'xyznonexistent12345')
      expect(results.length).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // 9. Activity — insert + prune at 100
  // -------------------------------------------------------------------------
  describe('getActivity + addActivity', () => {
    it('inserts and retrieves activity entries', async () => {
      await addActivity(db, { type: 'analyse', title: 'Processed transcript', detail: 'Session 10' })
      await addActivity(db, { type: 'draft', title: 'Generated newsletter', detail: 'Week 15' })

      const activity = await getActivity(db, 10)
      expect(activity.length).toBeGreaterThanOrEqual(2)
      // Both entries should be present
      const titles = activity.map(a => a.title)
      expect(titles).toContain('Processed transcript')
      expect(titles).toContain('Generated newsletter')
      // Most recent by id should be first (timestamp ties broken by id DESC via AUTOINCREMENT)
      expect(activity[0].id).toBeGreaterThan(activity[1].id)
    })

    it('respects limit parameter', async () => {
      const activity = await getActivity(db, 1)
      expect(activity.length).toBe(1)
    })

    it('prunes to 100 entries when exceeding limit', async () => {
      // Insert 105 entries total (we already have 2)
      for (let i = 0; i < 103; i++) {
        await addActivity(db, { type: 'test', title: `Activity ${i}`, detail: '' })
      }
      // After addActivity prune, should be max 100
      const countResult = await db.execute('SELECT COUNT(*) AS cnt FROM activity')
      expect(Number(countResult.rows[0].cnt)).toBeLessThanOrEqual(100)
    })
  })

  // -------------------------------------------------------------------------
  // 10. Notifications — dismiss
  // -------------------------------------------------------------------------
  describe('getNotifications + dismissNotification', () => {
    beforeAll(async () => {
      await insertNotification(db, { id: 'notif-active', title: 'Active notification', dismissed: 0 })
      await insertNotification(db, { id: 'notif-dismissed', title: 'Dismissed notification', dismissed: 1 })
    })

    it('returns only non-dismissed by default', async () => {
      const notifs = await getNotifications(db, {})
      const ids = notifs.map(n => n.id)
      expect(ids).toContain('notif-active')
      expect(ids).not.toContain('notif-dismissed')
    })

    it('returns all when showDismissed is true', async () => {
      const notifs = await getNotifications(db, { showDismissed: true })
      const ids = notifs.map(n => n.id)
      expect(ids).toContain('notif-active')
      expect(ids).toContain('notif-dismissed')
    })

    it('dismisses a notification', async () => {
      await dismissNotification(db, 'notif-active')
      const notifs = await getNotifications(db, {})
      const ids = notifs.map(n => n.id)
      expect(ids).not.toContain('notif-active')
    })
  })

  // -------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------
  describe('getDecisions + addDecision', () => {
    it('adds a decision with auto-incrementing id within session', async () => {
      const r1 = await addDecision(db, { session: 10, title: 'Decision A', decision: 'We decided X', reasoning: 'Because Y' })
      expect(r1.id).toBe('10.1')

      const r2 = await addDecision(db, { session: 10, title: 'Decision B', decision: 'We decided Z', reasoning: 'Because W' })
      expect(r2.id).toBe('10.2')

      const r3 = await addDecision(db, { session: 11, title: 'Decision C', decision: 'New session decision', reasoning: 'Fresh' })
      expect(r3.id).toBe('11.1')
    })

    it('returns decisions sorted by id DESC, excluding archived', async () => {
      // Archive one
      await setDecisionArchived(db, '10.1', 1)

      const decisions = await getDecisions(db, {})
      const ids = decisions.map(d => d.id)
      expect(ids).not.toContain('10.1') // archived
      expect(ids).toContain('10.2')
      expect(ids).toContain('11.1')
    })

    it('includes archived when showArchived is true', async () => {
      const decisions = await getDecisions(db, { showArchived: true })
      const ids = decisions.map(d => d.id)
      expect(ids).toContain('10.1')
    })
  })

  // -------------------------------------------------------------------------
  // Archive operations
  // -------------------------------------------------------------------------
  describe('archive operations', () => {
    it('setAnalysisArchived archives and unarchives', async () => {
      await setAnalysisArchived(db, 100, 1)
      let entry = await getAnalysisEntry(db, 100)
      expect(entry.archived).toBe(1)

      await setAnalysisArchived(db, 100, 0)
      entry = await getAnalysisEntry(db, 100)
      expect(entry.archived).toBe(0)
    })

    it('setThemeArchived archives and unarchives', async () => {
      await setThemeArchived(db, 'ai-regulation', 1)
      let themes = await getThemes(db, {})
      let codes = themes.map(t => t.code)
      expect(codes).not.toContain('ai-regulation')

      await setThemeArchived(db, 'ai-regulation', 0)
      themes = await getThemes(db, {})
      codes = themes.map(t => t.code)
      expect(codes).toContain('ai-regulation')
    })

    it('setDecisionArchived is already tested above', async () => {
      // Covered in the decisions test — unarchive for cleanliness
      await setDecisionArchived(db, '10.1', 0)
      const decisions = await getDecisions(db, {})
      const ids = decisions.map(d => d.id)
      expect(ids).toContain('10.1')
    })
  })
})
