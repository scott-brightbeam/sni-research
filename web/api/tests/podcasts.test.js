import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Isolate filesystem-bound routes to a temp dir so test data never touches real data/.
const TEST_ROOT = join(tmpdir(), `sni-podcasts-test-${process.pid}`)
process.env.SNI_ROOT = TEST_ROOT

// Import AFTER setting SNI_ROOT so routes/podcasts.js resolves ROOT against it.
const { handleGetPodcasts, handleGetTranscript, handlePatchPodcast } = await import('../routes/podcasts.js')
const { getDb, migrateSchema, _resetDbSingleton } = await import('../lib/db.js')

const TEST_DATE = '2099-12-01'
const TEST_SOURCE_SLUG = 'test-podcast'
const TEST_FILENAME = 'episode-one'

/** Seed the episodes + episode_stories tables with two test rows. */
async function seedEpisodes(db) {
  // Episode 1 — week 99, has a story
  const ep1 = await db.execute({
    sql: `INSERT INTO episodes (filename, date, source, source_slug, title, week, duration, tier, summary, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: [TEST_FILENAME, TEST_DATE, 'Test Podcast', TEST_SOURCE_SLUG, 'Episode One', 99, 2700, 1, 'Test episode summary'],
  })
  await db.execute({
    sql: `INSERT INTO episode_stories (episode_id, headline, detail, url, sector)
          VALUES (?, ?, ?, ?, ?)`,
    args: [Number(ep1.lastInsertRowid), 'First story', 'detail', 'https://example.com/1', 'general-ai'],
  })

  // Episode 2 — week 98, no stories
  await db.execute({
    sql: `INSERT INTO episodes (filename, date, source, source_slug, title, week, tier, summary, archived)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    args: ['older-episode', '2099-11-24', 'Other Show', 'other-show', 'Older Episode', 98, 1, null],
  })
}

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  await seedEpisodes(db)

  // Transcript file — handleGetTranscript reads from disk.
  const digestDir = join(TEST_ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE_SLUG)
  mkdirSync(digestDir, { recursive: true })
  writeFileSync(join(digestDir, `${TEST_FILENAME}.md`), `---
title: Episode One
source: Test Podcast
date: ${TEST_DATE}
duration: 45:00
---

This is the transcript body.

It has multiple paragraphs.
`)

  // Latest pipeline run summary — handleGetPodcasts reads from output/runs/.
  const runsDir = join(TEST_ROOT, 'output/runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(
    join(runsDir, 'podcast-import-2099-12-01.json'),
    JSON.stringify({ date: '2099-12-01', imported: 2, errors: 0 })
  )
})

afterEach(() => {
  _resetDbSingleton()
  if (existsSync(TEST_ROOT)) rmSync(TEST_ROOT, { recursive: true })
})

describe('handleGetPodcasts', () => {
  it('returns all episodes when no week filter', async () => {
    const result = await handleGetPodcasts({})
    expect(result.episodes.length).toBe(2)
    expect(result.week).toBeNull()
  })

  it('filters episodes by week number', async () => {
    const result = await handleGetPodcasts({ week: '99' })
    expect(result.week).toBe(99)
    expect(result.episodes.length).toBe(1)
    expect(result.episodes[0].source).toBe('Test Podcast')
  })

  it('returns empty episodes for non-existent week', async () => {
    const result = await handleGetPodcasts({ week: '1' })
    expect(result.episodes.length).toBe(0)
    expect(result.week).toBe(1)
  })

  it('attaches synthesised digest with summary for each episode', async () => {
    const result = await handleGetPodcasts({ week: '99' })
    const ep = result.episodes[0]
    expect(ep.digest).toBeTruthy()
    expect(ep.digest.summary).toBe('Test episode summary')
    expect(ep.digest.stories.length).toBe(1)
    expect(ep.digest.stories[0].headline).toBe('First story')
  })

  it('returns null summary when episode has no summary', async () => {
    const result = await handleGetPodcasts({ week: '98' })
    const ep = result.episodes[0]
    expect(ep.digest.summary).toBeNull()
    expect(ep.digest.stories.length).toBe(0)
  })

  it('includes lastRun from latest run summary', async () => {
    const result = await handleGetPodcasts({})
    expect(result.lastRun).toBeTruthy()
    expect(result.lastRun.date).toBe('2099-12-01')
    expect(result.lastRun.imported).toBe(2)
  })
})

describe('handleGetTranscript', () => {
  it('returns transcript and metadata', async () => {
    const result = await handleGetTranscript({
      date: TEST_DATE,
      source: TEST_SOURCE_SLUG,
      title: TEST_FILENAME,
    })
    expect(result.transcript).toContain('This is the transcript body.')
    expect(result.metadata.title).toBe('Episode One')
    expect(result.metadata.source).toBe('Test Podcast')
    expect(result.metadata.duration).toBe('45:00')
  })

  it('returns 400 for missing params', async () => {
    try {
      await handleGetTranscript({})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('Missing required params')
    }
  })

  it('returns 400 for invalid date param', async () => {
    try {
      await handleGetTranscript({ date: '../etc', source: 'foo', title: 'bar' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
      expect(err.message).toContain('Invalid')
    }
  })

  it('returns 400 for invalid source param', async () => {
    try {
      await handleGetTranscript({ date: '2099-12-01', source: 'foo/bar', title: 'baz' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
    }
  })

  it('returns 400 for invalid title param', async () => {
    try {
      await handleGetTranscript({ date: '2099-12-01', source: 'foo', title: 'bar/../baz' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(400)
    }
  })

  it('returns 404 for non-existent transcript', async () => {
    try {
      await handleGetTranscript({ date: '9999-01-01', source: 'nonexistent', title: 'missing' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
      expect(err.message).toContain('Transcript not found')
    }
  })

  it('handles transcript without frontmatter', async () => {
    const noFmDir = join(TEST_ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE_SLUG)
    writeFileSync(join(noFmDir, 'no-frontmatter.md'), 'Just plain transcript text.')

    const result = await handleGetTranscript({
      date: TEST_DATE,
      source: TEST_SOURCE_SLUG,
      title: 'no-frontmatter',
    })
    expect(result.transcript).toBe('Just plain transcript text.')
    expect(Object.keys(result.metadata).length).toBe(0)
  })
})

describe('handlePatchPodcast (archive)', () => {
  it('sets archived flag on episode', async () => {
    const result = await handlePatchPodcast(TEST_DATE, TEST_SOURCE_SLUG, TEST_FILENAME, { archived: true })
    expect(result.archived).toBe(true)
  })

  it('removes archived flag on restore', async () => {
    // Archive first, then restore
    await handlePatchPodcast(TEST_DATE, TEST_SOURCE_SLUG, TEST_FILENAME, { archived: true })
    const result = await handlePatchPodcast(TEST_DATE, TEST_SOURCE_SLUG, TEST_FILENAME, { archived: false })
    expect(result.archived).toBe(false)
  })

  it('returns 404 when episode does not exist', async () => {
    try {
      await handlePatchPodcast('2099-01-01', 'missing-show', 'no-such-episode', { archived: true })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('accepts no-op patch (empty body)', async () => {
    const result = await handlePatchPodcast(TEST_DATE, TEST_SOURCE_SLUG, TEST_FILENAME, {})
    expect(result.ok).toBe(true)
  })
})
