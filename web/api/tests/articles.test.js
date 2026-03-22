import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

describe('GET /api/articles/publications', () => {
  it('returns sorted unique source values', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/publications')
    const data = await resp.json()
    expect(Array.isArray(data.publications)).toBe(true)
    // Should be sorted
    const sorted = [...data.publications].sort((a, b) => a.localeCompare(b))
    expect(data.publications).toEqual(sorted)
    // Should have no duplicates
    expect(new Set(data.publications).size).toBe(data.publications.length)
  })
})

describe('POST /api/articles/manual', () => {
  const testDate = '2026-03-22'
  const testSector = 'general'
  let createdPath = null

  afterEach(() => {
    if (createdPath && existsSync(createdPath)) rmSync(createdPath)
  })

  it('rejects missing title', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Some content' }),
    })
    expect(resp.status).toBe(400)
  })

  it('rejects missing content', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Some title' }),
    })
    expect(resp.status).toBe(400)
  })

  it('creates article JSON with correct schema', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Manual Article',
        content: 'This is test content for the manual ingest.',
        source: 'Test Publication',
        sector: testSector,
        url: 'https://example.com/test',
        date_published: testDate,
      }),
    })

    expect(resp.status).toBe(200)
    const data = await resp.json()
    expect(data.article).toBeDefined()
    expect(data.article.title).toBe('Test Manual Article')
    expect(data.article.source).toBe('Test Publication')
    expect(data.article.source_type).toBe('manual')
    expect(data.article.found_by).toEqual(['manual-ingest'])
    expect(data.article.sector).toBe(testSector)
    expect(data.article.snippet).toBe('This is test content for the manual ingest.')
    expect(data.path).toContain(`data/verified/${testDate}/${testSector}/`)

    createdPath = join(ROOT, data.path)
    expect(existsSync(createdPath)).toBe(true)

    const saved = JSON.parse(readFileSync(createdPath, 'utf-8'))
    expect(saved.title).toBe('Test Manual Article')
    expect(saved.date_confidence).toBe('high')
    expect(saved.keywords_matched).toEqual([])
  })

  it('generates slug from title', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'AI & The Future: A Test!',
        content: 'Content here.',
      }),
    })
    const data = await resp.json()
    expect(data.path).toContain('ai-the-future-a-test')
    createdPath = join(ROOT, data.path)
  })
})

describe('PATCH /api/articles - archive', () => {
  const testDate = '2026-03-22'
  const testSector = 'general'
  const testSlug = 'test-archive-article'
  const testDir = join(ROOT, 'data/verified', testDate, testSector)
  const testPath = join(testDir, `${testSlug}.json`)

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(testPath, JSON.stringify({
      title: 'Test Archive Article',
      source: 'test',
      sector: testSector,
      date_published: testDate,
    }))
  })

  afterEach(() => {
    if (existsSync(testPath)) rmSync(testPath)
  })

  it('sets archived flag on article', async () => {
    const resp = await fetch(`http://localhost:3900/api/articles/${testDate}/${testSector}/${testSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(testPath, 'utf-8'))
    expect(saved.archived).toBe(true)
  })

  it('removes archived flag on restore', async () => {
    writeFileSync(testPath, JSON.stringify({
      title: 'Test', source: 'test', sector: testSector,
      date_published: testDate, archived: true,
    }))

    const resp = await fetch(`http://localhost:3900/api/articles/${testDate}/${testSector}/${testSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(testPath, 'utf-8'))
    expect(saved.archived).toBeUndefined()
  })
})
