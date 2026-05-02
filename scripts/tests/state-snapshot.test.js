import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { snapshotState, pruneSnapshots } from '../lib/state-snapshot.js'

let testDir

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'sni-snapshot-'))
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('state-snapshot', () => {
  it('creates a backup file with the right name pattern', () => {
    const sourcePath = join(testDir, 'source.json')
    const backupDir = join(testDir, 'backups')
    writeFileSync(sourcePath, '{"ok":true}')

    const snapshotPath = snapshotState(sourcePath, backupDir, 'pre-pull')

    expect(existsSync(snapshotPath)).toBe(true)
    expect(snapshotPath).toMatch(/state\.pre-pull\.\d{4}-\d{2}-\d{2}T/)
    expect(snapshotPath).toEndWith('.json')
  })

  it('throws if source does not exist', () => {
    const backupDir = join(testDir, 'backups')
    expect(() => snapshotState(join(testDir, 'missing.json'), backupDir, 'pre-pull'))
      .toThrow('state-snapshot: source does not exist')
  })

  it('creates backupDir if absent', () => {
    const sourcePath = join(testDir, 'source.json')
    const backupDir = join(testDir, 'new-backups', 'nested')
    writeFileSync(sourcePath, '{"ok":true}')

    snapshotState(sourcePath, backupDir, 'pre-pull')
    expect(existsSync(backupDir)).toBe(true)
  })

  it('pruneSnapshots keeps the N most recent (sorted by mtime desc)', () => {
    const backupDir = join(testDir, 'backups')
    mkdirSync(backupDir, { recursive: true })

    // Create 5 fake snapshot files with staggered mtimes so we can predict order.
    const paths = []
    for (let i = 0; i < 5; i++) {
      const name = `state.pre-pull.2026-01-01T00-00-0${i}-000Z.json`
      const p = join(backupDir, name)
      writeFileSync(p, '{}')
      // Set mtime deterministically: file i gets epoch + i seconds
      const t = new Date(2026, 0, 1, 0, 0, i)  // seconds offset = i
      utimesSync(p, t, t)
      paths.push(p)
    }
    // paths[0] = oldest (mtime sec=0), paths[4] = newest (mtime sec=4)

    const { kept, pruned } = pruneSnapshots(backupDir, 'pre-pull', 3)
    expect(kept).toBe(3)
    expect(pruned).toBe(2)

    // Oldest 2 (indices 0, 1) should be pruned
    expect(existsSync(paths[0])).toBe(false)
    expect(existsSync(paths[1])).toBe(false)
    // Newest 3 (indices 2, 3, 4) should remain
    expect(existsSync(paths[2])).toBe(true)
    expect(existsSync(paths[3])).toBe(true)
    expect(existsSync(paths[4])).toBe(true)
  })

  it('pruneSnapshots is idempotent on empty/missing dir', () => {
    const result = pruneSnapshots(join(testDir, 'nonexistent'), 'pre-pull', 30)
    expect(result).toEqual({ kept: 0, pruned: 0 })

    // Also safe when dir exists but has no matching files
    const emptyDir = join(testDir, 'empty')
    writeFileSync(join(testDir, 'dummy'), '')
    const result2 = pruneSnapshots(testDir, 'other-label', 30)
    expect(result2.pruned).toBe(0)
  })
})
