/**
 * undo-contribution.test.js — 17 tests for undoContribution()
 *
 * All tests use filesystem isolation (mkdtempSync per describe group / test).
 * DB is injected as an in-memory libSQL client (createTestDb + migrateSchema).
 * sendTelegram is never called — no injection needed (not in the hot path).
 * SNI_TEST_MODE=1 is mandatory (bunfig preload enforces).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test'
import {
  existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync,
  copyFileSync,
} from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

import { undoContribution } from '../undo-contribution.js'
import { createTestDb, migrateSchema } from '../../web/api/lib/db.js'
import { readSyncLog } from '../lib/sync-journal.js'

// ── Test infrastructure ────────────────────────────────────────────────────────

/**
 * Make a temporary project root with the necessary directories.
 */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'sni-undo-'))
  mkdirSync(join(root, 'data/editorial'), { recursive: true })
  return root
}

/**
 * Build a minimal valid state.json object.
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

function getStatePath(root)    { return join(root, 'data/editorial/state.json') }
function getBackupDir(root)    { return join(root, 'data/editorial/backups') }
function getJournalPath(root)  { return join(root, 'data/editorial/sync-log.jsonl') }
function getQuarantineDir(root){ return join(root, 'data/editorial/contributions/quarantined') }
function getFailedDir(root)    { return join(root, 'data/editorial/contributions/failed') }
function getProcessedDir(root) { return join(root, 'data/editorial/contributions/processed') }

function setState(root, state) {
  writeFileSync(getStatePath(root), JSON.stringify(state, null, 2))
}

function getState(root) {
  return JSON.parse(readFileSync(getStatePath(root), 'utf8'))
}

function getJournal(root) {
  return readSyncLog(getJournalPath(root))
}

/**
 * Write a sidecar JSON file to processed/{date}/ (simulating post-merge state).
 */
function writeProcessedSidecar(root, uuid, content = null) {
  const date = new Date().toISOString().slice(0, 10)
  const dir = join(getProcessedDir(root), date)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${uuid}.json`)
  writeFileSync(path, JSON.stringify(content ?? { contributionId: uuid, version: 1 }))
  return path
}

/**
 * Write a sidecar JSON file to the active contributions dir (not yet archived).
 */
function writeActiveSidecar(root, uuid, content = null) {
  const dir = join(root, 'data/editorial/contributions')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${uuid}.json`)
  writeFileSync(path, JSON.stringify(content ?? { contributionId: uuid, version: 1 }))
  return path
}

/**
 * Insert a row into mcp_contributions and return the contribution_id.
 */
async function insertContribution(db, {
  contributionId = randomUUID(),
  lifecycleState = 'submitted',
  userEmail = 'test@brightbeam.com',
  tool = 'sni_submit_post_candidate',
  outcome = 'success',
} = {}) {
  await db.execute({
    sql: `INSERT INTO mcp_contributions
            (user_email, tool, outcome, contribution_id, lifecycle_state)
          VALUES (?, ?, ?, ?, ?)`,
    args: [userEmail, tool, outcome, contributionId, lifecycleState],
  })
  return contributionId
}

async function getAuditRow(db, contributionId) {
  const r = await db.execute({
    sql: `SELECT * FROM mcp_contributions WHERE contribution_id = ? LIMIT 1`,
    args: [contributionId],
  })
  return r.rows[0] ?? null
}

// ── Shared DB setup ───────────────────────────────────────────────────────────

// Each describe group gets its own in-memory DB to keep tests isolated.
// A shared db per group is fine because the tests don't share contribution_ids.

// ── Case 1: Missing contributionId arg ───────────────────────────────────────

describe('undoContribution — missing contributionId', () => {
  it('throws when contributionId is not provided', async () => {
    await expect(undoContribution({ contributionId: null })).rejects.toThrow(
      'contributionId is required'
    )
  })
})

// ── Case 2: Audit row not found ───────────────────────────────────────────────

describe('undoContribution — audit row not found', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('throws with clear message when contribution_id is not in DB', async () => {
    setState(root, makeState())
    await expect(
      undoContribution({ contributionId: randomUUID(), root, db })
    ).rejects.toThrow('not found in mcp_contributions')
  })
})

// ── Cases 3–4: lifecycle=submitted / pulled ───────────────────────────────────

describe('undoContribution — lifecycle=submitted and pulled', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // Case 3: submitted
  it('submitted → audit row updated to rolled_back, state.json unchanged, sidecar quarantined', async () => {
    const id = await insertContribution(db, { lifecycleState: 'submitted' })
    setState(root, makeState())
    const stateBefore = readFileSync(getStatePath(root), 'utf8')

    // Write active sidecar
    writeActiveSidecar(root, id)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.prevLifecycle).toBe('submitted')
    expect(result.newLifecycle).toBe('rolled_back')
    expect(result.removedEntries).toHaveLength(0)

    // State unchanged
    expect(readFileSync(getStatePath(root), 'utf8')).toBe(stateBefore)

    // Audit row updated
    const row = await getAuditRow(db, id)
    expect(row.lifecycle_state).toBe('rolled_back')

    // Sidecar quarantined
    expect(result.quarantinedPath).toBeTruthy()
    expect(existsSync(result.quarantinedPath)).toBe(true)

    // Sentinel .attempts written
    const attPath = join(getFailedDir(root), `${id}.attempts`)
    expect(existsSync(attPath)).toBe(true)
  })

  // Case 4: pulled
  it('pulled → same as submitted: no state mutation, audit updated, sidecar quarantined if present', async () => {
    const id = await insertContribution(db, { lifecycleState: 'pulled' })
    setState(root, makeState())

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.prevLifecycle).toBe('pulled')
    expect(result.newLifecycle).toBe('rolled_back')
    expect(result.removedEntries).toHaveLength(0)
    expect(result.quarantinedPath).toBeNull() // no sidecar present

    const row = await getAuditRow(db, id)
    expect(row.lifecycle_state).toBe('rolled_back')
  })
})

// ── Cases 5–6: lifecycle=merged ────────────────────────────────────────────────

describe('undoContribution — lifecycle=merged', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // Case 5: entry in pendingContributions
  it('merged + entry in pendingContributions → entry spliced out, audit updated', async () => {
    const id = await insertContribution(db, { lifecycleState: 'merged' })
    const sidecar = { contributionId: id, version: 1, type: 'post_candidate',
      payload: { title: 'Test' }, user: { email: 'x@brightbeam.com', name: 'X' },
      ts: new Date().toISOString(), clientRequestId: null }
    setState(root, makeState({ pendingContributions: [sidecar] }))
    writeProcessedSidecar(root, id)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.removedEntries).toContain(`pendingContributions:${id}`)
    const state = getState(root)
    expect(state.pendingContributions ?? []).toHaveLength(0)

    const row = await getAuditRow(db, id)
    expect(row.lifecycle_state).toBe('rolled_back')
  })

  // Case 6: entry NOT in pendingContributions (race-edge)
  it('merged + entry NOT in pendingContributions → audit updated, no error', async () => {
    const id = await insertContribution(db, { lifecycleState: 'merged' })
    setState(root, makeState({ pendingContributions: [] }))

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.removedEntries).toHaveLength(0)
    expect(result.newLifecycle).toBe('rolled_back')

    const row = await getAuditRow(db, id)
    expect(row.lifecycle_state).toBe('rolled_back')
  })
})

// ── Cases 7–10: lifecycle=consumed ────────────────────────────────────────────

describe('undoContribution — lifecycle=consumed', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  // Case 7: post_candidate consumed → postBacklog entry removed
  it('consumed + post_candidate → postBacklog entry with matching _origin removed', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    const state = makeState({
      _extra: {
        counters: { nextSession: 2, nextDocument: 2, nextPost: 3 },
        postBacklog: {
          '1': {
            title: 'A post with enough coreArgument text to pass validation checks here',
            status: 'suggested',
            format: null,
            priority: 'medium',
            freshness: 'evergreen',
            coreArgument: 'A long enough core argument to pass validation, this needs more than fifty chars!',
            notes: 'Enough notes text to pass the validation check that requires more than fifty characters here.',
            sourceDocuments: [],
            dateAdded: '2026-04-01',
            session: 1,
            _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync-to-turso' },
          },
          '2': {
            title: 'Another post not from this contribution',
            status: 'suggested',
            format: null,
            priority: 'medium',
            freshness: 'evergreen',
            coreArgument: 'A long enough core argument to pass validation, this needs more than fifty chars!',
            notes: 'Enough notes text to pass the validation check that requires more than fifty characters here.',
            sourceDocuments: [],
            dateAdded: '2026-04-01',
            session: 1,
          },
        },
      },
    })
    setState(root, state)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.removedEntries).toContain('postBacklog:1')
    const stateAfter = getState(root)
    expect(stateAfter.postBacklog['1']).toBeUndefined()
    expect(stateAfter.postBacklog['2']).toBeDefined()
    // nextPost NOT decremented
    expect(stateAfter.counters.nextPost).toBe(3)
  })

  // Case 8: theme_evidence consumed → evidence entries removed, documentCount decremented
  it('consumed + theme_evidence → evidence entries removed, documentCount decremented', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    const state = makeState({
      _extra: {
        counters: { nextSession: 2, nextDocument: 2, nextPost: 2 },
        themeRegistry: {
          T01: {
            name: 'AI Governance',
            created: 'Session 1',
            lastUpdated: 'Session 1',
            documentCount: 3,
            evidence: [
              {
                session: 1,
                source: 'Source A',
                content: 'Evidence from contribution under test',
                url: 'https://example.com/a',
                _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync' },
              },
              {
                session: 1,
                source: 'Source B',
                content: 'Other evidence not from this contribution',
                url: 'https://example.com/b',
              },
            ],
            crossConnections: [],
          },
        },
      },
    })
    setState(root, state)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.removedEntries.some(e => e.includes('T01'))).toBe(true)
    const stateAfter = getState(root)
    const theme = stateAfter.themeRegistry['T01']
    expect(theme).toBeDefined()
    expect(theme.evidence).toHaveLength(1)
    expect(theme.evidence[0].source).toBe('Source B')
    // documentCount decremented: 3 → 2
    expect(theme.documentCount).toBe(2)
  })

  // Case 9: new_theme (no later evidence) → entire theme deleted
  it('consumed + new_theme with no later evidence → entire theme deleted', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    const state = makeState({
      _extra: {
        counters: { nextSession: 2, nextDocument: 2, nextPost: 2 },
        themeRegistry: {
          T02: {
            name: 'New Theme From Contribution',
            created: 'Session 1',
            lastUpdated: 'Session 1',
            documentCount: 1,
            _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync' },
            evidence: [
              {
                session: 1,
                source: 'Source A',
                content: 'The only evidence — from the contribution itself',
                url: 'https://example.com/a',
                _origin: { contributionId: id },
              },
            ],
            crossConnections: [],
          },
        },
      },
    })
    setState(root, state)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.removedEntries.some(e => e.includes('T02'))).toBe(true)
    const stateAfter = getState(root)
    expect(stateAfter.themeRegistry['T02']).toBeUndefined()
  })

  // Case 10: new_theme with later evidence → theme preserved, _origin removed
  it('consumed + new_theme with later evidence → theme preserved, own evidence removed', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    const state = makeState({
      _extra: {
        counters: { nextSession: 3, nextDocument: 3, nextPost: 2 },
        themeRegistry: {
          T03: {
            name: 'Evolving Theme',
            created: 'Session 1',
            lastUpdated: 'Session 2',
            documentCount: 2,
            _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync' },
            evidence: [
              {
                session: 1,
                source: 'Source A — from the original contribution',
                content: 'Initial evidence from contribution',
                url: 'https://example.com/a',
                _origin: { contributionId: id },
              },
              {
                session: 2,
                source: 'Source B — added later by editorial-analyse',
                content: 'Later evidence from a different source',
                url: 'https://example.com/b',
                // no _origin — from editorial-analyse, not MCP
              },
            ],
            crossConnections: [],
          },
        },
      },
    })
    setState(root, state)

    const result = await undoContribution({ contributionId: id, root, db })

    const stateAfter = getState(root)
    const theme = stateAfter.themeRegistry['T03']
    // Theme preserved because later evidence exists
    expect(theme).toBeDefined()
    expect(theme.name).toBe('Evolving Theme')
    // The contribution's own evidence removed
    expect(theme.evidence).toHaveLength(1)
    expect(theme.evidence[0].source).toContain('Source B')
    // _origin cleared from theme itself
    expect(theme._origin).toBeUndefined()
  })
})

// ── Case 11: lifecycle=rolled_back → no-op ────────────────────────────────────

describe('undoContribution — lifecycle=rolled_back', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('rolled_back → no-op, exits with noOp=true', async () => {
    const id = await insertContribution(db, { lifecycleState: 'rolled_back' })
    setState(root, makeState())
    const stateBefore = readFileSync(getStatePath(root), 'utf8')

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.noOp).toBe(true)
    expect(result.prevLifecycle).toBe('rolled_back')
    // State unchanged
    expect(readFileSync(getStatePath(root), 'utf8')).toBe(stateBefore)
  })
})

// ── Case 12: --dry-run ────────────────────────────────────────────────────────

describe('undoContribution — dry-run', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('--dry-run: no mutations, no journal entry, no sidecar quarantine', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    const state = makeState({
      _extra: {
        counters: { nextSession: 2, nextDocument: 2, nextPost: 3 },
        postBacklog: {
          '1': {
            title: 'A post with enough coreArgument text to pass validation checks here',
            status: 'suggested',
            format: null,
            priority: 'medium',
            freshness: 'evergreen',
            coreArgument: 'A long enough core argument to pass validation, this needs more than fifty chars!',
            notes: 'Enough notes text to pass the validation check that requires more than fifty characters here.',
            sourceDocuments: [],
            dateAdded: '2026-04-01',
            session: 1,
            _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync' },
          },
        },
      },
    })
    setState(root, state)
    const stateBefore = readFileSync(getStatePath(root), 'utf8')
    writeProcessedSidecar(root, id)

    const result = await undoContribution({ contributionId: id, root, db, dryRun: true })

    // State unchanged
    expect(readFileSync(getStatePath(root), 'utf8')).toBe(stateBefore)
    // No journal entry
    expect(getJournal(root)).toHaveLength(0)
    // No quarantine
    expect(result.quarantinedPath).toBeNull()
    // Journal ID null in dry-run
    expect(result.journalId).toBeNull()
    // DB row NOT updated (still consumed)
    const row = await getAuditRow(db, id)
    expect(row.lifecycle_state).toBe('consumed')
  })
})

// ── Case 13: Snapshot creation ────────────────────────────────────────────────

describe('undoContribution — snapshot', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('snapshot is created at backups/state.pre-undo.{TS}.json', async () => {
    const id = await insertContribution(db, { lifecycleState: 'submitted' })
    const originalState = makeState()
    setState(root, originalState)

    const result = await undoContribution({ contributionId: id, root, db })

    expect(result.preStatePath).toBeTruthy()
    expect(existsSync(result.preStatePath)).toBe(true)
    expect(result.preStatePath).toContain('pre-undo')
    const snap = JSON.parse(readFileSync(result.preStatePath, 'utf8'))
    expect(snap).toEqual(originalState)
  })
})

// ── Case 14: Validator fail → restore from snapshot ───────────────────────────

describe('undoContribution — validator failure restores snapshot', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('validator-fail after consumed rollback → restore from snapshot, exit non-zero', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    // State with a postBacklog entry that will cause validation to fail
    // We'll make a postBacklog entry whose removal leaves the counters wrong
    // (nextPost <= max post ID after removal is fine — counters aren't decremented)
    // Easier: create an initial state that is already invalid but won't fail
    // on load — we'll corrupt it after setting up by making an entry that the
    // removal leaves in an invalid state.
    // Actually the simplest path: include a separate pre-existing invalid entry
    // (e.g. a post with invalid status) alongside the one to remove.
    const state = makeState({
      _extra: {
        counters: { nextSession: 2, nextDocument: 2, nextPost: 3 },
        postBacklog: {
          '1': {
            title: 'Post to remove from contribution',
            status: 'suggested',
            format: null,
            priority: 'medium',
            freshness: 'evergreen',
            coreArgument: 'A long enough core argument to pass validation, this needs more than fifty chars!',
            notes: 'Enough notes text to pass the validation check that requires more than fifty characters here.',
            sourceDocuments: [],
            dateAdded: '2026-04-01',
            session: 1,
            _origin: { contributionId: id, mergedAt: '2026-04-01T10:00:00Z', mergedBy: 'sync' },
          },
          '2': {
            // Invalid status will cause validateEditorialState to fail
            title: 'Corrupt post causing validator failure',
            status: 'TOTALLY_INVALID_STATUS',
            format: null,
            priority: 'medium',
            freshness: 'evergreen',
            coreArgument: 'A long enough core argument to pass validation, this needs more than fifty chars!',
            notes: 'Enough notes text to pass the validation check that requires more than fifty characters here.',
            sourceDocuments: [],
            dateAdded: '2026-04-01',
            session: 1,
          },
        },
      },
    })
    setState(root, state)
    const stateBefore = readFileSync(getStatePath(root), 'utf8')

    await expect(
      undoContribution({ contributionId: id, root, db })
    ).rejects.toThrow(/validation failed/)

    // State restored from snapshot
    expect(readFileSync(getStatePath(root), 'utf8')).toBe(stateBefore)
  })
})

// ── Case 15: Compensating row for consumed ────────────────────────────────────

describe('undoContribution — compensating row', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('consumed case inserts compensating row with rollback_of=original_id', async () => {
    const id = await insertContribution(db, { lifecycleState: 'consumed' })
    setState(root, makeState())

    await undoContribution({ contributionId: id, root, db })

    const r = await db.execute({
      sql: `SELECT * FROM mcp_contributions WHERE rollback_of = ? AND tool = 'sni_rollback'`,
      args: [id],
    })
    expect(r.rows.length).toBe(1)
    expect(r.rows[0].lifecycle_state).toBe('rolled_back')
    expect(r.rows[0].outcome).toBe('success')
    expect(r.rows[0].rollback_of).toBe(id)
  })
})

// ── Journal entry ─────────────────────────────────────────────────────────────

describe('undoContribution — journal entry', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('journal entry has prevLifecycle, newLifecycle, removedEntries, outcome=undo', async () => {
    const id = await insertContribution(db, { lifecycleState: 'submitted' })
    setState(root, makeState())

    await undoContribution({ contributionId: id, root, db, reason: 'test reason', by: 'admin@brightbeam.com' })

    const journal = getJournal(root)
    expect(journal).toHaveLength(1)
    const entry = journal[0]
    expect(entry.outcome).toBe('undo')
    expect(entry.contributionId).toBe(id)
    expect(entry.prevLifecycle).toBe('submitted')
    expect(entry.newLifecycle).toBe('rolled_back')
    expect(Array.isArray(entry.removedEntries)).toBe(true)
    expect(entry.reason).toBe('test reason')
    expect(entry.by).toBe('admin@brightbeam.com')
  })
})

// ── Lock released in finally ──────────────────────────────────────────────────

describe('undoContribution — lock management', () => {
  let root, db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })
  afterAll(() => db.close())

  beforeEach(() => { root = makeRoot() })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('lock file is released after successful run', async () => {
    const id = await insertContribution(db, { lifecycleState: 'submitted' })
    setState(root, makeState())

    await undoContribution({ contributionId: id, root, db })

    const lockPath = join(root, 'data/editorial/.state-undo.lock')
    expect(existsSync(lockPath)).toBe(false)
  })

  it('lock file is released even when rollback throws (not-found case)', async () => {
    setState(root, makeState())
    const lockPath = join(root, 'data/editorial/.state-undo.lock')

    await expect(
      undoContribution({ contributionId: randomUUID(), root, db })
    ).rejects.toThrow()

    expect(existsSync(lockPath)).toBe(false)
  })
})
