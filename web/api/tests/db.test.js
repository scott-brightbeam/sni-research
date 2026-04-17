import { describe, it, expect, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'

describe('db module', () => {
  const db = createTestDb()

  it('creates all tables on migrate', async () => {
    await migrateSchema(db)
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    const names = tables.rows.map(r => r.name)
    expect(names).toContain('articles')
    expect(names).toContain('analysis_entries')
    expect(names).toContain('themes')
    expect(names).toContain('theme_evidence')
    expect(names).toContain('theme_connections')
    expect(names).toContain('posts')
    expect(names).toContain('decisions')
    expect(names).toContain('episodes')
    expect(names).toContain('episode_stories')
    expect(names).toContain('counters')
    expect(names).toContain('activity')
    expect(names).toContain('notifications')
    expect(names).toContain('published')
    expect(names).toContain('cost_log')
    expect(names).toContain('stories')
    expect(names).toContain('rotation_candidates')
    expect(names).toContain('permanent_preferences')
    expect(names).toContain('schema_version')
  })

  it('creates FTS virtual table', async () => {
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='articles_fts'"
    )
    expect(tables.rows.length).toBe(1)
  })

  it('creates corpus_stats view', async () => {
    const views = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='view' AND name='corpus_stats'"
    )
    expect(views.rows.length).toBe(1)
    // Should be queryable
    const stats = await db.execute("SELECT * FROM corpus_stats")
    expect(stats.rows.length).toBe(1)
    expect(stats.rows[0]).toHaveProperty('total_documents')
    expect(stats.rows[0]).toHaveProperty('active_themes')
  })

  it('creates FTS triggers', async () => {
    const triggers = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name"
    )
    const names = triggers.rows.map(r => r.name)
    expect(names).toContain('articles_ai')
    expect(names).toContain('articles_ad')
    expect(names).toContain('articles_au')
  })

  it('seeds counters on first migrate', async () => {
    const result = await db.execute("SELECT key, value FROM counters ORDER BY key")
    expect(result.rows.length).toBe(3)
    const keys = result.rows.map(r => r.key)
    expect(keys).toContain('nextSession')
    expect(keys).toContain('nextDocument')
    expect(keys).toContain('nextPost')
  })

  it('is idempotent (migrate twice)', async () => {
    await migrateSchema(db)
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    expect(tables.rows.length).toBeGreaterThan(0)
    // Counters should not be duplicated
    const counters = await db.execute("SELECT key, value FROM counters ORDER BY key")
    expect(counters.rows.length).toBe(3)
  })

  it('sets schema_version to the current SCHEMA_VERSION', async () => {
    const result = await db.execute("SELECT version FROM schema_version ORDER BY version DESC LIMIT 1")
    expect(result.rows.length).toBe(1)
    // Matches SCHEMA_VERSION constant at the top of lib/db.js.
    // Bump this when the schema version in the source is bumped.
    expect(result.rows[0].version).toBe(4)
  })

  afterAll(() => db.close())
})
