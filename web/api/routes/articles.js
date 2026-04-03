import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { walkArticleDir, validateParam } from '../lib/walk.js'
import config from '../lib/config.js'

const ROOT = config.ROOT
const INGEST_URL = config.INGEST_URL

export async function getArticles({ sector, date, dateFrom, dateTo, search, limit, offset } = {}) {
  const allMatched = []

  function collectArticle(raw, { date: d, sector: s, slug }, sourceType) {
    const article = {
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
    }

    if (search) {
      const hay = `${article.title} ${article.source} ${article.snippet}`.toLowerCase()
      if (!hay.includes(search.toLowerCase())) return
    }

    allMatched.push(article)
  }

  walkArticleDir('verified', (raw, meta) => {
    collectArticle(raw, meta, raw.source_type)
  }, { sector, date, dateFrom, dateTo })

  walkArticleDir('podcast-articles', (raw, meta) => {
    collectArticle(raw, meta, 'podcast-extract')
  }, { sector, date, dateFrom, dateTo })

  // Newest first — sort by date_published descending, then scraped_at as tiebreaker
  allMatched.sort((a, b) => (b.date_published || '').localeCompare(a.date_published || '')
    || (b.scraped_at || '').localeCompare(a.scraped_at || ''))

  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
  const off = Math.max(parseInt(offset) || 0, 0)

  return {
    articles: allMatched.slice(off, off + lim),
    total: allMatched.length,
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

  walkArticleDir('review', (raw, { date, sector, slug, sectorPath }) => {
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
