import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'

// walk.js resolves ROOT as three dirs up from web/api/lib/.
// This test is at web/api/walk.test.js, so project root is two dirs up.
const ROOT = resolve(import.meta.dir, '../..')
const VERIFIED = join(ROOT, 'data/verified')

// Create fixture structure using unique slugs to avoid colliding with real data:
// data/verified/2026-02-28/general/_test-fixture-a.json
// data/verified/2026-03-01/general/_test-fixture-b.json
// data/verified/2026-03-02/biopharma/_test-fixture-c.json
// data/verified/2026-03-04/general/_test-fixture-d.json

const FIXTURES = [
  { date: '2026-02-28', sector: 'general', slug: '_test-fixture-a', data: { title: 'Test Fixture A', url: 'https://test-a.example.com', source: 'TestFixture' } },
  { date: '2026-03-01', sector: 'general', slug: '_test-fixture-b', data: { title: 'Test Fixture B', url: 'https://test-b.example.com', source: 'TestFixture' } },
  { date: '2026-03-02', sector: 'biopharma', slug: '_test-fixture-c', data: { title: 'Test Fixture C', url: 'https://test-c.example.com', source: 'TestFixture' } },
  { date: '2026-03-04', sector: 'general', slug: '_test-fixture-d', data: { title: 'Test Fixture D', url: 'https://test-d.example.com', source: 'TestFixture' } },
]

// Track created files for cleanup (not dirs — real data may share them)
const createdFiles = []

beforeAll(() => {
  for (const f of FIXTURES) {
    const dir = join(VERIFIED, f.date, f.sector)
    mkdirSync(dir, { recursive: true })
    const filePath = join(dir, `${f.slug}.json`)
    writeFileSync(filePath, JSON.stringify(f.data))
    createdFiles.push(filePath)
  }
})

afterAll(() => {
  for (const f of createdFiles) {
    if (existsSync(f)) rmSync(f)
  }
})

// Dynamic import to get fresh module after fixture creation
const { walkArticleDir } = await import('./lib/walk.js')

// collect only our test fixtures (source === 'TestFixture') to avoid interference from real data
function collect(opts = {}) {
  const results = []
  walkArticleDir('verified', (raw, meta) => {
    if (raw.source === 'TestFixture') {
      results.push({ title: raw.title, ...meta })
    }
  }, opts)
  return results
}

describe('walkArticleDir date range filtering', () => {
  it('dateFrom filters out earlier dates', () => {
    const results = collect({ dateFrom: '2026-03-01' })
    const dates = results.map(r => r.date)
    expect(dates).not.toContain('2026-02-28')
    expect(dates).toContain('2026-03-01')
    expect(dates).toContain('2026-03-04')
  })

  it('dateTo filters out later dates', () => {
    const results = collect({ dateTo: '2026-03-01' })
    const dates = results.map(r => r.date)
    expect(dates).toContain('2026-02-28')
    expect(dates).toContain('2026-03-01')
    expect(dates).not.toContain('2026-03-04')
  })

  it('dateFrom + dateTo returns only dates in range', () => {
    const results = collect({ dateFrom: '2026-03-01', dateTo: '2026-03-02' })
    const dates = [...new Set(results.map(r => r.date))]
    expect(dates.sort()).toEqual(['2026-03-01', '2026-03-02'])
  })

  it('exact date filter takes precedence over range', () => {
    const results = collect({ date: '2026-03-01', dateFrom: '2026-02-28', dateTo: '2026-03-04' })
    const dates = [...new Set(results.map(r => r.date))]
    expect(dates).toEqual(['2026-03-01'])
  })

  it('open-ended dateFrom returns from that date onward', () => {
    const results = collect({ dateFrom: '2026-03-02' })
    const dates = [...new Set(results.map(r => r.date))].sort()
    expect(dates).toEqual(['2026-03-02', '2026-03-04'])
  })

  it('sector + dateFrom compound filter works', () => {
    const results = collect({ sector: 'general', dateFrom: '2026-03-01' })
    expect(results.length).toBe(2) // _test-fixture-b (03-01) + _test-fixture-d (03-04)
    expect(results.every(r => r.sector === 'general')).toBe(true)
  })
})
