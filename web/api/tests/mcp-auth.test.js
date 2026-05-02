import { describe, it, expect, beforeEach } from 'bun:test'
import { SignJWT } from 'jose'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { mintMcpToken, authenticateMcpRequest } from '../lib/mcp-auth.js'
import { revokeTokenHandler } from '../routes/mcp-token.js'

const SECRET = 'a'.repeat(64)
process.env.SNI_SESSION_SECRET = SECRET
process.env.SNI_AUTH_DOMAIN = 'brightbeam.com'
process.env.SNI_MCP_ADMINS = 'admin@brightbeam.com'

const fakeC = (authHeader, cookieHeader = '') => ({
  req: {
    header: (k) => {
      const key = k.toLowerCase()
      if (key === 'authorization') return authHeader
      if (key === 'cookie') return cookieHeader
      return undefined
    },
  },
})

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
})

describe('mcp-auth', () => {
  it('mints a 30d token with jti', async () => {
    const t = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    expect(t.token).toMatch(/^eyJ/)
    expect(t.jti).toMatch(/^[a-f0-9-]{36}$/)
  })

  it('verifies a valid Bearer token', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    const u = await authenticateMcpRequest(fakeC(`Bearer ${token}`))
    expect(u.sub).toBe('alice@brightbeam.com')
    expect(u.via).toBe('bearer')
  })

  it('rejects expired token', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' }, { ttl: '-1s' })
    await expect(authenticateMcpRequest(fakeC(`Bearer ${token}`))).rejects.toThrow(/expired|exp/i)
  })

  it('rejects alg:none algorithm-confusion', async () => {
    const forged = 'eyJhbGciOiJub25lIn0.' +
      Buffer.from(JSON.stringify({
        sub: 'alice@brightbeam.com',
        aud: 'https://sni-research.fly.dev/mcp',
        iss: 'sni-research',
        jti: 'fake',
        exp: Math.floor(Date.now()/1000) + 3600,
      })).toString('base64url') + '.'
    await expect(authenticateMcpRequest(fakeC(`Bearer ${forged}`))).rejects.toThrow()
  })

  it('rejects token signed with HS512 (algorithm pin)', async () => {
    const secret = new TextEncoder().encode(SECRET)
    const t = await new SignJWT({ name: 'Eve' })
      .setProtectedHeader({ alg: 'HS512' })
      .setIssuer('sni-research')
      .setAudience('https://sni-research.fly.dev/mcp')
      .setSubject('eve@brightbeam.com')
      .setJti('x')
      .setExpirationTime('1h')
      .sign(secret)
    await expect(authenticateMcpRequest(fakeC(`Bearer ${t}`))).rejects.toThrow()
  })

  it('rejects Bearer token missing jti', async () => {
    const secret = new TextEncoder().encode(SECRET)
    const t = await new SignJWT({ name: 'Eve' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('sni-research')
      .setAudience('https://sni-research.fly.dev/mcp')
      .setSubject('eve@brightbeam.com')
      .setExpirationTime('1h')
      .sign(secret)  // no setJti
    await expect(authenticateMcpRequest(fakeC(`Bearer ${t}`))).rejects.toThrow(/jti/)
  })

  it('rejects token whose jti is in mcp_revoked_tokens', async () => {
    const db = getDb()
    const { token, jti } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    await db.execute({
      sql: `INSERT INTO mcp_revoked_tokens (jti, revoked_by) VALUES (?, ?)`,
      args: [jti, 'admin@brightbeam.com'],
    })
    await expect(authenticateMcpRequest(fakeC(`Bearer ${token}`))).rejects.toThrow(/revoked/)
  })

  it('rejects email not in SNI_AUTH_DOMAIN (split-based)', async () => {
    const { token } = await mintMcpToken({ sub: 'evil@brightbeam.com.attacker.com', name: 'Eve' })
    await expect(authenticateMcpRequest(fakeC(`Bearer ${token}`))).rejects.toThrow(/domain/)
  })

  it('rejects malformed Bearer (empty or wrong scheme)', async () => {
    await expect(authenticateMcpRequest(fakeC('Bearer '))).rejects.toThrow()
    await expect(authenticateMcpRequest(fakeC('Basic abc'))).rejects.toThrow()
  })

  it('Bearer wins over cookie when both present', async () => {
    const { token } = await mintMcpToken({ sub: 'alice@brightbeam.com', name: 'Alice' })
    const u = await authenticateMcpRequest(fakeC(`Bearer ${token}`, `sni_session=garbage`))
    expect(u.sub).toBe('alice@brightbeam.com')
    expect(u.via).toBe('bearer')
  })

  it('cookie path verifies WITHOUT audience claim (existing cookies have no aud)', async () => {
    // Mint a cookie-style JWT — only issuer + sub, no audience
    const secret = new TextEncoder().encode(SECRET)
    const cookieJwt = await new SignJWT({ name: 'Alice' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('sni-research')
      .setSubject('alice@brightbeam.com')
      .setExpirationTime('1h')
      .sign(secret)
    const u = await authenticateMcpRequest(fakeC(undefined, `sni_session=${cookieJwt}`))
    expect(u.sub).toBe('alice@brightbeam.com')
    expect(u.via).toBe('cookie')
  })

  it('non-admin attempting POST /api/mcp/token/revoke gets 403', async () => {
    // Call the handler directly with a fake Hono ctx — avoids server-boot complexity
    const fakeRevokeCtx = {
      get: (k) => k === 'user' ? { sub: 'random@brightbeam.com' } : undefined,
      req: { json: async () => ({ jti: 'whatever' }) },
      json: (body, status) => ({ body, status: status ?? 200 }),
    }
    const result = await revokeTokenHandler(fakeRevokeCtx)
    expect(result.status).toBe(403)
    expect(result.body.error).toMatch(/admin/i)
  })
})
