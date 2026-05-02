/**
 * drain-contributions.test.js — 5 tests for drainContributions()
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, copyFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

import { drainContributions } from '../drain-contributions.js'
import { readSyncLog } from '../lib/sync-journal.js'

// ── Helpers ──────────────────────────────────────────────

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sni-drain-'))
  mkdirSync(join(root, 'data/editorial'), { recursive: true })
  return root
}

function readJournal(root) {
  return readSyncLog(join(root, 'data/editorial/sync-log.jsonl'))
}

function makeSidecar(id = randomUUID()) {
  return {
    version: 1,
    contributionId: id,
    type: 'post_candidate',
    payload: { title: 'Test' },
    user: { email: 'test@brightbeam.com', name: 'Test' },
    ts: new Date().toISOString(),
    clientRequestId: null,
  }
}

/**
 * Stub SFTP that serves files from a local fixtureDir.
 * Captures mv calls for assertion.
 */
function makeSftpStub(fixtureDir, opts = {}) {
  const mvCalls = []
  return {
    mvCalls,
    async ls() {
      if (!existsSync(fixtureDir)) return []
      return readdirSync(fixtureDir).filter(f => f.endsWith('.json'))
    },
    async get(filenames, localDir) {
      mkdirSync(localDir, { recursive: true })
      const written = []
      for (const f of filenames) {
        const src = join(fixtureDir, f)
        const dst = join(localDir, f)
        if (existsSync(src)) {
          copyFileSync(src, dst)
          written.push(dst)
        }
      }
      return written
    },
    async mv(filenames, remoteDestDir) {
      mvCalls.push({ filenames, remoteDestDir })
    },
  }
}

// ── Tests ────────────────────────────────────────────────

describe('drainContributions', () => {
  let root, fixtureDir, destDir

  beforeEach(() => {
    root = makeRoot()
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-drain-fixtures-'))
    destDir = join(root, 'data/editorial/contributions/parked/test-run')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 1
  it('pulls n files to the local --to directory', async () => {
    const sidecars = [makeSidecar(), makeSidecar(), makeSidecar()]
    for (const s of sidecars) {
      writeFileSync(join(fixtureDir, `${s.contributionId}.json`), JSON.stringify(s, null, 2))
    }
    const sftp = makeSftpStub(fixtureDir)

    const result = await drainContributions({ to: destDir, sftp, root })

    expect(result.count).toBe(3)
    expect(result.destDir).toBe(destDir)
    const files = readdirSync(destDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(3)
  })

  // Case 2
  it('empty source → no files pulled, exit 0, journal outcome=drained count=0', async () => {
    const sftp = makeSftpStub(fixtureDir)  // empty fixture dir

    const result = await drainContributions({ to: destDir, sftp, root })

    expect(result.count).toBe(0)
    expect(result.sourcePaths).toEqual([])
    const journal = readJournal(root)
    expect(journal).toHaveLength(1)
    expect(journal[0].outcome).toBe('drained')
    expect(journal[0].count).toBe(0)
  })

  // Case 3
  it('--remove-from-source triggers SFTP mv', async () => {
    const s = makeSidecar()
    writeFileSync(join(fixtureDir, `${s.contributionId}.json`), JSON.stringify(s, null, 2))
    const sftp = makeSftpStub(fixtureDir)

    await drainContributions({ to: destDir, removeFromSource: true, sftp, root })

    expect(sftp.mvCalls).toHaveLength(1)
    expect(sftp.mvCalls[0].filenames).toEqual([`${s.contributionId}.json`])
    expect(sftp.mvCalls[0].remoteDestDir).toMatch(/parked/)
  })

  // Case 4
  it('without --remove-from-source source is untouched (mv not called)', async () => {
    const s = makeSidecar()
    writeFileSync(join(fixtureDir, `${s.contributionId}.json`), JSON.stringify(s, null, 2))
    const sftp = makeSftpStub(fixtureDir)

    await drainContributions({ to: destDir, removeFromSource: false, sftp, root })

    expect(sftp.mvCalls).toHaveLength(0)
  })

  // Case 5
  it('journal entry has outcome=drained with count and ts', async () => {
    const sidecars = [makeSidecar(), makeSidecar()]
    for (const s of sidecars) {
      writeFileSync(join(fixtureDir, `${s.contributionId}.json`), JSON.stringify(s, null, 2))
    }
    const sftp = makeSftpStub(fixtureDir)

    await drainContributions({ to: destDir, sftp, root })

    const journal = readJournal(root)
    expect(journal).toHaveLength(1)
    const entry = journal[0]
    expect(entry.outcome).toBe('drained')
    expect(entry.count).toBe(2)
    expect(typeof entry.ts).toBe('string')
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
