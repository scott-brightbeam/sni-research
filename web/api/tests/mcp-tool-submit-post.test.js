import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { registerWriteTools } from '../lib/mcp-tools/writes.js'
import { SubmitPostCandidateIn } from '../lib/mcp-tools/schemas.js'
import { SidecarError } from '../lib/mcp-tools/contribute.js'
import { callTool } from './mcp-harness.js'

let TEST_ROOT

beforeEach(async () => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-task5-'))
  process.env.SNI_ROOT = TEST_ROOT
  _resetDbSingleton()
  await migrateSchema(getDb())
})

afterEach(() => {
  delete process.env.SNI_ROOT
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

function postArgs(overrides = {}) {
  return {
    title: 'Test post',
    coreArgument: 'Why this matters to enterprise leaders.',
    format: 'standalone',
    freshness: 'evergreen',
    priority: 'medium',
    sourceUrls: ['https://example.com/source'],
    notes: 'Test notes',
    ...overrides,
  }
}

describe('sni_submit_post_candidate', () => {
  it('writes sidecar + audit row + returns queuedFor', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: 'sni_submit_post_candidate',
      args: postArgs(),
      user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'jti-1' },
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe('sni_submit_post_candidate')
    expect(auditRow.outcome).toBe('success')
    expect(auditRow.user_email).toBe('alice@brightbeam.com')
    expect(auditRow.contribution_id).toBe(result.structuredContent.contributionId)

    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    const files = fs.readdirSync(contribDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('rejects malformed input via Zod (missing title) — NO sidecar', () => {
    const r = SubmitPostCandidateIn.safeParse({ coreArgument: 'no title' })
    expect(r.success).toBe(false)
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const args = postArgs({ clientRequestId: 'req-1' })
    const first = await callTool({
      register: registerWriteTools,
      name: 'sni_submit_post_candidate',
      args, user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'j1' }, db,
    })
    const second = await callTool({
      register: registerWriteTools,
      name: 'sni_submit_post_candidate',
      args, user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'j1' }, db,
    })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)

    // Only ONE sidecar should exist
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    const files = fs.readdirSync(contribDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(1)
  })

  it('idempotency: same clientRequestId from DIFFERENT user creates new sidecar', async () => {
    const db = getDb()
    const args = postArgs({ clientRequestId: 'req-shared' })
    await callTool({
      register: registerWriteTools, name: 'sni_submit_post_candidate',
      args, user: { sub: 'alice@brightbeam.com', name: 'A', jti: 'ja' }, db,
    })
    await callTool({
      register: registerWriteTools, name: 'sni_submit_post_candidate',
      args, user: { sub: 'bob@brightbeam.com', name: 'B', jti: 'jb' }, db,
    })
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    const files = fs.readdirSync(contribDir).filter(f => f.endsWith('.json'))
    expect(files).toHaveLength(2)
  })

  it('sidecar contains version=1, contributionId, type, payload, user, ts', async () => {
    const db = getDb()
    const r = await callTool({
      register: registerWriteTools, name: 'sni_submit_post_candidate',
      args: postArgs(), user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'j' }, db,
    })
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    const file = fs.readdirSync(contribDir).find(f => f.endsWith('.json'))
    const sidecar = JSON.parse(fs.readFileSync(path.join(contribDir, file), 'utf-8'))
    expect(sidecar.version).toBe(1)
    expect(sidecar.contributionId).toBe(r.result.structuredContent.contributionId)
    expect(sidecar.type).toBe('post_candidate')
    expect(sidecar.user.email).toBe('alice@brightbeam.com')
    expect(sidecar.user.name).toBe('Alice')
    expect(sidecar.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(sidecar.payload.title).toBe('Test post')
    // clientRequestId belongs at the top level, not duplicated inside payload.
    // Pins the strip-before-pass contract so Task 7 copies the right pattern.
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
  })

  it('sidecar uses .tmp + rename atomic pattern — no .tmp left over', async () => {
    const db = getDb()
    await callTool({
      register: registerWriteTools, name: 'sni_submit_post_candidate',
      args: postArgs(), user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'j' }, db,
    })
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    const all = fs.readdirSync(contribDir)
    const tmps = all.filter(f => f.endsWith('.tmp'))
    expect(tmps).toHaveLength(0)
  })

  it('sidecar_failed branch: simulate fs error → audit outcome=sidecar_failed, tool throws SidecarError', async () => {
    // Make CONTRIB_DIR unwritable by replacing it with a file
    const db = getDb()
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    fs.mkdirSync(path.dirname(contribDir), { recursive: true })
    fs.writeFileSync(contribDir, 'this is a file, not a dir')

    let threw = null
    try {
      await callTool({
        register: registerWriteTools, name: 'sni_submit_post_candidate',
        args: postArgs(), user: { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'j' }, db,
      })
    } catch (e) {
      threw = e
    }
    expect(threw).toBeTruthy()
    expect(threw.code).toBe('SIDECAR_FAILED')

    const auditRows = await db.execute(`SELECT * FROM mcp_contributions ORDER BY id DESC LIMIT 1`)
    expect(auditRows.rows[0].outcome).toBe('sidecar_failed')
  })
})
