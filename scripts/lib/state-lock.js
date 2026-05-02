import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'

/**
 * Acquire a generic state lock. Returns true on success, false if held by a live process.
 * Stale locks (PID no longer alive or unparseable) are automatically cleared.
 *
 * @param {string} lockPath — absolute path to the lock file
 * @param {{ owner?: string }} opts — owner tag stored in the lock for debugging
 * @returns {boolean}
 */
export function acquireStateLock(lockPath, { owner = 'unknown' } = {}) {
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      try {
        process.kill(lock.pid, 0)  // throws ESRCH if PID is dead
        return false  // lock held by a live process
      } catch {
        rmSync(lockPath)  // stale PID — clean up
      }
    } catch {
      rmSync(lockPath)  // unparseable lock — clean up
    }
  }
  writeFileSync(lockPath, JSON.stringify({
    pid: process.pid,
    owner,
    acquiredAt: new Date().toISOString(),
  }))
  return true
}

/**
 * Release the lock. Idempotent — safe to call if the lock doesn't exist.
 *
 * @param {string} lockPath
 */
export function releaseStateLock(lockPath) {
  try { rmSync(lockPath) } catch { /* idempotent */ }
}

/**
 * Wait for a lock with backoff, then acquire. Throws on timeout.
 *
 * @param {string} lockPath
 * @param {{ owner?: string, timeoutMs?: number, intervalMs?: number }} opts
 */
export async function waitAndAcquireStateLock(lockPath, opts = {}) {
  const { timeoutMs = 60_000, intervalMs = 500 } = opts
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (acquireStateLock(lockPath, opts)) return
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`state-lock: timeout acquiring ${lockPath} after ${timeoutMs}ms`)
}
