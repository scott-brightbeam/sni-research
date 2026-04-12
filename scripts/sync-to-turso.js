#!/usr/bin/env bun
/**
 * sync-to-turso.js — Push local JSON data to Turso database
 *
 * Replaces the old rsync/tarball/SSH sync-to-cloud.sh mechanism.
 * Runs on launchd schedule (07:40, 13:00, 22:00 daily). Idempotent.
 *
 * Usage: bun scripts/sync-to-turso.js
 *
 * Syncs:
 *  1. Articles from data/verified/, data/review/, data/deleted/, data/podcast-articles/
 *     (last 7 days only — older articles don't change)
 *  2. Editorial state from data/editorial/state.json + supporting files
 *  3. Podcast episodes from data/podcasts/
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createSyncDb } from './lib/db.js'
import { migrateSchema } from '../web/api/lib/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const log = (msg) => console.log(`[sync] ${msg}`)
const warn = (msg) => console.warn(`[sync] ${msg}`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** JSON.stringify arrays/objects, pass through primitives as-is. */
function jsonify(val) {
  if (val === undefined || val === null) return null
  if (Array.isArray(val) || typeof val === 'object') return JSON.stringify(val)
  return val
}

/** Read and parse a JSON file. Returns null if missing or malformed. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** Get date N days ago as YYYY-MM-DD. */
function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

/** Chunk an array into batches. */
function chunk(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

// ---------------------------------------------------------------------------
// Article sync
// ---------------------------------------------------------------------------

/**
 * Walk article directories and collect article records for upsert.
 * Only walks date directories from the last 7 days.
 */
function collectArticles() {
  const cutoff = daysAgo(7)
  const articles = []

  const dirs = [
    { base: 'data/verified', flagged: 0, deletedAt: null, sourceTypeOverride: null },
    { base: 'data/review', flagged: 1, deletedAt: null, sourceTypeOverride: null },
    { base: 'data/deleted', flagged: 0, deletedAt: 'auto', sourceTypeOverride: null },
    { base: 'data/podcast-articles', flagged: 0, deletedAt: null, sourceTypeOverride: 'podcast-extract' },
  ]

  for (const { base, flagged, deletedAt, sourceTypeOverride } of dirs) {
    const dir = join(ROOT, base)
    if (!existsSync(dir)) continue

    const dates = readdirSync(dir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= cutoff)
      .sort()

    for (const date of dates) {
      const datePath = join(dir, date)
      if (!statSync(datePath).isDirectory()) continue

      let sectors
      try { sectors = readdirSync(datePath) } catch { continue }

      for (const sector of sectors) {
        const sectorPath = join(datePath, sector)
        if (!existsSync(sectorPath) || !statSync(sectorPath).isDirectory()) continue

        let files
        try { files = readdirSync(sectorPath).filter(f => f.endsWith('.json')) } catch { continue }

        for (const file of files) {
          try {
            const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
            const slug = basename(file, '.json')
            articles.push({
              slug,
              title: raw.title || slug,
              url: raw.url || null,
              source: raw.source || null,
              source_type: sourceTypeOverride || raw.source_type || 'automated',
              date_published: raw.date_published || date,
              date_verified_method: raw.date_verified_method || null,
              date_confidence: raw.date_confidence || null,
              sector: raw.sector || sector,
              keywords_matched: jsonify(raw.keywords_matched),
              snippet: raw.snippet || null,
              full_text: raw.full_text || null,
              scraped_at: raw.scraped_at || null,
              found_by: jsonify(raw.found_by),
              score: raw.score ?? null,
              confidence: raw.confidence || null,
              score_reason: raw.score_reason || null,
              discovery_source: raw.discoverySource || raw.discovery_source || null,
              source_episode: raw.sourceEpisode || raw.source_episode || null,
              ingested_at: raw.ingested_at || null,
              archived: raw.archived ? 1 : 0,
              flagged: raw.flagged ? 1 : flagged,
              flag_reason: raw.flag_reason || null,
              deleted_at: deletedAt === 'auto' ? (raw.deleted_at || new Date().toISOString()) : (raw.deleted_at || null),
              ainewshub_meta: jsonify(raw.ainewshub_meta),
            })
          } catch { /* skip malformed files */ }
        }
      }
    }
  }

  return articles
}

/**
 * Upsert articles into the database in batches.
 * On conflict (date_published, sector, slug): update fields, preferring new non-null values.
 *
 * found_by handling: The local JSON file is the source of truth. On re-sync,
 * the file's found_by array replaces the DB value (it's always the most
 * complete version). For cross-directory conflicts (same article in both
 * verified/ and review/), the later-processed directory's value wins.
 * Full array merging is handled by db-migrate.js during initial migration.
 */
async function syncArticles(db) {
  const articles = collectArticles()
  if (articles.length === 0) {
    log('Articles: 0 (no recent articles found)')
    return 0
  }

  const BATCH_SIZE = 200
  const batches = chunk(articles, BATCH_SIZE)

  for (const batch of batches) {
    const stmts = batch.map(a => ({
      sql: `INSERT INTO articles (
              slug, title, url, source, source_type, date_published,
              date_verified_method, date_confidence, sector, keywords_matched,
              snippet, full_text, scraped_at, found_by, score, confidence,
              score_reason, discovery_source, source_episode, ingested_at,
              archived, flagged, flag_reason, deleted_at, ainewshub_meta,
              synced_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(date_published, sector, slug) DO UPDATE SET
              title = excluded.title,
              url = COALESCE(excluded.url, articles.url),
              source = COALESCE(excluded.source, articles.source),
              source_type = excluded.source_type,
              date_verified_method = COALESCE(excluded.date_verified_method, articles.date_verified_method),
              date_confidence = COALESCE(excluded.date_confidence, articles.date_confidence),
              keywords_matched = excluded.keywords_matched,
              snippet = COALESCE(excluded.snippet, articles.snippet),
              full_text = COALESCE(excluded.full_text, articles.full_text),
              scraped_at = COALESCE(excluded.scraped_at, articles.scraped_at),
              found_by = CASE
                WHEN articles.found_by IS NULL THEN excluded.found_by
                WHEN excluded.found_by IS NULL THEN articles.found_by
                ELSE excluded.found_by
              END,
              score = COALESCE(excluded.score, articles.score),
              confidence = COALESCE(excluded.confidence, articles.confidence),
              score_reason = COALESCE(excluded.score_reason, articles.score_reason),
              discovery_source = COALESCE(excluded.discovery_source, articles.discovery_source),
              source_episode = COALESCE(excluded.source_episode, articles.source_episode),
              ingested_at = COALESCE(excluded.ingested_at, articles.ingested_at),
              archived = MAX(articles.archived, excluded.archived),
              flagged = MAX(articles.flagged, excluded.flagged),
              flag_reason = COALESCE(excluded.flag_reason, articles.flag_reason),
              deleted_at = COALESCE(excluded.deleted_at, articles.deleted_at),
              ainewshub_meta = COALESCE(excluded.ainewshub_meta, articles.ainewshub_meta),
              synced_at = datetime('now'),
              updated_at = datetime('now')`,
      args: [
        a.slug, a.title, a.url, a.source, a.source_type, a.date_published,
        a.date_verified_method, a.date_confidence, a.sector, a.keywords_matched,
        a.snippet, a.full_text, a.scraped_at, a.found_by, a.score, a.confidence,
        a.score_reason, a.discovery_source, a.source_episode, a.ingested_at,
        a.archived, a.flagged, a.flag_reason, a.deleted_at, a.ainewshub_meta,
      ],
    }))
    await db.batch(stmts)
  }

  log(`Articles: ${articles.length} upserted (last 7 days)`)
  return articles.length
}

// ---------------------------------------------------------------------------
// Editorial state sync
// ---------------------------------------------------------------------------

async function syncEditorialState(db) {
  const statePath = join(ROOT, 'data/editorial/state.json')
  const state = readJson(statePath)
  if (!state) {
    warn('Editorial: state.json not found or malformed — skipping')
    return { entries: 0, themes: 0, posts: 0 }
  }

  let entryCount = 0
  let themeCount = 0
  let postCount = 0

  // --- Counters ---
  if (state.counters) {
    const counterStmts = Object.entries(state.counters).map(([key, value]) => ({
      sql: 'INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)',
      args: [key, value],
    }))
    if (counterStmts.length > 0) await db.batch(counterStmts)
  }

  // --- Analysis entries (DELETE + INSERT in transaction) ---
  if (state.analysisIndex) {
    const entries = Object.entries(state.analysisIndex)
    entryCount = entries.length

    // Delete all existing, then batch-insert
    await db.execute('DELETE FROM analysis_entries')

    const entryBatches = chunk(entries, 200)
    for (const batch of entryBatches) {
      const stmts = batch.map(([id, e]) => ({
        sql: `INSERT INTO analysis_entries (
                id, title, source, host, participants, filename, url, date,
                date_processed, session, tier, status, themes, summary,
                key_themes, post_potential, post_potential_reasoning,
                reconstructed, archived
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          parseInt(id, 10),
          e.title || '',
          e.source || null,
          e.host || null,
          jsonify(e.participants),
          e.filename || null,
          e.url || null,
          e.date || null,
          e.dateProcessed || e.date_processed || null,
          e.session ?? 0,
          e.tier ?? 1,
          e.status || 'active',
          jsonify(e.themes),
          e.summary || null,
          e.keyThemes || e.key_themes || null,
          e.postPotential || e.post_potential || null,
          e.postPotentialReasoning || e.post_potential_reasoning || null,
          e._reconstructed ? 1 : 0,
          e.archived ? 1 : 0,
        ],
      }))
      await db.batch(stmts)
    }
  }

  // --- Themes + evidence + connections ---
  if (state.themeRegistry) {
    const themeEntries = Object.entries(state.themeRegistry)
      .filter(([_, v]) => typeof v === 'object' && v !== null && 'name' in v)
    themeCount = themeEntries.length

    // Clear existing theme data
    await db.batch([
      'DELETE FROM theme_connections',
      'DELETE FROM theme_evidence',
      'DELETE FROM themes',
    ])

    // Insert themes
    const themeBatches = chunk(themeEntries, 200)
    for (const batch of themeBatches) {
      const stmts = batch.map(([code, t]) => ({
        sql: `INSERT INTO themes (
                code, name, created_session, last_updated_session,
                document_count, archived
              ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          code,
          t.name || code,
          t.created || t.created_session || null,
          t.lastUpdated || t.last_updated_session || null,
          t.documentCount ?? t.document_count ?? 0,
          t.archived ? 1 : 0,
        ],
      }))
      await db.batch(stmts)
    }

    // Insert theme evidence
    const allEvidence = []
    for (const [code, t] of themeEntries) {
      if (!Array.isArray(t.evidence)) continue
      for (const ev of t.evidence) {
        allEvidence.push({
          theme_code: code,
          session: ev.session ?? 0,
          source: ev.source || null,
          content: ev.content || null,
          url: ev.url || null,
        })
      }
    }
    const evidenceBatches = chunk(allEvidence, 200)
    for (const batch of evidenceBatches) {
      const stmts = batch.map(ev => ({
        sql: `INSERT INTO theme_evidence (theme_code, session, source, content, url)
              VALUES (?, ?, ?, ?, ?)`,
        args: [ev.theme_code, ev.session, ev.source, ev.content, ev.url],
      }))
      await db.batch(stmts)
    }

    // Insert theme connections (crossConnections)
    const allConnections = []
    for (const [code, t] of themeEntries) {
      if (!Array.isArray(t.crossConnections)) continue
      for (const conn of t.crossConnections) {
        const toCode = conn.theme || conn.to_code
        if (!toCode) continue
        allConnections.push({
          from_code: code,
          to_code: toCode,
          reasoning: conn.reasoning || null,
        })
      }
    }
    if (allConnections.length > 0) {
      const connBatches = chunk(allConnections, 200)
      for (const batch of connBatches) {
        const stmts = batch.map(c => ({
          sql: `INSERT OR IGNORE INTO theme_connections (from_code, to_code, reasoning)
                VALUES (?, ?, ?)`,
          args: [c.from_code, c.to_code, c.reasoning],
        }))
        await db.batch(stmts)
      }
    }
  }

  // --- Posts ---
  if (state.postBacklog) {
    const postEntries = Object.entries(state.postBacklog)
    postCount = postEntries.length

    await db.execute('DELETE FROM posts')

    const postBatches = chunk(postEntries, 200)
    for (const batch of postBatches) {
      const stmts = batch.map(([id, p]) => ({
        sql: `INSERT INTO posts (
                id, title, working_title, status, date_added, session,
                core_argument, format, source_documents, source_urls,
                freshness, priority, notes, date_published
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          parseInt(id, 10),
          p.title || '',
          p.workingTitle || p.working_title || null,
          p.status || 'suggested',
          p.dateAdded || p.date_added || null,
          p.session ?? null,
          p.coreArgument || p.core_argument || null,
          p.format || null,
          jsonify(p.sourceDocuments || p.source_documents),
          jsonify(p.sourceUrls || p.source_urls),
          p.freshness || 'evergreen',
          p.priority || 'medium',
          p.notes || null,
          p.date_published || null,
        ],
      }))
      await db.batch(stmts)
    }
  }

  // --- Decisions ---
  if (Array.isArray(state.decisionLog)) {
    await db.execute('DELETE FROM decisions')
    const decBatches = chunk(state.decisionLog, 200)
    for (const batch of decBatches) {
      const stmts = batch.map(d => ({
        sql: `INSERT INTO decisions (id, session, title, decision, reasoning, archived)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          String(d.id),
          d.session ?? 0,
          d.title || '',
          d.decision || '',
          d.reasoning || null,
          d.archived ? 1 : 0,
        ],
      }))
      await db.batch(stmts)
    }
  }

  // --- Rotation candidates ---
  if (Array.isArray(state.rotationCandidates)) {
    await db.execute('DELETE FROM rotation_candidates')
    if (state.rotationCandidates.length > 0) {
      const stmts = state.rotationCandidates.map(c => ({
        sql: 'INSERT INTO rotation_candidates (content) VALUES (?)',
        args: [typeof c === 'string' ? c : JSON.stringify(c)],
      }))
      await db.batch(stmts)
    }
  }

  // --- Permanent preferences ---
  if (Array.isArray(state.permanentPreferences)) {
    await db.execute('DELETE FROM permanent_preferences')
    if (state.permanentPreferences.length > 0) {
      const stmts = state.permanentPreferences.map(p => ({
        sql: 'INSERT INTO permanent_preferences (title, content) VALUES (?, ?)',
        args: [p.title || '', typeof p.content === 'string' ? p.content : JSON.stringify(p.content || '')],
      }))
      await db.batch(stmts)
    }
  }

  // --- Activity log ---
  const activityPath = join(ROOT, 'data/editorial/activity.json')
  const activity = readJson(activityPath)
  if (Array.isArray(activity) && activity.length > 0) {
    await db.execute('DELETE FROM activity')
    const actBatches = chunk(activity, 200)
    for (const batch of actBatches) {
      const stmts = batch.map(a => ({
        sql: `INSERT INTO activity (type, title, detail, timestamp)
              VALUES (?, ?, ?, ?)`,
        args: [
          a.type || 'unknown',
          a.title || '',
          a.detail || '',
          a.timestamp || null,
        ],
      }))
      await db.batch(stmts)
    }
  }

  // --- Notifications ---
  const notifPath = join(ROOT, 'data/editorial/notifications.json')
  const notifications = readJson(notifPath)
  if (Array.isArray(notifications) && notifications.length > 0) {
    const stmts = notifications.map(n => ({
      sql: `INSERT OR REPLACE INTO notifications (id, post_id, title, priority, detail, timestamp, dismissed)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        n.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        n.postId ?? n.post_id ?? null,
        n.title || '',
        n.priority || null,
        n.detail || '',
        n.timestamp || null,
        n.dismissed ? 1 : 0,
      ],
    }))
    await db.batch(stmts)
  }

  // --- Cost log ---
  const costPath = join(ROOT, 'data/editorial/cost-log.json')
  const costLog = readJson(costPath)
  if (costLog?.sessions) {
    const costEntries = Object.entries(costLog.sessions)
    if (costEntries.length > 0) {
      const costBatches = chunk(costEntries, 200)
      for (const batch of costBatches) {
        const stmts = batch.map(([sessionId, c]) => ({
          sql: `INSERT OR REPLACE INTO cost_log (session_id, timestamp, elapsed, stage, costs, total)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [
            sessionId,
            c.timestamp || null,
            c.elapsed || null,
            c.stage || null,
            jsonify(c.costs),
            c.total ?? null,
          ],
        }))
        await db.batch(stmts)
      }
    }
  }

  // --- Stories (session files) ---
  // DELETE existing stories per session, then re-insert — avoids duplicates
  // on repeated sync runs (stories table has no natural unique constraint).
  const editorialDir = join(ROOT, 'data/editorial')
  if (existsSync(editorialDir)) {
    const storyFiles = readdirSync(editorialDir)
      .filter(f => /^stories-session-\d+\.json$/.test(f))

    for (const file of storyFiles) {
      const sessionMatch = file.match(/stories-session-(\d+)\.json/)
      const session = sessionMatch ? parseInt(sessionMatch[1], 10) : 0
      const stories = readJson(join(editorialDir, file))
      if (!Array.isArray(stories) || stories.length === 0) continue

      // Clear this session's stories before re-inserting
      await db.execute({
        sql: 'DELETE FROM stories WHERE session = ?',
        args: [session],
      })

      const stmts = stories.map(s => ({
        sql: `INSERT INTO stories (session, headline, detail, url, type, sector, source_file)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          session,
          s.headline || '',
          s.detail || null,
          s.url || null,
          s.type || null,
          s.sector || null,
          s.sourceFile || s.source_file || null,
        ],
      }))
      // Stories can be large — batch in chunks
      const storyBatches = chunk(stmts, 200)
      for (const batch of storyBatches) {
        await db.batch(batch)
      }
    }
  }

  log(`Editorial: ${entryCount} entries, ${themeCount} themes, ${postCount} posts`)
  return { entries: entryCount, themes: themeCount, posts: postCount }
}

// ---------------------------------------------------------------------------
// Podcast sync
// ---------------------------------------------------------------------------

async function syncPodcasts(db) {
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) {
    log('Podcasts: 0 (data/podcasts/ not found)')
    return 0
  }

  let episodeCount = 0

  // Walk data/podcasts/{date}/{source-slug}/{filename}.digest.json
  const dates = readdirSync(podcastDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()

  for (const date of dates) {
    const datePath = join(podcastDir, date)
    if (!statSync(datePath).isDirectory()) continue

    let sources
    try { sources = readdirSync(datePath) } catch { continue }

    for (const sourceSlug of sources) {
      const sourcePath = join(datePath, sourceSlug)
      if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) continue

      let files
      try { files = readdirSync(sourcePath).filter(f => f.endsWith('.digest.json')) } catch { continue }

      for (const file of files) {
        const digest = readJson(join(sourcePath, file))
        if (!digest) continue

        const filename = basename(file, '.digest.json')
        episodeCount++

        // Upsert episode by filename
        await db.execute({
          sql: `INSERT INTO episodes (
                  filename, date, source, source_slug, title, week, year,
                  duration, episode_url, tier, summary, archived
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(filename) DO UPDATE SET
                  title = excluded.title,
                  week = COALESCE(excluded.week, episodes.week),
                  year = COALESCE(excluded.year, episodes.year),
                  duration = COALESCE(excluded.duration, episodes.duration),
                  episode_url = COALESCE(excluded.episode_url, episodes.episode_url),
                  tier = excluded.tier,
                  summary = COALESCE(excluded.summary, episodes.summary),
                  updated_at = datetime('now')`,
          args: [
            filename,
            digest.date || date,
            digest.source || sourceSlug,
            digest.sourceSlug || sourceSlug,
            digest.title || filename,
            digest.week ?? null,
            digest.year ?? null,
            typeof digest.duration === 'string'
              ? parseInt(digest.duration, 10) || null
              : (digest.duration ?? null),
            digest.url || digest.episode_url || null,
            digest.tier ?? 1,
            digest.summary || null,
            digest.archived ? 1 : 0,
          ],
        })

        // Sync episode stories (key_stories in digest)
        if (Array.isArray(digest.key_stories) && digest.key_stories.length > 0) {
          // Get the episode ID
          const epRow = await db.execute({
            sql: 'SELECT id FROM episodes WHERE filename = ?',
            args: [filename],
          })
          const episodeId = epRow.rows[0]?.id
          if (!episodeId) continue

          // Delete existing stories for this episode, then re-insert
          await db.execute({
            sql: 'DELETE FROM episode_stories WHERE episode_id = ?',
            args: [episodeId],
          })

          const storyStmts = digest.key_stories.map(s => ({
            sql: `INSERT INTO episode_stories (episode_id, headline, detail, url, sector)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              episodeId,
              s.headline || '',
              s.detail || null,
              s.url || null,
              s.sector || 'general-ai',
            ],
          }))
          const storyBatches = chunk(storyStmts, 200)
          for (const batch of storyBatches) {
            await db.batch(batch)
          }
        }
      }
    }
  }

  log(`Podcasts: ${episodeCount} episodes`)
  return episodeCount
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const start = performance.now()
  log('Starting sync to Turso...')

  const db = createSyncDb()
  if (!db) {
    // createSyncDb already logged the warning
    process.exit(0)
  }

  try {
    // Ensure schema is up to date
    await migrateSchema(db)

    // Sync all data types
    await syncArticles(db)
    await syncEditorialState(db)
    await syncPodcasts(db)

    const elapsed = ((performance.now() - start) / 1000).toFixed(1)
    log(`Complete in ${elapsed}s`)
    process.exit(0)
  } catch (err) {
    console.error('[sync] FATAL:', err.message || err)
    if (err.stack) console.error(err.stack)
    process.exit(1)
  }
}

main()
