import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { walkArticleDir, validateParam } from '../lib/walk.js'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getArticles({ sector, date, search, limit, offset } = {}) {
  const allMatched = []

  walkArticleDir('verified', (raw, { date: d, sector: s, slug }) => {
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
      source_type: raw.source_type,
    }

    if (search) {
      const hay = `${article.title} ${article.source} ${article.snippet}`.toLowerCase()
      if (!hay.includes(search.toLowerCase())) return
    }

    allMatched.push(article)
  }, { sector, date })

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
