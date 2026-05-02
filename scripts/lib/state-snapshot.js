import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

/**
 * Snapshot a file to backupDir/state.{label}.{TS}.json. Returns the snapshot path.
 *
 * @param {string} sourcePath — file to snapshot
 * @param {string} backupDir  — directory to write into (created if absent)
 * @param {string} label      — name infix, e.g. 'pre-pull'
 * @returns {string} snapshot path
 */
export function snapshotState(sourcePath, backupDir, label) {
  if (!existsSync(sourcePath)) {
    throw new Error(`state-snapshot: source does not exist: ${sourcePath}`)
  }
  mkdirSync(backupDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const snapshotPath = join(backupDir, `state.${label}.${ts}.json`)
  copyFileSync(sourcePath, snapshotPath)
  return snapshotPath
}

/**
 * Prune snapshots for a given label to the most recent `keep` files.
 * Sorted by mtime descending — the newest files are kept.
 * Best-effort: individual unlink failures are logged, not thrown.
 *
 * @param {string} backupDir
 * @param {string} label
 * @param {number} keep — number of snapshots to retain (default 30)
 * @returns {{ kept: number, pruned: number }}
 */
export function pruneSnapshots(backupDir, label, keep = 30) {
  if (!existsSync(backupDir)) return { kept: 0, pruned: 0 }
  const prefix = `state.${label}.`
  const files = readdirSync(backupDir)
    .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
    .map(f => ({ name: f, path: join(backupDir, f), mtime: statSync(join(backupDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)  // newest first
  const toPrune = files.slice(keep)
  let pruned = 0
  for (const f of toPrune) {
    try { unlinkSync(f.path); pruned++ } catch (e) {
      console.error(`[state-snapshot] failed to prune ${f.path}: ${e.message}`)
    }
  }
  return { kept: Math.min(files.length, keep), pruned }
}
