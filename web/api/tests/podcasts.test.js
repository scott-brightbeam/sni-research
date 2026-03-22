import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { handleGetPodcasts, handleGetTranscript, handlePatchPodcast } from '../routes/podcasts.js'

const ROOT = resolve(import.meta.dir, '../../..')
const TEST_DATE = '2099-12-01'
const TEST_SOURCE = 'test-podcast'
const TEST_TITLE = 'episode-one'

const testManifest = [
  {
    week: 99,
    date: TEST_DATE,
    source: TEST_SOURCE,
    title: TEST_TITLE,
    digestPath: `data/podcasts/${TEST_DATE}/${TEST_SOURCE}/digest.json`,
  },
  {
    week: 98,
    date: '2099-11-24',
    source: 'other-show',
    title: 'older-episode',
    digestPath: `data/podcasts/2099-11-24/other-show/digest.json`,
  },
]

const testDigest = {
  summary: 'Test episode summary',
  topics: ['AI', 'testing'],
  duration: '45:00',
}

const testTranscript = `---
title: Episode One
source: Test Podcast
date: ${TEST_DATE}
duration: 45:00
---

This is the transcript body.

It has multiple paragraphs.
`

beforeEach(() => {
  // Create manifest
  const podcastsDir = join(ROOT, 'data/podcasts')
  mkdirSync(podcastsDir, { recursive: true })
  writeFileSync(join(podcastsDir, 'manifest.json'), JSON.stringify(testManifest))

  // Create digest
  const digestDir = join(ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE)
  mkdirSync(digestDir, { recursive: true })
  writeFileSync(join(digestDir, 'digest.json'), JSON.stringify(testDigest))

  // Create transcript
  writeFileSync(join(digestDir, `${TEST_TITLE}.md`), testTranscript)

  // Create a run summary
  const runsDir = join(ROOT, 'output/runs')
  mkdirSync(runsDir, { recursive: true })
  writeFileSync(
    join(runsDir, 'podcast-import-2099-12-01.json'),
    JSON.stringify({ date: '2099-12-01', imported: 2, errors: 0 })
  )
})

afterEach(() => {
  // Clean up test podcast data
  const testDateDir = join(ROOT, 'data/podcasts', TEST_DATE)
  if (existsSync(testDateDir)) rmSync(testDateDir, { recursive: true })

  const otherDateDir = join(ROOT, 'data/podcasts/2099-11-24')
  if (existsSync(otherDateDir)) rmSync(otherDateDir, { recursive: true })

  // Clean up manifest (only if it's our test manifest)
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
  if (existsSync(manifestPath)) {
    try {
      const content = JSON.parse(require('fs').readFileSync(manifestPath, 'utf-8'))
      if (Array.isArray(content) && content.some(e => e.week === 99)) {
        rmSync(manifestPath)
      }
    } catch { /* leave it */ }
  }

  // Clean up run summary
  const runPath = join(ROOT, 'output/runs/podcast-import-2099-12-01.json')
  if (existsSync(runPath)) rmSync(runPath)
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
    expect(result.episodes[0].source).toBe(TEST_SOURCE)
  })

  it('returns empty episodes for non-existent week', async () => {
    const result = await handleGetPodcasts({ week: '1' })
    expect(result.episodes.length).toBe(0)
    expect(result.week).toBe(1)
  })

  it('loads digest JSON for each episode', async () => {
    const result = await handleGetPodcasts({ week: '99' })
    const ep = result.episodes[0]
    expect(ep.digest).toBeTruthy()
    expect(ep.digest.summary).toBe('Test episode summary')
    expect(ep.digest.topics).toEqual(['AI', 'testing'])
  })

  it('sets digest to null when digest file missing', async () => {
    const result = await handleGetPodcasts({ week: '98' })
    const ep = result.episodes[0]
    expect(ep.digest).toBeNull()
  })

  it('includes lastRun from latest run summary', async () => {
    const result = await handleGetPodcasts({})
    expect(result.lastRun).toBeTruthy()
    expect(result.lastRun.date).toBe('2099-12-01')
    expect(result.lastRun.imported).toBe(2)
  })

  it('falls back to digest scanner when manifest missing', async () => {
    const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
    if (existsSync(manifestPath)) rmSync(manifestPath)

    const result = await handleGetPodcasts({})
    // Without manifest, scanner finds digest files on disk (including test fixtures)
    expect(Array.isArray(result.episodes)).toBe(true)
    expect(result.episodes.length).toBeGreaterThanOrEqual(1) // at least the test digest
  })
})

describe('handleGetTranscript', () => {
  it('returns transcript and metadata', async () => {
    const result = await handleGetTranscript({
      date: TEST_DATE,
      source: TEST_SOURCE,
      title: TEST_TITLE,
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
    const noFmDir = join(ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE)
    writeFileSync(join(noFmDir, 'no-frontmatter.md'), 'Just plain transcript text.')

    const result = await handleGetTranscript({
      date: TEST_DATE,
      source: TEST_SOURCE,
      title: 'no-frontmatter',
    })
    expect(result.transcript).toBe('Just plain transcript text.')
    expect(Object.keys(result.metadata).length).toBe(0)
  })
})

describe('PATCH /api/podcasts - archive', () => {
  const TEST_DATE = '2026-01-15'
  const TEST_SOURCE = 'test-archive-pod'
  const TEST_SLUG = 'test-episode'
  const digestDir = join(ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE)
  const digestPath = join(digestDir, `${TEST_SLUG}.digest.json`)

  beforeEach(() => {
    mkdirSync(digestDir, { recursive: true })
    writeFileSync(digestPath, JSON.stringify({
      title: 'Test Episode', source: 'Test', date: TEST_DATE, summary: 'Test summary',
    }))
  })

  afterEach(() => {
    if (existsSync(digestPath)) rmSync(digestPath)
    try { rmSync(digestDir, { recursive: true }) } catch {}
    try { rmSync(join(ROOT, 'data/podcasts', TEST_DATE), { recursive: true }) } catch {}
  })

  it('sets archived flag on digest', async () => {
    const resp = await fetch(`http://localhost:3900/api/podcasts/${TEST_DATE}/${TEST_SOURCE}/${TEST_SLUG}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(digestPath, 'utf-8'))
    expect(saved.archived).toBe(true)
  })

  it('removes archived flag on restore', async () => {
    writeFileSync(digestPath, JSON.stringify({
      title: 'Test', source: 'Test', date: TEST_DATE, archived: true,
    }))

    const resp = await fetch(`http://localhost:3900/api/podcasts/${TEST_DATE}/${TEST_SOURCE}/${TEST_SLUG}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(digestPath, 'utf-8'))
    expect(saved.archived).toBeUndefined()
  })
})
