import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

describe('getPodcastImport', () => {
  const manifestDir = join(ROOT, 'data/podcasts')
  const runsDir = join(ROOT, 'output/runs')
  const manifestPath = join(manifestDir, 'manifest.json')
  const bakPath = join(manifestDir, 'manifest.json.bak')

  // Save originals
  let origManifest = null
  let origBak = null

  beforeEach(() => {
    if (existsSync(manifestPath)) origManifest = Bun.file(manifestPath).text()
    if (existsSync(bakPath)) origBak = Bun.file(bakPath).text()
  })

  afterEach(async () => {
    // Restore originals
    if (origManifest !== null) writeFileSync(manifestPath, await origManifest)
    else if (existsSync(manifestPath)) rmSync(manifestPath)
    if (origBak !== null) writeFileSync(bakPath, await origBak)
  })

  it('reads from manifest.json.bak when manifest.json missing', async () => {
    if (existsSync(manifestPath)) rmSync(manifestPath)

    const testManifest = {
      'test-ep.md': {
        date: new Date().toISOString().split('T')[0],
        source: 'Test Source',
        week: getISOWeek(new Date()),
        year: new Date().getFullYear(),
      }
    }
    writeFileSync(bakPath, JSON.stringify(testManifest))

    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    expect(data.podcastImport).toBeDefined()
    expect(data.podcastImport.episodesThisWeek).toBeGreaterThanOrEqual(1)
  })

  it('extracts episodes from dict manifest with Object.values', async () => {
    const today = new Date().toISOString().split('T')[0]
    const testManifest = {
      'episode-a.md': { date: today, source: 'A', week: getISOWeek(new Date()), year: new Date().getFullYear() },
      'episode-b.md': { date: today, source: 'B', week: getISOWeek(new Date()), year: new Date().getFullYear() },
    }
    writeFileSync(manifestPath, JSON.stringify(testManifest))

    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    expect(data.podcastImport.episodesThisWeek).toBe(2)
  })

  it('filters by ep.date field (not ep.date_published)', async () => {
    const today = new Date().toISOString().split('T')[0]
    const testManifest = {
      'has-date.md': { date: today, source: 'A', week: getISOWeek(new Date()), year: new Date().getFullYear() },
      'has-date-published.md': { date_published: today, source: 'B', week: getISOWeek(new Date()), year: new Date().getFullYear() },
    }
    writeFileSync(manifestPath, JSON.stringify(testManifest))

    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    expect(data.podcastImport.episodesThisWeek).toBe(2)
  })
})

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
