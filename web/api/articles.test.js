import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getArticles, getArticle } from './routes/articles.js'

const ROOT = resolve(import.meta.dir, '../..')

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

describe('podcast-articles integration', () => {
  const podcastDir = join(ROOT, 'data/podcast-articles/2029-01-01/general-ai')
  let cleanupDir = false

  beforeAll(() => {
    if (!existsSync(podcastDir)) {
      mkdirSync(podcastDir, { recursive: true })
      cleanupDir = true
    }

    writeFileSync(join(podcastDir, 'podcast-test-article.json'), JSON.stringify({
      title: 'AI Podcast Episode Discussion',
      url: 'https://example.com/podcast/ep1',
      source: 'Test Podcast',
      sector: 'general-ai',
      date_published: '2029-01-01',
      snippet: 'A discussion about AI developments',
      score: 0.85,
      keywords_matched: ['artificial intelligence'],
      scraped_at: '2029-01-01T10:00:00Z',
    }))

    writeFileSync(join(podcastDir, 'podcast-test-article-2.json'), JSON.stringify({
      title: 'Another Podcast Extract',
      url: 'https://example.com/podcast/ep2',
      source: 'Test Podcast 2',
      sector: 'general-ai',
      date_published: '2029-01-01',
      snippet: 'More AI news from podcasts',
      score: 0.7,
      keywords_matched: ['machine learning'],
      scraped_at: '2029-01-01T11:00:00Z',
    }))
  })

  afterAll(() => {
    if (cleanupDir) {
      try { rmSync(join(ROOT, 'data/podcast-articles/2029-01-01'), { recursive: true }) } catch { /* ok */ }
      // Clean up the date dir if empty
      try { rmSync(join(ROOT, 'data/podcast-articles'), { recursive: true }) } catch { /* ok */ }
    }
  })

  it('includes podcast-articles in getArticles results', async () => {
    const { articles } = await getArticles({ date: '2029-01-01' })
    const podcastArticle = articles.find(a => a.slug === 'podcast-test-article')
    expect(podcastArticle).toBeDefined()
    expect(podcastArticle.title).toBe('AI Podcast Episode Discussion')
  })

  it('sets source_type to podcast-extract for podcast articles', async () => {
    const { articles } = await getArticles({ date: '2029-01-01' })
    const podcastArticles = articles.filter(a => a.slug?.startsWith('podcast-test-article'))
    expect(podcastArticles.length).toBeGreaterThanOrEqual(2)
    for (const a of podcastArticles) {
      expect(a.source_type).toBe('podcast-extract')
    }
  })

  it('podcast articles have required fields', async () => {
    const { articles } = await getArticles({ date: '2029-01-01' })
    const podcastArticle = articles.find(a => a.slug === 'podcast-test-article')
    expect(podcastArticle).toBeDefined()
    expect(podcastArticle).toHaveProperty('title')
    expect(podcastArticle).toHaveProperty('url')
    expect(podcastArticle).toHaveProperty('sector')
    expect(podcastArticle).toHaveProperty('date_published')
    expect(podcastArticle).toHaveProperty('slug')
    expect(podcastArticle).toHaveProperty('source_type')
  })

  it('filters podcast articles by sector', async () => {
    const { articles } = await getArticles({ sector: 'general-ai', date: '2029-01-01' })
    const podcastArticle = articles.find(a => a.slug === 'podcast-test-article')
    expect(podcastArticle).toBeDefined()

    const { articles: otherArticles } = await getArticles({ sector: 'biopharma', date: '2029-01-01' })
    const noPodcast = otherArticles.find(a => a.slug === 'podcast-test-article')
    expect(noPodcast).toBeUndefined()
  })

  it('search works across podcast articles', async () => {
    const { articles } = await getArticles({ search: 'Podcast Episode Discussion' })
    const found = articles.find(a => a.slug === 'podcast-test-article')
    expect(found).toBeDefined()
  })
})
