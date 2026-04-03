import { jwtVerify, createRemoteJWKSet, SignJWT } from 'jose'
import crypto from 'crypto'
import config from '../lib/config.js'

const COOKIE_NAME = 'sni_session'
const STATE_COOKIE = 'sni_oauth_state'
const MAX_AGE = 7 * 24 * 60 * 60 // 7 days

// Google's JWKS endpoint for ID token signature verification
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs')
)

/**
 * GET /api/auth/login — redirect to Google OAuth consent screen
 */
export async function login(c) {
  const origin = new URL(c.req.url).origin
  const redirectUri = `${origin}/api/auth/callback`

  // CSRF protection: generate random state, store in short-lived cookie
  const state = crypto.randomBytes(32).toString('hex')
  const stateFlags = [
    `${STATE_COOKIE}=${state}`,
    'HttpOnly',
    'Path=/api/auth/callback',
    'Max-Age=600',
    'SameSite=Lax',
    ...(config.isProduction ? ['Secure'] : []),
  ].join('; ')

  const params = new URLSearchParams({
    client_id: config.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account',
    state,
    ...(config.AUTH_DOMAIN ? { hd: config.AUTH_DOMAIN } : {}),
  })

  return new Response(null, {
    status: 302,
    headers: {
      'Location': `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': stateFlags,
    },
  })
}

/**
 * GET /api/auth/callback — exchange auth code for tokens, set session cookie
 */
export async function callback(c) {
  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code) return c.json({ error: 'Missing code' }, 400)

  // Verify CSRF state parameter
  const cookies = c.req.header('cookie') || ''
  const stateMatch = cookies.match(new RegExp(`${STATE_COOKIE}=([^;]+)`))
  const storedState = stateMatch?.[1]
  if (!state || !storedState || state !== storedState) {
    return c.json({ error: 'Invalid OAuth state — possible CSRF attack' }, 403)
  }

  const origin = new URL(c.req.url).origin
  const redirectUri = `${origin}/api/auth/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 401)

  const tokens = await tokenRes.json()

  // Verify Google ID token signature and claims
  const { payload } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: config.GOOGLE_CLIENT_ID,
  })

  // Verify domain restriction
  if (config.AUTH_DOMAIN && payload.hd !== config.AUTH_DOMAIN) {
    return c.html(`<h1>Access denied</h1><p>Only @${config.AUTH_DOMAIN} accounts are allowed.</p>`, 403)
  }

  // Create session JWT
  const secret = new TextEncoder().encode(config.SESSION_SECRET)
  const jwt = await new SignJWT({
    sub: payload.email,
    name: payload.name,
    picture: payload.picture,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret)

  // Set httpOnly session cookie, clear state cookie, redirect to app
  const sessionFlags = [
    `${COOKIE_NAME}=${jwt}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${MAX_AGE}`,
    'SameSite=Lax',
    ...(config.isProduction ? ['Secure'] : []),
  ].join('; ')

  const clearState = [
    `${STATE_COOKIE}=`,
    'HttpOnly',
    'Path=/api/auth/callback',
    'Max-Age=0',
    'SameSite=Lax',
    ...(config.isProduction ? ['Secure'] : []),
  ].join('; ')

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', '/'],
      ['Set-Cookie', sessionFlags],
      ['Set-Cookie', clearState],
    ],
  })
}

/**
 * GET /api/auth/me — return current user from JWT
 */
export async function me(c) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  return c.json({ email: user.sub, name: user.name, picture: user.picture })
}

/**
 * POST /api/auth/logout — clear session cookie
 */
export async function logout(c) {
  const cookieFlags = [
    `${COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
    ...(config.isProduction ? ['Secure'] : []),
  ].join('; ')

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': cookieFlags,
    },
  })
}
