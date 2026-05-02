import { describe, it, expect, beforeEach } from 'bun:test'
import { z } from 'zod'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { wrapTool } from '../lib/mcp-tools/audit.js'
import { callTool } from './mcp-harness.js'

const TestIn = z.object({ value: z.string().optional() })
  .describe('Test input schema')

const user = { sub: 'alice@brightbeam.com', jti: 'jti-abc-123' }
const userNoJti = { sub: 'bob@brightbeam.com' }

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
})

describe('wrapTool audit wrapper', () => {
  it('inserts audit row with outcome=success on tool success', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: (srv) => wrapTool(srv, 'test_tool', TestIn, undefined,
        async () => ({ ok: true })
      ),
      name: 'test_tool',
      args: { value: 'hello' },
      user,
      db,
    })

    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true })
    expect(result.structuredContent).toEqual({ ok: true })

    expect(auditRow).not.toBeNull()
    expect(auditRow.outcome).toBe('success')
    expect(auditRow.tool).toBe('test_tool')
    expect(auditRow.user_email).toBe('alice@brightbeam.com')
    expect(auditRow.error).toBeNull()
  })

  it('inserts audit row with outcome=tool_error AND rethrows original error', async () => {
    const db = getDb()
    const boom = new Error('handler exploded')

    await expect(
      callTool({
        register: (srv) => wrapTool(srv, 'failing_tool', TestIn, undefined,
          async () => { throw boom }
        ),
        name: 'failing_tool',
        args: {},
        user,
        db,
      })
    ).rejects.toThrow('handler exploded')

    const audit = await db.execute({
      sql: `SELECT * FROM mcp_contributions WHERE tool = ? ORDER BY id DESC LIMIT 1`,
      args: ['failing_tool'],
    })
    const row = audit.rows[0]
    expect(row).not.toBeNull()
    expect(row.outcome).toBe('tool_error')
    expect(row.error).toBe('handler exploded')
  })

  it('returns tool result even when audit insert throws', async () => {
    // Drop the mcp_contributions table so INSERT fails, proving audit
    // failure is best-effort and does not propagate to the caller.
    // We bypass the harness here because the harness itself queries
    // mcp_contributions after the call (also dropped), so we invoke
    // the handler via McpServer._registeredTools directly.
    const db = getDb()
    await db.execute('DROP TABLE IF EXISTS mcp_contributions')

    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js')
    const srv = new McpServer({ name: 'sni-test', version: '0.0.0' })
    wrapTool(srv, 'resilient_tool', TestIn, undefined, async () => ({ survived: true }))

    const registeredTool = srv._registeredTools['resilient_tool']
    const result = await registeredTool.handler({}, { authInfo: user })

    expect(JSON.parse(result.content[0].text)).toEqual({ survived: true })
  })

  it('captures a positive latency_ms in the audit row', async () => {
    const db = getDb()
    await callTool({
      register: (srv) => wrapTool(srv, 'latency_tool', TestIn, undefined,
        async () => ({ done: true })
      ),
      name: 'latency_tool',
      args: {},
      user,
      db,
    })

    const audit = await db.execute({
      sql: `SELECT latency_ms FROM mcp_contributions WHERE tool = ? ORDER BY id DESC LIMIT 1`,
      args: ['latency_tool'],
    })
    expect(audit.rows[0].latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('captures jti when user has one, NULL when absent', async () => {
    const db = getDb()

    await callTool({
      register: (srv) => wrapTool(srv, 'jti_tool', TestIn, undefined,
        async () => ({})
      ),
      name: 'jti_tool',
      args: {},
      user,
      db,
    })

    await callTool({
      register: (srv) => wrapTool(srv, 'jti_tool', TestIn, undefined,
        async () => ({})
      ),
      name: 'jti_tool',
      args: {},
      user: userNoJti,
      db,
    })

    const rows = await db.execute({
      sql: `SELECT jti, user_email FROM mcp_contributions WHERE tool = ? ORDER BY id ASC`,
      args: ['jti_tool'],
    })
    expect(rows.rows[0].jti).toBe('jti-abc-123')
    expect(rows.rows[1].jti).toBeNull()
  })

  it('truncates payload to 8000 chars at character boundary', async () => {
    const db = getDb()
    // 10,000 char string — should be sliced to 8000 in the stored payload
    const bigValue = 'x'.repeat(10_000)

    await callTool({
      register: (srv) => wrapTool(srv, 'big_tool', TestIn, undefined,
        async () => ({})
      ),
      name: 'big_tool',
      args: { value: bigValue },
      user,
      db,
    })

    const audit = await db.execute({
      sql: `SELECT payload FROM mcp_contributions WHERE tool = ? ORDER BY id DESC LIMIT 1`,
      args: ['big_tool'],
    })
    expect(audit.rows[0].payload.length).toBeLessThanOrEqual(8000)
  })
})
