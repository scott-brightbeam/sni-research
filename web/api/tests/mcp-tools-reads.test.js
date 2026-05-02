import { describe, it, expect, beforeEach } from 'bun:test'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { registerReadTools } from '../lib/mcp-tools/reads.js'
import { SearchArticlesIn } from '../lib/mcp-tools/schemas.js'
import { callTool } from './mcp-harness.js'
import { seedArticles } from './fixtures.js'

const user = { sub: 'alice@brightbeam.com', jti: 'jti-reads-test' }

beforeEach(async () => {
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
})

describe('sni_search_articles', () => {
  it('returns articles matching sector filter', async () => {
    const db = getDb()
    // seed 10 articles — sectors cycle: general-ai(0,5,10), biopharma(1,6), medtech(2,7), manufacturing(3,8), insurance(4,9)
    await seedArticles(db, 10)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_articles',
      args: { sector: 'biopharma' },
      user,
      db,
    })

    const articles = JSON.parse(result.content[0].text)
    expect(articles.length).toBeGreaterThan(0)
    expect(articles.every(a => a.sector === 'biopharma')).toBe(true)
    // Verify shape — only analyst-facing columns
    const first = articles[0]
    expect(Object.keys(first).sort()).toEqual(['date', 'score', 'sector', 'slug', 'source', 'title', 'url'].sort())
  })

  it('returns empty array when no articles match', async () => {
    const db = getDb()
    await seedArticles(db, 3)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_articles',
      args: { query: 'xxxxxxthiswillnevermatch' },
      user,
      db,
    })

    const articles = JSON.parse(result.content[0].text)
    expect(articles).toEqual([])
  })

  it('honours limit boundary (limit:5 returns ≤5 rows)', async () => {
    const db = getDb()
    await seedArticles(db, 20)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_articles',
      args: { limit: 5 },
      user,
      db,
    })

    const articles = JSON.parse(result.content[0].text)
    expect(articles.length).toBeLessThanOrEqual(5)
  })

  it('rejects limit > 200 via Zod schema validation', () => {
    const parseResult = SearchArticlesIn.safeParse({ limit: 201 })
    expect(parseResult.success).toBe(false)
    expect(parseResult.error.issues[0].path).toContain('limit')
  })

  it('rejects invalid sector enum via Zod schema validation', () => {
    const parseResult = SearchArticlesIn.safeParse({ sector: 'crypto' })
    expect(parseResult.success).toBe(false)
    expect(parseResult.error.issues[0].path).toContain('sector')
  })
})
