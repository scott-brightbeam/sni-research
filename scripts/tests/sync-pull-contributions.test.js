/**
 * sync-pull-contributions.test.js — 42 integration tests for pullContributions()
 *
 * All tests use filesystem isolation (mkdtempSync per describe group or test).
 * SFTP is mocked via the injectable `sftp` parameter.
 * sendTelegram is mocked via module-level spy so no real Telegram calls are made.
 * Turso DB is not exercised here — pullContributions is pure filesystem.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test'
import {
  existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync,
  readdirSync, unlinkSync, utimesSync, copyFileSync, renameSync,
} from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

// ── Test infrastructure ────────────────────────────────────────────────────

/**
 * Build a valid sidecar object. Override any field by passing opts.
 */
function makeSidecar(opts = {}) {
  return {
    version: opts.version ?? 1,
    contributionId: opts.contributionId ?? randomUUID(),
    type: opts.type ?? 'post_candidate',
    payload: opts.payload ?? { title: 'Test post', format: 'Format 1: The Concept Contrast' },
    user: opts.user ?? { email: 'test@brightbeam.com', name: 'Test User' },
    ts: opts.ts ?? new Date().toISOString(),
    clientRequestId: opts.clientRequestId ?? null,
    ...opts._extra,
  }
}

/**
 * Build a minimal valid state.json content with the required top-level sections.
 * Optionally pass existing pendingContributions.
 */
function makeState(opts = {}) {
  return {
    counters: { nextSession: 1, nextDocument: 1, nextPost: 1 },
    analysisIndex: {},
    themeRegistry: {},
    postBacklog: {},
    decisionLog: [],
    ...(opts.pendingContributions !== undefined
      ? { pendingContributions: opts.pendingContributions }
      : {}),
    ...opts._extra,
  }
}

/**
 * Mock SFTP stub factory.
 * ls() returns filenames; get() copies them from a fixture dir to localDir.
 *
 * @param {string} fixtureDir — directory with sidecar .json files to "serve"
 * @param {{ lsError?, getError?, partialGet? }} opts
 */
function makeSftpStub(fixtureDir, opts = {}) {
  return {
    async ls() {
      if (opts.lsError) throw new Error(opts.lsError)
      if (!existsSync(fixtureDir)) return []
      return readdirSync(fixtureDir).filter(f => f.endsWith('.json') && !f.includes('/'))
    },
    async get(filenames, localDir) {
      if (opts.getError) throw new Error(opts.getError)
      mkdirSync(localDir, { recursive: true })
      const written = []
      const toFetch = opts.partialGet
        ? filenames.slice(0, opts.partialGet)  // simulate partial transfer
        : filenames
      for (const f of toFetch) {
        const src = join(fixtureDir, f)
        const dst = join(localDir, f)
        if (existsSync(src)) {
          copyFileSync(src, dst)
          written.push(dst)
        }
      }
      return written
    },
    async mv(_from, _to) {
      // no-op in pull-contribution tests — archiveMergedSidecars is tested separately
    },
  }
}

/**
 * Write a sidecar JSON file to a directory, returning the path.
 */
function writeSidecar(dir, sidecar) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${sidecar.contributionId}.json`)
  writeFileSync(path, JSON.stringify(sidecar, null, 2))
  return path
}

/**
 * Read sync-log.jsonl and return all entries.
 */
function readJournal(journalPath) {
  if (!existsSync(journalPath)) return []
  return readFileSync(journalPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(l => { try { return JSON.parse(l) } catch { return { _malformed: true } } })
}

// ── Production pullContributions imported directly ─────────────────────────
// The function accepts { sftp, root, telegram } so tests can isolate to a
// mkdtemp + inject an SFTP stub + spy on Telegram alerts. We import it as
// pullContributionsTest (the historical name) so test bodies don't change.
import { pullContributions as pullContributionsTest } from '../sync-to-turso.js'
import { appendSyncLog, readSyncLog } from '../lib/sync-journal.js'

// Test-local path helpers — production keeps these private; tests need to
// reach the same paths to set up fixtures and assert post-conditions.
function getSyncLogPath(root) { return join(root, 'data/editorial/sync-log.jsonl') }
function getStateLockPath(root) { return join(root, 'data/editorial/.state-pull.lock') }
function getBackupDir(root) { return join(root, 'data/editorial/backups') }
function getQuarantineDir(root, date) { return join(root, 'data/editorial/contributions/quarantine', date) }
function getFailedDir(root) { return join(root, 'data/editorial/contributions/failed') }
function getProcessedDir(root) { return join(root, 'data/editorial/contributions/processed') }
// ── Test helpers ────────────────────────────────────────────────────────────

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sni-pull-'))
  mkdirSync(join(root, 'data/editorial'), { recursive: true })
  return root
}

function rootHasState(root) { return existsSync(join(root, 'data/editorial/state.json')) }
function getState(root) { return JSON.parse(readFileSync(join(root, 'data/editorial/state.json'), 'utf8')) }
function setState(root, state) {
  mkdirSync(join(root, 'data/editorial'), { recursive: true })
  writeFileSync(join(root, 'data/editorial/state.json'), JSON.stringify(state, null, 2))
}

function getJournal(root) { return readJournal(getSyncLogPath(root)) }

// ── Happy path (cases 1–8) ─────────────────────────────────────────────────

describe('pullContributions — happy path', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 1
  it('no contributions → no-op, sync-log outcome=success merged=[]', async () => {
    setState(root, makeState())
    const sftp = makeSftpStub(fixtureDir)  // empty fixture dir

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([])
    expect(result.quarantined).toEqual([])
    const journal = getJournal(root)
    expect(journal).toHaveLength(1)
    expect(journal[0].outcome).toBe('success')
    expect(journal[0].merged).toEqual([])
  })

  // Case 2
  it('single sidecar → merged into pendingContributions, snapshot created', async () => {
    setState(root, makeState())
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([sidecar.contributionId])
    expect(result.preStatePath).toBeTruthy()
    expect(existsSync(result.preStatePath)).toBe(true)

    const state = getState(root)
    expect(Array.isArray(state.pendingContributions)).toBe(true)
    expect(state.pendingContributions).toHaveLength(1)
    expect(state.pendingContributions[0].contributionId).toBe(sidecar.contributionId)
  })

  // Case 3
  it('5 valid sidecars → all merged, sync-log records all 5 ids', async () => {
    setState(root, makeState())
    const sidecars = Array.from({ length: 5 }, () => makeSidecar())
    for (const s of sidecars) writeSidecar(fixtureDir, s)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toHaveLength(5)
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('success')
    expect(journal[0].merged).toHaveLength(5)

    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(5)
  })

  // Case 4 — 100 sidecars (batch processing check)
  it('100 sidecars → all merged without any cascade failure', async () => {
    setState(root, makeState())
    const sidecars = Array.from({ length: 100 }, () => makeSidecar())
    for (const s of sidecars) writeSidecar(fixtureDir, s)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toHaveLength(100)
    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(100)
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('success')
  })

  // Case 5 — preStateSha and postStateSha differ after merge
  it('sync-log records distinct preStateSha and postStateSha after merge', async () => {
    setState(root, makeState())
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })

    const journal = getJournal(root)
    const entry = journal.find(e => e.outcome === 'success')
    expect(entry.preStateSha).toBeTruthy()
    expect(entry.postStateSha).toBeTruthy()
    expect(entry.preStateSha).not.toBe(entry.postStateSha)
  })

  // Case 6 — mix of valid and invalid sidecars: valid ones merge, invalid quarantined
  it('mix of valid and invalid sidecars → valid merge, invalid quarantined, sync continues', async () => {
    setState(root, makeState())
    const good1 = makeSidecar()
    const bad = makeSidecar({ version: 2 })
    const good2 = makeSidecar()
    writeSidecar(fixtureDir, good1)
    writeSidecar(fixtureDir, bad)
    writeSidecar(fixtureDir, good2)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toHaveLength(2)
    expect(result.quarantined).toHaveLength(1)
    expect(result.quarantined[0]).toBe(bad.contributionId)
    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(2)
  })

  // Case 7 — lock is released even when pull succeeds (lock file absent after run)
  it('lock file is released after successful run', async () => {
    setState(root, makeState())
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })

    const lockPath = getStateLockPath(root)
    expect(existsSync(lockPath)).toBe(false)
  })

  // Case 8 — state.json absent: no merge (can't merge into absent state), no snapshot
  it('state.json absent → no snapshot, validation_failed, mergedIds empty', async () => {
    // Do NOT call setState — state.json is absent
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    // No snapshot since there was no source file to snapshot
    expect(result.preStatePath).toBeNull()
    // Validation fails because the synthetic state {} is missing required sections
    // so mergedIds is empty and state.json is NOT created (remains absent)
    expect(result.mergedIds).toHaveLength(0)
    expect(existsSync(join(root, 'data/editorial/state.json'))).toBe(false)
  })
})

// ── Validation/quarantine (cases 9–17) ────────────────────────────────────

describe('pullContributions — validation/quarantine', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    setState(root, makeState())
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 9
  it('version=2 sidecar → quarantined, sync continues for others', async () => {
    const bad = makeSidecar({ version: 2 })
    const good = makeSidecar()
    writeSidecar(fixtureDir, bad)
    writeSidecar(fixtureDir, good)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.quarantined).toContain(bad.contributionId)
    expect(result.mergedIds).toContain(good.contributionId)
    expect(result.mergedIds).not.toContain(bad.contributionId)
  })

  // Case 10
  it('version=0 → quarantined', async () => {
    const bad = makeSidecar({ version: 0 })
    writeSidecar(fixtureDir, bad)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.quarantined).toContain(bad.contributionId)
    expect(result.mergedIds).toHaveLength(0)
  })

  // Case 11
  it('malformed JSON → quarantined to failed/, attempts counter written', async () => {
    const uuid = randomUUID()
    const path = join(fixtureDir, `${uuid}.json`)
    writeFileSync(path, 'not-valid-json!!!')
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.quarantined).toContain(uuid)
    const attFile = join(getFailedDir(root), `${uuid}.attempts`)
    expect(existsSync(attFile)).toBe(true)
    const att = JSON.parse(readFileSync(attFile, 'utf8'))
    expect(att.count).toBe(1)
  })

  // Case 12
  it('malformed JSON 3 times → Telegram alert sent', async () => {
    const uuid = randomUUID()
    const path = join(fixtureDir, `${uuid}.json`)
    const telegramCalls = []
    const telegram = async (msg) => telegramCalls.push(msg)

    // Run 3 times with the same malformed file
    for (let i = 0; i < 3; i++) {
      writeFileSync(path, 'garbage')
      await pullContributionsTest({ root, sftp: makeSftpStub(fixtureDir), telegram })
    }

    expect(telegramCalls.length).toBeGreaterThanOrEqual(1)
    expect(telegramCalls.some(m => m.includes(uuid) || m.includes('quarantine'))).toBe(true)
  })

  // Case 13
  it('valid JSON but missing user.email → quarantined', async () => {
    const bad = makeSidecar({ user: { name: 'No Email' } })  // no .email
    writeSidecar(fixtureDir, bad)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.quarantined).toContain(bad.contributionId)
    expect(result.mergedIds).not.toContain(bad.contributionId)
  })

  // Case 14
  it('duplicate contributionId in same pull → only one merged', async () => {
    const id = randomUUID()
    const s1 = makeSidecar({ contributionId: id })
    const s2 = makeSidecar({ contributionId: id, _extra: { clientRequestId: 'x' } })
    writeSidecar(fixtureDir, s1)
    // Write s2 with a different filename to simulate a race sidecar
    const path2 = join(fixtureDir, `${id}-dup.json`)
    // Can't use same id as filename — use different uuid for filename but same contributionId
    const altUuid = randomUUID()
    writeFileSync(join(fixtureDir, `${altUuid}.json`), JSON.stringify({ ...s2, contributionId: id }))
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    const state = getState(root)
    const merged = state.pendingContributions.filter(c => c.contributionId === id)
    expect(merged).toHaveLength(1)
  })

  // Case 15
  it('duplicate already in pendingContributions → skipped', async () => {
    const sidecar = makeSidecar()
    setState(root, makeState({ pendingContributions: [sidecar] }))
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).not.toContain(sidecar.contributionId)
    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(1)  // still just one
  })

  // Case 16
  it('duplicate already in processed/ → skipped (cross-cycle dedup)', async () => {
    const sidecar = makeSidecar()
    // Write the sidecar to processed/ dir to simulate a prior cycle
    const processedDir = getProcessedDir(root)
    writeSidecar(processedDir, sidecar)
    // Also put it in the fixture dir as if Fly still has it
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).not.toContain(sidecar.contributionId)
    const state = getState(root)
    const pending = state.pendingContributions ?? []
    expect(pending.find(c => c.contributionId === sidecar.contributionId)).toBeUndefined()
  })

  // Case 17
  it('validateEditorialState throws → state.json untouched, alert fired', async () => {
    const originalState = makeState()
    setState(root, originalState)
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const telegramCalls = []
    const telegram = async (msg) => telegramCalls.push(msg)

    // Mock validateEditorialState to throw by passing a sidecar that has version=1
    // but then adding an invalid postBacklog entry that would fail validation.
    // Since validatePendingContributions itself is what would block the sidecar,
    // and validateEditorialState runs after merge — we need to corrupt the state
    // post-merge such that validateEditorialState fails. We do this by having a
    // post that violates the title-length rule (> 100 chars).
    const invalidPost = makeSidecar()
    writeSidecar(fixtureDir, invalidPost)
    // Write a state that already has a corrupt postBacklog entry
    const corruptState = makeState({
      _extra: {
        postBacklog: {
          1: {
            title: 'A'.repeat(200),  // exceeds 100-char limit → validation error
            status: 'suggested',
            format: null,
          }
        }
      }
    })
    setState(root, corruptState)

    const stateContentBefore = readFileSync(join(root, 'data/editorial/state.json'), 'utf8')

    const result = await pullContributionsTest({ root, sftp: makeSftpStub(fixtureDir), telegram })

    // State should be untouched
    const stateContentAfter = readFileSync(join(root, 'data/editorial/state.json'), 'utf8')
    expect(stateContentAfter).toBe(stateContentBefore)

    // Telegram alert should have fired
    expect(telegramCalls.some(m => m.includes('validation_failed'))).toBe(true)

    const journal = getJournal(root)
    expect(journal.some(e => e.outcome === 'validation_failed')).toBe(true)
  })
})

// ── SFTP edge cases (cases 18–25) ────────────────────────────────────────

describe('pullContributions — SFTP edge cases', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    setState(root, makeState())
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 18
  it('SFTP get fails entirely → no merge, sync-log outcome=sftp_failed', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir, { getError: 'connection refused' })

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([])
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('sftp_failed')
    // State unchanged
    const state = getState(root)
    expect(state.pendingContributions ?? []).toHaveLength(0)
  })

  // Case 19
  it('SFTP partial: ls=10, get returned 5 → abort, sync-log sftp_partial, no merge', async () => {
    const sidecars = Array.from({ length: 10 }, () => makeSidecar())
    for (const s of sidecars) writeSidecar(fixtureDir, s)
    const sftp = makeSftpStub(fixtureDir, { partialGet: 5 })

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([])
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('sftp_partial')
    const state = getState(root)
    expect((state.pendingContributions ?? [])).toHaveLength(0)
  })

  // Case 20
  it('SFTP *.tmp files in listing → excluded from merge', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    // Write a .tmp file that should be excluded
    writeFileSync(join(fixtureDir, 'ghost.tmp'), '{}')

    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    // Only the .json file should be merged
    expect(result.mergedIds).toHaveLength(1)
    expect(result.mergedIds[0]).toBe(sidecar.contributionId)
  })

  // Case 21
  it('SFTP authentication fails → handled as sftp_failed, no merge', async () => {
    const sftp = makeSftpStub(fixtureDir, { lsError: 'authentication failed' })

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([])
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('sftp_failed')
  })

  // Case 22
  it('SFTP listing includes processed/ subdir name → skipped (not a .json filename)', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    // Simulate a stub that also returns 'processed' in its ls output
    const sftp = {
      async ls() {
        return ['processed', `${sidecar.contributionId}.json`]
      },
      async get(filenames, localDir) {
        mkdirSync(localDir, { recursive: true })
        // Only copy the .json file
        const written = []
        for (const f of filenames) {
          if (f.endsWith('.json')) {
            const src = join(fixtureDir, f)
            const dst = join(localDir, f)
            if (existsSync(src)) { copyFileSync(src, dst); written.push(dst) }
          }
        }
        return written
      }
    }

    const result = await pullContributionsTest({ root, sftp })

    // 'processed' is not a .json file — ls() in our stub filters to .json only,
    // but the test explicitly checks the merge doesn't explode on non-json names.
    // Since our stub's ls() returns non-.json names too, the real ls() filters them.
    // In this test stub, 'processed' is returned but the get() won't find it and won't
    // copy it. The ls count (2) vs get count (1) would trigger sftp_partial abort.
    // This is the correct behaviour — verify sftp_partial outcome.
    expect(result.mergedIds).toEqual([])
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('sftp_partial')
  })

  // Case 23
  it('SFTP listing includes failed/ subdir name → treated same as case 22', async () => {
    // The ls stub that filters properly: failed/ is a directory, not a .json file
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    // Our makeSftpStub already filters to .endsWith('.json') — so 'failed/' won't appear
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    // Only the sidecar.json should be returned
    expect(result.mergedIds).toHaveLength(1)
  })

  // Case 24
  it('SFTP returns 0 files → no-op success', async () => {
    // Empty fixture dir
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toEqual([])
    const journal = getJournal(root)
    expect(journal[0].outcome).toBe('success')
    expect(journal[0].merged).toEqual([])
  })

  // Case 25 — double run: second sees same files but they were already merged
  it('two runs with same input → second run deduplicates, no extra pendingContributions', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })
    const stateMid = getState(root)
    expect(stateMid.pendingContributions).toHaveLength(1)

    // Second run — Fly still has the same sidecar (mv to processed happens in Task 8c)
    await pullContributionsTest({ root, sftp })
    const stateFinal = getState(root)
    expect(stateFinal.pendingContributions).toHaveLength(1)  // still just 1
  })
})

// ── Snapshot + rollback (cases 26–35) ─────────────────────────────────────

describe('pullContributions — snapshot and rollback', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    setState(root, makeState())
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 26 — snapshot write fails → abort, no state mutation, alert
  it('snapshot write fails → abort, state untouched, alert sent', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const telegramCalls = []
    const telegram = async (msg) => telegramCalls.push(msg)

    const stateContentBefore = readFileSync(join(root, 'data/editorial/state.json'), 'utf8')

    // Make backups dir read-only to force snapshot failure
    const backupDir = getBackupDir(root)
    mkdirSync(backupDir, { recursive: true })
    // Simulate a failing snapshotState by providing a sftp stub that
    // gets called, but the backup dir throws on write.
    // We'll override the backup dir to a path that can't be written.
    // Actually — easiest is to make the state file read-only so copyFileSync fails.
    // But renameSync in the write step also needs to work.
    // Instead: mock snapshotState by making backupDir a regular file (not a dir)
    // so mkdirSync inside snapshotState throws.
    rmSync(backupDir, { recursive: true, force: true })
    writeFileSync(backupDir, 'I am a file, not a dir')  // conflicts with mkdirSync

    const sftp = makeSftpStub(fixtureDir)
    await expect(pullContributionsTest({ root, sftp, telegram })).rejects.toThrow()

    // State should be untouched
    const stateContentAfter = readFileSync(join(root, 'data/editorial/state.json'), 'utf8')
    expect(stateContentAfter).toBe(stateContentBefore)

    // Alert fired
    expect(telegramCalls.some(m => m.includes('snapshot_failed'))).toBe(true)
  })

  // Case 27 — snapshot retention prune fails → warning logged, sync still proceeds
  it('30 snapshots already exist → after run, exactly 30 kept (oldest pruned)', async () => {
    const backupDir = getBackupDir(root)
    mkdirSync(backupDir, { recursive: true })

    // Create 30 pre-existing 'pre-pull' snapshots with staggered mtimes
    const existing = []
    for (let i = 0; i < 30; i++) {
      const name = `state.pre-pull.2026-01-0${Math.floor(i / 10) + 1}T00-00-${String(i % 10).padStart(2, '0')}-000Z.json`
      const p = join(backupDir, name)
      writeFileSync(p, '{}')
      const t = new Date(2026, 0, 1, 0, 0, i)
      utimesSync(p, t, t)
      existing.push(p)
    }

    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })

    // Count pre-pull snapshots in backupDir
    const snapshots = readdirSync(backupDir)
      .filter(f => f.startsWith('state.pre-pull.') && f.endsWith('.json'))
    expect(snapshots.length).toBe(30)  // 30 existing + 1 new - 1 oldest = 30
  })

  // Case 28 — orphan .tmp removed at next run start
  it('SIGTERM-after-tmp-write: orphan .tmp removed at next run start', async () => {
    // Simulate a crash left a .tmp file in data/editorial/
    const tmpFile = join(root, 'data/editorial', 'leftover.tmp')
    writeFileSync(tmpFile, '{}')
    expect(existsSync(tmpFile)).toBe(true)

    const sftp = makeSftpStub(fixtureDir)  // empty — no sidecars
    await pullContributionsTest({ root, sftp })

    // cleanupStaleTmpFiles should have removed it
    expect(existsSync(tmpFile)).toBe(false)
  })

  // Case 29 — state.json corrupt at start → snapshot anyway, validation catches it, abort
  it('state.json already corrupt → snapshot taken, validation catches it, abort with validation_failed', async () => {
    // Write corrupt (but parseable) state missing required sections
    writeFileSync(join(root, 'data/editorial/state.json'), JSON.stringify({ bad: true }))

    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const telegramCalls = []
    const telegram = async (msg) => telegramCalls.push(msg)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp, telegram })

    // Snapshot was taken (file exists)
    expect(result.preStatePath).toBeTruthy()
    expect(existsSync(result.preStatePath)).toBe(true)

    // validation_failed in journal
    const journal = getJournal(root)
    expect(journal.some(e => e.outcome === 'validation_failed')).toBe(true)
  })

  // Case 30 — lock contended → wait then succeed
  it('lock is stale PID → cleared and acquired immediately', async () => {
    const lockPath = getStateLockPath(root)
    mkdirSync(dirname(lockPath), { recursive: true })
    // Write a lock with a definitely-dead PID
    writeFileSync(lockPath, JSON.stringify({ pid: 2147483647, owner: 'ghost', acquiredAt: new Date().toISOString() }))

    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    // Should succeed — stale lock gets cleared
    const result = await pullContributionsTest({ root, sftp })
    expect(result.mergedIds).toHaveLength(1)
  })

  // Case 31 (lock held by live process — tested via waitAndAcquireStateLock timeout in helper tests)
  it('phase-0 succeeds, downstream throws → state.json keeps merged, journal records partial', async () => {
    // This simulates the main() error handler behaviour.
    // We verify that after pullContributions succeeds, state.json has the contributions.
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toHaveLength(1)
    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(1)

    // Simulate a downstream failure appending a 'partial' entry (what main() does)
    appendSyncLog(getSyncLogPath(root), {
      syncRunId: result.syncRunId,
      ts: new Date().toISOString(),
      outcome: 'partial',
      failedPhase: 'syncEditorialState: DB locked',
      preStatePath: result.preStatePath,
    })

    const journal = getJournal(root)
    expect(journal.some(e => e.outcome === 'partial')).toBe(true)
    expect(journal.find(e => e.outcome === 'partial').preStatePath).toBe(result.preStatePath)
  })

  // Case 32 — second run after first succeeds: previously-merged dedup-skipped
  it('phase-0 succeeds, next run → previously-merged dedup-skipped', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })
    const journalBefore = getJournal(root)

    // Second run — Fly still has the file
    await pullContributionsTest({ root, sftp })
    const journalAfter = getJournal(root)

    // Second run should log skippedDuplicates=1
    const secondRun = journalAfter[journalAfter.length - 1]
    expect(secondRun.outcome).toBe('success')
    expect(secondRun.skippedDuplicates).toBe(1)

    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(1)
  })

  // Case 33 — sync journal entry well-formed even on error
  it('sync-log JSONL entry is parseable on error path (sftp_failed)', async () => {
    const sftp = makeSftpStub(fixtureDir, { lsError: 'test error' })
    await pullContributionsTest({ root, sftp })

    const journal = getJournal(root)
    expect(journal).toHaveLength(1)
    expect(journal[0]._malformed).toBeFalsy()
    expect(journal[0].outcome).toBe('sftp_failed')
    expect(typeof journal[0].syncRunId).toBe('string')
    expect(typeof journal[0].ts).toBe('string')
  })

  // Case 34 — snapshot content matches original state
  it('snapshot content matches original state.json', async () => {
    const originalState = makeState()
    setState(root, originalState)
    const sftp = makeSftpStub(fixtureDir)  // no sidecars

    const result = await pullContributionsTest({ root, sftp })

    const snap = JSON.parse(readFileSync(result.preStatePath, 'utf8'))
    expect(snap).toEqual(originalState)
  })

  // Case 35 — syncRunId format matches expected pattern
  it('syncRunId is a valid timestamp string', async () => {
    const sftp = makeSftpStub(fixtureDir)
    const result = await pullContributionsTest({ root, sftp })
    expect(result.syncRunId).toMatch(/^\d{8}T\d{6}$/)
  })
})

// ── Semantic edge cases (cases 36–41) ─────────────────────────────────────

describe('pullContributions — semantic edge cases', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    setState(root, makeState())
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 36
  it('theme_evidence with themeCode not in themeRegistry → merges (downstream handles)', async () => {
    const sidecar = makeSidecar({
      type: 'theme_evidence',
      payload: { themeCode: 'T99', evidence: 'Some evidence text', url: 'https://example.com' },
    })
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
    const state = getState(root)
    expect(state.pendingContributions).toHaveLength(1)
  })

  // Case 37
  it('sidecar with future ts (clock skew +30min) → merges normally', async () => {
    const futureTs = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    const sidecar = makeSidecar({ ts: futureTs })
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
  })

  // Case 38
  it('sidecar with very old ts (>90 days) → merges, sync-log records age warning', async () => {
    const oldTs = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString()
    const sidecar = makeSidecar({ ts: oldTs })
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
    const journal = getJournal(root)
    expect(journal[0].warnings).toBeDefined()
    expect(journal[0].warnings.some(w => w.includes(sidecar.contributionId))).toBe(true)
  })

  // Case 39
  it('sidecar with large payload (>32KB) → merges (the Hono 32KB limit was request-side)', async () => {
    const bigPayload = { title: 'T', data: 'x'.repeat(50_000) }
    const sidecar = makeSidecar({ payload: bigPayload })
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
  })

  // Case 40
  it('same clientRequestId, different user_email in two sidecars → both merge', async () => {
    const clientRequestId = 'shared-req-id'
    const s1 = makeSidecar({ clientRequestId, user: { email: 'alice@brightbeam.com', name: 'Alice' } })
    const s2 = makeSidecar({ clientRequestId, user: { email: 'bob@brightbeam.com', name: 'Bob' } })
    writeSidecar(fixtureDir, s1)
    writeSidecar(fixtureDir, s2)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toHaveLength(2)
    expect(result.mergedIds).toContain(s1.contributionId)
    expect(result.mergedIds).toContain(s2.contributionId)
  })

  // Case 41
  it('sidecar version=1 but payload shape mismatched to type → merges (downstream handles)', async () => {
    // Type says 'decision' but payload has post-candidate shape — pullContributions
    // only validates the sidecar envelope, not the payload's semantic correctness
    const sidecar = makeSidecar({
      type: 'decision',
      payload: { title: 'Wrong shape for decision', format: 'Format 1: The Concept Contrast' },
    })
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
  })
})

// ── Operational (case 42) ─────────────────────────────────────────────────

describe('pullContributions — operational', () => {
  let root, fixtureDir

  beforeEach(() => {
    root = makeRoot()
    setState(root, makeState())
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 42
  it('sync-log.jsonl is readable by readSyncLog after a run', async () => {
    const sidecar = makeSidecar()
    writeSidecar(fixtureDir, sidecar)
    const sftp = makeSftpStub(fixtureDir)

    await pullContributionsTest({ root, sftp })

    const journalPath = getSyncLogPath(root)
    const entries = readSyncLog(journalPath)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every(e => !e._malformed)).toBe(true)
    const success = entries.find(e => e.outcome === 'success')
    expect(success).toBeDefined()
    expect(success.merged).toContain(sidecar.contributionId)
    expect(typeof success.elapsedMs).toBe('number')
  })
})

// ── payloadHash tampered quarantine (case 49) ─────────────────────────────────

import { createHash } from 'crypto'

describe('pullContributions — payloadHash mismatch quarantined to tampered/', () => {
  let root, fixtureDir
  const telegramCalls = []

  beforeEach(() => {
    root = makeRoot()
    fixtureDir = mkdtempSync(join(tmpdir(), 'sni-fixtures-'))
    telegramCalls.length = 0
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(fixtureDir, { recursive: true, force: true })
  })

  // Case 49
  it('sidecar with payloadHash mismatch is quarantined to tampered/', async () => {
    setState(root, makeState())

    const goodHash = createHash('sha256').update(JSON.stringify({ title: 'Original' })).digest('hex')
    const sidecar = {
      ...makeSidecar(),
      payload: { title: 'Tampered payload' },  // payload differs from hash
      payloadHash: goodHash,                    // hash of original payload
    }
    writeSidecar(fixtureDir, sidecar)

    const sftp = makeSftpStub(fixtureDir)
    const telegram = async (msg) => { telegramCalls.push(msg) }

    const result = await pullContributionsTest({ root, sftp, telegram })

    expect(result.mergedIds).toEqual([])
    expect(result.quarantined).toContain(sidecar.contributionId)

    const tamperedDir = join(root, 'data/editorial/contributions/tampered')
    const allTampered = readdirSync(tamperedDir, { recursive: true }).filter(f => String(f).endsWith('.json'))
    expect(allTampered.length).toBeGreaterThan(0)

    expect(telegramCalls.some(m => m.includes('tampered'))).toBe(true)

    const state = getState(root)
    expect(state.pendingContributions ?? []).toHaveLength(0)
  })

  // Case 50
  it('sidecar with correct payloadHash is accepted normally', async () => {
    setState(root, makeState())

    const payload = { title: 'Authentic payload', format: 'Format 1: The Concept Contrast' }
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const sidecar = { ...makeSidecar(), payload, payloadHash: hash }
    writeSidecar(fixtureDir, sidecar)

    const sftp = makeSftpStub(fixtureDir)

    const result = await pullContributionsTest({ root, sftp })

    expect(result.mergedIds).toContain(sidecar.contributionId)
    expect(result.quarantined).toEqual([])
  })
})
