import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'
import {
  insertArticle,
  upsertArticle,
  getArticles,
  getArticle,
  getFlaggedArticles,
  getArticleCounts,
  searchArticles,
  updateArticle,
  flagArticle,
  deleteArticle,
  getPublications,
} from '../lib/article-queries.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeArticle(overrides = {}) {
  return {
    slug: 'test-article',
    title: 'Test Article Title',
    url: 'https://example.com/test-article',
    source: 'Example News',
    source_type: 'rss',
    date_published: '2026-04-10',
    date_verified_method: 'rss',
    date_confidence: 'high',
    sector: 'general-ai',
    keywords_matched: JSON.stringify(['artificial intelligence', 'machine learning']),
    snippet: 'A test article about AI developments.',
    full_text: 'Full text of the test article about AI developments in the sector.',
    scraped_at: '2026-04-10T08:00:00Z',
    found_by: JSON.stringify(['brave-search']),
    score: 0.85,
    confidence: 'high',
    score_reason: 'Keyword match + source quality',
    discovery_source: 'brave',
    source_episode: null,
    ingested_at: null,
    ainewshub_meta: null,
    ...overrides,
  }
}

describe('article-queries', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })

  afterAll(() => db.close())

  // -----------------------------------------------------------------------
  // 1. Insert + retrieve (verify all fields)
  // -----------------------------------------------------------------------
  describe('insertArticle', () => {
    it('inserts and returns lastInsertRowid', async () => {
      const article = makeArticle()
      const rowid = await insertArticle(db, article)
      expect(rowid).toBeGreaterThan(0)

      // Verify stored correctly
      const row = await getArticle(db, '2026-04-10', 'general-ai', 'test-article')
      expect(row).not.toBeNull()
      expect(row.title).toBe('Test Article Title')
      expect(row.url).toBe('https://example.com/test-article')
      expect(row.source).toBe('Example News')
      expect(row.source_type).toBe('rss')
      expect(row.date_published).toBe('2026-04-10')
      expect(row.sector).toBe('general-ai')
      expect(row.snippet).toBe('A test article about AI developments.')
      expect(row.full_text).toBe('Full text of the test article about AI developments in the sector.')
      expect(row.score).toBe(0.85)
      expect(row.confidence).toBe('high')
      expect(row.synced_at).toBeTruthy()
    })

    it('throws on duplicate (date_published, sector, slug)', async () => {
      const article = makeArticle()
      expect(insertArticle(db, article)).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // 2. Upsert with found_by merge
  // -----------------------------------------------------------------------
  describe('upsertArticle', () => {
    it('inserts when article does not exist', async () => {
      const article = makeArticle({
        slug: 'upsert-new',
        found_by: JSON.stringify(['rss-feed']),
      })
      const id = await upsertArticle(db, article)
      expect(id).toBeGreaterThan(0)

      const row = await getArticle(db, '2026-04-10', 'general-ai', 'upsert-new')
      expect(row).not.toBeNull()
      expect(JSON.parse(row.found_by)).toEqual(['rss-feed'])
    })

    it('merges found_by on upsert of existing article', async () => {
      const article = makeArticle({
        slug: 'upsert-new',
        found_by: JSON.stringify(['brave-search', 'rss-feed']),
      })
      const id = await upsertArticle(db, article)
      expect(id).toBeGreaterThan(0)

      const row = await getArticle(db, '2026-04-10', 'general-ai', 'upsert-new')
      const foundBy = JSON.parse(row.found_by)
      expect(foundBy).toContain('rss-feed')
      expect(foundBy).toContain('brave-search')
      // No duplicates
      expect(foundBy.length).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // 3. getArticles — no filters (sorted by date desc)
  // -----------------------------------------------------------------------
  describe('getArticles', () => {
    beforeAll(async () => {
      // Seed additional articles for filtering tests
      await insertArticle(db, makeArticle({
        slug: 'biopharma-article',
        title: 'Biopharma AI Innovation',
        sector: 'biopharma',
        date_published: '2026-04-09',
        source: 'Pharma Weekly',
        scraped_at: '2026-04-09T10:00:00Z',
      }))
      await insertArticle(db, makeArticle({
        slug: 'medtech-article',
        title: 'MedTech Imaging Breakthrough',
        sector: 'medtech',
        date_published: '2026-04-11',
        source: 'MedTech Today',
        scraped_at: '2026-04-11T09:00:00Z',
      }))
      await insertArticle(db, makeArticle({
        slug: 'older-article',
        title: 'Older General AI News',
        sector: 'general-ai',
        date_published: '2026-04-05',
        source: 'Example News',
        scraped_at: '2026-04-05T07:00:00Z',
      }))
    })

    it('returns all non-deleted articles sorted by date desc', async () => {
      const result = await getArticles(db, {})
      expect(result.articles.length).toBeGreaterThanOrEqual(4)
      expect(result.total).toBeGreaterThanOrEqual(4)
      expect(result.limit).toBe(100)
      expect(result.offset).toBe(0)

      // Verify sorted by date_published DESC
      for (let i = 1; i < result.articles.length; i++) {
        expect(result.articles[i - 1].date_published >= result.articles[i].date_published).toBe(true)
      }
    })

    it('does NOT include full_text in list results', async () => {
      const result = await getArticles(db, {})
      for (const article of result.articles) {
        expect(article).not.toHaveProperty('full_text')
      }
    })

    // -------------------------------------------------------------------
    // 4. getArticles filtered by sector
    // -------------------------------------------------------------------
    it('filters by sector', async () => {
      const result = await getArticles(db, { sector: 'biopharma' })
      expect(result.articles.length).toBe(1)
      expect(result.articles[0].sector).toBe('biopharma')
      expect(result.total).toBe(1)
    })

    // -------------------------------------------------------------------
    // 5. getArticles filtered by date range
    // -------------------------------------------------------------------
    it('filters by date range (dateFrom + dateTo)', async () => {
      const result = await getArticles(db, { dateFrom: '2026-04-09', dateTo: '2026-04-10' })
      // Should include articles on 2026-04-09 and 2026-04-10 but not 2026-04-05 or 2026-04-11
      for (const article of result.articles) {
        expect(article.date_published >= '2026-04-09').toBe(true)
        expect(article.date_published <= '2026-04-10').toBe(true)
      }
      expect(result.total).toBeGreaterThanOrEqual(2)
    })

    it('filters by exact date', async () => {
      const result = await getArticles(db, { date: '2026-04-10' })
      for (const article of result.articles) {
        expect(article.date_published).toBe('2026-04-10')
      }
    })

    // -------------------------------------------------------------------
    // 6. getArticles with pagination
    // -------------------------------------------------------------------
    it('paginates with limit and offset', async () => {
      const full = await getArticles(db, {})
      const page1 = await getArticles(db, { limit: 2, offset: 0 })
      const page2 = await getArticles(db, { limit: 2, offset: 2 })

      expect(page1.articles.length).toBe(2)
      expect(page1.total).toBe(full.total) // total unaffected by pagination
      expect(page1.limit).toBe(2)
      expect(page1.offset).toBe(0)

      expect(page2.offset).toBe(2)
      // No overlap between pages
      const page1Ids = page1.articles.map(a => a.id)
      const page2Ids = page2.articles.map(a => a.id)
      for (const id of page2Ids) {
        expect(page1Ids).not.toContain(id)
      }
    })
  })

  // -----------------------------------------------------------------------
  // 7. getArticle returns full_text
  // -----------------------------------------------------------------------
  describe('getArticle', () => {
    it('returns all fields including full_text', async () => {
      const row = await getArticle(db, '2026-04-10', 'general-ai', 'test-article')
      expect(row).not.toBeNull()
      expect(row.full_text).toBeTruthy()
      expect(row.title).toBe('Test Article Title')
    })

    // -------------------------------------------------------------------
    // 8. getArticle returns null for missing
    // -------------------------------------------------------------------
    it('returns null for non-existent article', async () => {
      const row = await getArticle(db, '2026-04-10', 'general-ai', 'no-such-slug')
      expect(row).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // 9. getArticleCounts
  // -----------------------------------------------------------------------
  describe('getArticleCounts', () => {
    it('returns correct aggregations', async () => {
      const counts = await getArticleCounts(db, {})
      expect(counts.total).toBeGreaterThanOrEqual(4)
      expect(typeof counts.today).toBe('number')

      // byDate should have entries
      expect(counts.byDate.length).toBeGreaterThanOrEqual(1)
      const dateEntry = counts.byDate.find(d => d.date === '2026-04-10')
      expect(dateEntry).toBeTruthy()
      expect(dateEntry.count).toBeGreaterThanOrEqual(1)

      // bySector should have entries
      expect(counts.bySector.length).toBeGreaterThanOrEqual(1)
      const sectorEntry = counts.bySector.find(s => s.sector === 'general-ai')
      expect(sectorEntry).toBeTruthy()
      expect(sectorEntry.count).toBeGreaterThanOrEqual(1)

      // byDateBySector
      expect(counts.byDateBySector.length).toBeGreaterThanOrEqual(1)
    })

    it('filters weekArticles by scrapedSince', async () => {
      const counts = await getArticleCounts(db, { scrapedSince: '2026-04-09T00:00:00Z' })
      // Should only count articles scraped on or after 2026-04-09
      expect(counts.weekArticles).toBeTruthy()
      expect(counts.weekArticles.total).toBeGreaterThanOrEqual(1)
    })
  })

  // -----------------------------------------------------------------------
  // 10. searchArticles via FTS
  // -----------------------------------------------------------------------
  describe('searchArticles', () => {
    it('finds articles by FTS match on title', async () => {
      const results = await searchArticles(db, 'Biopharma')
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].title).toContain('Biopharma')
    })

    it('finds articles by FTS match on snippet', async () => {
      const results = await searchArticles(db, 'developments')
      expect(results.length).toBeGreaterThanOrEqual(1)
    })

    it('returns empty array for no matches', async () => {
      const results = await searchArticles(db, 'xyznonexistent')
      expect(results.length).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // 11. flagArticle + getFlaggedArticles
  // -----------------------------------------------------------------------
  describe('flagArticle + getFlaggedArticles', () => {
    it('flags an article and retrieves it', async () => {
      await flagArticle(db, '2026-04-10', 'general-ai', 'test-article', 'High relevance')

      const row = await getArticle(db, '2026-04-10', 'general-ai', 'test-article')
      expect(row.flagged).toBe(1)
      expect(row.flag_reason).toBe('High relevance')

      const flagged = await getFlaggedArticles(db)
      expect(flagged.articles.length).toBeGreaterThanOrEqual(1)
      expect(flagged.total).toBeGreaterThanOrEqual(1)
      const found = flagged.articles.find(a => a.slug === 'test-article')
      expect(found).toBeTruthy()
      expect(found.flag_reason).toBe('High relevance')
    })
  })

  // -----------------------------------------------------------------------
  // 12. deleteArticle (soft delete)
  // -----------------------------------------------------------------------
  describe('deleteArticle', () => {
    it('soft-deletes an article — excluded from getArticles', async () => {
      // Insert a dedicated article to delete
      await insertArticle(db, makeArticle({
        slug: 'to-be-deleted',
        title: 'Article To Delete',
        date_published: '2026-04-08',
        sector: 'manufacturing',
        source: 'Factory Weekly',
      }))

      // Verify it exists
      const before = await getArticle(db, '2026-04-08', 'manufacturing', 'to-be-deleted')
      expect(before).not.toBeNull()

      // Delete
      await deleteArticle(db, '2026-04-08', 'manufacturing', 'to-be-deleted')

      // Should not appear in getArticles
      const result = await getArticles(db, { sector: 'manufacturing' })
      const found = result.articles.find(a => a.slug === 'to-be-deleted')
      expect(found).toBeUndefined()

      // But getArticle still returns it (with deleted_at set)
      const after = await getArticle(db, '2026-04-08', 'manufacturing', 'to-be-deleted')
      expect(after).not.toBeNull()
      expect(after.deleted_at).toBeTruthy()
    })
  })

  // -----------------------------------------------------------------------
  // 13. getPublications — unique sources
  // -----------------------------------------------------------------------
  describe('getPublications', () => {
    it('returns distinct, sorted source names', async () => {
      const pubs = await getPublications(db)
      expect(pubs.length).toBeGreaterThanOrEqual(3)
      expect(pubs).toContain('Example News')
      expect(pubs).toContain('Pharma Weekly')
      expect(pubs).toContain('MedTech Today')

      // Verify sorted
      for (let i = 1; i < pubs.length; i++) {
        expect(pubs[i - 1] <= pubs[i]).toBe(true)
      }

      // Verify no duplicates
      expect(new Set(pubs).size).toBe(pubs.length)
    })
  })

  // -----------------------------------------------------------------------
  // updateArticle
  // -----------------------------------------------------------------------
  describe('updateArticle', () => {
    it('updates specified fields and sets updated_at', async () => {
      await updateArticle(db, '2026-04-10', 'general-ai', 'test-article', {
        title: 'Updated Title',
        score: 0.95,
      })

      const row = await getArticle(db, '2026-04-10', 'general-ai', 'test-article')
      expect(row.title).toBe('Updated Title')
      expect(row.score).toBe(0.95)
      expect(row.updated_at).toBeTruthy()
    })
  })
})
