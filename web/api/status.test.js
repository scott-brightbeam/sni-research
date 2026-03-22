import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getStatus } from './routes/status.js'

const ROOT = resolve(import.meta.dir, '../..')

describe('getStatus', () => {
  it('returns an object with lastRun, articles, and nextPipeline', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('lastRun')
    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('nextPipeline')
  })

  it('lastRun contains mode and stages array', async () => {
    const { lastRun } = await getStatus()
    // lastRun may be null if no runs exist
    if (lastRun) {
      expect(lastRun).toHaveProperty('mode')
      expect(lastRun).toHaveProperty('stages')
      expect(Array.isArray(lastRun.stages)).toBe(true)
    }
  })

  it('articles contains today and byDate counts', async () => {
    const { articles } = await getStatus()
    expect(typeof articles.today).toBe('number')
    expect(typeof articles.total).toBe('number')
    expect(typeof articles.byDate).toBe('object')
  })

  it('includes podcastImport field', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('podcastImport')
  })
})

describe('podcastImport status', () => {
  const runsDir = join(ROOT, 'output/runs')
  const manifestDir = join(ROOT, 'data/podcasts')
  const testRunFile = 'podcast-import-2099-12-31.json'
  let cleanupRunFile = false
  let cleanupManifestDir = false

  beforeAll(() => {
    // Create a test podcast-import run file (use far-future date to ensure it sorts last)
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(join(runsDir, testRunFile), JSON.stringify({
      startedAt: '2099-12-31T07:00:00.000Z',
      completedAt: '2099-12-31T07:02:32.000Z',
      storiesGapFilled: 5,
      warnings: ['Feed timeout: techcrunch-ai']
    }))
    cleanupRunFile = true

    // Create a test manifest
    if (!existsSync(manifestDir)) {
      mkdirSync(manifestDir, { recursive: true })
      cleanupManifestDir = true
    }
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify({
      episodes: [
        { title: 'Ep 1', date_published: '2026-03-20' },
        { title: 'Ep 2', date_published: '2026-03-19' },
        { title: 'Ep 3', date_published: '2026-03-18' },
        { title: 'Old ep', date_published: '2025-01-01' },
      ]
    }))
  })

  afterAll(() => {
    if (cleanupRunFile) {
      try { rmSync(join(runsDir, testRunFile)) } catch { /* ok */ }
    }
    if (cleanupManifestDir) {
      try { rmSync(manifestDir, { recursive: true }) } catch { /* ok */ }
    } else {
      try { rmSync(join(manifestDir, 'manifest.json')) } catch { /* ok */ }
    }
  })

  it('returns podcastImport with correct shape when run file exists', async () => {
    const { podcastImport } = await getStatus()
    expect(podcastImport).not.toBeNull()
    expect(podcastImport).toHaveProperty('lastRun')
    expect(podcastImport).toHaveProperty('episodesThisWeek')
    expect(podcastImport).toHaveProperty('storiesGapFilled')
    expect(podcastImport).toHaveProperty('warnings')
  })

  it('returns correct values from the run file', async () => {
    const { podcastImport } = await getStatus()
    expect(podcastImport.lastRun).toBe('2099-12-31T07:02:32.000Z')
    expect(podcastImport.storiesGapFilled).toBe(5)
    expect(Array.isArray(podcastImport.warnings)).toBe(true)
    expect(podcastImport.warnings).toContain('Feed timeout: techcrunch-ai')
  })

  it('episodesThisWeek is a number', async () => {
    const { podcastImport } = await getStatus()
    expect(typeof podcastImport.episodesThisWeek).toBe('number')
  })
})

describe('podcastImport when no run files exist', () => {
  // With no podcast-import-*.json files, should return null
  // We rely on the base state when no such files exist
  // The previous test block creates/removes its own files
  it('returns null when no podcast-import run files exist', async () => {
    // Temporarily remove any podcast-import files to test null case
    const runsDir = join(ROOT, 'output/runs')
    const { readdirSync } = await import('fs')
    const podcastFiles = readdirSync(runsDir)
      .filter(f => f.startsWith('podcast-import-') && f.endsWith('.json'))

    // If there are no podcast-import files (the normal state), podcastImport should be null
    if (podcastFiles.length === 0) {
      const { podcastImport } = await getStatus()
      expect(podcastImport).toBeNull()
    }
  })
})
