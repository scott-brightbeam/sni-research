import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { walkArticleDir, walkArticleDirAsync, validateParam } from '../lib/walk.js'
import config from '../lib/config.js'

const ROOT = config.ROOT
const INGEST_URL = config.INGEST_URL

// Stale-while-revalidate cache for the full article corpus. Walking 4576
// articles on Fly's persistent volume takes ~16s+ per full scan. 5-minute TTL,
// serve stale during refresh, filter + paginate in-memory per request.
// Tests skip the cache (they create fixtures between calls and expect fresh reads).
const ARTICLES_CACHE_TTL_MS = 5 * 60_000
let _articlesCache = null
let _articlesCacheAt = 0
let _articlesInflight = null

function buildCollector() {
  const all = []
  const collect = (raw, { date: d, sector: s, slug }, sourceType) => {
    all.push({
      slug,
      title: raw.title,
      url: raw.url,
      source: raw.source,
      sector: raw.sector || s,
      date_published: raw.date_published || d,
      date_confidence: raw.date_confidence,
      date_verified_method: raw.date_verified_method,
      snippet: raw.snippet || (raw.full_text || '').slice(0, 300),
      score: raw.score ?? null,
      keywords_matched: raw.keywords_matched || [],
      scraped_at: raw.scraped_at,
      source_type: sourceType || raw.source_type,
    })
  }
  return { all, collect }
}

async function loadAllArticles(walkerOpts = {}) {
  const { all, collect } = buildCollector()
  await walkArticleDirAsync('verified', (raw, meta) => collect(raw, meta, raw.source_type), walkerOpts)
  await walkArticleDirAsync('podcast-articles', (raw, meta) => collect(raw, meta, 'podcast-extract'), walkerOpts)
  // Newest first — sort once, filter + paginate per request
  all.sort((a, b) => (b.date_published || '').localeCompare(a.date_published || '')
    || (b.scraped_at || '').localeCompare(a.scraped_at || ''))
  return all
}

async function refreshArticlesCache() {
  try {
    const result = await loadAllArticles()
    _articlesCache = result
    _articlesCacheAt = Date.now()
    return result
  } finally {
    _articlesInflight = null
  }
}

async function getAllArticlesCached() {
  if (process.env.SNI_TEST_MODE === '1') return loadAllArticles()

  const now = Date.now()

  // Fresh cache
  if (_articlesCache && (now - _articlesCacheAt) < ARTICLES_CACHE_TTL_MS) {
    return _articlesCache
  }

  // Stale cache: return stale now, refresh in background
  if (_articlesCache) {
    if (!_articlesInflight) {
      _articlesInflight = refreshArticlesCache()
      _articlesInflight.catch(err => console.error('[articles] background refresh failed:', err.message))
    }
    return _articlesCache
  }

  // Cold start
  if (!_articlesInflight) {
    _articlesInflight = refreshArticlesCache()
  }
  return _articlesInflight
}

export function invalidateArticlesCache() {
  _articlesCache = null
  _articlesCacheAt = 0
}

export async function getArticles({ sector, date, dateFrom, dateTo, search, limit, offset } = {}) {
  // Two paths:
  // - Cache on (production): load the full corpus once per TTL, filter in memory
  // - Cache off (tests): walk with filters passed through so we skip irrelevant
  //   date directories. Avoids re-scanning 4576 articles for every test call.
  const useCache = process.env.SNI_TEST_MODE !== '1'
  const all = useCache
    ? await getAllArticlesCached()
    : await loadAllArticles({ sector, date, dateFrom, dateTo })

  const searchLower = search ? search.toLowerCase() : null
  const matched = all.filter(a => {
    if (sector && a.sector !== sector) return false
    const pubDate = a.date_published
    if (date && pubDate !== date) return false
    if (dateFrom && pubDate && pubDate < dateFrom) return false
    if (dateTo && pubDate && pubDate > dateTo) return false
    if (searchLower) {
      const hay = `${a.title || ''} ${a.source || ''} ${a.snippet || ''}`.toLowerCase()
      if (!hay.includes(searchLower)) return false
    }
    return true
  })

  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
  const off = Math.max(parseInt(offset) || 0, 0)

  return {
    articles: matched.slice(off, off + lim),
    total: matched.length,
    limit: lim,
    offset: off,
  }
}

export async function getArticle(date, sector, slug) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) return null

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return {
      slug,
      ...raw,
      // Include full_text for detail view
      full_text: raw.full_text || ''
    }
  } catch {
    return null
  }
}

export async function getFlaggedArticles() {
  const articles = []

  await walkArticleDirAsync('review', (raw, { date, sector, slug, sectorPath }) => {
    const reasonPath = join(sectorPath, `${slug}-reason.txt`)
    const reason = existsSync(reasonPath)
      ? readFileSync(reasonPath, 'utf-8').trim()
      : null

    articles.push({
      slug,
      title: raw.title,
      url: raw.url,
      source: raw.source,
      sector: raw.sector || sector,
      date_published: raw.date_published || date,
      score: raw.score ?? null,
      reason,
      flagged: true,
    })
  })

  // Newest first
  articles.sort((a, b) => (b.date_published || '').localeCompare(a.date_published || ''))

  return { articles, total: articles.length }
}

export async function patchArticle(date, sector, slug, body) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  const result = { article: { slug, ...raw } }

  // Handle flagging
  if (body.flagged === true) {
    const reviewDir = join(ROOT, 'data/review', date, sector)
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(join(reviewDir, `${slug}.json`), JSON.stringify(raw, null, 2))
  } else if (body.flagged === false) {
    const reviewPath = join(ROOT, 'data/review', date, sector, `${slug}.json`)
    if (existsSync(reviewPath)) rmSync(reviewPath)
  }

  // Handle sector move
  if (body.sector && body.sector !== sector) {
    validateParam(body.sector, 'sector')
    const destDir = join(ROOT, 'data/verified', date, body.sector)
    const destPath = join(destDir, `${slug}.json`)

    if (existsSync(destPath)) {
      const err = new Error(`An article with this name already exists in ${body.sector}`)
      err.status = 409
      throw err
    }

    mkdirSync(destDir, { recursive: true })
    raw.sector = body.sector
    writeFileSync(destPath, JSON.stringify(raw, null, 2))
    rmSync(filePath)

    // Also move review copy if flagged
    const oldReview = join(ROOT, 'data/review', date, sector, `${slug}.json`)
    if (existsSync(oldReview)) {
      const newReviewDir = join(ROOT, 'data/review', date, body.sector)
      mkdirSync(newReviewDir, { recursive: true })
      writeFileSync(join(newReviewDir, `${slug}.json`), JSON.stringify(raw, null, 2))
      rmSync(oldReview)
    }

    result.article.sector = body.sector
    result.moved = {
      from: `data/verified/${date}/${sector}/${slug}.json`,
      to: `data/verified/${date}/${body.sector}/${slug}.json`,
    }
  }

  // Handle archive toggle
  if (body.archived === true) {
    raw.archived = true
    writeFileSync(filePath, JSON.stringify(raw, null, 2))
    result.article.archived = true
  } else if (body.archived === false) {
    delete raw.archived
    writeFileSync(filePath, JSON.stringify(raw, null, 2))
    delete result.article.archived
  }

  return result
}

export async function deleteArticle(date, sector, slug) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  raw.deleted_at = new Date().toISOString()

  // Move to data/deleted/
  const deletedDir = join(ROOT, 'data/deleted', date, sector)
  mkdirSync(deletedDir, { recursive: true })
  writeFileSync(join(deletedDir, `${slug}.json`), JSON.stringify(raw, null, 2))
  rmSync(filePath)

  // Also remove from review if flagged
  const reviewPath = join(ROOT, 'data/review', date, sector, `${slug}.json`)
  if (existsSync(reviewPath)) rmSync(reviewPath)

  return { deleted: true, path: `data/deleted/${date}/${sector}/${slug}.json` }
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

export async function getPublications() {
  const sources = new Set()
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { publications: [] }

  for (const dateDir of readdirSync(verifiedDir)) {
    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sectorDir of readdirSync(datePath)) {
      const sectorPath = join(datePath, sectorDir)
      if (!statSync(sectorPath).isDirectory()) continue
      for (const file of readdirSync(sectorPath)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          if (raw.source) sources.add(raw.source)
        } catch { /* skip malformed */ }
      }
    }
  }

  return { publications: [...sources].sort((a, b) => a.localeCompare(b)) }
}

export async function manualIngest(body) {
  const { title, content, source, sector, url, date_published } = body || {}

  if (!title || !title.trim()) {
    const err = new Error('Title is required')
    err.status = 400
    throw err
  }
  if (!content || !content.trim()) {
    const err = new Error('Content is required')
    err.status = 400
    throw err
  }

  const dateStr = date_published || new Date().toISOString().split('T')[0]
  const sectorStr = (sector || 'general').toLowerCase()
  validateParam(sectorStr, 'sector')

  // Generate slug: lowercase, replace non-alphanum with hyphens, max 80 chars
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const article = {
    title: title.trim(),
    url: url || null,
    source: source || null,
    source_type: 'manual',
    date_published: dateStr,
    date_confidence: 'high',
    date_verified_method: 'manual',
    sector: sectorStr,
    keywords_matched: [],
    snippet: content.trim().slice(0, 500),
    full_text: content.trim(),
    found_by: ['manual-ingest'],
    scraped_at: null,
    ingested_at: new Date().toISOString(),
    score: null,
    score_reason: null,
  }

  const destDir = join(ROOT, 'data/verified', dateStr, sectorStr)
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, `${slug}.json`)
  writeFileSync(destPath, JSON.stringify(article, null, 2))

  const relPath = `data/verified/${dateStr}/${sectorStr}/${slug}.json`
  return { article, path: relPath }
}

export async function getLastUpdated() {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { timestamp: 0 }

  let maxMtime = 0

  const dates = readdirSync(verifiedDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  for (const d of dates) {
    const datePath = join(verifiedDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath)
    for (const s of sectors) {
      const sectorPath = join(datePath, s)
      try {
        const mtime = statSync(sectorPath).mtimeMs
        if (mtime > maxMtime) maxMtime = mtime
      } catch { /* skip */ }
    }
  }

  return { timestamp: maxMtime }
}
