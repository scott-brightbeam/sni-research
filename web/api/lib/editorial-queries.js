/**
 * editorial-queries.js — SQL query functions for editorial state tables.
 *
 * Covers: analysis_entries, themes, theme_evidence, theme_connections,
 *         posts, decisions, counters, corpus_stats, activity, notifications.
 *
 * All functions take a libSQL `db` client as first argument.
 * Uses parameterised queries exclusively (no string interpolation).
 */

// ---------------------------------------------------------------------------
// Analysis Entries
// ---------------------------------------------------------------------------

/**
 * List analysis entries with optional filters.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {number} [opts.tier]
 * @param {string} [opts.status]
 * @param {number} [opts.session]
 * @param {boolean} [opts.showArchived=false]
 * @returns {Promise<object[]>}
 */
export async function getAnalysisEntries(db, { tier, status, session, showArchived } = {}) {
  const conditions = []
  const args = []

  if (!showArchived) {
    conditions.push('archived = 0')
  }
  if (tier !== undefined) {
    conditions.push('tier = ?')
    args.push(tier)
  }
  if (status) {
    conditions.push('status = ?')
    args.push(status)
  }
  if (session !== undefined) {
    conditions.push('session = ?')
    args.push(session)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await db.execute({
    sql: `SELECT * FROM analysis_entries ${where} ORDER BY id DESC`,
    args,
  })
  return result.rows
}

/**
 * Get a single analysis entry by id.
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getAnalysisEntry(db, id) {
  const result = await db.execute({
    sql: 'SELECT * FROM analysis_entries WHERE id = ?',
    args: [id],
  })
  return result.rows.length > 0 ? result.rows[0] : null
}

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/**
 * List themes with optional filters.
 * "active" = themes with evidence in last 3 sessions (relative to currentSession).
 * "stale" = NOT active.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {boolean} [opts.active]
 * @param {boolean} [opts.stale]
 * @param {boolean} [opts.showArchived=false]
 * @param {number} [opts.currentSession]
 * @returns {Promise<object[]>}
 */
export async function getThemes(db, { active, stale, showArchived, currentSession } = {}) {
  const conditions = []
  const args = []

  if (!showArchived) {
    conditions.push('t.archived = 0')
  }

  // Active/stale filtering requires a subquery on theme_evidence sessions
  if (active && currentSession !== undefined) {
    const minSession = currentSession - 2 // last 3 sessions: current, current-1, current-2
    conditions.push(
      `t.code IN (SELECT DISTINCT theme_code FROM theme_evidence WHERE session >= ?)`
    )
    args.push(minSession)
  }
  if (stale && currentSession !== undefined) {
    const minSession = currentSession - 2
    conditions.push(
      `t.code NOT IN (SELECT DISTINCT theme_code FROM theme_evidence WHERE session >= ?)`
    )
    args.push(minSession)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await db.execute({
    sql: `SELECT t.*, COUNT(te.id) AS evidence_count,
            MAX(te.session) AS latest_evidence_session
          FROM themes t
          LEFT JOIN theme_evidence te ON te.theme_code = t.code
          ${where}
          GROUP BY t.code
          ORDER BY latest_evidence_session DESC, t.code ASC`,
    args,
  })
  return result.rows
}

/**
 * Get a single theme with its evidence and cross-connections.
 * @param {import('@libsql/client').Client} db
 * @param {string} code
 * @returns {Promise<{theme: object, evidence: object[], connections: object[]}|null>}
 */
export async function getThemeWithEvidence(db, code) {
  const themeResult = await db.execute({
    sql: 'SELECT * FROM themes WHERE code = ?',
    args: [code],
  })
  if (themeResult.rows.length === 0) return null

  const [evidenceResult, connectionsResult] = await Promise.all([
    db.execute({
      sql: 'SELECT * FROM theme_evidence WHERE theme_code = ? ORDER BY session DESC',
      args: [code],
    }),
    db.execute({
      sql: 'SELECT * FROM theme_connections WHERE from_code = ? OR to_code = ?',
      args: [code, code],
    }),
  ])

  return {
    theme: themeResult.rows[0],
    evidence: evidenceResult.rows,
    connections: connectionsResult.rows,
  }
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

/**
 * List posts with optional filters.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} [opts.status]
 * @param {string} [opts.priority]
 * @param {string} [opts.format]
 * @returns {Promise<object[]>}
 */
export async function getPosts(db, { status, priority, format } = {}) {
  const conditions = []
  const args = []

  if (status) {
    conditions.push('status = ?')
    args.push(status)
  }
  if (priority) {
    conditions.push('priority = ?')
    args.push(priority)
  }
  if (format) {
    conditions.push('format = ?')
    args.push(format)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const result = await db.execute({
    sql: `SELECT * FROM posts ${where} ORDER BY id DESC`,
    args,
  })
  return result.rows
}

/**
 * Update a post's status. Sets date_published if status='published'. Updates updated_at.
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 * @param {string} newStatus
 * @returns {Promise<object>} updated post
 */
export async function updatePostStatus(db, id, newStatus) {
  const setClauses = ["status = ?", "updated_at = datetime('now')"]
  const args = [newStatus]

  if (newStatus === 'published') {
    setClauses.push("date_published = datetime('now')")
  }

  args.push(id)

  await db.execute({
    sql: `UPDATE posts SET ${setClauses.join(', ')} WHERE id = ?`,
    args,
  })

  const result = await db.execute({
    sql: 'SELECT * FROM posts WHERE id = ?',
    args: [id],
  })
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * List decisions, optionally including archived.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {boolean} [opts.showArchived=false]
 * @returns {Promise<object[]>}
 */
export async function getDecisions(db, { showArchived } = {}) {
  const where = showArchived ? '' : 'WHERE archived = 0'
  const result = await db.execute(`SELECT * FROM decisions ${where} ORDER BY id DESC`)
  return result.rows
}

/**
 * Add a decision with auto-incrementing id per session.
 * ID format: "{session}.{count}" where count starts at 1.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {number} opts.session
 * @param {string} opts.title
 * @param {string} opts.decision
 * @param {string} [opts.reasoning]
 * @returns {Promise<{id: string}>}
 */
export async function addDecision(db, { session, title, decision, reasoning }) {
  // Count existing decisions for this session to determine next count
  const countResult = await db.execute({
    sql: "SELECT COUNT(*) AS cnt FROM decisions WHERE session = ?",
    args: [session],
  })
  const count = Number(countResult.rows[0].cnt) + 1
  const id = `${session}.${count}`

  await db.execute({
    sql: `INSERT INTO decisions (id, session, title, decision, reasoning)
          VALUES (?, ?, ?, ?, ?)`,
    args: [id, session, title, decision, reasoning ?? null],
  })

  return { id }
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Get all counters as a named-key object.
 * @param {import('@libsql/client').Client} db
 * @returns {Promise<{nextSession: number, nextDocument: number, nextPost: number}>}
 */
export async function getCounters(db) {
  const result = await db.execute('SELECT key, value FROM counters')
  const counters = {}
  for (const row of result.rows) {
    counters[row.key] = Number(row.value)
  }
  return counters
}

/**
 * Increment a counter by 1 and return the new value.
 * @param {import('@libsql/client').Client} db
 * @param {string} key
 * @returns {Promise<number>}
 */
export async function incrementCounter(db, key) {
  await db.execute({
    sql: 'UPDATE counters SET value = value + 1 WHERE key = ?',
    args: [key],
  })
  const result = await db.execute({
    sql: 'SELECT value FROM counters WHERE key = ?',
    args: [key],
  })
  return Number(result.rows[0].value)
}

// ---------------------------------------------------------------------------
// Corpus Stats
// ---------------------------------------------------------------------------

/**
 * Get corpus stats from the VIEW.
 * @param {import('@libsql/client').Client} db
 * @returns {Promise<object>}
 */
export async function getCorpusStats(db) {
  const result = await db.execute('SELECT * FROM corpus_stats')
  return result.rows[0]
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search across analysis_entries, themes, and posts.
 * Uses LIKE '%query%' with case-insensitive matching via LOWER().
 * @param {import('@libsql/client').Client} db
 * @param {string} query
 * @returns {Promise<Array<{type: string, id: number|string, title: string, source?: string, match: string}>>}
 */
export async function searchEditorial(db, query) {
  const pattern = `%${query.toLowerCase()}%`

  const [entriesResult, themesResult, postsResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, title, source, summary FROM analysis_entries
            WHERE LOWER(title) LIKE ? OR LOWER(source) LIKE ? OR LOWER(summary) LIKE ?`,
      args: [pattern, pattern, pattern],
    }),
    db.execute({
      sql: `SELECT code, name FROM themes WHERE LOWER(name) LIKE ?`,
      args: [pattern],
    }),
    db.execute({
      sql: `SELECT id, title, core_argument FROM posts
            WHERE LOWER(title) LIKE ? OR LOWER(core_argument) LIKE ?`,
      args: [pattern, pattern],
    }),
  ])

  const results = []

  for (const row of entriesResult.rows) {
    const matchField =
      row.title.toLowerCase().includes(query.toLowerCase()) ? 'title' :
      (row.source || '').toLowerCase().includes(query.toLowerCase()) ? 'source' : 'summary'
    results.push({
      type: 'analysis',
      id: row.id,
      title: row.title,
      source: row.source,
      match: matchField,
    })
  }

  for (const row of themesResult.rows) {
    results.push({
      type: 'theme',
      id: row.code,
      title: row.name,
      match: 'name',
    })
  }

  for (const row of postsResult.rows) {
    const matchField =
      row.title.toLowerCase().includes(query.toLowerCase()) ? 'title' : 'core_argument'
    results.push({
      type: 'post',
      id: row.id,
      title: row.title,
      match: matchField,
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * Get recent activity entries.
 * @param {import('@libsql/client').Client} db
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
export async function getActivity(db, limit = 20) {
  const result = await db.execute({
    sql: 'SELECT * FROM activity ORDER BY timestamp DESC, id DESC LIMIT ?',
    args: [limit],
  })
  return result.rows
}

/**
 * Add an activity entry and prune to keep max 100 entries.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} opts.type
 * @param {string} opts.title
 * @param {string} [opts.detail='']
 */
export async function addActivity(db, { type, title, detail = '' }) {
  await db.execute({
    sql: 'INSERT INTO activity (type, title, detail) VALUES (?, ?, ?)',
    args: [type, title, detail],
  })

  // Prune: keep only the most recent 100 entries
  await db.execute(
    `DELETE FROM activity WHERE id NOT IN (
      SELECT id FROM activity ORDER BY timestamp DESC LIMIT 100
    )`
  )
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Get notifications, optionally including dismissed.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {boolean} [opts.showDismissed=false]
 * @returns {Promise<object[]>}
 */
export async function getNotifications(db, { showDismissed } = {}) {
  const where = showDismissed ? '' : 'WHERE dismissed = 0'
  const result = await db.execute(`SELECT * FROM notifications ${where} ORDER BY timestamp DESC`)
  return result.rows
}

/**
 * Dismiss a notification by id.
 * @param {import('@libsql/client').Client} db
 * @param {string} id
 */
export async function dismissNotification(db, id) {
  await db.execute({
    sql: 'UPDATE notifications SET dismissed = 1 WHERE id = ?',
    args: [id],
  })
}

// ---------------------------------------------------------------------------
// Archive operations
// ---------------------------------------------------------------------------

/**
 * Set archived flag on an analysis entry.
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 * @param {number} archived - 0 or 1
 */
export async function setAnalysisArchived(db, id, archived) {
  await db.execute({
    sql: "UPDATE analysis_entries SET archived = ?, updated_at = datetime('now') WHERE id = ?",
    args: [archived, id],
  })
}

/**
 * Set archived flag on a theme.
 * @param {import('@libsql/client').Client} db
 * @param {string} code
 * @param {number} archived - 0 or 1
 */
export async function setThemeArchived(db, code, archived) {
  await db.execute({
    sql: "UPDATE themes SET archived = ?, updated_at = datetime('now') WHERE code = ?",
    args: [archived, code],
  })
}

/**
 * Set archived flag on a decision.
 * @param {import('@libsql/client').Client} db
 * @param {string} id
 * @param {number} archived - 0 or 1
 */
export async function setDecisionArchived(db, id, archived) {
  await db.execute({
    sql: 'UPDATE decisions SET archived = ? WHERE id = ?',
    args: [archived, id],
  })
}
