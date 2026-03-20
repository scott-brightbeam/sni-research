import { readFileSync, writeFileSync, copyFileSync, renameSync, rmSync, existsSync } from 'fs'

/**
 * Load manifest from disk. Returns empty object if file doesn't exist.
 */
export function loadManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/**
 * Save manifest using write-validate-swap pattern.
 * (1) Write .tmp, (2) parse back to verify, (3) backup existing, (4) rename.
 */
export function saveManifest(path, data) {
  const tmp = path + '.tmp'
  const bak = path + '.bak'

  try {
    writeFileSync(tmp, JSON.stringify(data, null, 2))
    // Verify round-trip
    JSON.parse(readFileSync(tmp, 'utf8'))
    // Backup existing
    if (existsSync(path)) {
      copyFileSync(path, bak)
    }
    // Swap
    renameSync(tmp, path)
  } catch (err) {
    try { rmSync(tmp) } catch {}
    throw err
  }
}

/**
 * Check if a manifest entry is fully complete (all stages done).
 */
export function isComplete(entry) {
  if (!entry.digestGenerated) return false
  if (entry.isTrustSource && !entry.storiesExtracted) return false
  return true
}

/**
 * Acquire import lockfile. Returns true on success, false if already locked.
 * Stale locks (from dead PIDs) are automatically cleaned up.
 */
export function acquireImportLock(lockPath) {
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      try {
        process.kill(lock.pid, 0)
        return false
      } catch {
        rmSync(lockPath)
      }
    } catch {
      rmSync(lockPath)
    }
  }

  writeFileSync(lockPath, JSON.stringify({ pid: process.pid, timestamp: new Date().toISOString() }))
  return true
}

/**
 * Release import lockfile.
 */
export function releaseImportLock(lockPath) {
  if (existsSync(lockPath)) rmSync(lockPath)
}
