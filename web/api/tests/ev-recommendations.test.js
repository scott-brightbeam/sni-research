import { describe, it, expect, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getEvRecommendations } from '../routes/ev-recommendations.js'

const ROOT = resolve(import.meta.dir, '../../..')
const recsPath = join(ROOT, 'data/editorial/ev-recommendations.json')

describe('getEvRecommendations', () => {
  let hadFile = false
  let originalContent = null

  afterEach(() => {
    if (originalContent !== null) {
      writeFileSync(recsPath, originalContent)
    } else if (existsSync(recsPath) && !hadFile) {
      rmSync(recsPath)
    }
    originalContent = null
  })

  it('returns empty domains when no file exists', () => {
    if (existsSync(recsPath)) {
      hadFile = true
      originalContent = require('fs').readFileSync(recsPath, 'utf-8')
      rmSync(recsPath)
    }
    const result = getEvRecommendations()
    expect(result.domains).toEqual([])
  })

  it('returns domains from file', () => {
    if (existsSync(recsPath)) {
      originalContent = require('fs').readFileSync(recsPath, 'utf-8')
    }
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(recsPath, JSON.stringify({
      domains: [{ domain: 'example.com', linkCount: 3, firstSeen: '2026-03-22', articles: [] }],
    }))

    const result = getEvRecommendations()
    expect(result.domains.length).toBe(1)
    expect(result.domains[0].domain).toBe('example.com')
  })
})
