#!/usr/bin/env bun
/**
 * drain-contributions.js — Operational drain: pull sidecars from Fly volume
 * to a local directory WITHOUT merging into state.json.
 *
 * Usage:
 *   bun scripts/drain-contributions.js --to data/editorial/contributions/parked/2026-04-30T12-00-00/
 *   bun scripts/drain-contributions.js --to <dir> --remove-from-source
 *
 * Flags:
 *   --to <dir>              Local destination directory (required)
 *   --remove-from-source    Also mv source files to parked/ on Fly volume (opt-in)
 *
 * Appends a journal entry { outcome: 'drained', count, ts } to the sync log.
 */

import { mkdirSync, existsSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = process.env.SNI_ROOT || resolve(__dirname, '..')

const CONTRIBUTIONS_REMOTE_DIR = '/app/data/editorial/contributions'
const FLY_APP = 'sni-research'
const FLY_BIN = `/Users/scott/.fly/bin`
const FLY_ENV = { ...process.env, PATH: `${FLY_BIN}:${process.env.PATH}` }

import { appendSyncLog } from './lib/sync-journal.js'

function getJournalPath(root = ROOT) {
  return join(root, 'data/editorial/sync-log.jsonl')
}

// ── Argument parsing ─────────────────────────────────────

function parseArgs(argv) {
  const args = { to: null, removeFromSource: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--to' && argv[i + 1]) {
      args.to = resolve(argv[++i])
    } else if (argv[i] === '--remove-from-source') {
      args.removeFromSource = true
    }
  }
  return args
}

// ── SFTP helpers (injectable for tests) ─────────────────

export const realSftp = {
  async ls() {
    const proc = Bun.spawn(
      ['fly', 'ssh', 'console', '--command',
        `sh -c 'ls -1 "${CONTRIBUTIONS_REMOTE_DIR}" 2>/dev/null || true'`,
        '-a', FLY_APP],
      { stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
    )
    const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    return stdout
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.endsWith('.json') && !l.includes('/'))
  },

  async get(filenames, localDir) {
    if (filenames.length === 0) return []
    mkdirSync(localDir, { recursive: true })
    const commands = filenames
      .map(f => `get "${CONTRIBUTIONS_REMOTE_DIR}/${f}" "${localDir}/${f}"`)
      .join('\n')
    const proc = Bun.spawn(
      ['fly', 'ssh', 'sftp', 'shell', '-a', FLY_APP],
      { stdin: new Blob([commands]), stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
    )
    await proc.exited
    return filenames.map(f => join(localDir, f)).filter(p => existsSync(p))
  },

  async mv(filenames, remoteDestDir) {
    if (filenames.length === 0) return
    const cmds = filenames
      .map(f => `mv "${CONTRIBUTIONS_REMOTE_DIR}/${f}" "${remoteDestDir}/${f}" 2>&1 && echo OK:${f} || echo FAIL:${f}`)
      .join('; ')
    const proc = Bun.spawn(
      ['fly', 'ssh', 'console', '--command', `sh -c '${cmds}'`, '-a', FLY_APP],
      { stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
    )
    await proc.exited
  },
}

// ── Core drain function (testable) ───────────────────────

/**
 * @param {{ to: string, removeFromSource?: boolean, sftp?: object, root?: string }} opts
 * @returns {{ count: number, bytes: number, sourcePaths: string[], destDir: string }}
 */
export async function drainContributions({ to, removeFromSource = false, sftp = realSftp, root = ROOT }) {
  if (!to) throw new Error('--to <dir> is required')

  const destDir = resolve(to)
  mkdirSync(destDir, { recursive: true })

  const filenames = await sftp.ls()

  if (filenames.length === 0) {
    console.log('drain-contributions: no sidecars found on Fly volume')
    appendSyncLog(getJournalPath(root), {
      outcome: 'drained',
      count: 0,
      ts: new Date().toISOString(),
      destDir,
    })
    return { count: 0, bytes: 0, sourcePaths: [], destDir }
  }

  const localPaths = await sftp.get(filenames, destDir)
  const count = localPaths.length
  const bytes = localPaths.reduce((sum, p) => {
    try { return sum + Bun.file(p).size } catch { return sum }
  }, 0)

  const sourcePaths = filenames.map(f => `${CONTRIBUTIONS_REMOTE_DIR}/${f}`)

  if (removeFromSource) {
    const remoteParkedDir = `${CONTRIBUTIONS_REMOTE_DIR}/parked`
    await sftp.mv(filenames, remoteParkedDir)
  }

  appendSyncLog(getJournalPath(root), {
    outcome: 'drained',
    count,
    ts: new Date().toISOString(),
    destDir,
    removeFromSource,
  })

  console.log(`drain-contributions: pulled ${count} file(s) (${bytes} bytes)`)
  console.log(`  source: ${CONTRIBUTIONS_REMOTE_DIR}`)
  console.log(`  destination: ${destDir}`)
  if (removeFromSource) {
    console.log(`  source files moved to parked/ on volume`)
  }
  sourcePaths.forEach(p => console.log(`  ${p}`))

  return { count, bytes, sourcePaths, destDir }
}

// ── CLI entry point ───────────────────────────────────────

if (import.meta.main) {
  const { to, removeFromSource } = parseArgs(process.argv.slice(2))
  if (!to) {
    console.error('Usage: bun scripts/drain-contributions.js --to <dir> [--remove-from-source]')
    process.exit(1)
  }
  try {
    await drainContributions({ to, removeFromSource })
  } catch (err) {
    console.error('drain-contributions failed:', err.message)
    process.exit(1)
  }
}
