/**
 * audit.js — wrapTool() registers an MCP tool with audit logging.
 *
 * Every wrapped tool writes one row to mcp_contributions (success or
 * failure) capturing user, jti, tool name, payload (truncated), outcome,
 * error, latency_ms, contributionId (write tools), clientRequestId.
 * Audit insert is best-effort: a Turso outage does not block the tool
 * result reaching the caller.
 *
 * Outcome enum ownership (the schema CHECK lists 7 values; ownership splits):
 *   - wrapTool here:    success / tool_error / sidecar_failed
 *   - routes/mcp.js:    auth_failed / rate_limited (currently NOT persisted —
 *                       returned as 401/429 before reaching wrapTool; if you
 *                       want them as audit rows, insert there)
 *   - reserved:         validation_error / audit_only (no producer yet)
 *
 * Idempotent retries (Decision #9): a write tool retried with the same
 * (clientRequestId, user_email) fails the UNIQUE partial index on the
 * audit INSERT. The catch below logs and moves on; the handler is the
 * source of truth for what the caller sees.
 */
import { getDb } from '../db.js'

const PAYLOAD_MAX = 8000

function classifyError(err) {
  if (err?.code === 'SIDECAR_FAILED') return 'sidecar_failed'
  return 'tool_error'
}

/**
 * Register a tool on the MCP server with audit logging.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {string} name
 * @param {import('zod').ZodObject} schemaIn  Zod object — .shape passed to the SDK
 * @param {import('zod').ZodObject|undefined} schemaOut  Optional output Zod object
 * @param {(args: object, ctx: {user: object}) => Promise<object>} handler
 */
export function wrapTool(server, name, schemaIn, schemaOut, handler) {
  server.registerTool(
    name,
    {
      title: name,
      description: schemaIn.description || name,
      inputSchema: schemaIn.shape,
      ...(schemaOut ? { outputSchema: schemaOut.shape } : {}),
    },
    async (args, extra) => {
      const start = Date.now()
      const user = extra?.authInfo ?? { sub: 'unknown', jti: null }
      let outcome = 'success'
      let errorMsg = null
      let contributionId = null
      let result
      let threwError = null

      try {
        result = await handler(args, { user })
        contributionId = result?.contributionId ?? null
      } catch (e) {
        outcome = classifyError(e)
        errorMsg = e.message
        threwError = e
      }

      const latency = Date.now() - start
      try {
        const db = getDb()
        await db.execute({
          sql: `INSERT INTO mcp_contributions
                  (user_email, jti, tool, payload, outcome, error, latency_ms,
                   contribution_id, client_request_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            user.sub ?? 'unknown',
            user.jti ?? null,
            name,
            // ASCII-dominated JSON payloads; surrogate-pair split at the byte
            // boundary is a negligible risk for our tool inputs.
            JSON.stringify(args ?? null).slice(0, PAYLOAD_MAX),
            outcome,
            errorMsg,
            latency,
            contributionId,
            args?.clientRequestId ?? null,
          ],
        })
      } catch (auditErr) {
        // Best-effort — sidecar/tool result is the durable record.
        console.error(`[mcp-audit] insert failed for tool=${name}: ${auditErr.message}`)
      }

      if (threwError) throw threwError

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }
  )
}
