import { describe, it, expect, beforeEach } from 'bun:test'
import { Hono } from 'hono'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { mintMcpToken } from '../lib/mcp-auth.js'
import { mountMcp, _resetMcpForTests } from '../routes/mcp.js'

const SECRET = 'a'.repeat(64)
process.env.SNI_SESSION_SECRET = SECRET
process.env.SNI_AUTH_DOMAIN = 'brightbeam.com'

let app

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  _resetMcpForTests()
  app = new Hono()
  await mountMcp(app)
})

describe('MCP route bootstrap', () => {
  it('rejects unauthenticated POST /mcp with 401 + WWW-Authenticate', async () => {
    const res = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
    }))
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/)
  })

  it('rejects malformed JSON-RPC body when authenticated', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    const res = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: 'not-json-at-all',
    }))
    // Transport should reject with 4xx (likely 400 or 422)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  it('responds to MCP initialize with valid Bearer', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    const res = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0.0.1' },
        },
      }),
    }))
    expect(res.status).toBe(200)
    // Body may be JSON or SSE; just verify it parses or contains 'result'
    const text = await res.text()
    expect(text).toMatch(/result|protocolVersion/i)
  })

  it('handles 10 parallel cold-start initialize calls without double-connect', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    const makeReq = () => app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'initialize', id: 1,
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'p', version: '0' } },
      }),
    }))
    const responses = await Promise.all(Array.from({ length: 10 }, makeReq))
    for (const r of responses) {
      expect(r.status).toBe(200)
    }
  })

  it('rejects oversized body (>32KB)', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    // 64KB of payload, well over the 32KB limit
    const huge = 'x'.repeat(64 * 1024)
    const bodyStr = JSON.stringify({ jsonrpc: '2.0', method: 'x', params: { huge } })
    const res = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(bodyStr.length),
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: bodyStr,
    }))
    expect(res.status).toBe(413)
  })

  it('rejects revoked token mid-session (per-request auth)', async () => {
    const { token, jti } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    // First request should succeed (initialize)
    const ok = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'initialize', id: 1,
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    }))
    expect(ok.status).toBe(200)

    // Revoke
    const db = getDb()
    await db.execute({
      sql: `INSERT INTO mcp_revoked_tokens (jti, revoked_by) VALUES (?, ?)`,
      args: [jti, 'admin@brightbeam.com'],
    })

    // Second request with same token should now 401
    const denied = await app.fetch(new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`,
        'accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 2 }),
    }))
    expect(denied.status).toBe(401)
  })
})
