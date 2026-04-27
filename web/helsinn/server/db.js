import { createClient } from '@libsql/client';

let client = null;

export function getDb() {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL not set');
  client = createClient({ url, authToken });
  return client;
}

export function dbAvailable() {
  return !!process.env.TURSO_DATABASE_URL;
}

// Idempotent schema bootstrap. Runs once at server start.
// All tables prefixed helsinn_ so they never collide with other apps sharing
// the same libSQL database.
export async function ensureSchema() {
  if (!dbAvailable()) return;
  const db = getDb();
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS helsinn_users (
      email          TEXT PRIMARY KEY,
      first_seen     TEXT NOT NULL,
      last_seen      TEXT NOT NULL,
      login_count    INTEGER NOT NULL DEFAULT 0,
      total_views    INTEGER NOT NULL DEFAULT 0,
      total_dwell_ms INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS helsinn_sessions (
      sid             TEXT PRIMARY KEY,
      email           TEXT NOT NULL,
      ip              TEXT,
      user_agent      TEXT,
      started_at      TEXT NOT NULL,
      last_activity_at TEXT NOT NULL,
      ended_at        TEXT,
      view_count      INTEGER NOT NULL DEFAULT 0,
      total_dwell_ms  INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_helsinn_sessions_email
      ON helsinn_sessions(email);
    CREATE INDEX IF NOT EXISTS idx_helsinn_sessions_started
      ON helsinn_sessions(started_at DESC);

    CREATE TABLE IF NOT EXISTS helsinn_views (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      sid         TEXT NOT NULL,
      email       TEXT NOT NULL,
      section     TEXT NOT NULL,
      tab         TEXT,
      anchor      TEXT,
      started_at  TEXT NOT NULL,
      dwell_ms    INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_helsinn_views_sid
      ON helsinn_views(sid);
    CREATE INDEX IF NOT EXISTS idx_helsinn_views_email
      ON helsinn_views(email);
    CREATE INDEX IF NOT EXISTS idx_helsinn_views_started
      ON helsinn_views(started_at DESC);
  `);
}

// ---- Write helpers ----

export async function recordLogin({ email, sid, ip, userAgent, now }) {
  if (!dbAvailable()) return;
  const db = getDb();
  await db.batch([
    {
      sql: `INSERT INTO helsinn_users (email, first_seen, last_seen, login_count)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(email) DO UPDATE SET
              last_seen   = excluded.last_seen,
              login_count = helsinn_users.login_count + 1`,
      args: [email, now, now],
    },
    {
      sql: `INSERT INTO helsinn_sessions
            (sid, email, ip, user_agent, started_at, last_activity_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [sid, email, ip || null, userAgent || null, now, now],
    },
  ], 'write');
}

export async function recordView({ sid, email, section, tab, anchor, startedAt, dwellMs }) {
  if (!dbAvailable()) return;
  const db = getDb();
  const dwell = Number.isFinite(dwellMs) && dwellMs >= 0 ? Math.min(dwellMs, 6 * 60 * 60 * 1000) : null;
  const now = new Date().toISOString();
  await db.batch([
    {
      sql: `INSERT INTO helsinn_views (sid, email, section, tab, anchor, started_at, dwell_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [sid, email, section, tab || null, anchor || null, startedAt || now, dwell],
    },
    {
      sql: `UPDATE helsinn_sessions
            SET view_count       = view_count + 1,
                total_dwell_ms   = total_dwell_ms + COALESCE(?, 0),
                last_activity_at = ?
            WHERE sid = ?`,
      args: [dwell, now, sid],
    },
    {
      sql: `UPDATE helsinn_users
            SET total_views    = total_views + 1,
                total_dwell_ms = total_dwell_ms + COALESCE(?, 0),
                last_seen      = ?
            WHERE email = ?`,
      args: [dwell, now, email],
    },
  ], 'write');
}

export async function recordHeartbeat({ sid, email }) {
  if (!dbAvailable()) return;
  const db = getDb();
  const now = new Date().toISOString();
  await db.batch([
    { sql: `UPDATE helsinn_sessions SET last_activity_at = ? WHERE sid = ?`, args: [now, sid] },
    { sql: `UPDATE helsinn_users SET last_seen = ? WHERE email = ?`, args: [now, email] },
  ], 'write');
}

export async function recordSessionEnd({ sid }) {
  if (!dbAvailable()) return;
  const db = getDb();
  const now = new Date().toISOString();
  await getDb().execute({
    sql: `UPDATE helsinn_sessions SET ended_at = ?, last_activity_at = ? WHERE sid = ? AND ended_at IS NULL`,
    args: [now, now, sid],
  });
}

// ---- Read helpers for dashboard ----

export async function summary() {
  const db = getDb();
  const [users, sessions, views] = await Promise.all([
    db.execute(`SELECT COUNT(*) AS n FROM helsinn_users`),
    db.execute(`SELECT COUNT(*) AS n, SUM(total_dwell_ms) AS dwell FROM helsinn_sessions`),
    db.execute(`SELECT COUNT(*) AS n FROM helsinn_views`),
  ]);
  return {
    unique_users:    Number(users.rows[0]?.n || 0),
    total_sessions:  Number(sessions.rows[0]?.n || 0),
    total_views:     Number(views.rows[0]?.n || 0),
    total_dwell_ms:  Number(sessions.rows[0]?.dwell || 0),
  };
}

export async function usersTable() {
  const db = getDb();
  const res = await db.execute(`
    SELECT u.email,
           u.login_count,
           u.total_views,
           u.total_dwell_ms,
           u.first_seen,
           u.last_seen,
           (SELECT COUNT(*) FROM helsinn_sessions s WHERE s.email = u.email) AS session_count
    FROM helsinn_users u
    ORDER BY u.last_seen DESC
  `);
  return res.rows;
}

export async function recentSessions(limit = 100) {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT sid, email, ip, user_agent, started_at, ended_at,
                 last_activity_at, view_count, total_dwell_ms
          FROM helsinn_sessions
          ORDER BY started_at DESC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows;
}

export async function recentViews(limit = 200) {
  const db = getDb();
  const res = await db.execute({
    sql: `SELECT id, sid, email, section, tab, anchor, started_at, dwell_ms
          FROM helsinn_views
          ORDER BY id DESC
          LIMIT ?`,
    args: [limit],
  });
  return res.rows;
}

export async function viewsBySection() {
  const db = getDb();
  const res = await db.execute(`
    SELECT section,
           tab,
           COUNT(*) AS views,
           COUNT(DISTINCT email) AS unique_users,
           COALESCE(SUM(dwell_ms), 0) AS total_dwell_ms,
           COALESCE(AVG(dwell_ms), 0) AS avg_dwell_ms
    FROM helsinn_views
    GROUP BY section, tab
    ORDER BY views DESC
  `);
  return res.rows;
}
