import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { acquireStateLock, releaseStateLock, waitAndAcquireStateLock } from '../lib/state-lock.js'

let testDir
let lockPath

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'sni-state-lock-'))
  lockPath = join(testDir, '.state.lock')
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('state-lock', () => {
  it('acquires on fresh path and creates lock file', () => {
    const result = acquireStateLock(lockPath, { owner: 'test' })
    expect(result).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
  })

  it('returns false when lock already held by current process (live PID)', () => {
    acquireStateLock(lockPath, { owner: 'first' })
    const second = acquireStateLock(lockPath, { owner: 'second' })
    expect(second).toBe(false)
  })

  it('clears stale lock with dead PID and re-acquires', () => {
    // Write a lock with a PID that definitely does not exist
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, owner: 'ghost', acquiredAt: new Date().toISOString() }))
    const result = acquireStateLock(lockPath, { owner: 'new-owner' })
    expect(result).toBe(true)
    // Verify the lock file now has the current PID
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
    expect(lock.pid).toBe(process.pid)
    expect(lock.owner).toBe('new-owner')
  })

  it('clears unparseable lock and re-acquires', () => {
    writeFileSync(lockPath, 'not-valid-json')
    const result = acquireStateLock(lockPath, { owner: 'recovery' })
    expect(result).toBe(true)
    expect(existsSync(lockPath)).toBe(true)
  })

  it('waitAndAcquireStateLock throws on timeout', async () => {
    // Simulate a held lock by writing a lock with the current process's own PID
    // so it looks like a live process. Use a very short timeout.
    acquireStateLock(lockPath, { owner: 'blocker' })

    // Override: write a lock that points at the *current* process (ourselves),
    // so kill(pid, 0) succeeds — the lock appears held. Then try to acquire with
    // a tiny timeout.
    await expect(
      waitAndAcquireStateLock(lockPath, { owner: 'waiter', timeoutMs: 100, intervalMs: 50 })
    ).rejects.toThrow('state-lock: timeout')
  })
})
