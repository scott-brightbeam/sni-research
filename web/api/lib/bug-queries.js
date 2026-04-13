/**
 * bug-queries.js — SQL query functions for the bug_reports table.
 *
 * All functions take a libSQL `db` client as first argument.
 * Uses parameterised queries exclusively (no string interpolation).
 */

import { randomUUID } from 'crypto'

const VALID_STATUSES = new Set(['open', 'investigating', 'fixed', 'closed', 'wont-fix'])
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const VALID_COMPONENTS = new Set(['dashboard', 'database', 'editorial', 'newsletter', 'sources', 'config', 'other'])
const UPDATABLE_FIELDS = new Set(['status', 'severity', 'resolution_notes', 'triage_notes', 'resolved_at'])

export { VALID_STATUSES, VALID_SEVERITIES, VALID_COMPONENTS }

// ---------------------------------------------------------------------------
// listBugs
// ---------------------------------------------------------------------------

/**
 * List bug reports with optional status filter and pagination.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} [opts.status] - filter by status
 * @param {number} [opts.limit=50]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{bugs: object[], total: number, limit: number, offset: number}>}
 */
export async function listBugs(db, { status, limit = 50, offset = 0 } = {}) {
  const conditions = []
  const args = []

  if (status) {
    conditions.push('status = ?')
    args.push(status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM bug_reports ${where}`,
    args,
  })
  const total = Number(countResult.rows[0].cnt)

  const result = await db.execute({
    sql: `SELECT * FROM bug_reports ${where}
          ORDER BY reported_at DESC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  })

  return { bugs: result.rows, total, limit, offset }
}

// ---------------------------------------------------------------------------
// getBug
// ---------------------------------------------------------------------------

/**
 * Get a single bug report by id.
 * @param {import('@libsql/client').Client} db
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getBug(db, id) {
  const result = await db.execute({
    sql: 'SELECT * FROM bug_reports WHERE id = ?',
    args: [id],
  })
  return result.rows.length > 0 ? result.rows[0] : null
}

// ---------------------------------------------------------------------------
// createBug
// ---------------------------------------------------------------------------

/**
 * Create a new bug report.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.description
 * @param {string} [opts.component]
 * @param {string} [opts.severity='medium']
 * @param {string} [opts.reportedBy]
 * @param {string} [opts.reportedByName]
 * @returns {Promise<{id: string}>}
 */
export async function createBug(db, { title, description, component, severity = 'medium', reportedBy, reportedByName }) {
  const id = randomUUID()

  await db.execute({
    sql: `INSERT INTO bug_reports (id, title, description, component, severity, reported_by, reported_by_name)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, title, description, component ?? null, severity, reportedBy ?? null, reportedByName ?? null],
  })

  return { id }
}

// ---------------------------------------------------------------------------
// updateBug
// ---------------------------------------------------------------------------

/**
 * Update a bug report. Only fields in UPDATABLE_FIELDS are allowed;
 * all others are silently ignored.
 * @param {import('@libsql/client').Client} db
 * @param {string} id
 * @param {object} fields - field:value pairs to SET
 * @returns {Promise<{ok: boolean}>}
 */
export async function updateBug(db, id, fields) {
  const filtered = Object.entries(fields).filter(([k]) => UPDATABLE_FIELDS.has(k))
  if (filtered.length === 0) return { ok: false }

  const setClauses = filtered.map(([k]) => `${k} = ?`)
  setClauses.push("updated_at = datetime('now')")

  const args = [...filtered.map(([, v]) => v), id]

  await db.execute({
    sql: `UPDATE bug_reports SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  })

  return { ok: true }
}

// ---------------------------------------------------------------------------
// getOpenBugs
// ---------------------------------------------------------------------------

/**
 * Get all open bug reports.
 * @param {import('@libsql/client').Client} db
 * @returns {Promise<object[]>}
 */
export async function getOpenBugs(db) {
  const result = await db.execute(
    "SELECT * FROM bug_reports WHERE status = 'open' ORDER BY reported_at DESC"
  )
  return result.rows
}

// ---------------------------------------------------------------------------
// getStaleFixedBugs
// ---------------------------------------------------------------------------

/**
 * Get bugs marked as 'fixed' more than `days` days ago that haven't been closed.
 * @param {import('@libsql/client').Client} db
 * @param {number} [days=7]
 * @returns {Promise<object[]>}
 */
export async function getStaleFixedBugs(db, days = 7) {
  const result = await db.execute({
    sql: `SELECT * FROM bug_reports
          WHERE status = 'fixed'
          AND resolved_at IS NOT NULL
          AND resolved_at <= datetime('now', ? || ' days')
          ORDER BY resolved_at ASC`,
    args: [`-${days}`],
  })
  return result.rows
}
