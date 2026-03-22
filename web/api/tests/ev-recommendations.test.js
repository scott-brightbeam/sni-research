import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const recsPath = join(ROOT, 'data/editorial/ev-recommendations.json')

describe('GET /api/editorial/ev-recommendations', () => {
  afterEach(() => {
    if (existsSync(recsPath)) rmSync(recsPath)
  })

  it('returns empty domains when no file exists', async () => {
    if (existsSync(recsPath)) rmSync(recsPath)
    const resp = await fetch('http://localhost:3900/api/editorial/ev-recommendations')
    const data = await resp.json()
    expect(data.domains).toEqual([])
  })

  it('returns domains from file', async () => {
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(recsPath, JSON.stringify({
      domains: [{ domain: 'example.com', linkCount: 3, firstSeen: '2026-03-22', articles: [] }],
    }))

    const resp = await fetch('http://localhost:3900/api/editorial/ev-recommendations')
    const data = await resp.json()
    expect(data.domains.length).toBe(1)
    expect(data.domains[0].domain).toBe('example.com')
  })
})
