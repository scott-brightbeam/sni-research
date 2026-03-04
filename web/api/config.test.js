import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getConfig, putConfig } from './routes/config.js'

const ROOT = resolve(import.meta.dir, '../..')

describe('getConfig', () => {
  it('reads off-limits config', async () => {
    const result = await getConfig('off-limits')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('object')
  })

  it('reads sources config', async () => {
    const result = await getConfig('sources')
    expect(result).toHaveProperty('rss_feeds')
  })

  it('reads sectors config', async () => {
    const result = await getConfig('sectors')
    expect(result).toHaveProperty('sectors')
  })

  it('rejects unknown config name', async () => {
    try {
      await getConfig('unknown')
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('Unknown config')
    }
  })
})

describe('putConfig', () => {
  let originalContent

  beforeAll(() => {
    const path = join(ROOT, 'config/off-limits.yaml')
    originalContent = readFileSync(path, 'utf-8')
  })

  afterAll(() => {
    const path = join(ROOT, 'config/off-limits.yaml')
    writeFileSync(path, originalContent)
    const tmpPath = path + '.tmp'
    const bakPath = path + '.bak'
    if (existsSync(tmpPath)) require('fs').rmSync(tmpPath)
  })

  it('writes and validates off-limits config', async () => {
    const current = await getConfig('off-limits')
    const result = await putConfig('off-limits', current)
    expect(result).toBeTruthy()
    const bakPath = join(ROOT, 'config/off-limits.yaml.bak')
    expect(existsSync(bakPath)).toBe(true)
  })

  it('rejects invalid off-limits structure', async () => {
    try {
      await putConfig('off-limits', { invalid_key: 'not valid' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('validation')
    }
  })

  it('rejects unknown config name', async () => {
    try {
      await putConfig('unknown', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('Unknown config')
    }
  })
})
