import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Isolate filesystem reads via SNI_ROOT so tests never mutate real data/.
const TEST_ROOT = join(tmpdir(), `sni-status-test-${process.pid}`)
process.env.SNI_ROOT = TEST_ROOT

// Import AFTER setting SNI_ROOT so routes/status.js resolves ROOT against it.
const { getStatus, getPodcastImport } = await import('../routes/status.js')
const { getDb, migrateSchema, _resetDbSingleton } = await import('../lib/db.js')

/** Seed a few articles so getStatus().articles returns sensible counts. */
async function seedArticles(db) {
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  // Note: articles.today counts by scraped_at, not date_published.
  const seeds = [
    { slug: 'seed-0', date: today, scraped: today },
    { slug: 'seed-1', date: today, scraped: today },
    { slug: 'seed-2', date: yesterday, scraped: yesterday },
    { slug: 'seed-3', date: '2026-03-01', scraped: '2026-03-01' },
  ]
  for (const s of seeds) {
    await db.execute({
      sql: `INSERT INTO articles (slug, title, source_type, date_published, scraped_at, sector)
            VALUES (?, ?, 'automated', ?, ?, 'general-ai')`,
      args: [s.slug, `Seed ${s.slug}`, s.date, s.scraped, 'general-ai'],
    })
  }
}

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  await seedArticles(db)
  // Supporting filesystem fixtures under the isolated ROOT
  mkdirSync(join(TEST_ROOT, 'output/runs'), { recursive: true })
  mkdirSync(join(TEST_ROOT, 'logs'), { recursive: true })
  mkdirSync(join(TEST_ROOT, 'data/verified'), { recursive: true })
  mkdirSync(join(TEST_ROOT, 'data/podcasts'), { recursive: true })
})

afterEach(() => {
  _resetDbSingleton()
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true })
})

describe('getStatus', () => {
  it('returns an object with lastRun, articles, and nextPipeline', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('lastRun')
    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('nextPipeline')
  })

  it('lastRun is null when no run files exist', async () => {
    const { lastRun } = await getStatus()
    expect(lastRun).toBeNull()
  })

  it('articles contains today and byDate counts with correct shape', async () => {
    const { articles } = await getStatus()
    expect(typeof articles.today).toBe('number')
    expect(typeof articles.total).toBe('number')
    expect(typeof articles.byDate).toBe('object')
    expect(articles.today).toBeGreaterThanOrEqual(2) // seeded two for today
    expect(articles.total).toBeGreaterThanOrEqual(4) // seeded four in total
  })

  it('includes podcastImport field', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('podcastImport')
  })

  it('includes ingestServer field', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('ingestServer')
  })
})

describe('getPodcastImport', () => {
  function todayStr() {
    return new Date().toISOString().slice(0, 10)
  }

  function createDigest(dateDir, source, slug) {
    const dir = join(TEST_ROOT, 'data/podcasts', dateDir, source)
    mkdirSync(dir, { recursive: true })
    const digestPath = join(dir, `${slug}.digest.json`)
    writeFileSync(digestPath, JSON.stringify({ title: slug, source }))
    return digestPath
  }

  it('counts episodes from digest files in date directories', () => {
    const today = todayStr()
    createDigest(today, 'test-source', 'test-episode-a')
    createDigest(today, 'test-source-b', 'test-episode-b')

    const result = getPodcastImport()
    expect(result).toBeDefined()
    expect(result.episodesThisWeek).toBeGreaterThanOrEqual(2)
  })

  it('only counts .digest.json files, not other files', () => {
    const today = todayStr()
    createDigest(today, 'test-source', 'real-episode')

    // Write a non-digest file in the same directory
    const nonDigestPath = join(TEST_ROOT, 'data/podcasts', today, 'test-source', 'notes.json')
    writeFileSync(nonDigestPath, '{}')

    const result = getPodcastImport()
    expect(result).toBeDefined()
    expect(result.episodesThisWeek).toBeGreaterThanOrEqual(1)
  })

  it('returns lastRun derived from most recent digest directory', () => {
    const today = todayStr()
    createDigest(today, 'test-source', 'ep')

    const result = getPodcastImport()
    expect(result).toBeDefined()
    expect(result.lastRun).toBeDefined()
    expect(new Date(result.lastRun).getTime()).not.toBeNaN()
  })

  it('returns null when no podcast data exists', () => {
    // Clean out the podcasts directory
    const podcastDir = join(TEST_ROOT, 'data/podcasts')
    if (existsSync(podcastDir)) rmSync(podcastDir, { recursive: true })
    mkdirSync(podcastDir, { recursive: true })

    const result = getPodcastImport()
    expect(result).toBeNull()
  })
})

describe('podcastImport status from run file', () => {
  const testRunFile = 'podcast-import-2099-12-31.json'

  beforeEach(() => {
    const runsDir = join(TEST_ROOT, 'output/runs')
    writeFileSync(join(runsDir, testRunFile), JSON.stringify({
      startedAt: '2099-12-31T07:00:00.000Z',
      completedAt: '2099-12-31T07:02:32.000Z',
      storiesGapFilled: 5,
      warnings: ['Feed timeout: techcrunch-ai'],
    }))

    const manifestDir = join(TEST_ROOT, 'data/podcasts')
    mkdirSync(manifestDir, { recursive: true })
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({
      episodes: [
        { title: 'Ep 1', date_published: '2026-03-20' },
        { title: 'Ep 2', date_published: '2026-03-19' },
        { title: 'Ep 3', date_published: '2026-03-18' },
        { title: 'Old ep', date_published: '2025-01-01' },
      ],
    }))
  })

  it('returns podcastImport with correct shape', async () => {
    const { podcastImport } = await getStatus()
    expect(podcastImport).not.toBeNull()
    expect(podcastImport).toHaveProperty('lastRun')
    expect(podcastImport).toHaveProperty('episodesThisWeek')
    expect(podcastImport).toHaveProperty('storiesGapFilled')
    expect(podcastImport).toHaveProperty('warnings')
  })

  it('returns values from the run file', async () => {
    const { podcastImport } = await getStatus()
    expect(podcastImport.storiesGapFilled).toBe(5)
    expect(Array.isArray(podcastImport.warnings)).toBe(true)
    expect(podcastImport.warnings).toContain('Feed timeout: techcrunch-ai')
  })

  it('episodesThisWeek is a number', async () => {
    const { podcastImport } = await getStatus()
    expect(typeof podcastImport.episodesThisWeek).toBe('number')
  })
})
