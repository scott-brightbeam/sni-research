import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

process.env.SNI_TEST_MODE = '1'

const { getArticles, getArticle, getPublications } = await import('./routes/articles.js')
const { getDb, migrateSchema, _resetDbSingleton } = await import('./lib/db.js')

async function seedArticles(db) {
  // Two general articles on 2026-03-02, two podcast-extracts on 2029-01-01
  const rows = [
    {
      slug: 'general-a', title: 'General A', url: 'https://example.com/a', source: 'Source A',
      source_type: 'automated', date_published: '2026-03-02', sector: 'general',
      scraped_at: '2026-03-02T09:00:00Z', score: 7,
    },
    {
      slug: 'general-b', title: 'General B', url: 'https://example.com/b', source: 'Source B',
      source_type: 'automated', date_published: '2026-03-02', sector: 'general',
      scraped_at: '2026-03-02T10:00:00Z', score: 6,
    },
    {
      slug: 'biopharma-a', title: 'Biopharma A', url: 'https://example.com/bp', source: 'Source C',
      source_type: 'automated', date_published: '2026-03-03', sector: 'biopharma',
      scraped_at: '2026-03-03T08:00:00Z', score: 5,
    },
    {
      slug: 'podcast-test-article', title: 'AI Podcast Episode Discussion',
      url: 'https://example.com/podcast/ep1', source: 'Test Podcast',
      source_type: 'podcast-extract', date_published: '2029-01-01', sector: 'general-ai',
      snippet: 'A discussion about AI developments',
      scraped_at: '2029-01-01T10:00:00Z', score: 8,
    },
    {
      slug: 'podcast-test-article-2', title: 'Another Podcast Extract',
      url: 'https://example.com/podcast/ep2', source: 'Test Podcast 2',
      source_type: 'podcast-extract', date_published: '2029-01-01', sector: 'general-ai',
      snippet: 'More AI news from podcasts',
      scraped_at: '2029-01-01T11:00:00Z', score: 7,
    },
  ]
  for (const r of rows) {
    await db.execute({
      sql: `INSERT INTO articles (slug, title, url, source, source_type, date_published, sector,
                                   snippet, scraped_at, score, archived, flagged)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      args: [r.slug, r.title, r.url, r.source, r.source_type, r.date_published, r.sector,
             r.snippet ?? null, r.scraped_at, r.score],
    })
  }
}

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
  await seedArticles(db)
})

afterEach(() => {
  _resetDbSingleton()
})

describe('getArticles', () => {
  it('returns an array of articles', async () => {
    const result = await getArticles({})
    expect(Array.isArray(result.articles)).toBe(true)
    expect(result.articles.length).toBeGreaterThanOrEqual(5)
  })

  it('articles have required fields', async () => {
    const { articles } = await getArticles({})
    const a = articles[0]
    expect(a).toHaveProperty('title')
    expect(a).toHaveProperty('url')
    expect(a).toHaveProperty('sector')
    expect(a).toHaveProperty('date_published')
    expect(a).toHaveProperty('slug')
  })

  it('filters by sector', async () => {
    const { articles } = await getArticles({ sector: 'general' })
    expect(articles.length).toBeGreaterThanOrEqual(2)
    for (const a of articles) {
      expect(a.sector).toBe('general')
    }
  })

  it('filters by date', async () => {
    const { articles } = await getArticles({ date: '2026-03-02' })
    expect(articles.length).toBeGreaterThanOrEqual(2)
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

  it('returns article when found', async () => {
    const result = await getArticle('2026-03-02', 'general', 'general-a')
    expect(result).not.toBeNull()
    expect(result.title).toBe('General A')
  })
})

describe('getPublications', () => {
  it('returns a sorted, unique array of source values', async () => {
    const publications = await getPublications()
    expect(Array.isArray(publications)).toBe(true)
    const sorted = [...publications].sort((a, b) => a.localeCompare(b))
    expect(publications).toEqual(sorted)
    expect(new Set(publications).size).toBe(publications.length)
  })

  it('includes sources from seeded articles', async () => {
    const publications = await getPublications()
    expect(publications).toContain('Source A')
    expect(publications).toContain('Source B')
    expect(publications).toContain('Test Podcast')
  })
})

describe('podcast-articles integration', () => {
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
    const { articles: ga } = await getArticles({ sector: 'general-ai', date: '2029-01-01' })
    expect(ga.find(a => a.slug === 'podcast-test-article')).toBeDefined()

    const { articles: bp } = await getArticles({ sector: 'biopharma', date: '2029-01-01' })
    expect(bp.find(a => a.slug === 'podcast-test-article')).toBeUndefined()
  })

  it('search works across podcast articles', async () => {
    const { articles } = await getArticles({ search: 'Podcast Episode Discussion' })
    const found = articles.find(a => a.slug === 'podcast-test-article')
    expect(found).toBeDefined()
  })
})
