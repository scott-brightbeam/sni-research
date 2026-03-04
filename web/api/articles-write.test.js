import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { patchArticle, deleteArticle, ingestArticle } from './routes/articles.js'
import { getStatus } from './routes/status.js'

const ROOT = resolve(import.meta.dir, '../..')
const TEST_DATE = '2099-01-01'
const TEST_SECTOR = 'general'
const TEST_SLUG = 'test-article-write'

const testArticle = {
  title: 'Test Article',
  url: 'https://example.com/test',
  source: 'Test Source',
  sector: 'general',
  date_published: TEST_DATE,
  full_text: 'Test content for article write tests.',
  score: 7,
  keywords_matched: ['test'],
  scraped_at: '2099-01-01T00:00:00Z',
}

beforeAll(() => {
  const dir = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${TEST_SLUG}.json`), JSON.stringify(testArticle))
})

afterAll(() => {
  // Clean up test directories
  const verifiedDir = join(ROOT, 'data/verified', TEST_DATE)
  if (existsSync(verifiedDir)) rmSync(verifiedDir, { recursive: true })
  const deletedDir = join(ROOT, 'data/deleted', TEST_DATE)
  if (existsSync(deletedDir)) rmSync(deletedDir, { recursive: true })
  const reviewDir = join(ROOT, 'data/review', TEST_DATE)
  if (existsSync(reviewDir)) rmSync(reviewDir, { recursive: true })
})

describe('patchArticle', () => {
  it('rejects invalid params', async () => {
    try {
      await patchArticle('../etc', 'general', 'slug', {})
      expect(true).toBe(false) // should not reach
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

  it('flags an article (copies to review)', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: true })
    expect(result.article.title).toBe('Test Article')
    const reviewPath = join(ROOT, 'data/review', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(reviewPath)).toBe(true)
  })

  it('unflags an article (removes from review)', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: false })
    expect(result.article.title).toBe('Test Article')
    const reviewPath = join(ROOT, 'data/review', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(reviewPath)).toBe(false)
  })

  it('moves article to new sector', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'medtech' })
    expect(result.moved).toBeTruthy()
    expect(result.moved.to).toContain('medtech')
    const newPath = join(ROOT, 'data/verified', TEST_DATE, 'medtech', `${TEST_SLUG}.json`)
    expect(existsSync(newPath)).toBe(true)
    const oldPath = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(oldPath)).toBe(false)

    // Move back for subsequent tests
    await patchArticle(TEST_DATE, 'medtech', TEST_SLUG, { sector: 'general' })
  })

  it('returns 409 on slug collision during sector move', async () => {
    // Create a file at the destination
    const destDir = join(ROOT, 'data/verified', TEST_DATE, 'biopharma')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, `${TEST_SLUG}.json`), JSON.stringify(testArticle))

    try {
      await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'biopharma' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(409)
    }

    // Clean up collision file
    rmSync(join(destDir, `${TEST_SLUG}.json`))
  })
})

describe('deleteArticle', () => {
  it('soft-deletes an article to data/deleted/', async () => {
    const result = await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
    expect(result.deleted).toBe(true)
    const deletedPath = join(ROOT, 'data/deleted', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(deletedPath)).toBe(true)
    const deletedContent = JSON.parse(readFileSync(deletedPath, 'utf-8'))
    expect(deletedContent.deleted_at).toBeTruthy()
    const originalPath = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(originalPath)).toBe(false)
  })

  it('returns 404 for already-deleted article', async () => {
    try {
      await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
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

  // Integration test — only passes when ingest server is running on 3847
  // Skipped by default since ingest server may not be available
  it.skip('proxies to ingest server', async () => {
    const result = await ingestArticle({ url: 'https://example.com' })
    expect(result).toHaveProperty('status')
  })
})

describe('getStatus with ingest health', () => {
  it('includes ingestServer field', async () => {
    const status = await getStatus()
    expect(status).toHaveProperty('ingestServer')
    expect(status.ingestServer).toHaveProperty('online')
    expect(typeof status.ingestServer.online).toBe('boolean')
  })
})
