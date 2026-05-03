import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getSyncStatus } from '../routes/sync-status.js'

let TEST_ROOT
const writeJournal = (lines) => {
  const dir = path.join(TEST_ROOT, 'data/editorial')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'sync-log.jsonl'), lines.map(JSON.stringify).join('\n'))
}

beforeEach(() => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-syncstatus-'))
  process.env.SNI_ROOT = TEST_ROOT
})
afterEach(() => {
  delete process.env.SNI_ROOT
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('getSyncStatus', () => {
  it('returns lastSync:null when no journal exists', async () => {
    const r = await getSyncStatus()
    expect(r.lastSync).toBeNull()
  })

  it('returns the last entry summary', async () => {
    writeJournal([
      { syncRunId: '1', ts: new Date().toISOString(), outcome: 'success',
        merged: ['uuid-1', 'uuid-2'], skippedDuplicates: 1, quarantined: 0, elapsedMs: 123 }
    ])
    const r = await getSyncStatus()
    expect(r.lastSync.outcome).toBe('success')
    expect(r.lastSync.mergedCount).toBe(2)
    expect(r.lastSync.skippedDuplicates).toBe(1)
    expect(r.lastSync.quarantined).toBe(0)
    expect(r.lastSync.elapsedMs).toBe(123)
    // No leakage of UUIDs or SHAs
    expect(r.lastSync.merged).toBeUndefined()
    expect(r.lastSync.preStateSha).toBeUndefined()
    expect(r.lastSync.syncRunId).toBeUndefined()
  })

  it('counts last24h outcomes correctly', async () => {
    const now = new Date()
    const earlier = new Date(now.getTime() - 6 * 60 * 60 * 1000)
    writeJournal([
      { ts: earlier.toISOString(), outcome: 'success', merged: [] },
      { ts: now.toISOString(), outcome: 'success', merged: ['x'] },
      { ts: now.toISOString(), outcome: 'sftp_failed' },
    ])
    const r = await getSyncStatus()
    expect(r.last24h.runCount).toBe(3)
    expect(r.last24h.outcomesCount).toEqual({ success: 2, sftp_failed: 1 })
  })

  it('excludes entries older than 24h from last24h count', async () => {
    const now = new Date()
    const yesterday = new Date(now.getTime() - 30 * 60 * 60 * 1000)
    writeJournal([
      { ts: yesterday.toISOString(), outcome: 'success' },
      { ts: now.toISOString(), outcome: 'success' },
    ])
    const r = await getSyncStatus()
    expect(r.last24h.runCount).toBe(1)
  })

  it('handles malformed lines gracefully', async () => {
    const dir = path.join(TEST_ROOT, 'data/editorial')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'sync-log.jsonl'),
      '{not-json}\n{"ts":"2026-05-01T00:00:00Z","outcome":"success"}\n')
    const r = await getSyncStatus()
    expect(r.lastSync.outcome).toBe('success')  // last VALID entry returned
  })
})
