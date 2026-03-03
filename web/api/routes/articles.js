import { readFileSync, existsSync } from 'fs'
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
