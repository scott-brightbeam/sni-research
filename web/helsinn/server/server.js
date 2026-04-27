import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isBotUserAgent } from './bots.js';
import {
  signSessionJWT, verifySessionJWT, passwordMatches,
  COOKIE_NAME, SESSION_TTL_SECONDS,
} from './auth.js';
import {
  ensureSchema, dbAvailable, recordLogin, recordView, recordHeartbeat, recordSessionEnd,
  summary, usersTable, recentSessions, recentViews, viewsBySection,
} from './db.js';
import { renderDashboard } from './dashboard.js';
import {
  oauthConfigured, redirectUri, buildAuthUrl,
  exchangeCodeForTokens, verifyGoogleIdToken, ALLOWED_DOMAIN,
} from './google-oauth.js';

// Admin gating is Google-OAuth-only. A self-claimed @brightbeam.com email
// via the shared password MUST NOT grant admin. `via` claim in JWT separates
// the two auth paths.
function isAdmin(payload) {
  if (!payload) return false;
  if (payload.via !== 'google') return false;
  const email = String(payload.email || '').toLowerCase();
  return email.endsWith('@' + ALLOWED_DOMAIN);
}

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const LOGIN_HTML = join(HERE, 'login.html');
const ADMIN_LOGIN_HTML = join(HERE, 'admin-login.html');

// Paths reachable without an auth cookie. Login pages + their static deps only.
const PUBLIC_PATHS = new Set([
  '/login',
  '/admin/login',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.webmanifest',
  '/assets/brightbeam-logo.png',
]);

// Restrict the post-OAuth `next` redirect to same-origin absolute paths
// we explicitly permit. Prevents open-redirect abuse.
function safeNextPath(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.length > 200) return null;
  return raw;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const app = new Hono();

// ---- Bot / crawler block (runs first) ----
app.use('*', async (c, next) => {
  const ua = c.req.header('user-agent') || '';
  if (isBotUserAgent(ua)) {
    return c.text('Forbidden', 403, {
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
    });
  }
  await next();
});

// ---- Security headers on every response ----
app.use('*', async (c, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Permissions-Policy', 'interest-cohort=(), browsing-topics=()');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
});

// ---- Rate limit for /auth/login ----
const loginBuckets = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function rateCheck(ip) {
  const now = Date.now();
  const b = loginBuckets.get(ip);
  if (!b || b.resetAt < now) {
    loginBuckets.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (b.count >= LOGIN_MAX_ATTEMPTS) return false;
  b.count++;
  return true;
}

function clientIP(c) {
  return (
    c.req.header('fly-client-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

function logEvent(kind, data) {
  const entry = { t: new Date().toISOString(), kind, ...data };
  // Fly captures stdout; structured JSON is easiest to grep later.
  console.log(JSON.stringify(entry));
}

// ---- Auth endpoints ----
app.post('/auth/login', async (c) => {
  const ip = clientIP(c);
  const ua = c.req.header('user-agent') || '';
  if (!rateCheck(ip)) {
    logEvent('login_rate_limited', { ip });
    return c.json({ error: 'Too many attempts. Try again later.' }, 429);
  }
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid request' }, 400); }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!email || !password) return c.json({ error: 'Email and password are required.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ error: 'Enter a valid email address.' }, 400);
  }
  if (!passwordMatches(password)) {
    logEvent('login_fail', { ip, email, ua });
    return c.json({ error: 'Invalid email or password.' }, 401);
  }
  const sid = randomUUID();
  const token = await signSessionJWT(email, sid, 'password');
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  logEvent('login_ok', { ip, email, ua, sid, via: 'password' });
  try {
    await recordLogin({ email, sid, ip, userAgent: ua, now: new Date().toISOString() });
  } catch (err) {
    logEvent('analytics_write_error', { where: 'login', msg: String(err?.message || err) });
  }
  return c.json({ ok: true });
});

// ---- Google OAuth (Brightbeam staff) ----
app.get('/auth/google/available', (c) => c.json({ available: oauthConfigured() }));

app.get('/auth/google/start', async (c) => {
  if (!oauthConfigured()) return c.text('Google sign-in is not configured.', 503);
  const state = randomUUID();
  const next = safeNextPath(c.req.query('next'));
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'Lax',
    path: '/auth/google',
    maxAge: 600,
  };
  setCookie(c, 'oauth_state', state, cookieOpts);
  if (next) setCookie(c, 'oauth_next', next, cookieOpts);
  else deleteCookie(c, 'oauth_next', { path: '/auth/google' });
  const url = buildAuthUrl({
    clientId: process.env.GOOGLE_CLIENT_ID,
    redirect: redirectUri(c),
    state,
  });
  return c.redirect(url, 302);
});

app.get('/auth/google/callback', async (c) => {
  if (!oauthConfigured()) return c.text('Google sign-in is not configured.', 503);
  const ip = clientIP(c);
  const ua = c.req.header('user-agent') || '';
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');
  const stateCookie = getCookie(c, 'oauth_state');
  const nextCookie = safeNextPath(getCookie(c, 'oauth_next'));
  deleteCookie(c, 'oauth_state', { path: '/auth/google' });
  deleteCookie(c, 'oauth_next', { path: '/auth/google' });
  if (errorParam) {
    logEvent('google_auth_error', { ip, error: errorParam });
    return c.redirect('/login?gerr=' + encodeURIComponent(errorParam), 302);
  }
  if (!code || !state || !stateCookie || state !== stateCookie) {
    logEvent('google_state_mismatch', { ip });
    return c.text('Invalid OAuth state. Please try signing in again.', 400);
  }
  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirect:     redirectUri(c),
    });
  } catch (err) {
    logEvent('google_token_exchange_error', { ip, msg: String(err?.message || err) });
    return c.text('Google token exchange failed. Please try again.', 502);
  }
  if (!tokens?.id_token) {
    logEvent('google_no_id_token', { ip });
    return c.text('Google did not return an identity token.', 502);
  }
  let identity;
  try {
    identity = await verifyGoogleIdToken(tokens.id_token, process.env.GOOGLE_CLIENT_ID);
  } catch (err) {
    logEvent('google_verify_error', { ip, msg: String(err?.message || err) });
    return c.text('Only @' + ALLOWED_DOMAIN + ' Google Workspace accounts may sign in this way.', 403);
  }
  const sid = randomUUID();
  const token = await signSessionJWT(identity.email, sid, 'google');
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  logEvent('login_ok', { ip, email: identity.email, ua, sid, via: 'google', name: identity.name });
  try {
    await recordLogin({ email: identity.email, sid, ip, userAgent: ua, now: new Date().toISOString() });
  } catch (err) {
    logEvent('analytics_write_error', { where: 'google_login', msg: String(err?.message || err) });
  }
  return c.redirect(nextCookie || '/', 302);
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const payload = token ? await verifySessionJWT(token) : null;
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  logEvent('logout', { ip: clientIP(c), email: payload?.email, sid: payload?.sid });
  if (payload?.sid) {
    try { await recordSessionEnd({ sid: payload.sid }); }
    catch (err) { logEvent('analytics_write_error', { where: 'logout', msg: String(err?.message || err) }); }
  }
  return c.json({ ok: true });
});

app.get('/auth/check', async (c) => {
  const token = getCookie(c, COOKIE_NAME);
  const payload = token ? await verifySessionJWT(token) : null;
  if (!payload) return c.json({ authenticated: false });
  return c.json({
    authenticated: true,
    email: payload.email,
    via:   payload.via || 'password',
    admin: isAdmin(payload),
  });
});

// ---- Auth gate for everything non-public ----
async function currentPayload(c) {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  return await verifySessionJWT(token);
}

app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path.startsWith('/auth/')) return next();
  if (PUBLIC_PATHS.has(path)) return next();
  const payload = await currentPayload(c);
  if (payload) {
    c.set('email', payload.email);
    c.set('sid', payload.sid);
    c.set('via', payload.via || 'password');
    c.set('admin', isAdmin(payload));
    return next();
  }
  const accept = c.req.header('accept') || '';
  if (accept.includes('text/html')) {
    // Admin area → Google-only login. Everywhere else → reviewer login.
    return c.redirect(path.startsWith('/admin/') ? '/admin/login' : '/login', 302);
  }
  return c.text('Unauthorized', 401);
});

// ---- Admin login page (Google-only, public) ----
app.get('/admin/login', async (c) => {
  // If already signed in as admin, skip straight to the dashboard.
  const payload = await currentPayload(c);
  if (payload && isAdmin(payload)) return c.redirect('/admin/analytics', 302);
  try {
    const html = readFileSync(ADMIN_LOGIN_HTML, 'utf8');
    return c.html(html);
  } catch {
    return c.text('Admin login page not found', 500);
  }
});

// ---- Analytics ingestion endpoints (auth-gated by middleware above) ----
async function parseBody(c) {
  try { return await c.req.json(); } catch { return {}; }
}

app.post('/a/view', async (c) => {
  const sid = c.get('sid'); const email = c.get('email');
  if (!sid || !email) return c.json({ error: 'no session' }, 400);
  const b = await parseBody(c);
  const section = typeof b.section === 'string' ? b.section.slice(0, 32) : null;
  if (!section) return c.json({ error: 'section required' }, 400);
  const tab = typeof b.tab === 'string' ? b.tab.slice(0, 32) : null;
  const anchor = typeof b.anchor === 'string' ? b.anchor.slice(0, 64) : null;
  const startedAt = typeof b.startedAt === 'string' ? b.startedAt : null;
  const dwellMs = Number.isFinite(b.dwellMs) ? Number(b.dwellMs) : null;
  try {
    await recordView({ sid, email, section, tab, anchor, startedAt, dwellMs });
    return c.json({ ok: true });
  } catch (err) {
    logEvent('analytics_write_error', { where: 'view', msg: String(err?.message || err) });
    return c.json({ ok: false }, 500);
  }
});

app.post('/a/heartbeat', async (c) => {
  const sid = c.get('sid'); const email = c.get('email');
  if (!sid || !email) return c.json({ error: 'no session' }, 400);
  try { await recordHeartbeat({ sid, email }); return c.json({ ok: true }); }
  catch { return c.json({ ok: false }, 500); }
});

app.post('/a/end', async (c) => {
  const sid = c.get('sid');
  if (!sid) return c.json({ error: 'no session' }, 400);
  try { await recordSessionEnd({ sid }); return c.json({ ok: true }); }
  catch { return c.json({ ok: false }, 500); }
});

function renderAdminDenied({ email, via }) {
  const currently = email
    ? `You're signed in as <strong>${email.replace(/</g, '&lt;')}</strong>` +
      (via ? ` (via ${via === 'google' ? 'Google' : 'shared password'})` : '')
    : 'You are not signed in';
  const canGoogle = oauthConfigured();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow, noarchive"/>
<title>Analytics — access denied</title>
<link rel="icon" href="/favicon.ico"/>
<style>
  :root{ --ember:#EA4700; --ink:#111; --gray:#7a7a7a; --faint:#e6e6e6;
         --paper:#ffffff; --sans: Arial, 'Helvetica Neue', Helvetica, sans-serif; }
  *{box-sizing:border-box}
  body{margin:0;padding:48px 32px;font-family:var(--sans);color:var(--ink);background:var(--paper);
       min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{max-width:560px;width:100%}
  p.eyebrow{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ember);
            font-weight:700;margin:0 0 16px}
  h1{font-size:36px;line-height:1.1;letter-spacing:-0.02em;font-weight:800;margin:0 0 16px}
  p{line-height:1.55;margin:0 0 14px;color:#2a2a2a}
  .btn{display:inline-flex;align-items:center;gap:10px;padding:14px 22px;margin:20px 12px 0 0;
       border:1px solid var(--ink);color:var(--ink);text-decoration:none;font-weight:700;
       font-size:13px;letter-spacing:.04em;background:var(--paper)}
  .btn--primary{background:var(--ember);color:var(--paper);border-color:var(--ember)}
  .btn:hover{background:var(--ink);color:var(--paper);border-color:var(--ink)}
  .btn--primary:hover{background:#c93d0b;border-color:#c93d0b;color:var(--paper)}
  .tiny{color:var(--gray);font-size:12px;margin-top:24px}
  form{display:inline}
</style></head><body><div class="card">
<p class="eyebrow">Analytics — access denied</p>
<h1>Brightbeam staff only.</h1>
<p>Analytics are restricted to Brightbeam team members signed in with a <strong>@brightbeam.com</strong> Google Workspace account.</p>
<p>${currently}.</p>
${canGoogle ? `
<form method="POST" action="/auth/logout" onsubmit="event.preventDefault();fetch('/auth/logout',{method:'POST'}).then(()=>location.href='/auth/google/start?next=/admin/analytics')">
  <button class="btn btn--primary" type="submit">Switch to Google sign-in →</button>
</form>
<a class="btn" href="/">Back to proposal</a>` : `
<p class="tiny">Google sign-in isn't configured on this environment yet.</p>
<a class="btn" href="/">Back to proposal</a>`}
</div></body></html>`;
}

// ---- Admin analytics dashboard ----
app.get('/admin/analytics', async (c) => {
  if (!c.get('admin')) return c.html(renderAdminDenied({ email: c.get('email'), via: c.get('via') }), 403);
  if (!dbAvailable()) return c.html('<p>Analytics database not configured.</p>', 503);
  try {
    const [sum, users, sessions, views, bySection] = await Promise.all([
      summary(), usersTable(), recentSessions(100), recentViews(300), viewsBySection(),
    ]);
    return c.html(renderDashboard({ summary: sum, users, sessions, views, bySection, me: c.get('email') }));
  } catch (err) {
    logEvent('dashboard_error', { msg: String(err?.message || err) });
    return c.text('Failed to load analytics: ' + String(err?.message || err), 500);
  }
});

app.get('/api/admin/summary', async (c) => {
  if (!c.get('admin')) return c.json({ error: 'forbidden' }, 403);
  if (!dbAvailable()) return c.json({ error: 'db not configured' }, 503);
  try {
    const [sum, users, sessions, views, bySection] = await Promise.all([
      summary(), usersTable(), recentSessions(100), recentViews(300), viewsBySection(),
    ]);
    return c.json({ summary: sum, users, sessions, views, bySection });
  } catch (err) {
    return c.json({ error: String(err?.message || err) }, 500);
  }
});

// ---- Login page (unauthenticated) ----
app.get('/login', (c) => {
  try {
    const html = readFileSync(LOGIN_HTML, 'utf8');
    return c.html(html);
  } catch {
    return c.text('Login page not found', 500);
  }
});

// ---- Static file serving ----
function tryServe(pathParts, dir) {
  let rel = pathParts.replace(/^\/+/, '');
  if (!rel) rel = 'index.html';
  const abs = join(dir, rel);
  if (!abs.startsWith(dir)) return null; // path traversal guard
  if (!existsSync(abs)) return null;
  const ext = extname(abs).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const body = readFileSync(abs);
  return new Response(body, { headers: { 'Content-Type': type } });
}

app.get('*', (c) => {
  const path = c.req.path;
  // Try public first (logo, icons, manifest), then dist (SPA + bundled assets), then SPA fallback.
  let res = tryServe(path, PUBLIC);
  if (res) return res;
  res = tryServe(path, DIST);
  if (res) return res;
  // SPA fallback for client-side routes / deep links
  const fallback = tryServe('/index.html', DIST);
  if (fallback) return fallback;
  return c.text('Not found', 404);
});

const port = Number(process.env.PORT || 8080);

// Bootstrap schema at startup (best-effort — don't crash the server if unreachable).
try {
  await ensureSchema();
  if (dbAvailable()) console.log(JSON.stringify({ t: new Date().toISOString(), kind: 'schema_ready' }));
} catch (err) {
  console.log(JSON.stringify({ t: new Date().toISOString(), kind: 'schema_error', msg: String(err?.message || err) }));
}

export default {
  port,
  fetch: app.fetch,
};
