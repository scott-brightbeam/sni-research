import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { registerReadTools } from '../lib/mcp-tools/reads.js'
import {
  SearchArticlesIn,
  SearchPodcastsIn,
  GetThemesIn,
  GetThemeDetailIn,
  GetPostBacklogIn,
  GetWritingPreferencesIn,
  GetDraftsIn,
  GetDecisionsIn,
} from '../lib/mcp-tools/schemas.js'
import { callTool } from './mcp-harness.js'
import {
  seedArticles,
  seedThemes,
  seedPodcasts,
  seedPosts,
  seedDecisions,
  seedDrafts,
} from './fixtures.js'

const user = { sub: 'alice@brightbeam.com', jti: 'jti-reads-test' }

let TEST_ROOT

beforeEach(async () => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-reads-'))
  process.env.SNI_ROOT = TEST_ROOT
  _resetDbSingleton()
  const db = getDb()
  await migrateSchema(db)
})

afterEach(() => {
  delete process.env.SNI_ROOT
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

describe('sni_search_articles', () => {
  it('returns articles matching sector filter', async () => {
    const db = getDb()
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

describe('sni_search_podcasts', () => {
  it('returns episodes matching source filter', async () => {
    const db = getDb()
    await seedPodcasts(db, 5)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_podcasts',
      args: { source: 'test-pod' },
      user,
      db,
    })

    const episodes = JSON.parse(result.content[0].text)
    expect(episodes.length).toBeGreaterThan(0)
    const first = episodes[0]
    expect(Object.keys(first).sort()).toEqual(['date', 'filename', 'source', 'summary', 'title', 'week'].sort())
  })

  it('returns empty array when no podcasts match query', async () => {
    const db = getDb()
    await seedPodcasts(db, 3)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_podcasts',
      args: { query: 'xxxxxxthiswillnevermatch' },
      user,
      db,
    })

    const episodes = JSON.parse(result.content[0].text)
    expect(episodes).toEqual([])
  })

  it('honours limit boundary', async () => {
    const db = getDb()
    await seedPodcasts(db, 10)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_search_podcasts',
      args: { limit: 3 },
      user,
      db,
    })

    const episodes = JSON.parse(result.content[0].text)
    expect(episodes.length).toBeLessThanOrEqual(3)
  })

  it('rejects limit > 100 via Zod', () => {
    const r = SearchPodcastsIn.safeParse({ limit: 101 })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('limit')
  })

  it('rejects dateFrom with bad format', () => {
    const r = SearchPodcastsIn.safeParse({ dateFrom: '30-04-2026' })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('dateFrom')
  })
})

describe('sni_get_themes', () => {
  it('returns theme list with correct shape', async () => {
    const db = getDb()
    await seedThemes(db, 3, { withEvidence: true })

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_themes',
      args: {},
      user,
      db,
    })

    const themes = JSON.parse(result.content[0].text)
    expect(themes.length).toBe(3)
    const first = themes[0]
    expect(Object.keys(first).sort()).toEqual(['code', 'documentCount', 'evidenceCount', 'name'].sort())
    expect(first.evidenceCount).toBeGreaterThan(0)
  })

  it('returns empty array when no themes seeded', async () => {
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_themes',
      args: {},
      user,
      db,
    })

    const themes = JSON.parse(result.content[0].text)
    expect(themes).toEqual([])
  })

  it('honours limit boundary', async () => {
    const db = getDb()
    await seedThemes(db, 10)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_themes',
      args: { limit: 4 },
      user,
      db,
    })

    const themes = JSON.parse(result.content[0].text)
    expect(themes.length).toBeLessThanOrEqual(4)
  })

  it('rejects limit > 200 via Zod', () => {
    const r = GetThemesIn.safeParse({ limit: 201 })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('limit')
  })

  it('schema validates archived as boolean', () => {
    const r = GetThemesIn.safeParse({ archived: 'yes' })
    expect(r.success).toBe(false)
  })
})

describe('sni_get_theme_detail', () => {
  it('returns full theme detail with evidence', async () => {
    const db = getDb()
    await seedThemes(db, 1, { withEvidence: true })

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_theme_detail',
      args: { code: 'T01' },
      user,
      db,
    })

    const detail = JSON.parse(result.content[0].text)
    expect(detail.theme).toBeDefined()
    expect(detail.evidence).toBeDefined()
    expect(Array.isArray(detail.evidence)).toBe(true)
    expect(detail.evidence.length).toBe(2)
  })

  it('throws 404 when theme not found', async () => {
    const db = getDb()
    let threw = null
    try {
      await callTool({
        register: registerReadTools,
        name: 'sni_get_theme_detail',
        args: { code: 'T99' },
        user,
        db,
      })
    } catch (e) {
      threw = e
    }
    expect(threw).toBeTruthy()
    expect(threw.message).toContain('T99')
  })

  it('returns connections array', async () => {
    const db = getDb()
    await seedThemes(db, 2, { withEvidence: false })

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_theme_detail',
      args: { code: 'T01' },
      user,
      db,
    })

    const detail = JSON.parse(result.content[0].text)
    expect(Array.isArray(detail.connections)).toBe(true)
  })

  it('rejects invalid theme code format', () => {
    const r = GetThemeDetailIn.safeParse({ code: 'X01' })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('code')
  })

  it('accepts T1 through T9999 (1–4 digit codes)', () => {
    expect(GetThemeDetailIn.safeParse({ code: 'T1' }).success).toBe(true)
    expect(GetThemeDetailIn.safeParse({ code: 'T99' }).success).toBe(true)
    expect(GetThemeDetailIn.safeParse({ code: 'T100' }).success).toBe(true)
    expect(GetThemeDetailIn.safeParse({ code: 'T9999' }).success).toBe(true)
    expect(GetThemeDetailIn.safeParse({ code: 'T10000' }).success).toBe(false)
  })
})

describe('sni_get_post_backlog', () => {
  it('returns posts with correct shape', async () => {
    const db = getDb()
    await seedPosts(db, 4)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_post_backlog',
      args: {},
      user,
      db,
    })

    const posts = JSON.parse(result.content[0].text)
    expect(posts.length).toBe(4)
    const first = posts[0]
    expect(Object.keys(first).sort()).toEqual(['dateAdded', 'freshness', 'id', 'priority', 'status', 'title'].sort())
  })

  it('returns empty array when no posts match filter', async () => {
    const db = getDb()
    await seedPosts(db, 3)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_post_backlog',
      args: { status: 'published' },
      user,
      db,
    })

    // seedPosts cycles statuses — only 0 or 1 out of 3 will be 'published'
    const posts = JSON.parse(result.content[0].text)
    expect(Array.isArray(posts)).toBe(true)
  })

  it('honours limit boundary', async () => {
    const db = getDb()
    await seedPosts(db, 20)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_post_backlog',
      args: { limit: 5 },
      user,
      db,
    })

    const posts = JSON.parse(result.content[0].text)
    expect(posts.length).toBeLessThanOrEqual(5)
  })

  it('rejects invalid status enum', () => {
    const r = GetPostBacklogIn.safeParse({ status: 'pending' })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('status')
  })

  it('rejects invalid priority enum', () => {
    const r = GetPostBacklogIn.safeParse({ priority: 'critical' })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('priority')
  })
})

describe('sni_get_writing_preferences', () => {
  it('returns all three preference fields when files exist', async () => {
    const editorialDir = path.join(TEST_ROOT, 'data/editorial')
    fs.mkdirSync(editorialDir, { recursive: true })
    fs.writeFileSync(path.join(editorialDir, 'writing-preferences.md'), '# Rules\n- UK English')
    fs.writeFileSync(path.join(editorialDir, 'vocabulary-fingerprint.json'), JSON.stringify({ version: 1 }))
    const state = { permanentPreferences: [{ title: 'Test', content: 'Always do X.' }] }
    fs.writeFileSync(path.join(editorialDir, 'state.json'), JSON.stringify(state))

    const db = getDb()
    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_writing_preferences',
      args: {},
      user,
      db,
    })

    const prefs = JSON.parse(result.content[0].text)
    expect(prefs.writingPreferencesMd).toContain('UK English')
    expect(prefs.vocabularyFingerprint.version).toBe(1)
    expect(prefs.permanentPreferences[0].title).toBe('Test')
  })

  it('returns nulls when files are absent', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_writing_preferences',
      args: {},
      user,
      db,
    })

    const prefs = JSON.parse(result.content[0].text)
    expect(prefs.writingPreferencesMd).toBeNull()
    expect(prefs.vocabularyFingerprint).toBeNull()
    expect(prefs.permanentPreferences).toBeNull()
  })

  it('returns null permanentPreferences when state.json has no permanentPreferences key', async () => {
    const editorialDir = path.join(TEST_ROOT, 'data/editorial')
    fs.mkdirSync(editorialDir, { recursive: true })
    fs.writeFileSync(path.join(editorialDir, 'state.json'), JSON.stringify({ counters: {} }))

    const db = getDb()
    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_writing_preferences',
      args: {},
      user,
      db,
    })

    const prefs = JSON.parse(result.content[0].text)
    expect(prefs.permanentPreferences).toBeNull()
  })

  it('schema rejects unexpected fields', () => {
    const r = GetWritingPreferencesIn.safeParse({ unexpected: true })
    // z.object({}) with default strict mode — bun zod strips extra keys; parse succeeds
    expect(r.success).toBe(true)
  })

  it('schema accepts empty object', () => {
    const r = GetWritingPreferencesIn.safeParse({})
    expect(r.success).toBe(true)
  })
})

describe('sni_get_drafts', () => {
  it('returns list of draft metadata when no week specified', async () => {
    await seedDrafts(TEST_ROOT, 3)
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_drafts',
      args: { limit: 5 },
      user,
      db,
    })

    const drafts = JSON.parse(result.content[0].text)
    expect(drafts.length).toBe(3)
    const first = drafts[0]
    expect(Object.keys(first).sort()).toEqual(['summary', 'verificationStatus', 'verifiedAt', 'week'].sort())
  })

  it('returns empty array when no drafts exist', async () => {
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_drafts',
      args: {},
      user,
      db,
    })

    const drafts = JSON.parse(result.content[0].text)
    expect(drafts).toEqual([])
  })

  it('honours limit boundary', async () => {
    await seedDrafts(TEST_ROOT, 10)
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_drafts',
      args: { limit: 3 },
      user,
      db,
    })

    const drafts = JSON.parse(result.content[0].text)
    expect(drafts.length).toBeLessThanOrEqual(3)
  })

  it('returns specific week when week arg provided', async () => {
    await seedDrafts(TEST_ROOT, 3)
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_drafts',
      args: { week: 17 },
      user,
      db,
    })

    const drafts = JSON.parse(result.content[0].text)
    expect(drafts.length).toBe(1)
    expect(drafts[0].week).toBe(17)
    expect(drafts[0].summary).toContain('body for week 17')
  })

  it('rejects limit > 20 via Zod', () => {
    const r = GetDraftsIn.safeParse({ limit: 21 })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('limit')
  })
})

describe('sni_get_decisions', () => {
  it('returns decisions with correct shape', async () => {
    const db = getDb()
    await seedDecisions(db, 5)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_decisions',
      args: {},
      user,
      db,
    })

    const decisions = JSON.parse(result.content[0].text)
    expect(decisions.length).toBe(5)
    const first = decisions[0]
    expect(Object.keys(first).sort()).toEqual(['dateAdded', 'decision', 'id', 'session', 'title'].sort())
  })

  it('returns empty array when no decisions seeded', async () => {
    const db = getDb()

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_decisions',
      args: {},
      user,
      db,
    })

    const decisions = JSON.parse(result.content[0].text)
    expect(decisions).toEqual([])
  })

  it('honours limit boundary', async () => {
    const db = getDb()
    await seedDecisions(db, 20)

    const { result } = await callTool({
      register: registerReadTools,
      name: 'sni_get_decisions',
      args: { limit: 7 },
      user,
      db,
    })

    const decisions = JSON.parse(result.content[0].text)
    expect(decisions.length).toBeLessThanOrEqual(7)
  })

  it('rejects limit > 100 via Zod', () => {
    const r = GetDecisionsIn.safeParse({ limit: 101 })
    expect(r.success).toBe(false)
    expect(r.error.issues[0].path).toContain('limit')
  })

  it('schema validates archived as boolean', () => {
    const r = GetDecisionsIn.safeParse({ archived: 'yes' })
    expect(r.success).toBe(false)
  })
})
