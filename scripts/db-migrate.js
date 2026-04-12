#!/usr/bin/env bun
/**
 * db-migrate.js — One-time bulk migration from local JSON files to Turso
 *
 * Reads all existing data from the filesystem and inserts it into the
 * remote Turso database. Idempotent via INSERT OR IGNORE / INSERT OR REPLACE.
 *
 * Usage:
 *   bun scripts/db-migrate.js [--dry-run] [--articles-only] [--editorial-only] [--podcasts-only]
 *
 * Flags:
 *   --dry-run          Walk files and report counts, but don't write to DB
 *   --articles-only    Only migrate articles (verified, review, deleted, podcast-articles)
 *   --editorial-only   Only migrate editorial state (state.json + supporting files)
 *   --podcasts-only    Only migrate podcast digests
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createSyncDb } from './lib/db.js'
import { migrateSchema } from '../web/api/lib/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA = join(ROOT, 'data')

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const ARTICLES_ONLY = args.has('--articles-only')
const EDITORIAL_ONLY = args.has('--editorial-only')
const PODCASTS_ONLY = args.has('--podcasts-only')
const RUN_ALL = !ARTICLES_ONLY && !EDITORIAL_ONLY && !PODCASTS_ONLY

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely read and parse a JSON file. Returns null on any error. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** Ensure a value is a JSON string (stringify arrays/objects, pass through strings). */
function ensureJsonString(val) {
  if (val == null) return null
  if (typeof val === 'string') return val
  return JSON.stringify(val)
}

/** Convert boolean-ish value to 0/1 integer. */
function boolToInt(val) {
  if (val == null) return 0
  if (typeof val === 'number') return val ? 1 : 0
  return val ? 1 : 0
}

/**
 * Walk a directory tree of shape {date}/{sector}/{slug}.json
 * and yield { date, sector, slug, path } for each JSON file.
 */
function* walkArticleDir(dir) {
  if (!existsSync(dir)) return
  for (const dateDir of safeReaddir(dir)) {
    const datePath = join(dir, dateDir)
    if (!isDir(datePath)) continue
    for (const sectorDir of safeReaddir(datePath)) {
      const sectorPath = join(datePath, sectorDir)
      if (!isDir(sectorPath)) continue
      for (const file of safeReaddir(sectorPath)) {
        if (!file.endsWith('.json')) continue
        const slug = file.replace(/\.json$/, '')
        yield {
          date: dateDir,
          sector: sectorDir,
          slug,
          path: join(sectorPath, file),
        }
      }
    }
  }
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function isDir(p) {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Execute a batch of SQL statements via db.batch(). */
async function executeBatch(db, statements) {
  if (!statements.length) return
  await db.batch(statements)
}

function log(msg) {
  console.log(msg)
}

// ---------------------------------------------------------------------------
// Article migration
// ---------------------------------------------------------------------------

/**
 * Map a raw article JSON + directory metadata to DB column args.
 */
function articleToArgs(data, dirDate, dirSector, slug, opts = {}) {
  const sourceType = opts.sourceType || data.source_type || 'automated'
  const flagged = opts.flagged ? 1 : 0
  const deletedAt = opts.deleted ? (data.deleted_at || data.deletedAt || new Date().toISOString()) : null

  return [
    slug,
    data.title || slug,
    data.url || null,
    data.source || null,
    sourceType,
    data.date_published || dirDate,
    data.date_verified_method || null,
    data.date_confidence || null,
    data.sector || dirSector,
    ensureJsonString(data.keywords_matched),
    data.snippet || (data.full_text ? data.full_text.slice(0, 300) : null),
    data.full_text || null,
    data.scraped_at || null,
    ensureJsonString(data.found_by),
    data.score != null ? data.score : null,
    data.confidence || null,
    data.score_reason || null,
    data.discoverySource || data.discovery_source || null,
    data.sourceEpisode || data.source_episode || null,
    data.ingested_at || null,
    boolToInt(data.archived),
    flagged,
    data.flag_reason || null,
    deletedAt,
    data.ainewshub ? JSON.stringify(data.ainewshub) : null,
  ]
}

const ARTICLE_INSERT_SQL = `INSERT OR IGNORE INTO articles (
  slug, title, url, source, source_type,
  date_published, date_verified_method, date_confidence,
  sector, keywords_matched, snippet, full_text,
  scraped_at, found_by, score, confidence, score_reason,
  discovery_source, source_episode, ingested_at,
  archived, flagged, flag_reason, deleted_at, ainewshub_meta
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const BATCH_SIZE = 200

async function migrateArticles(db) {
  log('')
  log('--- Articles ---')

  const dirs = [
    { path: join(DATA, 'verified'), label: 'verified', opts: {} },
    { path: join(DATA, 'review'), label: 'review', opts: { flagged: true } },
    { path: join(DATA, 'deleted'), label: 'deleted', opts: { deleted: true } },
    { path: join(DATA, 'podcast-articles'), label: 'podcast-articles', opts: { sourceType: 'podcast-extract' } },
  ]

  let totalInserted = 0
  let totalErrors = 0

  for (const { path: dirPath, label, opts } of dirs) {
    if (!existsSync(dirPath)) {
      log(`  ${label}: directory not found, skipping`)
      continue
    }

    let inserted = 0
    let errors = 0
    let batch = []

    for (const { date, sector, slug, path } of walkArticleDir(dirPath)) {
      const data = readJson(path)
      if (!data) {
        errors++
        continue
      }

      const args = articleToArgs(data, date, sector, slug, opts)
      batch.push({ sql: ARTICLE_INSERT_SQL, args })

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) {
          try {
            await executeBatch(db, batch)
          } catch (err) {
            log(`    Batch error in ${label}: ${err.message}`)
            errors += batch.length
            batch = []
            continue
          }
        }
        inserted += batch.length
        batch = []
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      if (!DRY_RUN) {
        try {
          await executeBatch(db, batch)
        } catch (err) {
          log(`    Final batch error in ${label}: ${err.message}`)
          errors += batch.length
          batch = []
        }
      }
      inserted += batch.length
    }

    log(`  ${label}: ${inserted} inserted, ${errors} errors`)
    totalInserted += inserted
    totalErrors += errors
  }

  log(`  Total: ${totalInserted} inserted, ${totalErrors} errors`)
  return { inserted: totalInserted, errors: totalErrors }
}

// ---------------------------------------------------------------------------
// Editorial state migration
// ---------------------------------------------------------------------------

async function migrateEditorialState(db) {
  log('')
  log('--- Editorial State ---')

  const statePath = join(DATA, 'editorial', 'state.json')
  const state = readJson(statePath)
  if (!state) {
    log('  state.json not found or unreadable — skipping')
    return
  }

  // -- Counters
  if (state.counters) {
    if (!DRY_RUN) {
      const stmts = Object.entries(state.counters).map(([key, value]) => ({
        sql: 'INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)',
        args: [key, value],
      }))
      await executeBatch(db, stmts)
    }
    log(`  Counters: ${Object.keys(state.counters).length} keys`)
  }

  // -- Analysis entries
  if (state.analysisIndex) {
    const entries = Object.entries(state.analysisIndex)
    let batch = []

    for (const [id, e] of entries) {
      batch.push({
        sql: `INSERT OR REPLACE INTO analysis_entries (
          id, title, source, host, participants, filename, url, date,
          date_processed, session, tier, status, themes, summary,
          key_themes, post_potential, post_potential_reasoning, reconstructed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          parseInt(id, 10),
          e.title || '',
          e.source || null,
          e.host || null,
          ensureJsonString(e.participants),
          e.filename || null,
          e.url || null,
          e.date || null,
          e.dateProcessed || null,
          e.session ?? 0,
          e.tier ?? 1,
          e.status || 'active',
          ensureJsonString(e.themes),
          e.summary || null,
          e.keyThemes || null,
          e.postPotential || null,
          e.postPotentialReasoning || null,
          boolToInt(e._reconstructed),
        ],
      })

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) await executeBatch(db, batch)
        batch = []
      }
    }
    if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
    log(`  Analysis entries: ${entries.length}`)
  }

  // -- Themes
  if (state.themeRegistry) {
    const themes = Object.entries(state.themeRegistry)
    const themeBatch = []
    const evidenceBatch = []
    const connectionBatch = []

    for (const [code, t] of themes) {
      themeBatch.push({
        sql: `INSERT OR REPLACE INTO themes (
          code, name, created_session, last_updated_session, document_count, archived
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          code,
          t.name || code,
          t.created || null,
          t.lastUpdated || null,
          t.documentCount ?? 0,
          boolToInt(t.archived),
        ],
      })

      // Evidence
      if (Array.isArray(t.evidence)) {
        for (const ev of t.evidence) {
          evidenceBatch.push({
            sql: `INSERT INTO theme_evidence (theme_code, session, source, content, url)
                  VALUES (?, ?, ?, ?, ?)`,
            args: [
              code,
              ev.session ?? 0,
              ev.source || null,
              ev.content || null,
              ev.url || null,
            ],
          })
        }
      }

      // Cross-connections
      if (Array.isArray(t.crossConnections)) {
        for (const cc of t.crossConnections) {
          connectionBatch.push({
            sql: `INSERT OR IGNORE INTO theme_connections (from_code, to_code, reasoning)
                  VALUES (?, ?, ?)`,
            args: [code, cc.theme || cc.to_code, cc.reasoning || null],
          })
        }
      }
    }

    if (!DRY_RUN) {
      // Themes first (referenced by evidence and connections)
      for (let i = 0; i < themeBatch.length; i += BATCH_SIZE) {
        await executeBatch(db, themeBatch.slice(i, i + BATCH_SIZE))
      }
      for (let i = 0; i < evidenceBatch.length; i += BATCH_SIZE) {
        await executeBatch(db, evidenceBatch.slice(i, i + BATCH_SIZE))
      }
      for (let i = 0; i < connectionBatch.length; i += BATCH_SIZE) {
        await executeBatch(db, connectionBatch.slice(i, i + BATCH_SIZE))
      }
    }
    log(`  Themes: ${themes.length}`)
    log(`  Theme evidence: ${evidenceBatch.length}`)
    log(`  Theme connections: ${connectionBatch.length}`)
  }

  // -- Posts
  if (state.postBacklog) {
    const posts = Object.entries(state.postBacklog)
    let batch = []

    for (const [id, p] of posts) {
      batch.push({
        sql: `INSERT OR REPLACE INTO posts (
          id, title, working_title, status, date_added, session,
          core_argument, format, source_documents, source_urls,
          freshness, priority, notes, date_published
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          parseInt(id, 10),
          p.title || `Post #${id}`,
          p.workingTitle || null,
          p.status || 'suggested',
          p.dateAdded || null,
          p.session ?? null,
          p.coreArgument || null,
          p.format || null,
          ensureJsonString(p.sourceDocuments),
          ensureJsonString(p.sourceUrls),
          p.freshness || 'evergreen',
          p.priority || 'medium',
          p.notes || null,
          p.datePublished || null,
        ],
      })

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) await executeBatch(db, batch)
        batch = []
      }
    }
    if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
    log(`  Posts: ${posts.length}`)
  }

  // -- Decisions
  if (Array.isArray(state.decisionLog)) {
    let batch = []

    for (const d of state.decisionLog) {
      batch.push({
        sql: `INSERT OR REPLACE INTO decisions (id, session, title, decision, reasoning, archived)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          d.id || `decision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          d.session ?? 0,
          d.title || '',
          d.decision || '',
          d.reasoning || null,
          boolToInt(d.archived),
        ],
      })

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) await executeBatch(db, batch)
        batch = []
      }
    }
    if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
    log(`  Decisions: ${state.decisionLog.length}`)
  }

  // -- Permanent preferences
  if (Array.isArray(state.permanentPreferences)) {
    if (!DRY_RUN) {
      const stmts = state.permanentPreferences.map((pp) => ({
        sql: 'INSERT INTO permanent_preferences (title, content) VALUES (?, ?)',
        args: [pp.title || '', pp.content || ''],
      }))
      for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
        await executeBatch(db, stmts.slice(i, i + BATCH_SIZE))
      }
    }
    log(`  Permanent preferences: ${state.permanentPreferences.length}`)
  }

  // -- Rotation candidates
  if (Array.isArray(state.rotationCandidates) && state.rotationCandidates.length > 0) {
    if (!DRY_RUN) {
      const stmts = state.rotationCandidates.map((rc) => ({
        sql: 'INSERT INTO rotation_candidates (content) VALUES (?)',
        args: [typeof rc === 'string' ? rc : JSON.stringify(rc)],
      }))
      await executeBatch(db, stmts)
    }
    log(`  Rotation candidates: ${state.rotationCandidates.length}`)
  }
}

// ---------------------------------------------------------------------------
// Activity, notifications, cost-log, published, stories
// ---------------------------------------------------------------------------

async function migrateActivity(db) {
  const path = join(DATA, 'editorial', 'activity.json')
  const data = readJson(path)
  if (!Array.isArray(data) || data.length === 0) {
    log('  Activity: not found or empty')
    return
  }

  let batch = []
  for (const a of data) {
    batch.push({
      sql: 'INSERT INTO activity (type, title, detail, timestamp) VALUES (?, ?, ?, ?)',
      args: [
        a.type || 'unknown',
        a.title || '',
        a.detail || '',
        a.timestamp || null,
      ],
    })
    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await executeBatch(db, batch)
      batch = []
    }
  }
  if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
  log(`  Activity: ${data.length}`)
}

async function migrateNotifications(db) {
  const path = join(DATA, 'editorial', 'notifications.json')
  const data = readJson(path)
  if (!Array.isArray(data) || data.length === 0) {
    log('  Notifications: not found or empty')
    return
  }

  let batch = []
  for (const n of data) {
    batch.push({
      sql: `INSERT OR IGNORE INTO notifications (id, post_id, title, priority, detail, timestamp, dismissed)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        n.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        n.postId ?? null,
        n.title || '',
        n.priority || null,
        n.detail || '',
        n.timestamp || null,
        boolToInt(n.dismissed),
      ],
    })
    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await executeBatch(db, batch)
      batch = []
    }
  }
  if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
  log(`  Notifications: ${data.length}`)
}

async function migrateCostLog(db) {
  const path = join(DATA, 'editorial', 'cost-log.json')
  const data = readJson(path)
  if (!data) {
    log('  Cost log: not found or empty')
    return
  }

  // cost-log.json has { sessions: { sessionId: { timestamp, elapsed, stage, costs, total } }, weeks: {...} }
  const sessions = data.sessions || data
  if (typeof sessions !== 'object') {
    log('  Cost log: unexpected format')
    return
  }

  let count = 0
  let batch = []

  for (const [sessionId, entry] of Object.entries(sessions)) {
    batch.push({
      sql: `INSERT OR IGNORE INTO cost_log (session_id, timestamp, elapsed, stage, costs, total)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        sessionId,
        entry.timestamp || null,
        entry.elapsed || null,
        entry.stage || null,
        entry.costs ? JSON.stringify(entry.costs) : null,
        entry.total ?? null,
      ],
    })
    count++
    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await executeBatch(db, batch)
      batch = []
    }
  }
  if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
  log(`  Cost log: ${count} sessions`)
}

async function migratePublished(db) {
  const path = join(DATA, 'editorial', 'published.json')
  const data = readJson(path)
  if (!data) {
    log('  Published: not found or empty')
    return
  }

  // published.json has { newsletters: [...], linkedin: [...] }
  let count = 0
  let batch = []

  for (const type of ['newsletters', 'linkedin']) {
    const items = data[type]
    if (!Array.isArray(items)) continue

    for (const item of items) {
      batch.push({
        sql: `INSERT INTO published (type, post_id, week, date, title)
              VALUES (?, ?, ?, ?, ?)`,
        args: [
          type === 'newsletters' ? 'newsletter' : 'linkedin',
          item.postId ?? null,
          item.week ?? null,
          item.date || null,
          item.title || null,
        ],
      })
      count++
    }
  }

  if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
  log(`  Published: ${count}`)
}

async function migrateStories(db) {
  const editorialDir = join(DATA, 'editorial')
  const files = safeReaddir(editorialDir).filter((f) => f.match(/^stories-session-\d+\.json$/))

  if (files.length === 0) {
    log('  Stories: no session files found')
    return
  }

  let totalCount = 0
  let batch = []

  for (const file of files) {
    const sessionMatch = file.match(/stories-session-(\d+)\.json$/)
    const session = sessionMatch ? parseInt(sessionMatch[1], 10) : 0

    const stories = readJson(join(editorialDir, file))
    if (!Array.isArray(stories)) continue

    for (const s of stories) {
      batch.push({
        sql: `INSERT INTO stories (session, headline, detail, url, type, sector, source_file)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          session,
          s.headline || '',
          s.detail || null,
          s.url || null,
          s.type || null,
          s.sector || null,
          file,
        ],
      })
      totalCount++

      if (batch.length >= BATCH_SIZE) {
        if (!DRY_RUN) await executeBatch(db, batch)
        batch = []
      }
    }
  }

  if (batch.length > 0 && !DRY_RUN) await executeBatch(db, batch)
  log(`  Stories: ${totalCount} from ${files.length} session files`)
}

// ---------------------------------------------------------------------------
// Podcast migration
// ---------------------------------------------------------------------------

async function migratePodcasts(db) {
  log('')
  log('--- Podcasts ---')

  const podcastDir = join(DATA, 'podcasts')
  if (!existsSync(podcastDir)) {
    log('  Podcasts directory not found — skipping')
    return
  }

  // Walk data/podcasts/{date}/{source-slug}/{slug}.digest.json
  let episodeCount = 0
  let storyCount = 0
  let episodeBatch = []

  // Collect all digests first — we need the auto-generated IDs for episode_stories
  const digests = []

  for (const dateDir of safeReaddir(podcastDir)) {
    const datePath = join(podcastDir, dateDir)
    if (!isDir(datePath)) continue

    for (const sourceDir of safeReaddir(datePath)) {
      const sourcePath = join(datePath, sourceDir)
      if (!isDir(sourcePath)) continue

      for (const file of safeReaddir(sourcePath)) {
        if (!file.endsWith('.digest.json')) continue
        const digest = readJson(join(sourcePath, file))
        if (!digest) continue
        digests.push({ digest, sourceSlug: sourceDir, date: dateDir })
      }
    }
  }

  if (digests.length === 0) {
    log('  No digest files found')
    return
  }

  // Insert episodes
  for (const { digest, sourceSlug, date } of digests) {
    const filename = digest.filename || `${date}-${sourceSlug}-unknown.md`

    episodeBatch.push({
      sql: `INSERT OR IGNORE INTO episodes (
        filename, date, source, source_slug, title, week, year,
        duration, episode_url, tier, summary, archived
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        filename,
        digest.date || date,
        digest.source || sourceSlug,
        sourceSlug,
        digest.title || filename,
        digest.week ?? null,
        digest.year ?? null,
        parseDuration(digest.duration),
        digest.episodeUrl || null,
        digest.tier ?? 1,
        digest.summary || null,
        boolToInt(digest.archived),
      ],
    })
    episodeCount++

    if (episodeBatch.length >= BATCH_SIZE) {
      if (!DRY_RUN) await executeBatch(db, episodeBatch)
      episodeBatch = []
    }
  }

  if (episodeBatch.length > 0 && !DRY_RUN) await executeBatch(db, episodeBatch)
  log(`  Episodes: ${episodeCount}`)

  // Insert episode_stories — need to look up episode IDs by filename
  if (!DRY_RUN) {
    let storyBatch = []

    for (const { digest } of digests) {
      if (!Array.isArray(digest.key_stories) || digest.key_stories.length === 0) continue
      const filename = digest.filename || 'unknown'

      // Look up the episode ID
      const result = await db.execute({
        sql: 'SELECT id FROM episodes WHERE filename = ?',
        args: [filename],
      })
      const episodeId = result.rows[0]?.id
      if (!episodeId) continue

      for (const story of digest.key_stories) {
        storyBatch.push({
          sql: `INSERT INTO episode_stories (episode_id, headline, detail, url, sector)
                VALUES (?, ?, ?, ?, ?)`,
          args: [
            episodeId,
            story.headline || '',
            story.detail || null,
            story.url || null,
            story.sector || 'general-ai',
          ],
        })
        storyCount++

        if (storyBatch.length >= BATCH_SIZE) {
          await executeBatch(db, storyBatch)
          storyBatch = []
        }
      }
    }

    if (storyBatch.length > 0) await executeBatch(db, storyBatch)
  } else {
    // Dry-run: just count stories
    for (const { digest } of digests) {
      if (Array.isArray(digest.key_stories)) {
        storyCount += digest.key_stories.length
      }
    }
  }

  log(`  Episode stories: ${storyCount}`)
}

/**
 * Parse a duration string like "20 min" or "1h 30m" to integer minutes.
 * Returns null if unparseable.
 */
function parseDuration(val) {
  if (val == null) return null
  if (typeof val === 'number') return val
  const str = String(val).toLowerCase().trim()
  // "20 min", "45 minutes", "20"
  const minMatch = str.match(/^(\d+)\s*(min|minutes?)?$/)
  if (minMatch) return parseInt(minMatch[1], 10)
  // "1h 30m", "1h30m"
  const hmMatch = str.match(/(\d+)\s*h\s*(\d+)?\s*m?/)
  if (hmMatch) return parseInt(hmMatch[1], 10) * 60 + (parseInt(hmMatch[2], 10) || 0)
  return null
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verify(db) {
  log('')
  log('--- Verification ---')

  const tables = [
    'articles',
    'analysis_entries',
    'themes',
    'theme_evidence',
    'theme_connections',
    'posts',
    'decisions',
    'counters',
    'permanent_preferences',
    'activity',
    'notifications',
    'cost_log',
    'published',
    'stories',
    'episodes',
    'episode_stories',
  ]

  for (const table of tables) {
    try {
      const result = await db.execute(`SELECT COUNT(*) AS cnt FROM ${table}`)
      log(`  ${table}: ${result.rows[0].cnt}`)
    } catch (err) {
      log(`  ${table}: ERROR — ${err.message}`)
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('=== SNI Research → Turso Migration ===')
  if (DRY_RUN) log('[DRY RUN — no data will be written]')
  log('')

  // Connect to DB
  const db = DRY_RUN ? null : createSyncDb()
  if (!DRY_RUN && !db) {
    log('ERROR: Could not connect to Turso (check TURSO_DATABASE_URL in .env)')
    process.exit(1)
  }

  // Run schema migration first
  if (!DRY_RUN) {
    log('Running schema migration...')
    await migrateSchema(db)
    log('Schema migration complete')
  }

  // Migrate articles
  if (RUN_ALL || ARTICLES_ONLY) {
    await migrateArticles(db)
  }

  // Migrate editorial state
  if (RUN_ALL || EDITORIAL_ONLY) {
    await migrateEditorialState(db)
    await migrateActivity(db)
    await migrateNotifications(db)
    await migrateCostLog(db)
    await migratePublished(db)
    await migrateStories(db)
  }

  // Migrate podcasts
  if (RUN_ALL || PODCASTS_ONLY) {
    await migratePodcasts(db)
  }

  // Verification
  if (!DRY_RUN) {
    await verify(db)
  }

  log('')
  log('=== Migration complete ===')
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
