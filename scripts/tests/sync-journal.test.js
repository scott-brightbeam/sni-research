import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { appendSyncLog, readSyncLog } from '../lib/sync-journal.js'

let testDir
let journalPath

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'sni-journal-'))
  journalPath = join(testDir, 'subdir', 'sync-log.jsonl')
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('sync-journal', () => {
  it('creates the file and directory if absent on first append', () => {
    appendSyncLog(journalPath, { syncRunId: 'r1', ts: new Date().toISOString(), outcome: 'success' })
    expect(existsSync(journalPath)).toBe(true)
  })

  it('produces valid JSONL with multiple appends (each line is a valid object)', () => {
    appendSyncLog(journalPath, { syncRunId: 'r1', ts: 'ts1', outcome: 'success', merged: [] })
    appendSyncLog(journalPath, { syncRunId: 'r2', ts: 'ts2', outcome: 'partial', failedPhase: 'syncEditorialState' })
    appendSyncLog(journalPath, { syncRunId: 'r3', ts: 'ts3', outcome: 'sftp_failed' })

    const content = readFileSync(journalPath, 'utf-8')
    const lines = content.split('\n').filter(Boolean)
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('readSyncLog round-trips appended entries', () => {
    const entries = [
      { syncRunId: 'a', ts: '2026-01-01T00:00:00Z', outcome: 'success', merged: ['id-1'] },
      { syncRunId: 'b', ts: '2026-01-02T00:00:00Z', outcome: 'sftp_partial' },
    ]
    for (const e of entries) appendSyncLog(journalPath, e)

    const read = readSyncLog(journalPath)
    expect(read).toHaveLength(2)
    expect(read[0]).toEqual(entries[0])
    expect(read[1]).toEqual(entries[1])
  })

  it('readSyncLog flags malformed lines without throwing', () => {
    mkdirSync(dirname(journalPath), { recursive: true })
    writeFileSync(journalPath, '{"ok":true}\nnot-json\n{"also":"good"}\n', 'utf-8')

    const entries = readSyncLog(journalPath)
    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({ ok: true })
    expect(entries[1]).toMatchObject({ _malformed: true, raw: 'not-json' })
    expect(entries[2]).toEqual({ also: 'good' })
  })
})
