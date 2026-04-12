import { validateParam } from '../lib/walk.js'
import { getDb } from '../lib/db.js'
import * as articleQueries from '../lib/article-queries.js'

const INGEST_URL = 'http://127.0.0.1:3847'

export async function getArticles({ sector, date, from, to, search, limit, offset } = {}) {
  const db = getDb()
  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
  const off = Math.max(parseInt(offset) || 0, 0)

  const result = await articleQueries.getArticles(db, {
    sector,
    date,
    dateFrom: from,
    dateTo: to,
    search,
    limit: lim,
    offset: off,
  })

  // Parse JSON text fields back to arrays/objects for UI compatibility
  result.articles = result.articles.map(normaliseArticleRow)

  return result
}

export async function getArticle(date, sector, slug) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const db = getDb()
  const row = await articleQueries.getArticle(db, date, sector, slug)
  if (!row) return null

  return normaliseArticleRow(row)
}

export async function getFlaggedArticles() {
  const db = getDb()
  const result = await articleQueries.getFlaggedArticles(db)

  result.articles = result.articles.map(row => {
    const normalised = normaliseArticleRow(row)
    // Map flag_reason → reason for UI compatibility
    normalised.reason = row.flag_reason ?? null
    return normalised
  })

  return result
}

export async function patchArticle(date, sector, slug, body) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const db = getDb()

  // Check article exists
  const existing = await articleQueries.getArticle(db, date, sector, slug)
  if (!existing) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  const result = { article: normaliseArticleRow(existing) }

  // Track effective sector — may change during sector move
  let effectiveSector = sector

  // Handle flagging
  if (body.flagged === true) {
    await articleQueries.flagArticle(db, date, effectiveSector, slug, body.reason || '')
    result.article.flagged = 1
  } else if (body.flagged === false) {
    await articleQueries.updateArticle(db, date, effectiveSector, slug, { flagged: 0, flag_reason: null })
    result.article.flagged = 0
  }

  // Handle sector move
  if (body.sector && body.sector !== sector) {
    validateParam(body.sector, 'sector')

    // Check destination doesn't already exist
    const destExists = await articleQueries.getArticle(db, date, body.sector, slug)
    if (destExists) {
      const err = new Error(`An article with this name already exists in ${body.sector}`)
      err.status = 409
      throw err
    }

    await articleQueries.updateArticle(db, date, effectiveSector, slug, { sector: body.sector })
    effectiveSector = body.sector

    result.article.sector = body.sector
    result.moved = {
      from: `data/verified/${date}/${sector}/${slug}.json`,
      to: `data/verified/${date}/${body.sector}/${slug}.json`,
    }
  }

  // Handle archive
  if (body.archived !== undefined) {
    await articleQueries.updateArticle(db, date, effectiveSector, slug, { archived: body.archived ? 1 : 0 })
    result.article.archived = body.archived ? 1 : 0
  }

  return result
}

export async function deleteArticle(date, sector, slug) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const db = getDb()

  // Check article exists
  const existing = await articleQueries.getArticle(db, date, sector, slug)
  if (!existing) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  await articleQueries.deleteArticle(db, date, sector, slug)

  return { deleted: true }
}

export async function ingestArticle(body) {
  if (!body.url || typeof body.url !== 'string') {
    throw new Error('Missing or invalid url')
  }

  try {
    new URL(body.url)
  } catch {
    throw new Error('Invalid url format')
  }

  const payload = { url: body.url }
  if (body.sectorOverride) payload.sectorOverride = body.sectorOverride

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${INGEST_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const data = await res.json()

    if (!res.ok) {
      const err = new Error(data.error || `Ingest server error ${res.status}`)
      err.status = res.status
      throw err
    }

    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout_err = new Error('Ingest request timed out after 30s')
      timeout_err.status = 504
      throw timeout_err
    }
    if (err.status) throw err
    const conn_err = new Error('Ingest server unavailable')
    conn_err.status = 503
    throw conn_err
  } finally {
    clearTimeout(timeout)
  }
}

export async function getLastUpdated() {
  const db = getDb()
  const result = await db.execute(
    'SELECT MAX(scraped_at) AS latest FROM articles WHERE deleted_at IS NULL'
  )
  const latest = result.rows[0]?.latest
  // Convert ISO string to epoch ms for compatibility
  const timestamp = latest ? new Date(latest).getTime() : 0
  return { timestamp }
}

export async function getPublications() {
  const db = getDb()
  return await articleQueries.getPublications(db)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise a DB row for API response.
 * - Parses JSON text columns (keywords_matched, found_by) back to arrays
 * - Preserves all other fields as-is
 */
function normaliseArticleRow(row) {
  const article = { ...row }

  // keywords_matched: stored as JSON text in DB, UI expects array
  if (typeof article.keywords_matched === 'string') {
    try { article.keywords_matched = JSON.parse(article.keywords_matched) }
    catch { article.keywords_matched = [] }
  }
  if (article.keywords_matched == null) article.keywords_matched = []

  // found_by: stored as JSON text in DB, UI may expect array
  if (typeof article.found_by === 'string') {
    try { article.found_by = JSON.parse(article.found_by) }
    catch { article.found_by = [] }
  }

  // ainewshub_meta: stored as JSON text
  if (typeof article.ainewshub_meta === 'string') {
    try { article.ainewshub_meta = JSON.parse(article.ainewshub_meta) }
    catch { article.ainewshub_meta = null }
  }

  return article
}

// Alias for server.js import compatibility
export { ingestArticle as manualIngest }
