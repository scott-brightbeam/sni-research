import { describe, it, expect } from 'bun:test'
import { getArticles, getArticle } from './routes/articles.js'

describe('getArticles', () => {
  it('returns an array of articles', async () => {
    const result = await getArticles({})
    expect(Array.isArray(result.articles)).toBe(true)
  })

  it('articles have required fields', async () => {
    const { articles } = await getArticles({})
    if (articles.length > 0) {
      const a = articles[0]
      expect(a).toHaveProperty('title')
      expect(a).toHaveProperty('url')
      expect(a).toHaveProperty('sector')
      expect(a).toHaveProperty('date_published')
      expect(a).toHaveProperty('slug')
    }
  })

  it('filters by sector', async () => {
    const { articles } = await getArticles({ sector: 'general' })
    for (const a of articles) {
      expect(a.sector).toBe('general')
    }
  })

  it('filters by date', async () => {
    const { articles } = await getArticles({ date: '2026-03-02' })
    for (const a of articles) {
      expect(a.date_published).toBe('2026-03-02')
    }
  })
})

describe('getArticle', () => {
  it('returns null for non-existent article', async () => {
    const result = await getArticle('9999-01-01', 'general', 'nonexistent')
    expect(result).toBeNull()
  })
})
