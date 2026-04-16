/**
 * db.js — Turso (libSQL) client singleton + schema migration
 *
 * Exports:
 *   createTestDb()       — in-memory libSQL client for tests
 *   createProductionDb() — Turso client (embedded replica on Fly, remote elsewhere)
 *   migrateSchema(db)    — idempotent CREATE TABLE IF NOT EXISTS for all tables
 *   getDb()              — singleton; uses test DB when SNI_TEST_MODE=1
 */

const SCHEMA_VERSION = 3

import { createClient } from '@libsql/client'
import { loadEnvKey } from './env.js'

// ---------------------------------------------------------------------------
// Client factories
// ---------------------------------------------------------------------------

/** In-memory libSQL client for tests. */
export function createTestDb() {
  return createClient({ url: ':memory:' })
}

/**
 * Production Turso client.
 * On Fly.io (FLY_MACHINE_ID set): embedded replica with local file + remote sync.
 * Elsewhere: remote-only connection.
 */
export function createProductionDb() {
  const url = loadEnvKey('TURSO_DATABASE_URL')
  const authToken = loadEnvKey('TURSO_AUTH_TOKEN')
  if (!url) {
    throw new Error('[db] TURSO_DATABASE_URL not set — cannot create production client')
  }

  const isFly = !!process.env.FLY_MACHINE_ID
  if (isFly) {
    return createClient({
      url: 'file:/app/data/local.db',
      syncUrl: url,
      authToken,
      syncInterval: 30,
    })
  }

  return createClient({ url, authToken })
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _db = null

/** Returns the singleton DB client. Uses in-memory DB when SNI_TEST_MODE=1. */
export function getDb() {
  if (_db) return _db
  const isTest = process.env.SNI_TEST_MODE === '1'
  _db = isTest ? createTestDb() : createProductionDb()
  return _db
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Batch-safe DDL statements — regular CREATE TABLE / INDEX.
 * These can be executed together via db.batch().
 */
const BATCH_STATEMENTS = [
  // -- articles
  `CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    source TEXT,
    source_type TEXT NOT NULL,
    date_published TEXT NOT NULL,
    date_verified_method TEXT,
    date_confidence TEXT,
    sector TEXT NOT NULL,
    keywords_matched TEXT,
    snippet TEXT,
    full_text TEXT,
    scraped_at TEXT,
    found_by TEXT,
    score REAL,
    confidence TEXT,
    score_reason TEXT,
    discovery_source TEXT,
    source_episode TEXT,
    ingested_at TEXT,
    archived INTEGER DEFAULT 0,
    flagged INTEGER DEFAULT 0,
    flag_reason TEXT,
    deleted_at TEXT,
    ainewshub_meta TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    synced_at TEXT,
    UNIQUE(date_published, sector, slug)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date_published DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_sector ON articles(sector)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_scraped ON articles(scraped_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_source_type ON articles(source_type)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_date_sector ON articles(date_published, sector)`,
  `CREATE INDEX IF NOT EXISTS idx_articles_flagged ON articles(flagged) WHERE flagged = 1`,
  `CREATE INDEX IF NOT EXISTS idx_articles_deleted ON articles(deleted_at) WHERE deleted_at IS NOT NULL`,

  // -- analysis_entries
  `CREATE TABLE IF NOT EXISTS analysis_entries (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT,
    host TEXT,
    participants TEXT,
    filename TEXT,
    url TEXT,
    date TEXT,
    date_processed TEXT,
    session INTEGER NOT NULL,
    tier INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    themes TEXT,
    summary TEXT,
    key_themes TEXT,
    post_potential TEXT,
    post_potential_reasoning TEXT,
    transcript TEXT,
    reconstructed INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_analysis_session ON analysis_entries(session DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_tier ON analysis_entries(tier)`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_status ON analysis_entries(status)`,
  `CREATE INDEX IF NOT EXISTS idx_analysis_archived ON analysis_entries(archived)`,

  // -- themes
  `CREATE TABLE IF NOT EXISTS themes (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_session TEXT,
    last_updated_session TEXT,
    document_count INTEGER DEFAULT 0,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // -- theme_evidence
  `CREATE TABLE IF NOT EXISTS theme_evidence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    theme_code TEXT NOT NULL REFERENCES themes(code),
    session INTEGER NOT NULL,
    source TEXT,
    content TEXT,
    url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_evidence_theme ON theme_evidence(theme_code)`,
  `CREATE INDEX IF NOT EXISTS idx_evidence_session ON theme_evidence(session DESC)`,

  // -- theme_connections
  `CREATE TABLE IF NOT EXISTS theme_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_code TEXT NOT NULL REFERENCES themes(code),
    to_code TEXT NOT NULL REFERENCES themes(code),
    reasoning TEXT,
    UNIQUE(from_code, to_code)
  )`,

  // -- posts
  `CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    working_title TEXT,
    status TEXT DEFAULT 'suggested',
    date_added TEXT,
    session INTEGER,
    core_argument TEXT,
    format TEXT,
    source_documents TEXT,
    source_urls TEXT,
    freshness TEXT DEFAULT 'evergreen',
    priority TEXT DEFAULT 'medium',
    notes TEXT,
    date_published TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status)`,
  `CREATE INDEX IF NOT EXISTS idx_posts_priority ON posts(priority)`,

  // -- decisions
  `CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    session INTEGER NOT NULL,
    title TEXT NOT NULL,
    decision TEXT NOT NULL,
    reasoning TEXT,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // -- counters
  `CREATE TABLE IF NOT EXISTS counters (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  )`,

  // -- activity
  `CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT DEFAULT '',
    timestamp TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type)`,

  // -- notifications
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    post_id INTEGER,
    title TEXT NOT NULL,
    priority TEXT,
    detail TEXT DEFAULT '',
    timestamp TEXT DEFAULT (datetime('now')),
    dismissed INTEGER DEFAULT 0
  )`,

  // -- episodes
  `CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    date TEXT NOT NULL,
    source TEXT NOT NULL,
    source_slug TEXT NOT NULL,
    title TEXT NOT NULL,
    week INTEGER,
    year INTEGER,
    duration INTEGER,
    episode_url TEXT,
    tier INTEGER DEFAULT 1,
    summary TEXT,
    archived INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_episodes_week ON episodes(week DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes(source_slug)`,
  `CREATE INDEX IF NOT EXISTS idx_episodes_date ON episodes(date DESC)`,

  // -- episode_stories
  `CREATE TABLE IF NOT EXISTS episode_stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL REFERENCES episodes(id),
    headline TEXT NOT NULL,
    detail TEXT,
    url TEXT,
    sector TEXT DEFAULT 'general-ai'
  )`,

  `CREATE INDEX IF NOT EXISTS idx_stories_episode ON episode_stories(episode_id)`,

  // -- published
  `CREATE TABLE IF NOT EXISTS published (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    post_id INTEGER,
    week INTEGER,
    date TEXT,
    title TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // -- cost_log
  `CREATE TABLE IF NOT EXISTS cost_log (
    session_id TEXT PRIMARY KEY,
    timestamp TEXT,
    elapsed TEXT,
    stage TEXT,
    costs TEXT,
    total REAL
  )`,

  // -- stories
  `CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session INTEGER NOT NULL,
    headline TEXT NOT NULL,
    detail TEXT,
    url TEXT,
    type TEXT,
    sector TEXT,
    source_file TEXT
  )`,

  `CREATE INDEX IF NOT EXISTS idx_stories_session ON stories(session)`,

  // -- rotation_candidates
  `CREATE TABLE IF NOT EXISTS rotation_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT
  )`,

  // -- permanent_preferences
  `CREATE TABLE IF NOT EXISTS permanent_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL
  )`,

  // -- bug_reports
  `CREATE TABLE IF NOT EXISTS bug_reports (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    component TEXT,
    status TEXT DEFAULT 'open',
    severity TEXT DEFAULT 'medium',
    reported_by TEXT,
    reported_by_name TEXT,
    reported_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolution_notes TEXT,
    triage_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_bug_reports_status ON bug_reports(status)`,

  // -- published_posts (Scott's published articles/newsletters — the ground truth
  // for writing style. Used as few-shot references by the editorial chat.)
  `CREATE TABLE IF NOT EXISTS published_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    date_published TEXT,
    url TEXT,
    category TEXT DEFAULT 'article',
    body TEXT NOT NULL,
    word_count INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE INDEX IF NOT EXISTS idx_published_posts_category ON published_posts(category)`,
  `CREATE INDEX IF NOT EXISTS idx_published_posts_date ON published_posts(date_published)`,

  // -- schema_version
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )`,
]

/**
 * Statements that must be executed individually (FTS5, triggers, views).
 * libSQL batch() does not support VIRTUAL TABLE or TRIGGER statements.
 */
const SEQUENTIAL_STATEMENTS = [
  // -- FTS5 virtual table
  `CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
    title, source, snippet,
    content=articles, content_rowid=id
  )`,

  // -- FTS triggers
  `CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts(rowid, title, source, snippet)
    VALUES (new.id, new.title, new.source, new.snippet);
  END`,

  `CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, source, snippet)
    VALUES ('delete', old.id, old.title, old.source, old.snippet);
  END`,

  `CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
    INSERT INTO articles_fts(articles_fts, rowid, title, source, snippet)
    VALUES ('delete', old.id, old.title, old.source, old.snippet);
    INSERT INTO articles_fts(rowid, title, source, snippet)
    VALUES (new.id, new.title, new.source, new.snippet);
  END`,

  // -- corpus_stats view
  `CREATE VIEW IF NOT EXISTS corpus_stats AS
  SELECT
    (SELECT COUNT(*) FROM analysis_entries) AS total_documents,
    (SELECT COUNT(*) FROM analysis_entries WHERE tier = 1 AND status = 'active' AND archived = 0) AS active_tier1,
    (SELECT COUNT(*) FROM analysis_entries WHERE tier = 2 AND status = 'active' AND archived = 0) AS active_tier2,
    (SELECT COUNT(*) FROM analysis_entries WHERE status = 'retired') AS retired,
    (SELECT COUNT(*) FROM analysis_entries WHERE tier = 0) AS stubs,
    (SELECT COUNT(*) FROM analysis_entries WHERE tier = -1) AS reference_documents,
    (SELECT COUNT(*) FROM themes WHERE archived = 0) AS active_themes,
    (SELECT COUNT(*) FROM posts) AS total_posts,
    (SELECT COUNT(*) FROM posts WHERE status = 'published') AS posts_published,
    (SELECT COUNT(*) FROM posts WHERE status = 'approved') AS posts_approved`,
]

/**
 * Counter seeds — inserted only if counters table is empty.
 */
const COUNTER_SEEDS = [
  { key: 'nextSession', value: 56 },
  { key: 'nextDocument', value: 218 },
  { key: 'nextPost', value: 163 },
]

/**
 * Run all schema migrations. Idempotent — safe to call on every startup.
 * @param {import('@libsql/client').Client} db
 */
export async function migrateSchema(db) {
  // Check current schema version — skip if already up to date
  try {
    const vResult = await db.execute('SELECT MAX(version) AS v FROM schema_version')
    if (vResult.rows[0]?.v >= SCHEMA_VERSION) return
  } catch {
    // schema_version table doesn't exist yet — first run
  }

  // 1. Batch-safe DDL (tables + indexes)
  await db.batch(BATCH_STATEMENTS)

  // 2. Sequential DDL (FTS5, triggers, view) — must be one at a time
  for (const stmt of SEQUENTIAL_STATEMENTS) {
    await db.execute(stmt)
  }

  // 3. Seed counters if empty
  const existing = await db.execute("SELECT COUNT(*) AS cnt FROM counters")
  if (existing.rows[0].cnt === 0) {
    for (const { key, value } of COUNTER_SEEDS) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO counters (key, value) VALUES (?, ?)",
        args: [key, value],
      })
    }
  }

  // 4. Schema v3 additions: published_posts enrichment columns
  const addCol = async (table, col, type) => {
    try { await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`) }
    catch { /* column already exists */ }
  }
  await addCol('published_posts', 'format', 'TEXT')            // LinkedIn format classification
  await addCol('published_posts', 'opening_line', 'TEXT')      // First sentence for pattern matching
  await addCol('published_posts', 'iteate', 'TEXT')            // In-the-end-at-the-end text
  await addCol('published_posts', 'argument_structure', 'TEXT') // JSON array of paragraph roles

  // 5. Record schema version
  await db.execute({
    sql: "INSERT OR REPLACE INTO schema_version (version) VALUES (?)",
    args: [SCHEMA_VERSION],
  })
}
