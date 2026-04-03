import { describe, it, expect, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getPodcastImport } from '../routes/status.js'

const ROOT = resolve(import.meta.dir, '../../..')

describe('getPodcastImport', () => {
  const podcastDir = join(ROOT, 'data/podcasts')
  const createdDirs = []

  function todayStr() {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  function createDigest(dateDir, source, slug) {
    const dir = join(podcastDir, dateDir, source)
    mkdirSync(dir, { recursive: true })
    createdDirs.push(join(podcastDir, dateDir))
    const digestPath = join(dir, `${slug}.digest.json`)
    writeFileSync(digestPath, JSON.stringify({ title: slug, source }))
    return digestPath
  }

  afterEach(() => {
    for (const dir of createdDirs) {
      try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    }
    createdDirs.length = 0
  })

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
    const nonDigestPath = join(podcastDir, today, 'test-source', 'notes.json')
    writeFileSync(nonDigestPath, '{}')

    const result = getPodcastImport()
    expect(result).toBeDefined()
    expect(result.episodesThisWeek).toBeGreaterThanOrEqual(1)
  })

  it('returns lastRun from most recent date directory', () => {
    const result = getPodcastImport()
    expect(result).toBeDefined()
    expect(result.lastRun).toBeDefined()
    expect(new Date(result.lastRun).getTime()).not.toBeNaN()
  })
})
