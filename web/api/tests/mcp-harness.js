/**
 * mcp-harness.js — Test helper for invoking MCP tools through the SDK plumbing.
 *
 * IMPORTANT: The caller must call _resetDbSingleton() and migrateSchema(getDb())
 * before each test so that the singleton in-memory DB is initialised.  Any
 * wrapTool-wrapped handler (Task 4+) calls getDb() internally — that call MUST
 * return the same DB instance that the test's seed functions wrote into.
 * If you create a separate db = createTestDb() it will be a different in-memory
 * client and audit-row assertions will see nothing.
 *
 * Usage pattern:
 *
 *   import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
 *   import { callTool } from './mcp-harness.js'
 *
 *   beforeEach(async () => {
 *     _resetDbSingleton()
 *     const db = getDb()           // creates singleton in-memory DB
 *     await migrateSchema(db)
 *     await seedArticles(db, 5)    // seed via fixtures
 *   })
 *
 *   it('...', async () => {
 *     const db = getDb()
 *     const { result, auditRow } = await callTool({
 *       register, name: 'sni_list_articles', args: { limit: 3 }, user, db,
 *     })
 *     expect(result.content[0].type).toBe('text')
 *     expect(auditRow.tool).toBe('sni_list_articles')
 *   })
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * Register one tool (via the `register` callback), invoke it by name, and
 * return the tool result plus the most-recent mcp_contributions audit row
 * for that tool.
 *
 * @param {object} opts
 * @param {(srv: McpServer) => void} opts.register
 *   Callback that registers the tool(s) under test on the provided McpServer.
 * @param {string} opts.name   Tool name to invoke.
 * @param {object} opts.args   Arguments to pass to the tool handler.
 * @param {object} opts.user   User identity object (shape: { email, jti? }).
 *   Bridged through extra.authInfo — matches how @hono/mcp will bridge
 *   c.get('auth') in routes/mcp.js (Task 3).
 * @param {import('@libsql/client').Client} opts.db
 *   The singleton DB returned by getDb() after _resetDbSingleton().
 *   Used only to query the audit row after the tool runs; the tool handler
 *   itself also calls getDb() internally, which MUST return this same client.
 * @returns {Promise<{ result: object, auditRow: object|null }>}
 */
export async function callTool({ register, name, args, user, db }) {
  const srv = new McpServer({ name: 'sni-test', version: '0.0.0' })
  register(srv)

  // _registeredTools is the internal SDK tool registry; see harness JSDoc.
  const registeredTool = srv._registeredTools[name]
  if (!registeredTool) {
    const known = Object.keys(srv._registeredTools).join(', ') || '(none)'
    throw new Error(
      `callTool: tool "${name}" not registered. Known tools: ${known}`
    )
  }

  const extra = {
    authInfo: user,
    sessionId: 'test-session',
    requestId: 'test-req-1',
  }

  // Mirror the SDK's executeToolHandler signature: tools with an inputSchema
  // are called as handler(args, extra); tools without one as handler(extra).
  // Without this branch a no-inputSchema tool would receive `args` where it
  // expects `extra`, silently dropping the auth payload.
  const result = registeredTool.inputSchema
    ? await registeredTool.handler(args, extra)
    : await registeredTool.handler(extra)

  // Query the most-recent audit row this tool wrote.
  const audit = await db.execute({
    sql: `SELECT * FROM mcp_contributions WHERE tool = ? ORDER BY id DESC LIMIT 1`,
    args: [name],
  })

  return { result, auditRow: audit.rows[0] ?? null }
}
