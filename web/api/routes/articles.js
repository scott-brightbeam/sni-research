import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getArticles({ sector, date, week, search } = {}) {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { articles: [], total: 0 }

  const articles = []
  const dates = readdirSync(verifiedDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  for (const d of dates) {
    if (date && d !== date) continue

    const datePath = join(verifiedDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      if (sector && s !== sector) continue

      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          const slug = basename(f, '.json')

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
            source_type: raw.source_type
          }

          if (search) {
            const hay = `${article.title} ${article.source} ${article.snippet}`.toLowerCase()
            if (!hay.includes(search.toLowerCase())) continue
          }

          articles.push(article)
        } catch { /* skip malformed files */ }
      }
    }
  }

  return { articles, total: articles.length }
}

export async function getArticle(date, sector, slug) {
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
  const reviewDir = join(ROOT, 'data/review')
  if (!existsSync(reviewDir)) return { articles: [], total: 0 }

  const articles = []
  const dates = readdirSync(reviewDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  for (const d of dates) {
    const datePath = join(reviewDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          const slug = basename(f, '.json')

          // Check for reason file
          const reasonPath = join(sectorPath, `${slug}-reason.txt`)
          const reason = existsSync(reasonPath)
            ? readFileSync(reasonPath, 'utf-8').trim()
            : null

          articles.push({
            slug,
            title: raw.title,
            url: raw.url,
            source: raw.source,
            sector: raw.sector || s,
            date_published: raw.date_published || d,
            score: raw.score ?? null,
            reason,
            flagged: true
          })
        } catch { /* skip */ }
      }
    }
  }

  return { articles, total: articles.length }
}
