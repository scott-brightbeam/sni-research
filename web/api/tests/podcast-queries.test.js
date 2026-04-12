import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'
import {
  getEpisodes,
  getEpisode,
  upsertEpisode,
  upsertEpisodeStories,
  patchEpisode,
} from '../lib/podcast-queries.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEpisode(overrides = {}) {
  return {
    filename: 'ai-daily-2026-04-07.md',
    date: '2026-04-07',
    source: 'AI Daily',
    source_slug: 'ai-daily',
    title: 'AI Daily — 7 April 2026',
    week: 15,
    year: 2026,
    duration: 2400,
    episode_url: 'https://podcasts.example.com/ai-daily/ep-42',
    tier: 1,
    summary: 'Discussion of latest AI developments.',
    archived: 0,
    ...overrides,
  }
}

function makeStories() {
  return [
    {
      headline: 'OpenAI launches GPT-5',
      detail: 'Major upgrade with improved reasoning',
      url: 'https://example.com/gpt-5',
      sector: 'general-ai',
    },
    {
      headline: 'Novo Nordisk uses AI for drug design',
      detail: 'Computational drug design breakthrough',
      url: 'https://example.com/novo-ai',
      sector: 'biopharma',
    },
  ]
}

describe('podcast-queries', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })

  afterAll(() => db.close())

  // -----------------------------------------------------------------------
  // 1. Insert episode + retrieve
  // -----------------------------------------------------------------------
  describe('upsertEpisode + getEpisode', () => {
    it('inserts a new episode and retrieves it by filename', async () => {
      const ep = makeEpisode()
      const id = await upsertEpisode(db, ep)
      expect(id).toBeGreaterThan(0)

      const row = await getEpisode(db, 'ai-daily-2026-04-07.md')
      expect(row).not.toBeNull()
      expect(row.filename).toBe('ai-daily-2026-04-07.md')
      expect(row.title).toBe('AI Daily — 7 April 2026')
      expect(row.source).toBe('AI Daily')
      expect(row.source_slug).toBe('ai-daily')
      expect(row.date).toBe('2026-04-07')
      expect(row.week).toBe(15)
      expect(row.year).toBe(2026)
      expect(row.duration).toBe(2400)
      expect(row.episode_url).toBe('https://podcasts.example.com/ai-daily/ep-42')
      expect(row.tier).toBe(1)
      expect(row.summary).toBe('Discussion of latest AI developments.')
      expect(row.archived).toBe(0)
      // No stories yet
      expect(row.stories).toEqual([])
    })

    // -------------------------------------------------------------------
    // 8. getEpisode returns null for missing
    // -------------------------------------------------------------------
    it('returns null for non-existent filename', async () => {
      const row = await getEpisode(db, 'no-such-file.md')
      expect(row).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // 2. Insert episode with stories + retrieve with stories
  // -----------------------------------------------------------------------
  describe('upsertEpisodeStories', () => {
    it('inserts stories and retrieves them with the episode', async () => {
      const ep = makeEpisode({
        filename: 'tech-talk-2026-04-08.md',
        date: '2026-04-08',
        source: 'Tech Talk',
        source_slug: 'tech-talk',
        title: 'Tech Talk — 8 April 2026',
      })
      const id = await upsertEpisode(db, ep)
      const stories = makeStories()
      await upsertEpisodeStories(db, id, stories)

      const row = await getEpisode(db, 'tech-talk-2026-04-08.md')
      expect(row).not.toBeNull()
      expect(row.stories.length).toBe(2)

      const gpt5 = row.stories.find(s => s.headline === 'OpenAI launches GPT-5')
      expect(gpt5).toBeTruthy()
      expect(gpt5.detail).toBe('Major upgrade with improved reasoning')
      expect(gpt5.url).toBe('https://example.com/gpt-5')
      expect(gpt5.sector).toBe('general-ai')

      const novo = row.stories.find(s => s.headline === 'Novo Nordisk uses AI for drug design')
      expect(novo).toBeTruthy()
      expect(novo.sector).toBe('biopharma')
    })
  })

  // -----------------------------------------------------------------------
  // 3. Filter by week
  // -----------------------------------------------------------------------
  describe('getEpisodes — filter by week', () => {
    beforeAll(async () => {
      // Seed another episode in a different week
      const ep = makeEpisode({
        filename: 'ai-daily-2026-03-31.md',
        date: '2026-03-31',
        source: 'AI Daily',
        source_slug: 'ai-daily',
        title: 'AI Daily — 31 March 2026',
        week: 14,
        year: 2026,
      })
      await upsertEpisode(db, ep)
    })

    it('returns only episodes matching the given week', async () => {
      const result = await getEpisodes(db, { week: 15 })
      expect(result.length).toBeGreaterThanOrEqual(1)
      for (const ep of result) {
        expect(ep.week).toBe(15)
      }
      // Week 14 episode should NOT be in the result
      const week14 = result.find(e => e.filename === 'ai-daily-2026-03-31.md')
      expect(week14).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // 4. Filter by source
  // -----------------------------------------------------------------------
  describe('getEpisodes — filter by source', () => {
    it('returns only episodes matching the given source_slug', async () => {
      const result = await getEpisodes(db, { source: 'tech-talk' })
      expect(result.length).toBe(1)
      expect(result[0].source_slug).toBe('tech-talk')
      expect(result[0].filename).toBe('tech-talk-2026-04-08.md')
    })
  })

  // -----------------------------------------------------------------------
  // 5. Upsert — insert then update same episode
  // -----------------------------------------------------------------------
  describe('upsertEpisode — update existing', () => {
    it('updates fields when episode already exists (by filename)', async () => {
      const updated = makeEpisode({
        filename: 'ai-daily-2026-04-07.md',
        duration: 3600,
        tier: 2,
        summary: 'Updated summary with more detail.',
        episode_url: 'https://podcasts.example.com/ai-daily/ep-42-v2',
      })
      const id = await upsertEpisode(db, updated)
      expect(id).toBeGreaterThan(0)

      const row = await getEpisode(db, 'ai-daily-2026-04-07.md')
      expect(row.duration).toBe(3600)
      expect(row.tier).toBe(2)
      expect(row.summary).toBe('Updated summary with more detail.')
      expect(row.episode_url).toBe('https://podcasts.example.com/ai-daily/ep-42-v2')
      // Original fields should be preserved
      expect(row.source).toBe('AI Daily')
      expect(row.title).toBe('AI Daily — 7 April 2026')
    })
  })

  // -----------------------------------------------------------------------
  // 6. Replace stories (upsert stories)
  // -----------------------------------------------------------------------
  describe('upsertEpisodeStories — replace existing', () => {
    it('replaces all stories when called again for the same episode', async () => {
      // Get the tech-talk episode id
      const row = await getEpisode(db, 'tech-talk-2026-04-08.md')
      const epId = row.id

      // Replace with a different set
      const newStories = [
        {
          headline: 'Completely new story',
          detail: 'Brand new detail',
          url: 'https://example.com/new',
          sector: 'manufacturing',
        },
      ]
      await upsertEpisodeStories(db, epId, newStories)

      const updated = await getEpisode(db, 'tech-talk-2026-04-08.md')
      expect(updated.stories.length).toBe(1)
      expect(updated.stories[0].headline).toBe('Completely new story')
      expect(updated.stories[0].sector).toBe('manufacturing')
    })
  })

  // -----------------------------------------------------------------------
  // 7. Patch archived flag
  // -----------------------------------------------------------------------
  describe('patchEpisode', () => {
    it('patches the archived flag on a matching episode', async () => {
      await patchEpisode(db, '2026-04-07', 'ai-daily', 'ai-daily-2026-04-07', { archived: 1 })

      const row = await getEpisode(db, 'ai-daily-2026-04-07.md')
      expect(row.archived).toBe(1)
    })

    it('can un-archive an episode', async () => {
      await patchEpisode(db, '2026-04-07', 'ai-daily', 'ai-daily-2026-04-07', { archived: 0 })

      const row = await getEpisode(db, 'ai-daily-2026-04-07.md')
      expect(row.archived).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // getEpisodes — no filters (all, sorted by date DESC)
  // -----------------------------------------------------------------------
  describe('getEpisodes — no filters', () => {
    it('returns all episodes sorted by date DESC with story_count', async () => {
      const result = await getEpisodes(db, {})
      expect(result.length).toBeGreaterThanOrEqual(3)

      // Verify sorted by date DESC
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1].date >= result[i].date).toBe(true)
      }

      // Each episode should have a story_count and stories array
      for (const ep of result) {
        expect(typeof ep.story_count).toBe('number')
        expect(Array.isArray(ep.stories)).toBe(true)
      }
    })
  })

  // -----------------------------------------------------------------------
  // getEpisodes — combined week + source filter
  // -----------------------------------------------------------------------
  describe('getEpisodes — combined filters', () => {
    it('filters by both week and source', async () => {
      const result = await getEpisodes(db, { week: 15, source: 'ai-daily' })
      expect(result.length).toBe(1)
      expect(result[0].source_slug).toBe('ai-daily')
      expect(result[0].week).toBe(15)
    })
  })
})
