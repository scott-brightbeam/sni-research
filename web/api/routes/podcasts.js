import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { validateParam } from '../lib/walk.js'
import { getDb } from '../lib/db.js'
import * as pq from '../lib/podcast-queries.js'

// Resolved per-call so that SNI_ROOT overrides (e.g. in tests) take effect
// without requiring modules to be re-imported after the env var is set.
function getRoot() { return process.env.SNI_ROOT || resolve(import.meta.dir, '../../..') }

// ---------------------------------------------------------------------------
// Normalise DB row (snake_case) → UI shape (camelCase + digest sub-object)
// ---------------------------------------------------------------------------

/**
 * The UI expects camelCase keys and a nested `digest` object containing
 * summary, stories, and themes.  DB rows use snake_case and return stories
 * at the top level.  This function bridges the gap.
 */
function normaliseEpisode(row) {
  const sourceSlug = row.source_slug || slugify(row.source)
  const filenameSlug = (row.filename || '').replace(/\.md$/, '')

  // Build stories array in the shape the UI expects
  const stories = (row.stories || []).map(s => ({
    headline: s.headline,
    detail: s.detail || null,
    url: s.url || null,
    sector: s.sector || 'general-ai',
  }))

  return {
    filename: row.filename,
    title: row.title,
    source: row.source,
    date: row.date,
    week: row.week != null ? Number(row.week) : null,
    year: row.year != null ? Number(row.year) : null,
    duration: row.duration != null ? Number(row.duration) : null,
    episodeUrl: row.episode_url || null,
    tier: row.tier != null ? Number(row.tier) : 1,
    archived: row.archived === 1 || row.archived === true,
    type: 'podcast',
    // Synthetic digestPath so the UI can build PATCH URLs
    digestPath: `data/podcasts/${row.date}/${sourceSlug}/${filenameSlug}.digest.json`,
    // Nested digest for UI backward compat (digest.summary, digest.stories, digest.themes)
    digest: {
      summary: row.summary || null,
      stories,
      themes: [], // themes not stored in episodes table; empty for now
    },
    // Flat stats the UI also reads
    storiesExtracted: stories.length,
    storyCount: row.story_count != null ? Number(row.story_count) : stories.length,
  }
}

/** Simple slug helper — only needed as fallback if source_slug is missing */
function slugify(s) {
  if (!s) return 'unknown'
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// GET /api/podcasts?week=N&source=X
// ---------------------------------------------------------------------------

export async function handleGetPodcasts(query) {
  const { week, source } = query
  const db = getDb()

  const opts = {}
  if (week != null) opts.week = parseInt(week, 10)
  if (source) opts.source = source

  const rows = await pq.getEpisodes(db, opts)
  const episodes = rows.map(normaliseEpisode)

  // Find the latest podcast-import run summary (stays on filesystem)
  let lastRun = null
  const runsDir = join(getRoot(), 'output/runs')
  if (existsSync(runsDir)) {
    try {
      const runFiles = readdirSync(runsDir)
        .filter(f => f.startsWith('podcast-import-') && f.endsWith('.json'))
        .sort()
        .reverse()

      if (runFiles.length > 0) {
        try {
          lastRun = JSON.parse(readFileSync(join(runsDir, runFiles[0]), 'utf-8'))
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if can't read dir */ }
  }

  return { week: week ? parseInt(week, 10) : null, episodes, lastRun }
}

// ---------------------------------------------------------------------------
// GET /api/podcasts/transcript?date=...&source=...&title=...
// ---------------------------------------------------------------------------

export async function handleGetTranscript(query) {
  const { date, source, title } = query

  if (!date || !source || !title) {
    const err = new Error('Missing required params: date, source, title')
    err.status = 400
    throw err
  }

  try {
    validateParam(date, 'date')
    validateParam(source, 'source')
    validateParam(title, 'title')
  } catch (e) {
    const err = new Error(e.message)
    err.status = 400
    throw err
  }

  const filePath = join(getRoot(), 'data/podcasts', date, source, `${title}.md`)

  if (!existsSync(filePath)) {
    const err = new Error('Transcript not found')
    err.status = 404
    throw err
  }

  const raw = readFileSync(filePath, 'utf-8')

  // Parse frontmatter
  let metadata = {}
  let transcript = raw

  if (raw.startsWith('---')) {
    const endIndex = raw.indexOf('---', 3)
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim()
      transcript = raw.slice(endIndex + 3).trim()

      for (const line of frontmatter.split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim()
          const value = line.slice(colonIdx + 1).trim()
          metadata[key] = value
        }
      }
    }
  }

  return { transcript, metadata }
}

// ---------------------------------------------------------------------------
// PATCH /api/podcasts/:date/:source/:slug
// ---------------------------------------------------------------------------

export async function handlePatchPodcast(date, source, slug, body) {
  validateParam(date, 'date')
  validateParam(source, 'source')
  validateParam(slug, 'slug')

  const db = getDb()

  // Map camelCase body keys to snake_case DB columns
  const updates = {}
  if (body.archived === true) updates.archived = 1
  else if (body.archived === false) updates.archived = 0
  if (body.tier != null) updates.tier = body.tier
  if (body.summary != null) updates.summary = body.summary

  if (Object.keys(updates).length === 0) {
    return { ok: true }
  }

  await pq.patchEpisode(db, date, source, slug, updates)

  // Return updated episode if we can find it
  const result = await db.execute({
    sql: `SELECT * FROM episodes
          WHERE date = ? AND source_slug = ? AND filename LIKE ?`,
    args: [date, source, `%${slug}%`],
  })

  if (result.rows.length === 0) {
    const err = new Error('Podcast episode not found')
    err.status = 404
    throw err
  }

  // Fetch stories for the matched episode
  const row = result.rows[0]
  const storiesResult = await db.execute({
    sql: 'SELECT headline, detail, url, sector FROM episode_stories WHERE episode_id = ?',
    args: [row.id],
  })

  return normaliseEpisode({ ...row, stories: storiesResult.rows })
}
