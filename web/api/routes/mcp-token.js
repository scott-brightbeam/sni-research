import { mintMcpToken, MCP_AUDIENCE } from '../lib/mcp-auth.js'
import { getDb } from '../lib/db.js'
import config from '../lib/config.js'

/** GET /api/mcp/token — mint a fresh 30d Bearer for the cookie-authed user. */
export async function mintTokenHandler(c) {
  const user = c.get('user')
  if (!user?.sub) return c.json({ error: 'Not authenticated' }, 401)
  const { token, jti } = await mintMcpToken({
    sub: user.sub, name: user.name, picture: user.picture,
  })
  return c.json({
    token, jti, expiresInDays: 30,
    mcpUrl: MCP_AUDIENCE,
  })
}

/**
 * GET /api/mcp/tokens — best-effort active-jti list for the caller.
 * No mcp_issued_tokens table exists (deferred). Approximates "active" by
 * showing distinct jtis seen in mcp_contributions for this user that are
 * NOT in mcp_revoked_tokens.
 */
export async function listTokensHandler(c) {
  const user = c.get('user')
  if (!user?.sub) return c.json({ error: 'Not authenticated' }, 401)
  const db = getDb()
  const r = await db.execute({
    sql: `SELECT jti, MAX(ts) AS last_seen, COUNT(*) AS call_count
          FROM mcp_contributions
          WHERE user_email = ? AND jti IS NOT NULL
            AND jti NOT IN (SELECT jti FROM mcp_revoked_tokens)
          GROUP BY jti
          ORDER BY last_seen DESC LIMIT 50`,
    args: [user.sub],
  })
  return c.json({ activeTokens: r.rows })
}

/**
 * POST /api/mcp/token/revoke — admin-only.
 * Body: { jti: string, reason?: string }
 */
export async function revokeTokenHandler(c) {
  const user = c.get('user')
  if (!user?.sub) return c.json({ error: 'Not authenticated' }, 401)
  // Read lazily so test overrides of process.env.SNI_MCP_ADMINS take effect.
  const admins = process.env.SNI_MCP_ADMINS
    ? process.env.SNI_MCP_ADMINS.split(',').map(s => s.trim()).filter(Boolean)
    : config.MCP_ADMINS
  if (!admins.includes(user.sub)) {
    return c.json({ error: 'Admin only' }, 403)
  }
  const body = await c.req.json().catch(() => ({}))
  if (!body.jti || typeof body.jti !== 'string') {
    return c.json({ error: 'jti required' }, 400)
  }
  const db = getDb()
  await db.execute({
    sql: `INSERT OR IGNORE INTO mcp_revoked_tokens (jti, revoked_by, reason)
          VALUES (?, ?, ?)`,
    args: [body.jti, user.sub, body.reason || null],
  })
  return c.json({ revoked: body.jti })
}
