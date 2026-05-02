/**
 * sync-archive-merged.test.js — 7 tests for archiveMergedSidecars()
 *
 * Uses filesystem isolation (mkdtempSync per test) + SFTP stub injection.
 * No real fly/SFTP calls are made.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import {
  existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync,
  readdirSync, copyFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

import { archiveMergedSidecars } from '../sync-to-turso.js'
import { readSyncLog } from '../lib/sync-journal.js'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sni-archive-'))
  mkdirSync(join(root, 'data/editorial'), { recursive: true })
  return root
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'sni-pull-'))
}

function getSyncLogPath(root) {
  return join(root, 'data/editorial/sync-log.jsonl')
}

function getProcessedDir(root) {
  return join(root, 'data/editorial/contributions/processed')
}

/**
 * Write a fake sidecar file to a tmp dir, return the path.
 * contributionId becomes both the filename and content.
 */
function writeTmpSidecar(tmpDir, id) {
  const path = join(tmpDir, `${id}.json`)
  writeFileSync(path, JSON.stringify({ contributionId: id, version: 1 }))
  return path
}

function readJournal(root) {
  return readSyncLog(getSyncLogPath(root))
}

/**
 * Build a record of mv calls made, for assertion.
 */
function makeMvSpy(opts = {}) {
  const calls = []
  return {
    calls,
    stub: {
      async mv(from, to) {
        calls.push({ from, to })
        if (opts.failFor && opts.failFor.some(id => from.includes(id))) {
          throw new Error(`mock mv failure for ${from}`)
        }
        if (opts.failAll) {
          throw new Error(`mock mv failure for ${from}`)
        }
      },
    },
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('archiveMergedSidecars', () => {
  let root, tmpDir

  beforeEach(() => {
    root = makeRoot()
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // Case 1: 5 merged ids → 5 local copies + 5 SFTP mvs
  it('5 merged ids → 5 local processed copies and 5 SFTP mv calls', async () => {
    const ids = Array.from({ length: 5 }, () => randomUUID())
    const localPathById = {}
    for (const id of ids) {
      localPathById[id] = writeTmpSidecar(tmpDir, id)
    }

    const spy = makeMvSpy()
    const syncRunId = 'test-run-1'
    const journalPath = getSyncLogPath(root)

    const result = await archiveMergedSidecars(ids, {
      sftp: spy.stub,
      root,
      localPathById,
      journalPath,
      syncRunId,
    })

    // All 5 archived
    expect(result.archivedIds).toHaveLength(5)
    expect(result.failedMv).toHaveLength(0)

    // 5 SFTP mv calls
    expect(spy.calls).toHaveLength(5)

    // Local processed copies exist under {date}/
    const processedBase = getProcessedDir(root)
    const dateDirs = readdirSync(processedBase)
    expect(dateDirs).toHaveLength(1)
    const dateDir = join(processedBase, dateDirs[0])
    const copiedFiles = readdirSync(dateDir)
    expect(copiedFiles).toHaveLength(5)
    for (const id of ids) {
      expect(existsSync(join(dateDir, `${id}.json`))).toBe(true)
    }

    // Journal entry with outcome=archived
    const journal = readJournal(root)
    const entry = journal.find(e => e.outcome === 'archived')
    expect(entry).toBeDefined()
    expect(entry.archivedIds).toHaveLength(5)
    expect(entry.failedMv).toHaveLength(0)
  })

  // Case 2: empty mergedIds → no-op
  it('empty mergedIds → no-op, no SFTP mv calls, no journal entry', async () => {
    const spy = makeMvSpy()

    const result = await archiveMergedSidecars([], {
      sftp: spy.stub,
      root,
      localPathById: {},
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-2',
    })

    expect(result.archivedIds).toHaveLength(0)
    expect(result.failedMv).toHaveLength(0)
    expect(result.date).toBe('')
    expect(spy.calls).toHaveLength(0)

    // No journal entry written for empty runs
    expect(readJournal(root)).toHaveLength(0)
  })

  // Case 3: date dir auto-created on first mv
  it('processed/{date}/ dir created automatically if absent', async () => {
    const id = randomUUID()
    const localPathById = { [id]: writeTmpSidecar(tmpDir, id) }
    const spy = makeMvSpy()

    const processedBase = getProcessedDir(root)
    expect(existsSync(processedBase)).toBe(false)

    await archiveMergedSidecars([id], {
      sftp: spy.stub,
      root,
      localPathById,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-3',
    })

    expect(existsSync(processedBase)).toBe(true)
    const dateDirs = readdirSync(processedBase)
    expect(dateDirs).toHaveLength(1)
    // dir name matches ISO date format YYYY-MM-DD
    expect(dateDirs[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // Case 4: SFTP mv fails for 1 of N → other N-1 still archived, failedMv recorded
  it('SFTP mv fails for 1 of 3 → 2 succeed, 1 in failedMv, local copies all exist', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    const failingId = ids[1]
    const localPathById = {}
    for (const id of ids) {
      localPathById[id] = writeTmpSidecar(tmpDir, id)
    }

    const spy = makeMvSpy({ failFor: [failingId] })

    const result = await archiveMergedSidecars(ids, {
      sftp: spy.stub,
      root,
      localPathById,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-4',
    })

    // failedMv contains the one that failed
    expect(result.failedMv).toContain(failingId)
    expect(result.failedMv).toHaveLength(1)

    // archivedIds contains all 3 (local copy succeeded for all)
    expect(result.archivedIds).toHaveLength(3)

    // All 3 local copies exist (dedup will hold even for the mv-failed one)
    const dateDir = join(getProcessedDir(root), result.date)
    for (const id of ids) {
      expect(existsSync(join(dateDir, `${id}.json`))).toBe(true)
    }

    // Journal records the failure
    const journal = readJournal(root)
    const entry = journal.find(e => e.outcome === 'archived')
    expect(entry.failedMv).toContain(failingId)
  })

  // Case 5: all SFTP mvs fail → local archive succeeded, journal records all failures
  it('all SFTP mvs fail → local copies intact, journal records all failedMv', async () => {
    const ids = [randomUUID(), randomUUID()]
    const localPathById = {}
    for (const id of ids) {
      localPathById[id] = writeTmpSidecar(tmpDir, id)
    }

    const spy = makeMvSpy({ failAll: true })

    const result = await archiveMergedSidecars(ids, {
      sftp: spy.stub,
      root,
      localPathById,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-5',
    })

    expect(result.failedMv).toHaveLength(2)
    expect(result.archivedIds).toHaveLength(2)

    // Local copies still exist — dedup will hold on next run
    const dateDir = join(getProcessedDir(root), result.date)
    for (const id of ids) {
      expect(existsSync(join(dateDir, `${id}.json`))).toBe(true)
    }

    const journal = readJournal(root)
    const entry = journal.find(e => e.outcome === 'archived')
    expect(entry.failedMv).toHaveLength(2)
  })

  // Case 6: local copy fails (no source file) → continue to SFTP mv, don't block
  it('local copy fails (source absent) → SFTP mv still attempted, no crash', async () => {
    const id = randomUUID()
    // localPathById points to a non-existent file
    const localPathById = { [id]: join(tmpDir, 'does-not-exist.json') }
    const spy = makeMvSpy()

    const result = await archiveMergedSidecars([id], {
      sftp: spy.stub,
      root,
      localPathById,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-6',
    })

    // SFTP mv was still attempted
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0].from).toContain(id)

    // archivedIds still includes the id (remote mv succeeded)
    expect(result.archivedIds).toContain(id)
    expect(result.failedMv).toHaveLength(0)
  })

  // Case 7: two consecutive runs on same date → second run's date dir already exists, no error
  it('two runs on same date → second mv into existing date dir succeeds without error', async () => {
    const id1 = randomUUID()
    const id2 = randomUUID()
    const spy = makeMvSpy()

    // First run
    const localPathById1 = { [id1]: writeTmpSidecar(tmpDir, id1) }
    const r1 = await archiveMergedSidecars([id1], {
      sftp: spy.stub,
      root,
      localPathById: localPathById1,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-7a',
    })

    // Second run — same date dir already exists (mkdirSync recursive handles it)
    const localPathById2 = { [id2]: writeTmpSidecar(tmpDir, id2) }
    const r2 = await archiveMergedSidecars([id2], {
      sftp: spy.stub,
      root,
      localPathById: localPathById2,
      journalPath: getSyncLogPath(root),
      syncRunId: 'test-run-7b',
    })

    // Both runs succeed
    expect(r1.failedMv).toHaveLength(0)
    expect(r2.failedMv).toHaveLength(0)

    // Both files exist in the same date dir (dates match since same test run)
    const dateDir = join(getProcessedDir(root), r1.date)
    expect(existsSync(join(dateDir, `${id1}.json`))).toBe(true)
    expect(existsSync(join(dateDir, `${id2}.json`))).toBe(true)

    // Two separate journal entries, both outcome=archived
    const journal = readJournal(root)
    const archivedEntries = journal.filter(e => e.outcome === 'archived')
    expect(archivedEntries).toHaveLength(2)
  })
})
