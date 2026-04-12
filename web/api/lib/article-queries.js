/**
 * article-queries.js — SQL query functions for the articles table.
 *
 * All functions take a libSQL `db` client as first argument.
 * Uses parameterised queries exclusively (no string interpolation).
 */

// ---------------------------------------------------------------------------
// List fields — returned by getArticles, searchArticles, getFlaggedArticles
// Excludes full_text for performance.
// ---------------------------------------------------------------------------
const LIST_FIELDS_ARR = [
  'id', 'slug', 'title', 'url', 'source', 'source_type',
  'date_published', 'date_verified_method', 'date_confidence',
  'sector', 'keywords_matched', 'snippet', 'score', 'confidence',
  'score_reason', 'scraped_at', 'found_by', 'archived', 'flagged',
]
const LIST_FIELDS = LIST_FIELDS_ARR.join(', ')
/** Table-qualified list fields for JOINs (avoids ambiguous column names with FTS). */
const LIST_FIELDS_QUALIFIED = LIST_FIELDS_ARR.map(f => `articles.${f}`).join(', ')

// ---------------------------------------------------------------------------
// insertArticle
// ---------------------------------------------------------------------------

/**
 * Insert a new article. Throws on unique constraint violation.
 * @param {import('@libsql/client').Client} db
 * @param {object} article
 * @returns {Promise<number>} lastInsertRowid
 */
export async function insertArticle(db, article) {
  const result = await db.execute({
    sql: `INSERT INTO articles (
      slug, title, url, source, source_type,
      date_published, date_verified_method, date_confidence,
      sector, keywords_matched, snippet, full_text,
      scraped_at, found_by, score, confidence, score_reason,
      discovery_source, source_episode, ingested_at,
      ainewshub_meta, synced_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, datetime('now')
    )`,
    args: [
      article.slug,
      article.title,
      article.url ?? null,
      article.source ?? null,
      article.source_type,
      article.date_published,
      article.date_verified_method ?? null,
      article.date_confidence ?? null,
      article.sector,
      article.keywords_matched ?? null,
      article.snippet ?? null,
      article.full_text ?? null,
      article.scraped_at ?? null,
      article.found_by ?? null,
      article.score ?? null,
      article.confidence ?? null,
      article.score_reason ?? null,
      article.discovery_source ?? null,
      article.source_episode ?? null,
      article.ingested_at ?? null,
      article.ainewshub_meta ?? null,
    ],
  })
  return Number(result.lastInsertRowid)
}

// ---------------------------------------------------------------------------
// upsertArticle
// ---------------------------------------------------------------------------

/**
 * Check if article exists by (date_published, sector, slug).
 * If exists, merge found_by arrays (union, deduplicated).
 * If not, insert.
 * @param {import('@libsql/client').Client} db
 * @param {object} article
 * @returns {Promise<number>} id of existing or newly inserted row
 */
export async function upsertArticle(db, article) {
  const existing = await db.execute({
    sql: `SELECT id, found_by FROM articles
          WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [article.date_published, article.sector, article.slug],
  })

  if (existing.rows.length > 0) {
    const row = existing.rows[0]
    const existingFoundBy = JSON.parse(row.found_by || '[]')
    const newFoundBy = JSON.parse(article.found_by || '[]')
    const merged = [...new Set([...existingFoundBy, ...newFoundBy])]

    await db.execute({
      sql: `UPDATE articles SET found_by = ?, updated_at = datetime('now'), synced_at = datetime('now')
            WHERE id = ?`,
      args: [JSON.stringify(merged), row.id],
    })
    return Number(row.id)
  }

  return await insertArticle(db, article)
}

// ---------------------------------------------------------------------------
// getArticles
// ---------------------------------------------------------------------------

/**
 * List articles with optional filters and pagination.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} [opts.sector]
 * @param {string} [opts.date] - exact date_published match
 * @param {string} [opts.dateFrom] - date_published >= dateFrom
 * @param {string} [opts.dateTo] - date_published <= dateTo
 * @param {string} [opts.search] - FTS5 MATCH query
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {Promise<{articles: object[], total: number, limit: number, offset: number}>}
 */
export async function getArticles(db, { sector, date, dateFrom, dateTo, search, limit = 100, offset = 0 } = {}) {
  // Search path — uses LIKE for reliability (libsql#1811: parameterised FTS5
  // MATCH crashes in embedded replica mode). LIKE is fast enough for ~10K articles.
  if (search) {
    const pattern = `%${search}%`
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) AS cnt FROM articles
            WHERE deleted_at IS NULL
            AND (title LIKE ? OR source LIKE ? OR snippet LIKE ?)`,
      args: [pattern, pattern, pattern],
    })
    const total = Number(countResult.rows[0].cnt)

    const result = await db.execute({
      sql: `SELECT ${LIST_FIELDS} FROM articles
            WHERE deleted_at IS NULL
            AND (title LIKE ? OR source LIKE ? OR snippet LIKE ?)
            ORDER BY date_published DESC, scraped_at DESC
            LIMIT ? OFFSET ?`,
      args: [pattern, pattern, pattern, limit, offset],
    })

    return { articles: result.rows, total, limit, offset }
  }

  // Standard filter path
  const conditions = ['deleted_at IS NULL']
  const args = []

  if (sector) {
    conditions.push('sector = ?')
    args.push(sector)
  }
  if (date) {
    conditions.push('date_published = ?')
    args.push(date)
  }
  if (dateFrom) {
    conditions.push('date_published >= ?')
    args.push(dateFrom)
  }
  if (dateTo) {
    conditions.push('date_published <= ?')
    args.push(dateTo)
  }

  const where = conditions.join(' AND ')

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS cnt FROM articles WHERE ${where}`,
    args,
  })
  const total = Number(countResult.rows[0].cnt)

  const result = await db.execute({
    sql: `SELECT ${LIST_FIELDS} FROM articles
          WHERE ${where}
          ORDER BY date_published DESC, scraped_at DESC
          LIMIT ? OFFSET ?`,
    args: [...args, limit, offset],
  })

  return { articles: result.rows, total, limit, offset }
}

// ---------------------------------------------------------------------------
// getArticle
// ---------------------------------------------------------------------------

/**
 * Get a single article by (date_published, sector, slug). Returns ALL fields.
 * @param {import('@libsql/client').Client} db
 * @param {string} date - date_published
 * @param {string} sector
 * @param {string} slug
 * @returns {Promise<object|null>}
 */
export async function getArticle(db, date, sector, slug) {
  const result = await db.execute({
    sql: `SELECT * FROM articles
          WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [date, sector, slug],
  })
  return result.rows.length > 0 ? result.rows[0] : null
}

// ---------------------------------------------------------------------------
// getFlaggedArticles
// ---------------------------------------------------------------------------

/**
 * Get all flagged, non-deleted articles.
 * @param {import('@libsql/client').Client} db
 * @returns {Promise<{articles: object[], total: number}>}
 */
export async function getFlaggedArticles(db) {
  const result = await db.execute(
    `SELECT ${LIST_FIELDS}, flag_reason FROM articles
     WHERE flagged = 1 AND deleted_at IS NULL
     ORDER BY date_published DESC`
  )
  return { articles: result.rows, total: result.rows.length }
}

// ---------------------------------------------------------------------------
// getArticleCounts
// ---------------------------------------------------------------------------

/**
 * Aggregate article counts.
 * @param {import('@libsql/client').Client} db
 * @param {object} opts
 * @param {string} [opts.scrapedSince] - for weekArticles filter
 * @returns {Promise<object>}
 */
export async function getArticleCounts(db, { scrapedSince } = {}) {
  const todayStr = new Date().toISOString().slice(0, 10)

  const [totalResult, todayResult, byDateResult, bySectorResult, byDateBySectorResult] = await Promise.all([
    db.execute('SELECT COUNT(*) AS cnt FROM articles WHERE deleted_at IS NULL AND flagged = 0'),
    db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM articles WHERE scraped_at >= ? AND deleted_at IS NULL',
      args: [todayStr],
    }),
    db.execute(
      `SELECT date_published AS date, COUNT(*) AS count FROM articles
       WHERE deleted_at IS NULL AND flagged = 0
       GROUP BY date_published ORDER BY date_published DESC`
    ),
    db.execute(
      `SELECT sector, COUNT(*) AS count FROM articles
       WHERE deleted_at IS NULL AND flagged = 0
       GROUP BY sector ORDER BY sector`
    ),
    db.execute(
      `SELECT date_published AS date, sector, COUNT(*) AS count FROM articles
       WHERE deleted_at IS NULL AND flagged = 0
       GROUP BY date_published, sector ORDER BY date_published DESC, sector`
    ),
  ])

  const result = {
    total: Number(totalResult.rows[0].cnt),
    today: Number(todayResult.rows[0].cnt),
    byDate: byDateResult.rows.map(r => ({ date: r.date, count: Number(r.count) })),
    bySector: bySectorResult.rows.map(r => ({ sector: r.sector, count: Number(r.count) })),
    byDateBySector: byDateBySectorResult.rows.map(r => ({
      date: r.date, sector: r.sector, count: Number(r.count),
    })),
  }

  // weekArticles — same structure but filtered by scraped_at >= scrapedSince
  if (scrapedSince) {
    const [weekTotal, weekByDate, weekBySector, weekByDateBySector] = await Promise.all([
      db.execute({
        sql: 'SELECT COUNT(*) AS cnt FROM articles WHERE scraped_at >= ? AND deleted_at IS NULL AND flagged = 0',
        args: [scrapedSince],
      }),
      db.execute({
        sql: `SELECT date_published AS date, COUNT(*) AS count FROM articles
              WHERE scraped_at >= ? AND deleted_at IS NULL AND flagged = 0
              GROUP BY date_published ORDER BY date_published DESC`,
        args: [scrapedSince],
      }),
      db.execute({
        sql: `SELECT sector, COUNT(*) AS count FROM articles
              WHERE scraped_at >= ? AND deleted_at IS NULL AND flagged = 0
              GROUP BY sector ORDER BY sector`,
        args: [scrapedSince],
      }),
      db.execute({
        sql: `SELECT date_published AS date, sector, COUNT(*) AS count FROM articles
              WHERE scraped_at >= ? AND deleted_at IS NULL AND flagged = 0
              GROUP BY date_published, sector ORDER BY date_published DESC, sector`,
        args: [scrapedSince],
      }),
    ])

    result.weekArticles = {
      total: Number(weekTotal.rows[0].cnt),
      byDate: weekByDate.rows.map(r => ({ date: r.date, count: Number(r.count) })),
      bySector: weekBySector.rows.map(r => ({ sector: r.sector, count: Number(r.count) })),
      byDateBySector: weekByDateBySector.rows.map(r => ({
        date: r.date, sector: r.sector, count: Number(r.count),
      })),
    }
  } else {
    result.weekArticles = null
  }

  return result
}

// ---------------------------------------------------------------------------
// searchArticles
// ---------------------------------------------------------------------------

/**
 * Search articles by title, source, or snippet.
 * Uses LIKE instead of FTS5 MATCH to avoid libsql#1811 (parameterised MATCH
 * crashes in embedded replica mode). LIKE is fast enough for ~10K articles.
 * @param {import('@libsql/client').Client} db
 * @param {string} query - search term
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function searchArticles(db, query, limit = 50) {
  const pattern = `%${query}%`
  const result = await db.execute({
    sql: `SELECT ${LIST_FIELDS} FROM articles
          WHERE deleted_at IS NULL
          AND (title LIKE ? OR source LIKE ? OR snippet LIKE ?)
          ORDER BY date_published DESC
          LIMIT ?`,
    args: [pattern, pattern, pattern, limit],
  })
  return result.rows
}

// ---------------------------------------------------------------------------
// updateArticle
// ---------------------------------------------------------------------------

/**
 * Dynamic update of article fields.
 * @param {import('@libsql/client').Client} db
 * @param {string} date - date_published
 * @param {string} sector
 * @param {string} slug
 * @param {object} updates - field:value pairs to SET
 */
export async function updateArticle(db, date, sector, slug, updates) {
  const keys = Object.keys(updates)
  if (keys.length === 0) return

  const setClauses = keys.map(k => `${k} = ?`)
  setClauses.push("updated_at = datetime('now')")

  const args = [...keys.map(k => updates[k]), date, sector, slug]

  await db.execute({
    sql: `UPDATE articles SET ${setClauses.join(', ')}
          WHERE date_published = ? AND sector = ? AND slug = ?`,
    args,
  })
}

// ---------------------------------------------------------------------------
// flagArticle
// ---------------------------------------------------------------------------

/**
 * Flag an article for editorial review.
 * @param {import('@libsql/client').Client} db
 * @param {string} date - date_published
 * @param {string} sector
 * @param {string} slug
 * @param {string} reason
 */
export async function flagArticle(db, date, sector, slug, reason) {
  await db.execute({
    sql: `UPDATE articles SET flagged = 1, flag_reason = ?, updated_at = datetime('now')
          WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [reason, date, sector, slug],
  })
}

// ---------------------------------------------------------------------------
// deleteArticle
// ---------------------------------------------------------------------------

/**
 * Soft-delete an article (sets deleted_at).
 * @param {import('@libsql/client').Client} db
 * @param {string} date - date_published
 * @param {string} sector
 * @param {string} slug
 */
export async function deleteArticle(db, date, sector, slug) {
  await db.execute({
    sql: `UPDATE articles SET deleted_at = datetime('now')
          WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [date, sector, slug],
  })
}

// ---------------------------------------------------------------------------
// getPublications
// ---------------------------------------------------------------------------

/**
 * Get distinct source names from non-deleted articles.
 * @param {import('@libsql/client').Client} db
 * @returns {Promise<string[]>}
 */
export async function getPublications(db) {
  const result = await db.execute(
    `SELECT DISTINCT source FROM articles
     WHERE source IS NOT NULL AND deleted_at IS NULL
     ORDER BY source`
  )
  return result.rows.map(r => r.source)
}
