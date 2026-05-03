/**
 * mcp-e2e.test.js — End-to-end test for the MCP server.
 *
 * Boots app.fetch in-process (no real network). Proves the full wiring:
 * token issuance → authenticate → initialize → tools/list (15 tools) →
 * sni_get_themes (read) → sni_submit_post_candidate (write) → sidecar on
 * disk → audit row in DB.
 *
 * Keeps assertions loose on SSE/JSON format (the SDK may return either)
 * so this test doesn't break if the transport switches between them.
 * Shape-correctness is tested in the lower-level unit tests (Tasks 4–7).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { mountMcp, _resetMcpForTests } from '../routes/mcp.js'
import { mintMcpToken } from '../lib/mcp-auth.js'

const SECRET = 'a'.repeat(64)
process.env.SNI_SESSION_SECRET = SECRET
process.env.SNI_AUTH_DOMAIN = 'brightbeam.com'

let TEST_ROOT
let app

function mcpReq(token, body) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${token}`,
      'accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(async () => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-e2e-'))
  process.env.SNI_ROOT = TEST_ROOT
  _resetDbSingleton()
  await migrateSchema(getDb())
  _resetMcpForTests()
  app = new Hono()
  await mountMcp(app)
})

afterEach(() => {
  delete process.env.SNI_ROOT
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('MCP E2E', () => {
  it('initialize → list 15 tools → read + write end-to-end', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })

    // 1. initialize — proves the transport wires up under auth
    const initRes = await app.fetch(mcpReq(token, {
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    }))
    expect(initRes.status).toBe(200)
    const initText = await initRes.text()
    expect(initText).toMatch(/result|protocolVersion/i)

    // 2. tools/list — proves all 15 tools are registered.
    // Reset and re-mount to get a clean transport (the SDK's StreamableHTTP
    // transport is stateful after initialize; a fresh mount gives a clean session).
    _resetMcpForTests()
    app = new Hono()
    await mountMcp(app)

    await app.fetch(mcpReq(token, {
      jsonrpc: '2.0',
      method: 'initialize',
      id: 1,
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'e2e', version: '1' },
      },
    }))

    const toolsRes = await app.fetch(mcpReq(token, {
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 2,
    }))
    expect(toolsRes.status).toBe(200)
    const toolsText = await toolsRes.text()
    // Extract all sni_* tool names from the response (SSE or JSON)
    const toolMatches = toolsText.match(/sni_\w+/g) || []
    const uniqueTools = [...new Set(toolMatches)]
    expect(uniqueTools.length).toBeGreaterThanOrEqual(15)

    // 3. sni_get_themes (read tool) — empty state, should return []
    const readRes = await app.fetch(mcpReq(token, {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 3,
      params: {
        name: 'sni_get_themes',
        arguments: {},
      },
    }))
    expect(readRes.status).toBe(200)
    const readText = await readRes.text()
    // Response should contain content array or result keyword
    expect(readText).toMatch(/content|result/i)

    // 4. sni_submit_post_candidate (write tool)
    const writeRes = await app.fetch(mcpReq(token, {
      jsonrpc: '2.0',
      method: 'tools/call',
      id: 4,
      params: {
        name: 'sni_submit_post_candidate',
        arguments: {
          title: 'E2E test post',
          coreArgument: 'Why this matters to enterprise leaders.',
          format: 'standalone',
          freshness: 'evergreen',
          priority: 'medium',
        },
      },
    }))
    expect(writeRes.status).toBe(200)
    const writeText = await writeRes.text()

    // Response carries contributionId (UUID) and queuedFor (ISO timestamp)
    expect(writeText).toMatch(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/)
    expect(writeText).toMatch(/queuedFor/)

    // 5. Sidecar file written to TEST_ROOT/data/editorial/contributions/
    const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
    expect(fs.existsSync(contribDir)).toBe(true)
    const files = fs.readdirSync(contribDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBe(1)
    const sidecar = JSON.parse(fs.readFileSync(path.join(contribDir, files[0]), 'utf-8'))
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('post_candidate')
    expect(sidecar.payloadHash).toMatch(/^[a-f0-9]{64}$/)

    // 6. Audit row inserted with lifecycle_state='submitted'
    const audit = await getDb().execute({
      sql: `SELECT * FROM mcp_contributions WHERE tool = ? ORDER BY id DESC LIMIT 1`,
      args: ['sni_submit_post_candidate'],
    })
    expect(audit.rows.length).toBe(1)
    expect(audit.rows[0].lifecycle_state).toBe('submitted')
    expect(audit.rows[0].user_email).toBe('alice@brightbeam.com')
  })

  it('unauthenticated request is rejected before any tool runs', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    }))
    expect(res.status).toBe(401)
  })
})
