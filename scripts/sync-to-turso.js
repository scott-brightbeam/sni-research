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

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync, renameSync, unlinkSync, copyFileSync } from 'fs'
import { join, basename, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { createSyncDb } from './lib/db.js'
import { migrateSchema } from '../web/api/lib/db.js'
import { validateEditorialState, validatePendingContributions } from './validate-editorial-state.js'
import { acquireStateLock, releaseStateLock, waitAndAcquireStateLock } from './lib/state-lock.js'
import { snapshotState, pruneSnapshots } from './lib/state-snapshot.js'
import { appendSyncLog, readSyncLog } from './lib/sync-journal.js'
import { sendTelegram } from './lib/telegram.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const log = (msg) => console.log(`[sync] ${msg}`)
const warn = (msg) => console.warn(`[sync] ${msg}`)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TRANSCRIPT_DIR = join(process.env.HOME || '', 'Desktop/Podcast Transcripts')

/** Load transcript from local file by filename. Returns null if not found. */
function loadTranscript(filename) {
  if (!filename) return null
  try {
    return readFileSync(join(TRANSCRIPT_DIR, filename), 'utf-8')
  } catch { return null }
}

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
 *
 * Default behaviour: only walk date directories from the last 7 days
 * (the automated pipeline produces thousands of articles per week and
 * older ones don't change — re-scanning all of them would slow sync).
 *
 * Exception: editorial-discover articles are always included regardless
 * of date. DISCOVER often resolves story references from older events
 * (e.g. a podcast in April discussing a fundraise from January), and
 * those articles must still be queryable in the Articles tab.
 *
 * Source types that always sync: editorial-discover, editorial-headlines,
 * editorial-geographic-sweep, editorial-sector-search, manual.
 * These are curated, comparatively rare, and high-value.
 */
const ALWAYS_SYNC_SOURCE_TYPES = new Set([
  'editorial-discover',
  'editorial-headlines',
  'editorial-geographic-sweep',
  'editorial-sector-search',
  'manual',
])

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

    // Walk ALL date dirs — the per-file source_type decides whether to keep each.
    const dates = readdirSync(dir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
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
            const sourceType = sourceTypeOverride || raw.source_type || 'automated'
            // Keep if within the recent window OR the source_type is one
            // that always syncs regardless of date.
            const keep = date >= cutoff || ALWAYS_SYNC_SOURCE_TYPES.has(sourceType)
            if (!keep) continue
            const slug = basename(file, '.json')
            articles.push({
              slug,
              title: raw.title || slug,
              url: raw.url || null,
              source: raw.source || null,
              source_type: sourceType,
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
                reconstructed, archived, transcript
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          loadTranscript(e.filename),
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
// Output file sync (fly ssh sftp → Fly volume at /app/data/output)
// ---------------------------------------------------------------------------

async function syncOutputFiles() {
  const outputDir = join(ROOT, 'output')
  const editorialDir = join(ROOT, 'data/editorial')

  // Collect files to sync
  const filesToSync = []

  // Editorial state + supporting files — the chat handler reads these from
  // the Fly volume, not Turso. If we don't sync them, the deployed chat
  // sees a stale state and can't find recent backlog items / themes / entries.
  const editorialFiles = ['state.json', 'activity.json', 'writing-preferences.md', 'sync-log.jsonl']
  for (const f of editorialFiles) {
    const local = join(editorialDir, f)
    if (existsSync(local)) {
      filesToSync.push({ local, remote: `/app/data/editorial/${f}` })
    }
  }

  if (!existsSync(outputDir)) {
    // Still sync editorial files even if output/ is missing
    if (filesToSync.length > 0) {
      await runSftp(filesToSync, ['mkdir /app/data/editorial'])
    }
    log('Output: no output/ directory, skipping output files')
    return
  }

  // All output files the Draft page needs: drafts, links, reviews,
  // evaluations, research packs, verified sidecars, critiques.
  const topFiles = readdirSync(outputDir).filter(f => {
    // Draft files + their .verified sidecars
    if (f.startsWith('draft-week-')) return true
    // Links, reviews, evaluations
    if ((f.startsWith('links-week-') || f.startsWith('review-week-') ||
         f.startsWith('evaluate-week-')) && (f.endsWith('.md') || f.endsWith('.json'))) return true
    // Research packs
    if (f.includes('-research') && (f.endsWith('.md') || f.endsWith('.json'))) return true
    return false
  })
  for (const f of topFiles) {
    filesToSync.push({ local: join(outputDir, f), remote: `/app/data/output/${f}` })
  }

  // Critique files from data/editorial/drafts/
  const critDir = join(editorialDir, 'drafts')
  if (existsSync(critDir)) {
    const critFiles = readdirSync(critDir).filter(f =>
      f.startsWith('critique-') && f.endsWith('.json')
    )
    for (const f of critFiles) {
      filesToSync.push({ local: join(critDir, f), remote: `/app/data/editorial/drafts/${f}` })
    }
  }

  // Published newsletters
  const pubDir = join(outputDir, 'published')
  if (existsSync(pubDir)) {
    const pubFiles = readdirSync(pubDir).filter(f =>
      f.startsWith('week-') && (f.endsWith('.md') || f.endsWith('.json'))
    )
    for (const f of pubFiles) {
      filesToSync.push({ local: join(pubDir, f), remote: `/app/data/output/published/${f}` })
    }
  }

  if (filesToSync.length === 0) {
    log('Output: no files to sync')
    return
  }

  // Ring buffer: before uploading state.json, rename the existing copy on the
  // volume to state.json.previous (one-deep rollback point). The check and
  // rename happen via a single sh -c call; if state.json doesn't exist yet the
  // mv is skipped silently. This runs BEFORE the put so .previous always holds
  // the version that was live before this sync.
  const stateSynced = filesToSync.some(f => f.remote === '/app/data/editorial/state.json')
  if (stateSynced) {
    try {
      const proc = Bun.spawn(
        ['fly', 'ssh', 'console', '--command',
          `sh -c 'if [ -f /app/data/editorial/state.json ]; then mv /app/data/editorial/state.json /app/data/editorial/state.json.previous; fi'`,
          '-a', 'sni-research'],
        { stdout: 'pipe', stderr: 'pipe',
          env: { ...process.env, PATH: `/Users/scott/.fly/bin:${process.env.PATH}` } }
      )
      await proc.exited
      log('Output: rotated state.json → state.json.previous on volume')
    } catch (err) {
      console.error('[sync] state.json.previous rotation failed (non-fatal):', err.message)
    }
  }

  await runSftp(filesToSync, [
    'mkdir /app/data/editorial',
    'mkdir /app/data/editorial/drafts',
    'mkdir /app/data/output',
    'mkdir /app/data/output/published',
  ])
  log(`Output: ${filesToSync.length} files synced to Fly volume`)
}

/**
 * SFTP helper — push a list of {local, remote} files to the Fly volume.
 *
 * Fly's SFTP `put` refuses to overwrite existing files ("file exists on VM").
 * Workaround: upload to `remote + '.new'`, then `fly ssh console` to `mv`
 * each `.new` file into place. This is atomic-ish (mv is a rename on the
 * same filesystem) and avoids the stale-file bug where state.json on Fly
 * was 690KB while local was 1.2MB because `put` silently skipped it.
 *
 * Apr 2026 fix: the rename step used to chain every mv with `&&` in a single
 * `fly ssh console --command` call. For 60 files the command string exceeded
 * what the console reliably delivered, so most mv's silently dropped and
 * `.new` files stacked on the volume (weeks 8–17 all had stuck `.new` files).
 * Now chunks the renames into batches of 10, checks exit codes, and does a
 * post-rename audit listing any .new files still present.
 */
async function runSftp(filesToSync, mkdirs = []) {
  // Step 1: SFTP upload to .new paths
  const sftpCommands = [
    ...mkdirs,
    ...filesToSync.map(f => `put ${f.local} ${f.remote}.new`)
  ].join('\n')

  try {
    const proc = Bun.spawn(['fly', 'ssh', 'sftp', 'shell', '-a', 'sni-research'], {
      stdin: new Blob([sftpCommands]),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, PATH: `/Users/scott/.fly/bin:${process.env.PATH}` },
    })
    await proc.exited
  } catch (err) {
    console.error('[sync] SFTP upload failed (non-fatal):', err.message)
    return
  }

  // Step 2: Rename .new files into place in batches of 10 (command-length safe)
  const BATCH_SIZE = 10
  let renameSuccess = 0
  let renameFailed = 0

  for (let i = 0; i < filesToSync.length; i += BATCH_SIZE) {
    const batch = filesToSync.slice(i, i + BATCH_SIZE)
    // Guard against quotes in remote paths — we wrap the mv script in `sh -c '…'`,
    // so a single quote in a filename would break out of the outer string.
    // All current paths are ASCII slugs, but fail loud rather than silently corrupt.
    const badPath = batch.find(f => /['"`\\]/.test(f.remote))
    if (badPath) {
      console.error(`[sync] unsafe char in remote path: ${badPath.remote}`)
      renameFailed += batch.length
      continue
    }
    // Use `;` so one failure doesn't abort the batch.
    // Collect per-file stderr via a server-side shell loop.
    const mvScript = batch
      .map(f => `mv "${f.remote}.new" "${f.remote}" 2>&1 && echo OK:${f.remote} || echo FAIL:${f.remote}`)
      .join('; ')

    try {
      const proc = Bun.spawn(
        ['fly', 'ssh', 'console', '--command', `sh -c '${mvScript}'`, '-a', 'sni-research'],
        { stdout: 'pipe', stderr: 'pipe',
          env: { ...process.env, PATH: `/Users/scott/.fly/bin:${process.env.PATH}` } }
      )
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      for (const line of stdout.split('\n')) {
        if (line.startsWith('OK:')) renameSuccess++
        else if (line.startsWith('FAIL:')) {
          renameFailed++
          console.error(`[sync] rename failed: ${line.slice(5)}`)
        }
      }
    } catch (err) {
      console.error(`[sync] rename batch ${i}-${i + batch.length} failed:`, err.message)
      renameFailed += batch.length
    }
  }

  log(`Output rename: ${renameSuccess} ok, ${renameFailed} failed`)

  // Step 3: post-rename audit — scan for any .new files still present in our
  // target directories and flag them. A successful sync leaves zero .new files
  // in the specific subtrees we just wrote to.
  if (renameFailed > 0) {
    try {
      const auditDirs = [...new Set(filesToSync.map(f => f.remote.replace(/\/[^/]+$/, '')))]
      const auditCmd = auditDirs.map(d => `find "${d}" -maxdepth 1 -name '*.new' 2>/dev/null`).join('; ')
      const proc = Bun.spawn(
        ['fly', 'ssh', 'console', '--command', `sh -c '${auditCmd}'`, '-a', 'sni-research'],
        { stdout: 'pipe', stderr: 'pipe',
          env: { ...process.env, PATH: `/Users/scott/.fly/bin:${process.env.PATH}` } }
      )
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      const leftover = stdout.split('\n').filter(l => l.endsWith('.new')).length
      if (leftover > 0) {
        console.error(`[sync] WARN: ${leftover} .new files still present on volume — manual mv needed`)
      }
    } catch (err) {
      console.error('[sync] post-rename audit failed (non-fatal):', err.message)
    }
  }
}

// ---------------------------------------------------------------------------
// pullContributions — phase-0 reverse-merge from Fly volume
// ---------------------------------------------------------------------------

const CONTRIBUTIONS_REMOTE_DIR = '/app/data/editorial/contributions'
const FLY_APP = 'sni-research'
const FLY_BIN = `/Users/scott/.fly/bin`
const FLY_ENV = { ...process.env, PATH: `${FLY_BIN}:${process.env.PATH}` }

// Path helpers — each accepts an optional root override so tests can
// isolate filesystem state via mkdtemp without forking the production code.
function getSyncLogPath(root = ROOT) {
  return join(root, 'data/editorial/sync-log.jsonl')
}

function getStateLockPath(root = ROOT) {
  return join(root, 'data/editorial/.state-pull.lock')
}

function getBackupDir(root = ROOT) {
  return join(root, 'data/editorial/backups')
}

function getQuarantineDir(root = ROOT, date) {
  return join(root, 'data/editorial/contributions', 'quarantine', date)
}

function getFailedDir(root = ROOT) {
  return join(root, 'data/editorial/contributions', 'failed')
}

function getTamperedDir(root = ROOT, date) {
  return join(root, 'data/editorial/contributions', 'tampered', date)
}

function getProcessedDir(root = ROOT) {
  return join(root, 'data/editorial/contributions', 'processed')
}

/** Remove stale .tmp files left by prior crashes in a directory. */
function cleanupStaleTmpFiles(dir) {
  if (!existsSync(dir)) return
  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.tmp'))
    for (const f of files) {
      try { unlinkSync(join(dir, f)) } catch { /* best-effort */ }
    }
    if (files.length > 0) {
      log(`Cleaned up ${files.length} stale .tmp file(s) in ${dir}`)
    }
  } catch { /* best-effort */ }
}

/** SHA-256 of a buffer, returned as hex. */
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** Derive syncRunId from a Date (or 'now'). */
function makeSyncRunId(d = new Date()) {
  return d.toISOString()
    .replace(/[-:]/g, '')
    .replace('T', 'T')
    .slice(0, 15)  // 'YYYYMMDDTHHmmss'
}

/**
 * Real SFTP implementation — wraps `fly ssh sftp shell` and `fly ssh console`.
 * Used in production; tests inject a stub.
 */
const realSftp = {
  /**
   * List JSON sidecar filenames in the remote contributions directory.
   * Excludes subdirectories (processed/, failed/, quarantine/) and *.tmp files.
   * Returns an array of bare filenames like ['uuid1.json', 'uuid2.json'].
   */
  async ls() {
    try {
      const proc = Bun.spawn(
        ['fly', 'ssh', 'console', '--command',
          `sh -c 'ls -1 "${CONTRIBUTIONS_REMOTE_DIR}" 2>/dev/null || true'`,
          '-a', FLY_APP],
        { stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
      )
      const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      return stdout
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.endsWith('.json') && !l.includes('/'))
    } catch (err) {
      throw new Error(`sftp.ls failed: ${err.message}`)
    }
  },

  /**
   * Download files from the remote contributions directory to a local tmpDir.
   * Returns an array of local paths for the files actually written.
   *
   * @param {string[]} filenames  — bare filenames to fetch
   * @param {string}   localDir   — directory to write into
   */
  async get(filenames, localDir) {
    if (filenames.length === 0) return []
    mkdirSync(localDir, { recursive: true })

    // Build an SFTP batch script: one `get` per file
    const commands = filenames
      .map(f => `get "${CONTRIBUTIONS_REMOTE_DIR}/${f}" "${localDir}/${f}"`)
      .join('\n')

    try {
      const proc = Bun.spawn(
        ['fly', 'ssh', 'sftp', 'shell', '-a', FLY_APP],
        { stdin: new Blob([commands]), stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
      )
      await proc.exited
    } catch (err) {
      throw new Error(`sftp.get failed: ${err.message}`)
    }

    // Return whichever files actually landed
    return filenames
      .map(f => join(localDir, f))
      .filter(p => existsSync(p))
  },

  /**
   * Move a file on the remote Fly volume from remoteFrom to remoteTo.
   * Creates the target directory if absent (via mkdir -p).
   * Throws on spawn failure; the caller decides how to handle that.
   */
  async mv(remoteFrom, remoteTo) {
    const remoteDir = remoteTo.replace(/\/[^/]+$/, '')
    const mvScript = `mkdir -p "${remoteDir}" && mv "${remoteFrom}" "${remoteTo}"`
    const proc = Bun.spawn(
      ['fly', 'ssh', 'console', '--command', `sh -c '${mvScript}'`, '-a', FLY_APP],
      { stdout: 'pipe', stderr: 'pipe', env: FLY_ENV }
    )
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`sftp.mv failed (exit ${exitCode}): ${stderr.trim()}`)
    }
  },
}

/**
 * Read the processed/ dir recursively to collect all contributionIds that have
 * already been merged in a prior cycle. Used for cross-cycle dedup.
 */
function collectProcessedIds(processedDir) {
  const ids = new Set()
  if (!existsSync(processedDir)) return ids
  try {
    const recurse = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          recurse(join(dir, entry.name))
        } else if (entry.name.endsWith('.json')) {
          // filename is {uuid}.json — the uuid IS the contributionId
          ids.add(basename(entry.name, '.json'))
        }
      }
    }
    recurse(processedDir)
  } catch { /* best-effort */ }
  return ids
}

/**
 * archiveMergedSidecars — post-merge cleanup for phase-0.
 *
 * For each successfully merged contributionId:
 *   1. Copies the local /tmp sidecar to local processed/{date}/{uuid}.json so
 *      cross-cycle dedup works even if the remote mv fails.
 *   2. MVs the source sidecar on Fly from contributions/{uuid}.json to
 *      contributions/processed/{date}/{uuid}.json (permanent archive).
 *      The mv is best-effort; failure is logged and journalled but non-fatal.
 *
 * @param {string[]}  mergedIds  — contributionIds that were just merged
 * @param {{ sftp, root, localPathById, journalPath, syncRunId }} opts
 * @returns {{ archivedIds: string[], failedMv: string[], date: string }}
 */
export async function archiveMergedSidecars(mergedIds, {
  sftp = realSftp,
  root = ROOT,
  localPathById = {},
  journalPath = getSyncLogPath(),
  syncRunId = '',
} = {}) {
  if (mergedIds.length === 0) {
    return { archivedIds: [], failedMv: [], date: '' }
  }

  const date = new Date().toISOString().slice(0, 10)
  const localProcessedDateDir = join(getProcessedDir(root), date)
  mkdirSync(localProcessedDateDir, { recursive: true })

  const archivedIds = []
  const failedMv = []

  for (const id of mergedIds) {
    const localSrc = localPathById[id]
    const localDst = join(localProcessedDateDir, `${id}.json`)

    // Step 1: local copy (must happen before remote mv so dedup holds even on mv failure)
    if (localSrc && existsSync(localSrc)) {
      try {
        copyFileSync(localSrc, localDst)
      } catch (copyErr) {
        log(`archiveMergedSidecars: local copy failed for ${id}: ${copyErr.message}`)
        // Non-fatal — proceed to remote mv attempt anyway
      }
    }

    // Step 2: remote mv (best-effort)
    const remoteFrom = `${CONTRIBUTIONS_REMOTE_DIR}/${id}.json`
    const remoteTo = `${CONTRIBUTIONS_REMOTE_DIR}/processed/${date}/${id}.json`
    try {
      await sftp.mv(remoteFrom, remoteTo)
      archivedIds.push(id)
    } catch (mvErr) {
      log(`archiveMergedSidecars: remote mv failed for ${id}: ${mvErr.message}`)
      failedMv.push(id)
      if (!archivedIds.includes(id)) archivedIds.push(id)
    }
  }

  appendSyncLog(journalPath, {
    syncRunId,
    ts: new Date().toISOString(),
    outcome: 'archived',
    archivedIds,
    failedMv,
    date,
  })

  return { archivedIds, failedMv, date }
}

/**
 * Increment the attempts counter for a quarantined file.
 * Returns the new count.
 */
function bumpAttempts(failedDir, uuid, lastError) {
  mkdirSync(failedDir, { recursive: true })
  const attFile = join(failedDir, `${uuid}.attempts`)
  let data = { count: 0, lastError: '', lastAt: '' }
  try { data = JSON.parse(readFileSync(attFile, 'utf8')) } catch { /* first attempt */ }
  data.count++
  data.lastError = lastError
  data.lastAt = new Date().toISOString()
  writeFileSync(attFile, JSON.stringify(data))
  return data.count
}

/**
 * pullContributions — phase-0 of each sync run.
 *
 * Downloads MCP write-tool sidecars from the Fly volume and merges them into
 * local data/editorial/state.json before the destructive Turso sync runs.
 *
 * @param {{ sftp?: object }} opts — inject a stub for tests
 * @returns {{ syncRunId, mergedIds, preStatePath, quarantined }}
 */
export async function pullContributions({
  sftp = realSftp,
  root = ROOT,
  telegram = sendTelegram,
} = {}) {
  const statePath = join(root, 'data/editorial/state.json')
  const lockPath = getStateLockPath(root)
  const backupDir = getBackupDir(root)
  const processedDir = getProcessedDir(root)
  const failedDir = getFailedDir(root)
  const journalPath = getSyncLogPath(root)
  const runStart = Date.now()
  const syncRunId = makeSyncRunId()

  // 0. Acquire state lock (60s timeout)
  await waitAndAcquireStateLock(lockPath, { owner: 'pullContributions', timeoutMs: 60_000, intervalMs: 500 })

  let preStatePath = null

  try {
    // 1. Stale .tmp cleanup
    cleanupStaleTmpFiles(join(root, 'data/editorial'))

    // 2. Snapshot state.json before any mutation
    if (!existsSync(statePath)) {
      // No state.json yet — nothing to protect, but we can still proceed
      log('pullContributions: state.json not found — proceeding without snapshot')
    } else {
      try {
        preStatePath = snapshotState(statePath, backupDir, 'pre-pull')
        pruneSnapshots(backupDir, 'pre-pull', 30)
      } catch (snapErr) {
        const msg = `snapshot failed: ${snapErr.message}`
        appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'snapshot_failed', error: msg })
        await telegram(`🚨 SNI sync snapshot_failed — ${msg}. Cannot proceed safely.`)
        throw new Error(`pullContributions: ${msg}`)
      }
    }

    // 3. SFTP ls + get with partial-listing detection
    let remoteFilenames
    try {
      remoteFilenames = await sftp.ls()
    } catch (lsErr) {
      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'sftp_failed', error: lsErr.message, preStatePath, elapsedMs: Date.now() - runStart })
      return { syncRunId, mergedIds: [], preStatePath, quarantined: [] }
    }

    if (remoteFilenames.length === 0) {
      log('pullContributions: no contributions on Fly — nothing to merge')
      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'success', merged: [], skippedDuplicates: 0, quarantined: 0, elapsedMs: Date.now() - runStart })
      return { syncRunId, mergedIds: [], preStatePath, quarantined: [] }
    }

    log(`pullContributions: found ${remoteFilenames.length} sidecar(s) on Fly`)

    const pullDir = mkdtempSync(join(tmpdir(), 'sni-mcp-pull-'))
    let localFiles
    try {
      localFiles = await sftp.get(remoteFilenames, pullDir)
    } catch (getErr) {
      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'sftp_failed', error: getErr.message, preStatePath, elapsedMs: Date.now() - runStart })
      return { syncRunId, mergedIds: [], preStatePath, quarantined: [] }
    }

    // Count check: if we got fewer files than ls reported, abort
    if (localFiles.length < remoteFilenames.length) {
      const msg = `ls reported ${remoteFilenames.length} files but get only returned ${localFiles.length}`
      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'sftp_partial', error: msg, preStatePath, elapsedMs: Date.now() - runStart })
      log(`pullContributions: ${msg} — aborting (will retry next run)`)
      return { syncRunId, mergedIds: [], preStatePath, quarantined: [] }
    }

    // 4. Parse + validate each sidecar; quarantine failures
    const validSidecars = []
    const quarantinedIds = []
    const localPathById = {}  // contributionId → local tmp path (for archiveMergedSidecars)
    const today = new Date().toISOString().slice(0, 10)
    const quarantineDir = getQuarantineDir(root, today)

    for (const localPath of localFiles) {
      const uuid = basename(localPath, '.json')
      let sidecar

      // Parse
      try {
        sidecar = JSON.parse(readFileSync(localPath, 'utf8'))
      } catch (parseErr) {
        const attempts = bumpAttempts(failedDir, uuid, `parse error: ${parseErr.message}`)
        mkdirSync(quarantineDir, { recursive: true })
        try { copyFileSync(localPath, join(quarantineDir, basename(localPath))) } catch { /* best-effort */ }
        quarantinedIds.push(uuid)
        if (attempts >= 3) {
          await telegram(`🚨 SNI sync quarantine — ${uuid} has failed ${attempts} times (parse error). Manual review needed.`)
        }
        continue
      }

      // Validate shape via single-element array call
      try {
        const r = validatePendingContributions([sidecar])
        if (r.errors.length > 0) {
          const errMsg = r.errors.map(e => e.message).join('; ')
          const attempts = bumpAttempts(failedDir, uuid, `validation error: ${errMsg}`)
          mkdirSync(quarantineDir, { recursive: true })
          try { copyFileSync(localPath, join(quarantineDir, basename(localPath))) } catch { /* best-effort */ }
          quarantinedIds.push(uuid)
          if (attempts >= 3) {
            await telegram(`🚨 SNI sync quarantine — ${uuid} has failed ${attempts} times (validation: ${errMsg}). Manual review needed.`)
          }
          continue
        }
      } catch (valErr) {
        // Validator threw — treat as invalid
        const attempts = bumpAttempts(failedDir, uuid, `validator threw: ${valErr.message}`)
        mkdirSync(quarantineDir, { recursive: true })
        try { copyFileSync(localPath, join(quarantineDir, basename(localPath))) } catch { /* best-effort */ }
        quarantinedIds.push(uuid)
        if (attempts >= 3) {
          await telegram(`🚨 SNI sync quarantine — ${uuid} has failed ${attempts} times (validator threw). Manual review needed.`)
        }
        continue
      }

      // payloadHash verification (v1.1+ sidecars only — field is optional)
      if (sidecar.payloadHash !== undefined) {
        const expected = sha256(JSON.stringify(sidecar.payload))
        if (sidecar.payloadHash !== expected) {
          const tamperedDir = getTamperedDir(root, today)
          mkdirSync(tamperedDir, { recursive: true })
          try { copyFileSync(localPath, join(tamperedDir, basename(localPath))) } catch { /* best-effort */ }
          quarantinedIds.push(uuid)
          await telegram(`🚨 SNI sync tampered — ${uuid} payloadHash mismatch. Storage corruption or sender bug. Manual review needed.`)
          continue
        }
      }

      localPathById[sidecar.contributionId] = localPath
      validSidecars.push(sidecar)
    }

    // 5. Load state, initialise pendingContributions if absent
    let state = {}
    if (existsSync(statePath)) {
      try {
        state = JSON.parse(readFileSync(statePath, 'utf8'))
      } catch (parseErr) {
        // Corrupt state — snapshot exists, validation will catch it below
        warn(`pullContributions: state.json parse error: ${parseErr.message}`)
      }
    }
    if (!Array.isArray(state.pendingContributions)) {
      state.pendingContributions = []
    }

    // 6. Build dedup set: existing pendingContributions + processed/ files
    const existingIds = new Set(state.pendingContributions.map(c => c.contributionId))
    const processedIds = collectProcessedIds(processedDir)
    const allKnownIds = new Set([...existingIds, ...processedIds])

    // 7. Append non-duplicate sidecars
    let skippedDuplicates = 0
    const mergedIds = []
    const warnings = []

    for (const sidecar of validSidecars) {
      if (allKnownIds.has(sidecar.contributionId)) {
        skippedDuplicates++
        continue
      }

      // Age warning for very old sidecars (>90 days)
      const sidecarAge = sidecar.ts ? (Date.now() - new Date(sidecar.ts).getTime()) : 0
      if (sidecarAge > 90 * 24 * 60 * 60 * 1000) {
        warnings.push(`${sidecar.contributionId}: sidecar age ${Math.round(sidecarAge / 86400000)}d`)
      }

      state.pendingContributions.push(sidecar)
      allKnownIds.add(sidecar.contributionId)
      mergedIds.push(sidecar.contributionId)
    }

    // 8. Validate state with merged contributions (try/catch — throws = invalid)
    let preStateSha = null
    let postStateSha = null

    if (preStatePath) {
      try { preStateSha = sha256(readFileSync(preStatePath)) } catch { /* non-critical */ }
    }

    try {
      const validation = validateEditorialState(state)
      if (!validation.valid) {
        const errMsg = validation.errors.slice(0, 3).map(e => e.message).join('; ')
        appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'validation_failed', error: errMsg, preStatePath, elapsedMs: Date.now() - runStart })
        await telegram(`🚨 SNI sync validation_failed — ${errMsg}. State snapshot: ${preStatePath}`)
        // State is UNTOUCHED — we haven't written yet
        return { syncRunId, mergedIds: [], preStatePath, quarantined: quarantinedIds }
      }
    } catch (valErr) {
      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'validation_failed', error: valErr.message, preStatePath, elapsedMs: Date.now() - runStart })
      await telegram(`🚨 SNI sync validation_failed — validator threw: ${valErr.message}. State snapshot: ${preStatePath}`)
      return { syncRunId, mergedIds: [], preStatePath, quarantined: quarantinedIds }
    }

    // 9. Atomic write state.json (.tmp → rename)
    const stateJson = JSON.stringify(state, null, 2)
    const tmpPath = statePath + '.tmp'

    try {
      writeFileSync(tmpPath, stateJson)
      renameSync(tmpPath, statePath)
    } catch (writeErr) {
      // Write failed — try to restore from snapshot
      try { unlinkSync(tmpPath) } catch { /* cleanup best-effort */ }

      if (preStatePath && existsSync(preStatePath)) {
        try {
          copyFileSync(preStatePath, statePath)
          log('pullContributions: restored state.json from snapshot after write failure')
        } catch (restoreErr) {
          const msg = `write failed AND restore failed: ${writeErr.message} / ${restoreErr.message}`
          appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'restore_failed', error: msg, preStatePath, elapsedMs: Date.now() - runStart })
          await telegram(`🚨 SNI sync restore_failed — ${msg}. Manual restore from ${preStatePath} required.`)
          throw new Error(`pullContributions: ${msg}`)
        }
      }

      appendSyncLog(journalPath, { syncRunId, ts: new Date().toISOString(), outcome: 'write_failed', error: writeErr.message, preStatePath, elapsedMs: Date.now() - runStart })
      throw new Error(`pullContributions: atomic write failed: ${writeErr.message}`)
    }

    try { postStateSha = sha256(readFileSync(statePath)) } catch { /* non-critical */ }

    // 10. Append success to sync log
    appendSyncLog(journalPath, {
      syncRunId,
      ts: new Date().toISOString(),
      outcome: 'success',
      merged: mergedIds,
      skippedDuplicates,
      quarantined: quarantinedIds.length,
      preStateSha,
      postStateSha,
      elapsedMs: Date.now() - runStart,
      ...(warnings.length > 0 ? { warnings } : {}),
    })

    // 11. Archive merged sidecars (best-effort — non-fatal on mv failure)
    // Runs after success is journalled so the success entry always comes first.
    if (mergedIds.length > 0) {
      await archiveMergedSidecars(mergedIds, { sftp, root, localPathById, journalPath, syncRunId })
    }

    if (mergedIds.length > 0) {
      log(`pullContributions: merged ${mergedIds.length} contribution(s), skipped ${skippedDuplicates} duplicate(s)`)
    }

    return { syncRunId, mergedIds, preStatePath, quarantined: quarantinedIds }

  } finally {
    // 11. Always release the lock — even on thrown errors
    releaseStateLock(lockPath)
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const start = performance.now()
  log('Starting sync to Turso...')

  // Stale .tmp cleanup at top of every run
  cleanupStaleTmpFiles(join(ROOT, 'data/editorial'))

  const db = createSyncDb()
  if (!db) {
    // createSyncDb already logged the warning
    process.exit(0)
  }

  // Phase 0: pull MCP contributions from Fly volume → merge into state.json
  // Must run BEFORE syncEditorialState (which does a destructive DELETE+INSERT).
  let pullResult
  try {
    pullResult = await pullContributions()
  } catch (e) {
    // pullContributions handles its own logging + alerts; just exit non-zero
    console.error('[sync] pullContributions failed:', e.message)
    process.exit(1)
  }

  try {
    // Ensure schema is up to date
    await migrateSchema(db)

    // Sync all data types
    await syncArticles(db)

    // Validate editorial state before syncing — block if errors found
    const statePath = join(ROOT, 'data/editorial/state.json')
    if (existsSync(statePath)) {
      try {
        const rawState = JSON.parse(readFileSync(statePath, 'utf8'))
        const validation = validateEditorialState(rawState)
        if (!validation.valid) {
          console.error(`[sync] Editorial validation failed (${validation.errors.length} errors) — skipping editorial sync`)
          validation.errors.slice(0, 5).forEach(e => console.error(`[sync]   ${e.message}`))
          if (validation.errors.length > 5) console.error(`[sync]   ... and ${validation.errors.length - 5} more`)
        } else {
          await syncEditorialState(db)
          if (validation.warnings.length > 0) {
            log(`Editorial: synced with ${validation.warnings.length} warnings`)
          }
        }
      } catch (err) {
        console.error(`[sync] Editorial state parse error: ${err.message} — skipping editorial sync`)
      }
    } else {
      log('Editorial: state.json not found — skipping')
    }

    await syncPodcasts(db)

    // Sync output/ files to Fly volume (draft, links, review, evaluate, published)
    await syncOutputFiles()

    const elapsed = ((performance.now() - start) / 1000).toFixed(1)
    log(`Complete in ${elapsed}s`)
    process.exit(0)
  } catch (err) {
    console.error('[sync] FATAL after phase-0 merge:', err.message || err)
    if (err.stack) console.error(err.stack)
    if (pullResult?.preStatePath) {
      console.error(`[sync] state.json snapshot at: ${pullResult.preStatePath}`)
    }
    appendSyncLog(getSyncLogPath(), {
      syncRunId: pullResult?.syncRunId ?? new Date().toISOString(),
      ts: new Date().toISOString(),
      outcome: 'partial',
      failedPhase: err.message,
      preStatePath: pullResult?.preStatePath ?? null,
    })
    await sendTelegram(`🚨 SNI sync FATAL after phase-0 merge: ${err.message}. State snapshot: ${pullResult?.preStatePath ?? 'unknown'}`)
    process.exit(1)
  }
}

main()
