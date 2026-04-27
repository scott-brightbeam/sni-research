import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_URL  = 'https://www.googleapis.com/oauth2/v3/certs';
const ALLOWED_DOMAIN   = 'brightbeam.com';

let jwks = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

export function oauthConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

// Determine the callback URL we register with Google and hand back.
// Prefer an explicit GOOGLE_REDIRECT_URI (matches what's in Google Cloud Console).
// Fall back to reconstructing from the request, which Fly's proxy supports.
export function redirectUri(c) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const fwdProto = c.req.header('x-forwarded-proto') || 'https';
  const host = c.req.header('host') || 'localhost';
  return `${fwdProto}://${host}/auth/google/callback`;
}

export function buildAuthUrl({ clientId, redirect, state }) {
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirect,
    response_type: 'code',
    scope:         'openid email profile',
    state,
    hd:            ALLOWED_DOMAIN, // hint to show only Brightbeam accounts
    prompt:        'select_account',
    access_type:   'online',
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens({ code, clientId, clientSecret, redirect }) {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirect,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// Returns { email, emailVerified, hd, name, sub } on success.
// Throws if signature / issuer / audience invalid, or non-Brightbeam.
export async function verifyGoogleIdToken(idToken, expectedAudience) {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer:   ['https://accounts.google.com', 'accounts.google.com'],
    audience: expectedAudience,
  });
  const email = String(payload.email || '').toLowerCase();
  const emailVerified = payload.email_verified === true;
  const hd = String(payload.hd || '').toLowerCase();
  if (!emailVerified) throw new Error('Google account email not verified');
  // Belt-and-braces: the hd claim is the authoritative Workspace-domain signal.
  // We also check the email suffix as a secondary guard.
  if (hd !== ALLOWED_DOMAIN || !email.endsWith('@' + ALLOWED_DOMAIN)) {
    throw new Error(`Only @${ALLOWED_DOMAIN} Google Workspace accounts may sign in this way`);
  }
  return {
    email,
    emailVerified,
    hd,
    name: String(payload.name || ''),
    sub:  String(payload.sub || ''),
  };
}

export { ALLOWED_DOMAIN };
