/**
 * lock.js — File-based locking for SNI Research Tool
 *
 * Prevents concurrent pipeline runs. Uses atomic file creation
 * with { flag: 'wx' } to avoid race conditions.
 *
 * Stale lock detection: if the lock file's PID is dead and the lock
 * is older than 2 hours, it's treated as stale and stolen.
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Check if a process with the given PID is alive and looks like a bun/node process.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = check existence, don't kill
    // Verify it's a bun/node process (not a reused PID for something unrelated)
    const cmd = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim().toLowerCase();
    return cmd.includes('bun') || cmd.includes('node');
  } catch {
    return false;
  }
}

/**
 * Acquire a named lock. Returns whether the lock was acquired.
 *
 * @param {string} name — lock name (e.g. 'pipeline')
 * @returns {{ acquired: boolean, lockPath: string, reason?: string }}
 */
export function acquireLock(name) {
  const lockPath = join(ROOT, 'data', `.${name}.lock`);

  // Check for existing lock
  if (existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
      const age = Date.now() - lockData.timestamp;

      if (isProcessAlive(lockData.pid)) {
        return { acquired: false, lockPath, reason: `Lock held by PID ${lockData.pid} (running for ${Math.round(age / 1000)}s)` };
      }

      // PID is dead — check if stale
      if (age > STALE_THRESHOLD_MS) {
        // Stale lock: steal it
        unlinkSync(lockPath);
        console.warn(`[lock] Stale lock removed (PID ${lockData.pid} dead, age ${Math.round(age / 60000)}min)`);
      } else {
        // PID dead but lock is recent — might have just crashed, steal anyway
        unlinkSync(lockPath);
        console.warn(`[lock] Removed lock from dead process (PID ${lockData.pid})`);
      }
    } catch {
      // Corrupt lock file — remove it
      try { unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }

  // Attempt atomic creation
  const lockData = JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
    startedAt: new Date().toISOString(),
  });

  try {
    writeFileSync(lockPath, lockData, { flag: 'wx' }); // exclusive create — atomic
    return { acquired: true, lockPath };
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another process acquired the lock between our check and create
      return { acquired: false, lockPath, reason: 'Lock acquired by another process (race)' };
    }
    throw err;
  }
}

/**
 * Release a lock. Safe to call even if lock doesn't exist.
 * @param {string} lockPath — path returned by acquireLock
 */
export function releaseLock(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch { /* already released or never acquired */ }
}
