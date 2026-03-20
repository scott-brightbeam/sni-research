import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { loadManifest, saveManifest, isComplete, acquireImportLock, releaseImportLock } from './manifest.js'

const TEST_DIR = join(import.meta.dir, '..', '..', 'data', 'podcasts', '_test_manifest')

describe('manifest', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns empty object for missing manifest', () => {
    const m = loadManifest(join(TEST_DIR, 'manifest.json'))
    expect(m).toEqual({})
  })

  it('saves and loads manifest with write-validate-swap', () => {
    const path = join(TEST_DIR, 'manifest.json')
    const data = { 'test-file.md': { importedAt: '2026-03-18T07:00:00Z', week: 12 } }
    saveManifest(path, data)
    const loaded = loadManifest(path)
    expect(loaded).toEqual(data)
    expect(existsSync(path + '.bak')).toBe(false)
  })

  it('creates .bak on subsequent saves', () => {
    const path = join(TEST_DIR, 'manifest.json')
    saveManifest(path, { first: true })
    saveManifest(path, { second: true })
    expect(existsSync(path + '.bak')).toBe(true)
    const bak = JSON.parse(readFileSync(path + '.bak', 'utf8'))
    expect(bak).toEqual({ first: true })
  })

  it('cleans up .tmp on write failure', () => {
    const path = join(TEST_DIR, 'manifest.json')
    saveManifest(path, { clean: true })
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('isComplete returns true when all stages done (non-trust source)', () => {
    expect(isComplete({ digestGenerated: true, isTrustSource: false })).toBe(true)
  })

  it('isComplete returns false when digest missing', () => {
    expect(isComplete({ digestGenerated: false, isTrustSource: false })).toBe(false)
  })

  it('isComplete requires stories for trust sources', () => {
    expect(isComplete({ digestGenerated: true, isTrustSource: true, storiesExtracted: false })).toBe(false)
    expect(isComplete({ digestGenerated: true, isTrustSource: true, storiesExtracted: true })).toBe(true)
  })
})

describe('import lock', () => {
  const lockPath = join(TEST_DIR, '.import.lock')

  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    try { releaseImportLock(lockPath) } catch {}
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('acquires and releases lock', () => {
    expect(acquireImportLock(lockPath)).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
    releaseImportLock(lockPath)
    expect(existsSync(lockPath)).toBe(false)
  })

  it('rejects concurrent lock', () => {
    acquireImportLock(lockPath)
    expect(acquireImportLock(lockPath)).toBe(false)
  })

  it('detects stale lock from dead PID', () => {
    writeFileSync(lockPath, JSON.stringify({ pid: 99999999, timestamp: new Date().toISOString() }))
    expect(acquireImportLock(lockPath)).toBe(true)
  })
})
