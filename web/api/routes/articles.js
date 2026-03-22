import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { walkArticleDir, validateParam } from '../lib/walk.js'

const ROOT = resolve(import.meta.dir, '../../..')
const INGEST_URL = 'http://127.0.0.1:3847'

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
