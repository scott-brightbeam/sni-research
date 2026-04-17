import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

// Force test mode + in-memory DB before route imports touch getDb().
process.env.SNI_TEST_MODE = '1'

const { patchArticle, deleteArticle, ingestArticle, getLastUpdated } = await import('./routes/articles.js')
const { getDb, migrateSchema, _resetDbSingleton } = await import('./lib/db.js')

const TEST_DATE = '2099-01-01'
const TEST_SECTOR = 'general'
const TEST_SLUG = 'test-article-write'

async function seedArticle(db, overrides = {}) {
  await db.execute({
    sql: `INSERT INTO articles (slug, title, url, source, source_type, date_published, sector,
                                 full_text, score, scraped_at, archived, flagged)
          VALUES (?, ?, ?, ?, 'automated', ?, ?, ?, ?, ?, 0, 0)`,
    args: [
      overrides.slug ?? TEST_SLUG,
      overrides.title ?? 'Test Article',
      overrides.url ?? 'https://example.com/test',
      overrides.source ?? 'Test Source',
      overrides.date ?? TEST_DATE,
      overrides.sector ?? TEST_SECTOR,
      'Test content for article write tests.',
      7,
      '2099-01-01T00:00:00Z',
    ],
  })
}

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  await seedArticle(db)
})

afterEach(() => {
  _resetDbSingleton()
})

describe('patchArticle', () => {
  it('rejects invalid params', async () => {
    try {
      await patchArticle('../etc', 'general', 'slug', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })

  it('returns 404 for non-existent article', async () => {
    try {
      await patchArticle('9999-01-01', 'general', 'nonexistent', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('flags an article (sets flagged=1 in DB)', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: true })
    expect(result.article.title).toBe('Test Article')
    expect(result.article.flagged).toBe(1)

    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT flagged FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].flagged).toBe(1)
  })

  it('unflags an article (sets flagged=0)', async () => {
    // First flag, then unflag
    await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: true })
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: false })
    expect(result.article.flagged).toBe(0)

    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT flagged FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].flagged).toBe(0)
  })

  it('moves article to new sector', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'medtech' })
    expect(result.moved).toBeTruthy()
    expect(result.moved.to).toContain('medtech')

    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT sector FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].sector).toBe('medtech')
  })

  it('returns 409 on slug collision during sector move', async () => {
    // Seed a second article in the destination sector with the same slug
    const db = getDb()
    await db.execute({
      sql: `INSERT INTO articles (slug, title, source_type, date_published, sector)
            VALUES (?, 'Collider', 'automated', ?, 'biopharma')`,
      args: [TEST_SLUG, TEST_DATE],
    })

    try {
      await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'biopharma' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(409)
    }
  })

  it('sets archived flag when body.archived=true', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { archived: true })
    expect(result.article.archived).toBe(1)

    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT archived FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].archived).toBe(1)
  })
})

describe('deleteArticle', () => {
  it('soft-deletes an article (sets deleted_at)', async () => {
    const result = await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
    expect(result.deleted).toBe(true)

    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT deleted_at FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].deleted_at).toBeTruthy()
  })

  it('is idempotent — a second delete updates deleted_at again', async () => {
    await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
    const result = await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
    expect(result.deleted).toBe(true)
    // The soft-delete does not filter out already-deleted rows when checking
    // existence, so the route doesn't 404 — the DB just stores a refreshed
    // deleted_at. If you want to detect re-deletes, filter in getArticle.
    const db = getDb()
    const r = await db.execute({
      sql: 'SELECT deleted_at FROM articles WHERE slug = ?',
      args: [TEST_SLUG],
    })
    expect(r.rows[0].deleted_at).toBeTruthy()
  })
})

describe('ingestArticle', () => {
  it('rejects missing URL', async () => {
    try {
      await ingestArticle({})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('url')
    }
  })

  it('rejects invalid URL format', async () => {
    try {
      await ingestArticle({ url: 'not-a-url' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('url')
    }
  })

  // Integration test — only passes when ingest server is running on 3847.
  it.skip('proxies to ingest server', async () => {
    const result = await ingestArticle({ url: 'https://example.com' })
    expect(result).toHaveProperty('status')
  })
})

describe('getLastUpdated', () => {
  it('returns a timestamp object', async () => {
    const result = await getLastUpdated()
    expect(result).toHaveProperty('timestamp')
    expect(typeof result.timestamp).toBe('number')
  })

  it('timestamp reflects the most recent scraped_at in the DB', async () => {
    const result = await getLastUpdated()
    // Seeded article had scraped_at = 2099-01-01T00:00:00Z
    const expected = new Date('2099-01-01T00:00:00Z').getTime()
    expect(result.timestamp).toBe(expected)
  })
})
