import { jwtVerify } from 'jose'
import config from '../lib/config.js'

const COOKIE_NAME = 'sni_session'

// Routes that don't require auth
const PUBLIC_PATHS = ['/api/health', '/api/auth/login', '/api/auth/callback', '/api/status/sync']

/**
 * Auth middleware — verifies JWT from httpOnly cookie.
 *
 * When SNI_SESSION_SECRET is empty (local dev), auth is bypassed
 * with a fake dev user. This means local development works exactly
 * as before — no Google OAuth needed.
 */
export async function authMiddleware(c, next) {
  const path = c.req.path

  // Skip auth for public paths and static files
  if (PUBLIC_PATHS.includes(path) || !path.startsWith('/api/')) {
    return next()
  }

  // Dev mode without session secret: skip auth
  if (!config.SESSION_SECRET) {
    c.set('user', { sub: 'dev@local', name: 'Dev User', picture: '' })
    return next()
  }

  // Extract JWT from cookie
  const cookies = c.req.header('cookie') || ''
  const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  if (!match) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const secret = new TextEncoder().encode(config.SESSION_SECRET)
    const { payload } = await jwtVerify(match[1], secret, { issuer: 'sni-research' })

    // Check domain if configured
    if (config.AUTH_DOMAIN && !payload.sub.endsWith(`@${config.AUTH_DOMAIN}`)) {
      return c.json({ error: 'Unauthorised domain' }, 403)
    }

    c.set('user', payload)

    // CSRF protection for mutating requests in production
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.req.method) && config.isProduction) {
      const origin = c.req.header('origin')
      const referer = c.req.header('referer')
      const fetchMode = c.req.header('sec-fetch-mode')
      // Browser requests always send Sec-Fetch-Mode; its presence means this is
      // a browser request that must have a valid Origin or Referer.
      if (fetchMode) {
        if (!origin && !referer) {
          return c.json({ error: 'Missing origin' }, 403)
        }
        const check = origin || referer
        // For same-origin production (empty CORS_ORIGIN), verify the request
        // comes from the same host. For cross-origin dev, check CORS_ORIGIN.
        if (config.CORS_ORIGIN && !check.startsWith(config.CORS_ORIGIN)) {
          return c.json({ error: 'Invalid origin' }, 403)
        }
      }
    }

    return next()
  } catch {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }
}
