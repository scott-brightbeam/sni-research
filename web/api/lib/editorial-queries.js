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
          ORDER BY t.created_at DESC, t.code DESC`,
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

  const [entriesResult, themesResult, themesByEvidenceResult, postsResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, title, source, summary FROM analysis_entries
            WHERE LOWER(title) LIKE ? OR LOWER(source) LIKE ? OR LOWER(summary) LIKE ?
              OR LOWER(host) LIKE ? OR LOWER(key_themes) LIKE ? OR LOWER(themes) LIKE ?`,
      args: [pattern, pattern, pattern, pattern, pattern, pattern],
    }),
    db.execute({
      sql: `SELECT code, name FROM themes WHERE LOWER(name) LIKE ?`,
      args: [pattern],
    }),
    db.execute({
      sql: `SELECT DISTINCT theme_code FROM theme_evidence WHERE LOWER(content) LIKE ?`,
      args: [pattern],
    }),
    db.execute({
      sql: `SELECT id, title, core_argument FROM posts
            WHERE LOWER(title) LIKE ? OR LOWER(core_argument) LIKE ?
              OR LOWER(notes) LIKE ? OR LOWER(format) LIKE ? OR LOWER(source_documents) LIKE ?`,
      args: [pattern, pattern, pattern, pattern, pattern],
    }),
  ])

  const results = []

  for (const row of entriesResult.rows) {
    const q = query.toLowerCase()
    const matchField =
      (row.title || '').toLowerCase().includes(q) ? 'title' :
      (row.source || '').toLowerCase().includes(q) ? 'source' :
      (row.summary || '').toLowerCase().includes(q) ? 'summary' : 'other'
    results.push({
      type: 'analysis',
      id: row.id,
      title: row.title,
      source: row.source,
      match: matchField,
    })
  }

  const addedThemeCodes = new Set()
  for (const row of themesResult.rows) {
    addedThemeCodes.add(row.code)
    results.push({
      type: 'theme',
      id: row.code,
      title: row.name,
      match: 'name',
    })
  }

  // Themes found via evidence content search (avoid duplicates)
  for (const row of themesByEvidenceResult.rows) {
    if (!addedThemeCodes.has(row.theme_code)) {
      addedThemeCodes.add(row.theme_code)
      results.push({
        type: 'theme',
        id: row.theme_code,
        title: row.theme_code,
        match: 'evidence',
      })
    }
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

// ---------------------------------------------------------------------------
// Single-row lookups
// ---------------------------------------------------------------------------

/**
 * Get a single post by id.
 * @param {import('@libsql/client').Client} db
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
export async function getPost(db, id) {
  const result = await db.execute({ sql: 'SELECT * FROM posts WHERE id = ?', args: [id] })
  return result.rows[0] || null
}

/**
 * Get a single article by id.
 * @param {import('@libsql/client').Client} db
 * @param {number|string} id
 * @returns {Promise<object|null>}
 */
export async function getArticle(db, id) {
  const result = await db.execute({ sql: 'SELECT * FROM articles WHERE id = ?', args: [id] })
  return result.rows[0] || null
}

// ---------------------------------------------------------------------------
// Article search
// ---------------------------------------------------------------------------

/**
 * Search articles by keyword with optional filters.
 * Searches title, snippet, source using LIKE (case-insensitive via LOWER).
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} [opts.sector]
 * @param {string} [opts.dateFrom]
 * @param {string} [opts.dateTo]
 * @param {string} [opts.sourceType]
 * @returns {Promise<object[]>}
 */
export async function searchArticles(db, { query, sector, dateFrom, dateTo, sourceType } = {}) {
  const pattern = `%${(query || '').toLowerCase()}%`
  const conditions = [
    '(LOWER(title) LIKE ? OR LOWER(snippet) LIKE ? OR LOWER(source) LIKE ?)',
  ]
  const args = [pattern, pattern, pattern]

  if (sector) {
    conditions.push('sector = ?')
    args.push(sector)
  }
  if (dateFrom) {
    conditions.push('date_published >= ?')
    args.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('date_published <= ?')
    args.push(dateTo)
  }
  if (sourceType) {
    conditions.push('source_type = ?')
    args.push(sourceType)
  }

  const where = conditions.join(' AND ')
  const result = await db.execute({
    sql: `SELECT * FROM articles WHERE ${where} ORDER BY date_published DESC LIMIT 20`,
    args,
  })
  return result.rows
}

// ---------------------------------------------------------------------------
// Podcast search
// ---------------------------------------------------------------------------

/**
 * Search episodes with story count, using keyword match on headline/title/summary.
 * JOINs episodes with episode_stories for story count.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} [opts.source]
 * @param {string} [opts.dateFrom]
 * @param {string} [opts.dateTo]
 * @returns {Promise<object[]>}
 */
export async function searchPodcasts(db, { query, source, dateFrom, dateTo } = {}) {
  const pattern = `%${(query || '').toLowerCase()}%`
  const conditions = [
    `(LOWER(e.title) LIKE ? OR LOWER(e.summary) LIKE ? OR e.id IN (
      SELECT es.episode_id FROM episode_stories es WHERE LOWER(es.headline) LIKE ?
    ))`,
  ]
  const args = [pattern, pattern, pattern]

  if (source) {
    conditions.push('LOWER(e.source) LIKE ?')
    args.push(`%${source.toLowerCase()}%`)
  }
  if (dateFrom) {
    conditions.push('e.date >= ?')
    args.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('e.date <= ?')
    args.push(dateTo)
  }

  const where = conditions.join(' AND ')
  const result = await db.execute({
    sql: `SELECT e.*, COUNT(es.id) AS story_count
          FROM episodes e
          LEFT JOIN episode_stories es ON es.episode_id = e.id
          WHERE ${where}
          GROUP BY e.id
          ORDER BY e.date DESC
          LIMIT 20`,
    args,
  })
  return result.rows
}

// ---------------------------------------------------------------------------
// Full podcast episode with stories + transcript
// ---------------------------------------------------------------------------

/**
 * Get a podcast episode by id, including its stories and transcript.
 * Transcript is looked up by matching the episode's filename against
 * analysis_entries.filename to retrieve analysis_entries.transcript.
 * @param {import('@libsql/client').Client} db
 * @param {number|string} id
 * @returns {Promise<{episode: object, stories: object[], transcript: string|null}|null>}
 */
export async function getPodcastEpisode(db, id) {
  const epResult = await db.execute({
    sql: 'SELECT * FROM episodes WHERE id = ?',
    args: [id],
  })
  if (epResult.rows.length === 0) return null

  const episode = epResult.rows[0]

  const [storiesResult, transcriptResult] = await Promise.all([
    db.execute({
      sql: 'SELECT * FROM episode_stories WHERE episode_id = ? ORDER BY id',
      args: [id],
    }),
    // Match filename to find the analysis entry's transcript
    episode.filename
      ? db.execute({
          sql: 'SELECT transcript FROM analysis_entries WHERE filename = ? LIMIT 1',
          args: [episode.filename],
        })
      : Promise.resolve({ rows: [] }),
  ])

  return {
    episode,
    stories: storiesResult.rows,
    transcript: transcriptResult.rows[0]?.transcript || null,
  }
}

// ---------------------------------------------------------------------------
// Published Posts (Scott's writing reference corpus)
// ---------------------------------------------------------------------------

/**
 * Search published posts by keyword.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} [opts.query]
 * @param {string} [opts.category] — 'article', 'newsletter', 'series', 'awards'
 * @param {number} [opts.limit=10]
 * @returns {Promise<object[]>}
 */
export async function searchPublishedPosts(db, { query, category, limit = 10 } = {}) {
  const conditions = []
  const args = []

  if (query) {
    conditions.push('(LOWER(title) LIKE ? OR LOWER(body) LIKE ?)')
    const p = `%${query.toLowerCase()}%`
    args.push(p, p)
  }
  if (category) {
    conditions.push('category = ?')
    args.push(category)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  args.push(limit)

  const result = await db.execute({
    sql: `SELECT id, title, slug, date_published, category, word_count,
            SUBSTR(body, 1, 300) AS excerpt
          FROM published_posts ${where}
          ORDER BY date_published DESC
          LIMIT ?`,
    args,
  })
  return result.rows
}

/**
 * Get a single published post by ID with full body.
 * @param {import('@libsql/client').Client} db
 * @param {number} id
 * @returns {Promise<object|null>}
 */
export async function getPublishedPost(db, id) {
  const result = await db.execute({
    sql: 'SELECT * FROM published_posts WHERE id = ?',
    args: [id],
  })
  return result.rows[0] || null
}
