import { SignJWT, jwtVerify } from 'jose'
import { randomUUID } from 'crypto'
import { getDb } from './db.js'
import config from './config.js'

const ISSUER = 'sni-research'
export const MCP_AUDIENCE = 'https://sni-research.fly.dev/mcp'
const TOKEN_TTL = '30d'
const ALG = 'HS256'

/**
 * Read SESSION_SECRET lazily so test files that set process.env before calling
 * these functions get the correct value. config.SESSION_SECRET is frozen at
 * module-load time, but process.env is always live.
 */
function getSecret() {
  return new TextEncoder().encode(process.env.SNI_SESSION_SECRET || config.SESSION_SECRET)
}

/**
 * Mint a 30-day MCP Bearer token for the given user.
 * Returns { token, jti }.
 *
 * @param {{ sub: string, name?: string, picture?: string }} user
 * @param {{ ttl?: string, aud?: string }} opts
 */
export async function mintMcpToken(user, { ttl = TOKEN_TTL, aud = MCP_AUDIENCE } = {}) {
  const jti = randomUUID()
  const secret = getSecret()
  const token = await new SignJWT({ name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setAudience(aud)
    .setSubject(user.sub)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret)
  return { token, jti }
}

/**
 * Split-based domain check — avoids the .endsWith() bypass present in
 * middleware/auth.js (e.g. evil@notbrightbeam.com.attacker.com would pass
 * an endsWith check). Here we require exact match of the domain part.
 */
function emailDomainMatches(sub, domain) {
  const parts = String(sub || '').split('@')
  return parts.length === 2 && parts[1] === domain
}

/**
 * Authenticate an incoming MCP request. Checks Bearer token first; falls back
 * to sni_session cookie. Returns the decoded payload on success; throws on any
 * failure (expired, revoked, wrong domain, missing jti on Bearer, etc.).
 *
 * Caller is responsible for the try/catch and returning an appropriate HTTP
 * error response.
 *
 * @param {import('hono').Context} c
 * @returns {Promise<{ sub: string, name: string, picture: string, jti: string|null, via: 'bearer'|'cookie' }>}
 */
export async function authenticateMcpRequest(c) {
  const authHeader = c.req.header('authorization')
  let token
  let isBearer = false

  if (authHeader?.startsWith('Bearer ')) {
    isBearer = true
    token = authHeader.slice(7).trim()
    if (!token) throw new Error('mcp_auth: empty Bearer token')
  } else {
    const cookies = c.req.header('cookie') || ''
    const m = cookies.match(/sni_session=([^;]+)/)
    if (m) token = m[1]
  }

  if (!token) throw new Error('mcp_auth: no token')

  const secret = getSecret()
  const verifyOpts = {
    issuer: ISSUER,
    algorithms: [ALG],   // pin algorithm — closes alg:none / alg-confusion CVEs
  }

  // Bearer tokens carry an explicit audience claim; existing cookie JWTs do
  // not (they're minted in routes/auth.js without setAudience). Passing an
  // audience to jwtVerify for the cookie path would always reject valid sessions.
  if (isBearer) {
    verifyOpts.audience = MCP_AUDIENCE
  }

  const { payload } = await jwtVerify(token, secret, verifyOpts)

  // Bearer tokens must have a jti — it's the revocation handle.
  if (isBearer && !payload.jti) {
    throw new Error('mcp_auth: Bearer token missing jti')
  }

  // Domain restriction (split-based; never use .endsWith() — see comment above).
  // Read lazily from process.env so test overrides take effect.
  const domain = process.env.SNI_AUTH_DOMAIN || config.AUTH_DOMAIN
  if (domain && !emailDomainMatches(payload.sub, domain)) {
    throw new Error(`mcp_auth: domain mismatch (expected @${domain})`)
  }

  // Revocation check — Bearer path only. Guard with isBearer in case any
  // future cookie JWT happens to carry a jti claim.
  if (isBearer && payload.jti) {
    const db = getDb()
    const r = await db.execute({
      sql: `SELECT 1 FROM mcp_revoked_tokens WHERE jti = ?`,
      args: [payload.jti],
    })
    if (r.rows.length > 0) throw new Error('mcp_auth: token revoked')
  }

  return {
    sub: payload.sub,
    name: payload.name,
    picture: payload.picture,
    jti: payload.jti || null,
    via: isBearer ? 'bearer' : 'cookie',
  }
}
