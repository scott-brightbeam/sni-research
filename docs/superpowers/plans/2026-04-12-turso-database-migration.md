# Turso Database Migration — Full Data Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat JSON file storage + fragile rsync sync with Turso (hosted libSQL), so all data is server-side and immediately available to the web UI and co-pilot.

**Architecture:** Local Mac pipeline scripts write to JSON files as they do now. A new `sync-to-turso.js` script reads those files and upserts to a hosted Turso database via HTTP. The Fly.io API server reads from a Turso embedded replica (local SQLite file synced from Turso primary). This eliminates the rsync/tarball/SSH sync mechanism entirely. The co-pilot can assemble context from the database instead of walking thousands of files.

**Tech Stack:** Turso (hosted libSQL), `@libsql/client` (async, HTTP + embedded replica), Bun runtime, Hono API framework, existing test suite (250 tests, 788 assertions).

**Key constraints:**
- Pipeline scripts (`fetch.js`, `score.js`, `editorial-analyse.js`, etc.) are NOT modified — they keep writing JSON files locally
- All API endpoint signatures and response shapes are preserved — the UI doesn't change
- Config files stay as YAML — loaded at startup, not queryable data
- Copilot chat threads and pins stay as JSONL/JSON files — they're per-session, low volume
- Draft markdown files stay on disk — they're single files read/written whole
- Published newsletters stay on disk — same reason

**FTS5 caveat:** There is a known bug (libsql#1811) where FTS5 crashes with parameterised queries in embedded replica mode. We use FTS5 via the remote connection only (for writes during sync), and read via embedded replica (which works fine for FTS5 SELECTs). If this bug is fixed upstream, the workaround can be removed.

---

## File structure

### New files

| File | Responsibility |
|------|---------------|
| `web/api/lib/db.js` | Turso client singleton + schema migration runner |
| `scripts/lib/db.js` | Turso client for pipeline scripts (remote-only, no embedded replica) |
| `scripts/sync-to-turso.js` | Walk local JSON files → upsert to Turso. Replaces `sync-to-cloud.sh` |
| `scripts/db-migrate.js` | One-time bulk import of all existing JSON data into Turso |
| `web/api/lib/article-queries.js` | All article SQL queries (SELECT, INSERT, UPDATE, DELETE) |
| `web/api/lib/editorial-queries.js` | All editorial state SQL queries |
| `web/api/lib/podcast-queries.js` | All podcast SQL queries |
| `web/api/tests/db.test.js` | Database module tests (connection, schema, migrations) |
| `web/api/tests/article-queries.test.js` | Article query tests against in-memory SQLite |
| `web/api/tests/editorial-queries.test.js` | Editorial query tests |
| `web/api/tests/podcast-queries.test.js` | Podcast query tests |
| `web/api/tests/sync.test.js` | Sync script logic tests |

### Modified files

| File | What changes |
|------|-------------|
| `web/api/routes/articles.js` (423 lines) | Replace `walkArticleDirAsync` calls with `article-queries.js`. Remove SWR cache. |
| `web/api/routes/status.js` (397 lines) | Replace walk-based counting with `SELECT COUNT(*) ... GROUP BY`. Remove SWR cache + startup warming. |
| `web/api/routes/editorial.js` (914 lines) | Replace `readJSON(STATE_PATH)` with editorial queries. Replace `saveState()` with DB transactions. |
| `web/api/routes/podcasts.js` (263 lines) | Replace manifest.json + digest file reads with podcast queries. Remove SWR cache. |
| `web/api/lib/context.js` (395 lines) | Replace `loadArticlesForWeek()`, `buildEditorialContext()`, `buildPodcastContext()` with DB queries. |
| `web/api/lib/walk.js` (109 lines) | Remove article-walking functions. Keep `validateParam()` only. |
| `web/api/server.js` (343 lines) | Replace cache warming with `db.migrate()`. Remove SWR startup setTimeout. |
| `web/api/package.json` | Add `@libsql/client` dependency. |
| `scripts/sync-to-cloud.sh` | Delete (replaced by `sync-to-turso.js`). |
| `Dockerfile` | Remove data volume mount for articles. Keep for `local.db` replica file. |
| `web/api/tests/articles.test.js` | Replace filesystem fixtures with DB fixtures. |
| `web/api/tests/status.test.js` | Same. |
| `web/api/tests/editorial.test.js` | Same. |
| `web/api/tests/podcasts.test.js` | Same. |

### Unchanged files

| File | Why unchanged |
|------|--------------|
| `scripts/fetch.js`, `scripts/ainewshub-fetch.js`, `scripts/score.js`, `scripts/editorial-discover.js` | Continue writing JSON files locally. Sync script pushes to Turso separately. |
| `scripts/lib/editorial-state.js` (811 lines) | Still manages local state.json for pipeline writes. Sync script reads it. |
| `scripts/editorial-analyse.js`, `scripts/editorial-draft.js`, `scripts/podcast-import.js` | Pipeline scripts unchanged. |
| `web/api/routes/chat.js` (462 lines) | Chat threads/pins stay as JSONL files. Low volume, per-session. |
| `web/api/routes/draft.js` (369 lines) | Drafts stay as markdown files. Single files read/written whole. |
| `web/api/routes/published.js` (182 lines) | Published newsletters stay as markdown files. |
| `web/api/routes/config.js` | Config stays as YAML files. |
| `web/api/routes/auth.js` | No data storage. |
| `config/*.yaml` | Configuration, not queryable data. |

---

## Database schema

```sql
-- ============================================================
-- ARTICLES (replaces data/verified/, data/review/, data/deleted/)
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
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
  keywords_matched TEXT,          -- JSON array string
  snippet TEXT,
  full_text TEXT,
  scraped_at TEXT,
  found_by TEXT,                  -- JSON array string
  score REAL,                     -- relevance score (0-10, nullable)
  confidence TEXT,
  score_reason TEXT,
  discovery_source TEXT,
  source_episode TEXT,
  ingested_at TEXT,
  archived INTEGER DEFAULT 0,
  flagged INTEGER DEFAULT 0,
  flag_reason TEXT,
  deleted_at TEXT,                -- soft delete timestamp
  ainewshub_meta TEXT,            -- JSON object for ainewshub enrichment
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  synced_at TEXT,                 -- when this row was last synced from local
  UNIQUE(date_published, sector, slug)
);

CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date_published DESC);
CREATE INDEX IF NOT EXISTS idx_articles_sector ON articles(sector);
CREATE INDEX IF NOT EXISTS idx_articles_scraped ON articles(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_source_type ON articles(source_type);
CREATE INDEX IF NOT EXISTS idx_articles_date_sector ON articles(date_published, sector);
CREATE INDEX IF NOT EXISTS idx_articles_flagged ON articles(flagged) WHERE flagged = 1;
CREATE INDEX IF NOT EXISTS idx_articles_deleted ON articles(deleted_at) WHERE deleted_at IS NOT NULL;

-- Full-text search (title + source + snippet)
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title, source, snippet,
  content=articles, content_rowid=id
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, source, snippet)
  VALUES (new.id, new.title, new.source, new.snippet);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, source, snippet)
  VALUES ('delete', old.id, old.title, old.source, old.snippet);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, source, snippet)
  VALUES ('delete', old.id, old.title, old.source, old.snippet);
  INSERT INTO articles_fts(rowid, title, source, snippet)
  VALUES (new.id, new.title, new.source, new.snippet);
END;

-- ============================================================
-- EDITORIAL: ANALYSIS INDEX (replaces state.json.analysisIndex)
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_entries (
  id INTEGER PRIMARY KEY,         -- matches state.json numeric ID
  title TEXT NOT NULL,
  source TEXT,
  host TEXT,
  participants TEXT,               -- JSON array
  filename TEXT,
  url TEXT,
  date TEXT,
  date_processed TEXT,
  session INTEGER NOT NULL,
  tier INTEGER DEFAULT 1,          -- -1=reference, 0=stub, 1=primary, 2=secondary
  status TEXT DEFAULT 'active',
  themes TEXT,                     -- JSON array of theme codes ["T01","T05"]
  summary TEXT,
  key_themes TEXT,
  post_potential TEXT,
  post_potential_reasoning TEXT,
  reconstructed INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,       -- separate from status (active/retired/stub)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_analysis_session ON analysis_entries(session DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_tier ON analysis_entries(tier);
CREATE INDEX IF NOT EXISTS idx_analysis_status ON analysis_entries(status);
CREATE INDEX IF NOT EXISTS idx_analysis_archived ON analysis_entries(archived);

-- ============================================================
-- EDITORIAL: THEME REGISTRY (replaces state.json.themeRegistry)
-- ============================================================
CREATE TABLE IF NOT EXISTS themes (
  code TEXT PRIMARY KEY,           -- T01, T02, etc.
  name TEXT NOT NULL,
  created_session TEXT,            -- "Session N"
  last_updated_session TEXT,       -- "Session N"
  document_count INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS theme_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_code TEXT NOT NULL REFERENCES themes(code),
  session INTEGER NOT NULL,
  source TEXT,
  content TEXT,
  url TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evidence_theme ON theme_evidence(theme_code);
CREATE INDEX IF NOT EXISTS idx_evidence_session ON theme_evidence(session DESC);

CREATE TABLE IF NOT EXISTS theme_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_code TEXT NOT NULL REFERENCES themes(code),
  to_code TEXT NOT NULL REFERENCES themes(code),
  reasoning TEXT,
  UNIQUE(from_code, to_code)
);

-- ============================================================
-- EDITORIAL: POST BACKLOG (replaces state.json.postBacklog)
-- ============================================================
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,          -- matches state.json numeric ID
  title TEXT NOT NULL,
  working_title TEXT,
  status TEXT DEFAULT 'suggested',
  date_added TEXT,
  session INTEGER,
  core_argument TEXT,
  format TEXT,
  source_documents TEXT,           -- JSON array of analysis entry IDs
  source_urls TEXT,                -- JSON array of URLs
  freshness TEXT DEFAULT 'evergreen',
  priority TEXT DEFAULT 'medium',
  notes TEXT,
  date_published TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_priority ON posts(priority);

-- ============================================================
-- EDITORIAL: DECISION LOG (replaces state.json.decisionLog)
-- ============================================================
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,             -- format: "N.M" (session.count)
  session INTEGER NOT NULL,
  title TEXT NOT NULL,
  decision TEXT NOT NULL,
  reasoning TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- EDITORIAL: COUNTERS (replaces state.json.counters)
-- ============================================================
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
-- Seed: INSERT INTO counters VALUES ('nextSession', 56), ('nextDocument', 218), ('nextPost', 163);

-- ============================================================
-- EDITORIAL: ACTIVITY LOG (replaces activity.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,               -- 'analyse', 'discover', 'draft', 'track', 'error'
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(type);

-- ============================================================
-- EDITORIAL: NOTIFICATIONS (replaces notifications.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  post_id INTEGER,
  title TEXT NOT NULL,
  priority TEXT,
  detail TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now')),
  dismissed INTEGER DEFAULT 0
);

-- ============================================================
-- EDITORIAL: CORPUS STATS (replaces state.json.corpusStats)
-- ============================================================
-- Computed as a VIEW rather than stored — always fresh
CREATE VIEW IF NOT EXISTS corpus_stats AS
SELECT
  (SELECT COUNT(*) FROM analysis_entries) AS total_documents,
  (SELECT COUNT(*) FROM analysis_entries WHERE tier = 1 AND status = 'active') AS active_tier1,
  (SELECT COUNT(*) FROM analysis_entries WHERE tier = 2 AND status = 'active') AS active_tier2,
  (SELECT COUNT(*) FROM analysis_entries WHERE status = 'retired') AS retired,
  (SELECT COUNT(*) FROM analysis_entries WHERE tier = 0) AS stubs,
  (SELECT COUNT(*) FROM analysis_entries WHERE tier = -1) AS reference_documents,
  (SELECT COUNT(*) FROM themes WHERE archived = 0) AS active_themes,
  (SELECT COUNT(*) FROM posts) AS total_posts,
  (SELECT COUNT(*) FROM posts WHERE status = 'published') AS posts_published,
  (SELECT COUNT(*) FROM posts WHERE status = 'approved') AS posts_approved;

-- ============================================================
-- PODCASTS (replaces manifest.json + digest files)
-- ============================================================
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,    -- manifest key
  date TEXT NOT NULL,
  source TEXT NOT NULL,
  source_slug TEXT NOT NULL,
  title TEXT NOT NULL,
  week INTEGER,
  year INTEGER,
  duration INTEGER,                 -- minutes
  episode_url TEXT,
  tier INTEGER DEFAULT 1,
  summary TEXT,
  archived INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_episodes_week ON episodes(week DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes(source_slug);
CREATE INDEX IF NOT EXISTS idx_episodes_date ON episodes(date DESC);

CREATE TABLE IF NOT EXISTS episode_stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id),
  headline TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  sector TEXT DEFAULT 'general-ai'
);

CREATE INDEX IF NOT EXISTS idx_stories_episode ON episode_stories(episode_id);

-- ============================================================
-- EDITORIAL: PUBLISHED TRACKING (replaces published.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS published (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,               -- 'newsletter' | 'linkedin'
  post_id INTEGER,
  week INTEGER,
  date TEXT,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- EDITORIAL: COST LOG (replaces cost-log.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS cost_log (
  session_id TEXT PRIMARY KEY,
  timestamp TEXT,
  elapsed TEXT,
  stage TEXT,
  costs TEXT,                       -- JSON: {opus:{calls,cost}, gemini:{calls,cost}, openai:{calls,cost}}
  total REAL
);

-- ============================================================
-- EDITORIAL: STORIES SESSION (replaces stories-session-N.json)
-- ============================================================
CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session INTEGER NOT NULL,
  headline TEXT NOT NULL,
  detail TEXT,
  url TEXT,
  type TEXT,                        -- 'product-launch', 'research', 'regulation', 'other'
  sector TEXT,
  source_file TEXT
);

CREATE INDEX IF NOT EXISTS idx_stories_session ON stories(session);

-- ============================================================
-- EDITORIAL: PERMANENT PREFERENCES (replaces state.json.permanentPreferences)
-- ============================================================
-- ============================================================
-- EDITORIAL: ROTATION CANDIDATES (replaces state.json.rotationCandidates)
-- Currently always empty in live data — included for schema completeness
-- ============================================================
CREATE TABLE IF NOT EXISTS rotation_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT                      -- JSON blob if ever populated
);

CREATE TABLE IF NOT EXISTS permanent_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL
);

-- ============================================================
-- SCHEMA VERSION TRACKING
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
```

---

## Task breakdown

### Task 1: Turso setup + database module

**Files:**
- Create: `web/api/lib/db.js`
- Create: `scripts/lib/db.js`
- Modify: `web/api/package.json`
- Test: `web/api/tests/db.test.js`

- [ ] **Step 1: Install @libsql/client**

```bash
cd web/api && bun add @libsql/client
```

- [ ] **Step 2: Create Turso database (one-time, manual)**

```bash
# Install Turso CLI if not present
curl -sSfL https://get.tur.so/install.sh | bash

# Create database in London region
turso db create sni-research --location lhr

# Get connection URL
turso db show sni-research --url
# Output: libsql://sni-research-<org>.turso.io

# Create auth token (never expires)
turso db tokens create sni-research --expiration never
# Output: eyJhbG...

# Add to local .env
echo 'TURSO_DATABASE_URL=libsql://sni-research-<org>.turso.io' >> .env
echo 'TURSO_AUTH_TOKEN=eyJhbG...' >> .env

# Add to Fly secrets
fly secrets set TURSO_DATABASE_URL=libsql://sni-research-<org>.turso.io TURSO_AUTH_TOKEN=eyJhbG... -a sni-research
```

- [ ] **Step 3: Write failing test for db module**

```javascript
// web/api/tests/db.test.js
import { describe, it, expect, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'

describe('db module', () => {
  const db = createTestDb()  // in-memory SQLite for tests

  it('creates all tables on migrate', async () => {
    await migrateSchema(db)
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    const names = tables.rows.map(r => r.name)
    expect(names).toContain('articles')
    expect(names).toContain('analysis_entries')
    expect(names).toContain('themes')
    expect(names).toContain('theme_evidence')
    expect(names).toContain('posts')
    expect(names).toContain('episodes')
    expect(names).toContain('counters')
    expect(names).toContain('activity')
    expect(names).toContain('schema_version')
  })

  it('seeds counters on first migrate', async () => {
    const result = await db.execute("SELECT key, value FROM counters ORDER BY key")
    expect(result.rows.length).toBe(3)
  })

  it('is idempotent (migrate twice)', async () => {
    await migrateSchema(db)  // second call
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    expect(tables.rows.length).toBeGreaterThan(0)
  })

  afterAll(() => db.close())
})
```

Run: `cd web/api && bun test tests/db.test.js`
Expected: FAIL — `db.js` doesn't exist yet

- [ ] **Step 4: Implement db.js**

```javascript
// web/api/lib/db.js
import { createClient } from '@libsql/client'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../..')

function loadEnv(key) {
  if (process.env[key]) return process.env[key]
  try {
    const lines = readFileSync(join(ROOT, '.env'), 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(new RegExp(`^${key}=(.+)$`))
      if (m) return m[1].trim()
    }
  } catch { /* no .env */ }
  return undefined
}

const SCHEMA_VERSION = 1

const SCHEMA_SQL = `
-- [paste full schema from above, with IF NOT EXISTS on everything]
`

/** Create a production client (remote or embedded replica). */
export function createProductionDb() {
  const url = loadEnv('TURSO_DATABASE_URL')
  const authToken = loadEnv('TURSO_AUTH_TOKEN')
  if (!url) throw new Error('TURSO_DATABASE_URL not set')

  const isProduction = !!process.env.FLY_MACHINE_ID
  return createClient(
    isProduction
      ? { url: 'file:/app/data/local.db', syncUrl: url, authToken, syncInterval: 30 }
      : { url, authToken }
  )
}

/** Create an in-memory client for tests. */
export function createTestDb() {
  return createClient({ url: ':memory:' })
}

/** Run schema migrations. Idempotent. */
export async function migrateSchema(db) {
  // Check current version
  try {
    const result = await db.execute('SELECT MAX(version) as v FROM schema_version')
    if (result.rows[0]?.v >= SCHEMA_VERSION) return
  } catch {
    // Table doesn't exist yet — first run
  }

  // Apply schema (all IF NOT EXISTS, safe to re-run)
  const statements = SCHEMA_SQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)

  for (const sql of statements) {
    await db.execute(sql)
  }

  // Seed counters if empty
  const counters = await db.execute('SELECT COUNT(*) as n FROM counters')
  if (counters.rows[0].n === 0) {
    await db.batch([
      { sql: "INSERT INTO counters (key, value) VALUES ('nextSession', 56)", args: [] },
      { sql: "INSERT INTO counters (key, value) VALUES ('nextDocument', 218)", args: [] },
      { sql: "INSERT INTO counters (key, value) VALUES ('nextPost', 163)", args: [] },
    ], 'write')
  }

  // Record version
  await db.execute({
    sql: 'INSERT OR REPLACE INTO schema_version (version) VALUES (?)',
    args: [SCHEMA_VERSION]
  })
}

/** Singleton for the API server. */
let _db = null
export function getDb() {
  if (!_db) {
    _db = process.env.SNI_TEST_MODE === '1'
      ? createTestDb()
      : createProductionDb()
  }
  return _db
}

export default { getDb, createTestDb, createProductionDb, migrateSchema }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web/api && bun test tests/db.test.js`
Expected: PASS (3 tests)

- [ ] **Step 6: Create scripts/lib/db.js (pipeline client)**

```javascript
// scripts/lib/db.js
import { createClient } from '@libsql/client'
import { loadEnvKey } from './env.js'

/** Remote-only client for pipeline scripts (no embedded replica). */
export function createSyncDb() {
  const url = loadEnvKey('TURSO_DATABASE_URL')
  const authToken = loadEnvKey('TURSO_AUTH_TOKEN')
  if (!url) {
    console.warn('[db] TURSO_DATABASE_URL not set — database sync disabled')
    return null
  }
  return createClient({ url, authToken })
}
```

- [ ] **Step 7: Commit**

```bash
git add web/api/lib/db.js web/api/tests/db.test.js web/api/package.json web/api/bun.lock scripts/lib/db.js
git commit -m "feat(db): add Turso client module with schema migrations"
```

---

### Task 2: Article query layer

**Files:**
- Create: `web/api/lib/article-queries.js`
- Test: `web/api/tests/article-queries.test.js`

- [ ] **Step 1: Write failing tests for article queries**

```javascript
// web/api/tests/article-queries.test.js
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestDb, migrateSchema } from '../lib/db.js'
import {
  insertArticle, getArticles, getArticle, getArticleCounts,
  searchArticles, updateArticle, flagArticle, deleteArticle,
  getPublications, upsertArticle
} from '../lib/article-queries.js'

describe('article queries', () => {
  const db = createTestDb()

  beforeAll(async () => {
    await migrateSchema(db)
    // Seed test data
    await insertArticle(db, {
      slug: 'test-article-one',
      title: 'Test Article One',
      url: 'https://example.com/one',
      source: 'Test Source',
      source_type: 'automated',
      date_published: '2026-04-10',
      sector: 'general',
      snippet: 'This is a test snippet about AI.',
      full_text: 'Full text of the article about artificial intelligence.',
      scraped_at: '2026-04-10T08:00:00Z',
      found_by: JSON.stringify(['RSS: Test Feed']),
    })
    await insertArticle(db, {
      slug: 'biopharma-article',
      title: 'Drug Discovery With AI',
      url: 'https://example.com/two',
      source: 'Pharma Weekly',
      source_type: 'ainewshub',
      date_published: '2026-04-10',
      sector: 'biopharma',
      snippet: 'AI-driven drug discovery advances.',
      full_text: 'Full text about biopharma.',
      scraped_at: '2026-04-10T09:00:00Z',
      found_by: JSON.stringify(['AINewsHub: IE']),
    })
    await insertArticle(db, {
      slug: 'old-article',
      title: 'Old AI News',
      url: 'https://example.com/old',
      source: 'Old Source',
      source_type: 'automated',
      date_published: '2026-04-05',
      sector: 'general',
      snippet: 'Older article snippet.',
      full_text: 'Older full text.',
      scraped_at: '2026-04-05T08:00:00Z',
      found_by: JSON.stringify(['RSS: Old Feed']),
    })
  })

  it('getArticles returns all articles sorted by date desc', async () => {
    const result = await getArticles(db, {})
    expect(result.total).toBe(3)
    expect(result.articles[0].date_published).toBe('2026-04-10')
    expect(result.articles[2].date_published).toBe('2026-04-05')
  })

  it('getArticles filters by sector', async () => {
    const result = await getArticles(db, { sector: 'biopharma' })
    expect(result.total).toBe(1)
    expect(result.articles[0].slug).toBe('biopharma-article')
  })

  it('getArticles filters by date range', async () => {
    const result = await getArticles(db, { dateFrom: '2026-04-09', dateTo: '2026-04-11' })
    expect(result.total).toBe(2)
  })

  it('getArticles paginates with limit/offset', async () => {
    const result = await getArticles(db, { limit: 1, offset: 1 })
    expect(result.articles.length).toBe(1)
    expect(result.total).toBe(3)  // total is unaffected by pagination
  })

  it('getArticle returns single article with full_text', async () => {
    const article = await getArticle(db, '2026-04-10', 'general', 'test-article-one')
    expect(article).not.toBeNull()
    expect(article.full_text).toContain('artificial intelligence')
  })

  it('getArticle returns null for missing article', async () => {
    const article = await getArticle(db, '2026-04-10', 'general', 'nonexistent')
    expect(article).toBeNull()
  })

  it('getArticleCounts returns aggregated counts', async () => {
    const counts = await getArticleCounts(db)
    expect(counts.total).toBe(3)
    expect(counts.bySector.general).toBe(2)
    expect(counts.bySector.biopharma).toBe(1)
    expect(counts.byDate['2026-04-10']).toBe(2)
    expect(counts.byDate['2026-04-05']).toBe(1)
  })

  it('searchArticles uses FTS', async () => {
    const results = await searchArticles(db, 'drug discovery')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('Drug Discovery')
  })

  it('upsertArticle merges found_by on collision', async () => {
    await upsertArticle(db, {
      slug: 'test-article-one',
      title: 'Test Article One',
      date_published: '2026-04-10',
      sector: 'general',
      source_type: 'automated',
      found_by: JSON.stringify(['Brave: AI news']),
      scraped_at: '2026-04-10T10:00:00Z',
    })
    const article = await getArticle(db, '2026-04-10', 'general', 'test-article-one')
    const foundBy = JSON.parse(article.found_by)
    expect(foundBy).toContain('RSS: Test Feed')
    expect(foundBy).toContain('Brave: AI news')
  })

  it('flagArticle moves article to flagged state', async () => {
    await flagArticle(db, '2026-04-05', 'general', 'old-article', 'Low relevance')
    const article = await getArticle(db, '2026-04-05', 'general', 'old-article')
    expect(article.flagged).toBe(1)
    expect(article.flag_reason).toBe('Low relevance')
  })

  it('getPublications returns unique sources', async () => {
    const pubs = await getPublications(db)
    expect(pubs).toContain('Test Source')
    expect(pubs).toContain('Pharma Weekly')
  })

  afterAll(() => db.close())
})
```

Run: `cd web/api && bun test tests/article-queries.test.js`
Expected: FAIL — module doesn't exist

- [ ] **Step 2: Implement article-queries.js**

```javascript
// web/api/lib/article-queries.js

// List fields returned for article list views (excludes full_text for performance)
const LIST_FIELDS = `id, slug, title, url, source, source_type, date_published,
  date_verified_method, date_confidence, sector, keywords_matched, snippet,
  score, confidence, score_reason, scraped_at, found_by, archived, flagged`

/** Insert a new article. Throws on unique constraint violation. */
export async function insertArticle(db, article) {
  const result = await db.execute({
    sql: `INSERT INTO articles (slug, title, url, source, source_type, date_published,
      date_verified_method, date_confidence, sector, keywords_matched, snippet,
      full_text, scraped_at, found_by, confidence, score_reason, discovery_source,
      source_episode, ingested_at, ainewshub_meta, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      article.slug, article.title, article.url ?? null, article.source ?? null,
      article.source_type, article.date_published, article.date_verified_method ?? null,
      article.date_confidence ?? null, article.sector, article.keywords_matched ?? '[]',
      article.snippet ?? null, article.full_text ?? null, article.scraped_at ?? null,
      article.found_by ?? '[]', article.confidence ?? null, article.score_reason ?? null,
      article.discovery_source ?? null, article.source_episode ?? null,
      article.ingested_at ?? null, article.ainewshub_meta ?? null
    ]
  })
  return result.lastInsertRowid
}

/** Upsert an article, merging found_by arrays on collision. */
export async function upsertArticle(db, article) {
  // Check if exists
  const existing = await db.execute({
    sql: 'SELECT id, found_by FROM articles WHERE date_published = ? AND sector = ? AND slug = ?',
    args: [article.date_published, article.sector, article.slug]
  })

  if (existing.rows.length > 0) {
    const row = existing.rows[0]
    const existingFoundBy = JSON.parse(row.found_by || '[]')
    const newFoundBy = JSON.parse(article.found_by || '[]')
    const merged = [...new Set([...existingFoundBy, ...newFoundBy])]

    await db.execute({
      sql: `UPDATE articles SET found_by = ?, updated_at = datetime('now'), synced_at = datetime('now')
        WHERE id = ?`,
      args: [JSON.stringify(merged), row.id]
    })
    return row.id
  }

  return insertArticle(db, article)
}

/** Get articles with filtering, pagination, search. */
export async function getArticles(db, { sector, date, dateFrom, dateTo, search, limit = 100, offset = 0 } = {}) {
  const conditions = ['deleted_at IS NULL']
  const args = []

  if (sector) { conditions.push('sector = ?'); args.push(sector) }
  if (date) { conditions.push('date_published = ?'); args.push(date) }
  if (dateFrom) { conditions.push('date_published >= ?'); args.push(dateFrom) }
  if (dateTo) { conditions.push('date_published <= ?'); args.push(dateTo) }

  const where = conditions.join(' AND ')

  if (search) {
    // FTS5 search
    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as n FROM articles_fts
        JOIN articles ON articles.id = articles_fts.rowid
        WHERE articles_fts MATCH ? AND ${where}`,
      args: [search, ...args]
    })
    const total = countResult.rows[0].n

    const result = await db.execute({
      sql: `SELECT ${LIST_FIELDS} FROM articles_fts
        JOIN articles ON articles.id = articles_fts.rowid
        WHERE articles_fts MATCH ? AND ${where}
        ORDER BY rank
        LIMIT ? OFFSET ?`,
      args: [search, ...args, limit, offset]
    })

    return { articles: result.rows, total, limit, offset }
  }

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) as n FROM articles WHERE ${where}`,
    args
  })
  const total = countResult.rows[0].n

  const result = await db.execute({
    sql: `SELECT ${LIST_FIELDS} FROM articles WHERE ${where}
      ORDER BY date_published DESC, scraped_at DESC
      LIMIT ? OFFSET ?`,
    args: [...args, limit, offset]
  })

  return { articles: result.rows, total, limit, offset }
}

/** Get a single article with full_text. */
export async function getArticle(db, date, sector, slug) {
  const result = await db.execute({
    sql: 'SELECT * FROM articles WHERE date_published = ? AND sector = ? AND slug = ?',
    args: [date, sector, slug]
  })
  return result.rows[0] ?? null
}

/** Get flagged articles. */
export async function getFlaggedArticles(db) {
  const result = await db.execute(
    `SELECT ${LIST_FIELDS}, flag_reason FROM articles
     WHERE flagged = 1 AND deleted_at IS NULL
     ORDER BY date_published DESC`
  )
  return { articles: result.rows, total: result.rows.length }
}

/** Get article counts aggregated by date and sector. */
export async function getArticleCounts(db, { scrapedSince } = {}) {
  const base = 'deleted_at IS NULL AND flagged = 0'

  const totalResult = await db.execute(`SELECT COUNT(*) as n FROM articles WHERE ${base}`)
  const total = totalResult.rows[0].n

  // Today count (by scraped_at)
  const today = new Date().toISOString().slice(0, 10)
  const todayResult = await db.execute({
    sql: `SELECT COUNT(*) as n FROM articles WHERE ${base} AND scraped_at >= ?`,
    args: [`${today}T00:00:00`]
  })
  const todayCount = todayResult.rows[0].n

  // By date
  const byDateResult = await db.execute(
    `SELECT date_published, COUNT(*) as n FROM articles WHERE ${base}
     GROUP BY date_published ORDER BY date_published`
  )
  const byDate = Object.fromEntries(byDateResult.rows.map(r => [r.date_published, r.n]))

  // By sector
  const bySectorResult = await db.execute(
    `SELECT sector, COUNT(*) as n FROM articles WHERE ${base} GROUP BY sector`
  )
  const bySector = Object.fromEntries(bySectorResult.rows.map(r => [r.sector, r.n]))

  // By date × sector
  const crossResult = await db.execute(
    `SELECT date_published, sector, COUNT(*) as n FROM articles WHERE ${base}
     GROUP BY date_published, sector`
  )
  const byDateBySector = {}
  for (const r of crossResult.rows) {
    if (!byDateBySector[r.date_published]) byDateBySector[r.date_published] = {}
    byDateBySector[r.date_published][r.sector] = r.n
  }

  // Week articles (since scrapedSince cutoff)
  let weekArticles = null
  if (scrapedSince) {
    const wTotal = await db.execute({
      sql: `SELECT COUNT(*) as n FROM articles WHERE ${base} AND scraped_at >= ?`,
      args: [scrapedSince]
    })
    const wByDate = await db.execute({
      sql: `SELECT date_published, COUNT(*) as n FROM articles WHERE ${base} AND scraped_at >= ?
        GROUP BY date_published`, args: [scrapedSince]
    })
    const wBySector = await db.execute({
      sql: `SELECT sector, COUNT(*) as n FROM articles WHERE ${base} AND scraped_at >= ?
        GROUP BY sector`, args: [scrapedSince]
    })
    const wCross = await db.execute({
      sql: `SELECT date_published, sector, COUNT(*) as n FROM articles WHERE ${base} AND scraped_at >= ?
        GROUP BY date_published, sector`, args: [scrapedSince]
    })
    weekArticles = {
      total: wTotal.rows[0].n,
      byDate: Object.fromEntries(wByDate.rows.map(r => [r.date_published, r.n])),
      bySector: Object.fromEntries(wBySector.rows.map(r => [r.sector, r.n])),
      byDateBySector: {}
    }
    for (const r of wCross.rows) {
      if (!weekArticles.byDateBySector[r.date_published]) weekArticles.byDateBySector[r.date_published] = {}
      weekArticles.byDateBySector[r.date_published][r.sector] = r.n
    }
  }

  return { total, today: todayCount, byDate, bySector, byDateBySector, weekArticles }
}

/** Full-text search. */
export async function searchArticles(db, query, limit = 50) {
  const result = await db.execute({
    sql: `SELECT ${LIST_FIELDS} FROM articles_fts
      JOIN articles ON articles.id = articles_fts.rowid
      WHERE articles_fts MATCH ? AND articles.deleted_at IS NULL
      ORDER BY rank LIMIT ?`,
    args: [query, limit]
  })
  return result.rows
}

/** Update article fields. */
export async function updateArticle(db, date, sector, slug, updates) {
  const fields = Object.keys(updates)
  const sets = fields.map(f => `${f} = ?`).join(', ')
  const args = [...fields.map(f => updates[f]), date, sector, slug]
  await db.execute({
    sql: `UPDATE articles SET ${sets}, updated_at = datetime('now')
      WHERE date_published = ? AND sector = ? AND slug = ?`,
    args
  })
}

/** Flag an article. */
export async function flagArticle(db, date, sector, slug, reason) {
  await db.execute({
    sql: `UPDATE articles SET flagged = 1, flag_reason = ?, updated_at = datetime('now')
      WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [reason, date, sector, slug]
  })
}

/** Soft-delete an article. */
export async function deleteArticle(db, date, sector, slug) {
  await db.execute({
    sql: `UPDATE articles SET deleted_at = datetime('now'), updated_at = datetime('now')
      WHERE date_published = ? AND sector = ? AND slug = ?`,
    args: [date, sector, slug]
  })
}

/** Get unique publication names. */
export async function getPublications(db) {
  const result = await db.execute(
    "SELECT DISTINCT source FROM articles WHERE source IS NOT NULL AND deleted_at IS NULL ORDER BY source"
  )
  return result.rows.map(r => r.source)
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd web/api && bun test tests/article-queries.test.js`
Expected: PASS (all tests)

- [ ] **Step 4: Commit**

```bash
git add web/api/lib/article-queries.js web/api/tests/article-queries.test.js
git commit -m "feat(db): add article query layer with tests"
```

---

### Task 3: Editorial query layer

**Files:**
- Create: `web/api/lib/editorial-queries.js`
- Test: `web/api/tests/editorial-queries.test.js`

- [ ] **Step 1: Write failing tests for editorial queries**

Tests should cover:
- `getAnalysisEntries(db, { tier, status, session, showArchived })` — filtered list
- `getAnalysisEntry(db, id)` — single entry
- `getThemes(db, { active, stale, showArchived })` — with active = evidence in last 3 sessions
- `getThemeWithEvidence(db, code)` — theme + evidence array + cross-connections
- `getPosts(db, { status, priority, format })` — filtered backlog
- `updatePostStatus(db, id, newStatus)` — status transition with validation
- `getDecisions(db, { showArchived })` — sorted
- `getCounters(db)` — returns { nextSession, nextDocument, nextPost }
- `incrementCounter(db, key)` — atomic increment, returns new value
- `getCorpusStats(db)` — computed from tables
- `searchEditorial(db, query)` — cross-table search
- `getActivity(db, limit)` — sorted by timestamp desc
- `addActivity(db, { type, title, detail })` — insert + prune to 100

- [ ] **Step 2: Implement editorial-queries.js**

Key design decisions:
- Analysis entries, themes, posts, decisions each get their own query functions
- Theme evidence is a separate table with FK — `getThemeWithEvidence()` does a JOIN
- Counter increment is `UPDATE counters SET value = value + 1 WHERE key = ? RETURNING value`
- Corpus stats is a VIEW — just `SELECT * FROM corpus_stats`
- Activity pruning: `DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY timestamp DESC LIMIT 100)`
- Search: LIKE queries across analysis_entries.title, themes.name, posts.title (not FTS — small corpus)

- [ ] **Step 3: Run tests, verify pass**

Run: `cd web/api && bun test tests/editorial-queries.test.js`

- [ ] **Step 4: Commit**

```bash
git add web/api/lib/editorial-queries.js web/api/tests/editorial-queries.test.js
git commit -m "feat(db): add editorial query layer with tests"
```

---

### Task 4: Podcast query layer

**Files:**
- Create: `web/api/lib/podcast-queries.js`
- Test: `web/api/tests/podcast-queries.test.js`

- [ ] **Step 1: Write failing tests**

Tests should cover:
- `getEpisodes(db, { week, source })` — filtered list
- `getEpisode(db, filename)` — single episode with stories
- `upsertEpisode(db, episode)` — insert or update by filename
- `upsertEpisodeStories(db, episodeId, stories)` — replace stories for episode
- `patchEpisode(db, date, source, slug, updates)` — partial update (archived flag)

- [ ] **Step 2: Implement podcast-queries.js**

- [ ] **Step 3: Run tests, verify pass**

- [ ] **Step 4: Commit**

```bash
git add web/api/lib/podcast-queries.js web/api/tests/podcast-queries.test.js
git commit -m "feat(db): add podcast query layer with tests"
```

---

### Task 5: Bulk migration script

**Files:**
- Create: `scripts/db-migrate.js`

- [ ] **Step 1: Write migration script**

```javascript
// scripts/db-migrate.js
// One-time bulk import of all existing JSON data into Turso.
//
// Usage: bun scripts/db-migrate.js [--dry-run] [--articles-only] [--editorial-only] [--podcasts-only]
//
// Reads from local data/ directory and inserts into Turso.
// Idempotent via UPSERT — safe to re-run.

import { createSyncDb } from './lib/db.js'
import { migrateSchema } from '../web/api/lib/db.js'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..')
const BATCH_SIZE = 200

async function migrateArticles(db, baseDir, stats) {
  const dateDirs = readdirSync(join(ROOT, 'data', baseDir))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()

  for (const date of dateDirs) {
    const datePath = join(ROOT, 'data', baseDir, date)
    const sectors = readdirSync(datePath).filter(d =>
      statSync(join(datePath, d)).isDirectory()
    )

    for (const sector of sectors) {
      const sectorPath = join(datePath, sector)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      // Batch insert
      const batch = []
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'))
          const slug = file.replace('.json', '')
          batch.push({
            sql: `INSERT OR IGNORE INTO articles (slug, title, url, source, source_type,
              date_published, date_verified_method, date_confidence, sector,
              keywords_matched, snippet, full_text, scraped_at, found_by,
              confidence, score_reason, discovery_source, source_episode,
              ingested_at, archived, flagged, ainewshub_meta, deleted_at, score, synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            args: [
              slug, raw.title, raw.url ?? null, raw.source ?? null,
              raw.source_type ?? 'automated', raw.date_published ?? date,
              raw.date_verified_method ?? null, raw.date_confidence ?? null,
              raw.sector ?? sector,
              JSON.stringify(raw.keywords_matched ?? []),
              raw.snippet ?? (raw.full_text?.slice(0, 300) ?? null),
              raw.full_text ?? null, raw.scraped_at ?? null,
              JSON.stringify(raw.found_by ?? []),
              raw.confidence ?? null, raw.score_reason ?? null,
              raw.discoverySource ?? null, raw.sourceEpisode ?? null,
              raw.ingested_at ?? null, raw.archived ? 1 : 0,
              baseDir === 'review' ? 1 : 0,
              raw.ainewshub ? JSON.stringify(raw.ainewshub) : null,
              raw.deleted_at ?? (baseDir === 'deleted' ? raw.scraped_at : null),
              raw.source_type ?? (baseDir === 'podcast-articles' ? 'podcast-extract' : 'automated'),
              raw.score ?? null
            ]
          })

          if (batch.length >= BATCH_SIZE) {
            await db.batch(batch, 'write')
            stats.inserted += batch.length
            batch.length = 0
          }
        } catch (e) {
          stats.errors++
          console.error(`  ERROR: ${file}: ${e.message}`)
        }
      }

      if (batch.length > 0) {
        await db.batch(batch, 'write')
        stats.inserted += batch.length
      }
    }
    process.stdout.write(`\r  ${baseDir}/${date}: ${stats.inserted} inserted, ${stats.errors} errors`)
  }
  console.log()
}

async function migrateEditorialState(db) {
  const statePath = join(ROOT, 'data/editorial/state.json')
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  let count = 0

  // Counters
  for (const [key, value] of Object.entries(state.counters || {})) {
    await db.execute({
      sql: 'INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)',
      args: [key, value]
    })
  }
  console.log('  Counters: done')

  // Analysis index
  const entries = Object.entries(state.analysisIndex || {})
  for (const [id, entry] of entries) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO analysis_entries (id, title, source, host,
        participants, filename, url, date, date_processed, session, tier, status,
        themes, summary, key_themes, post_potential, post_potential_reasoning, reconstructed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        parseInt(id), entry.title, entry.source ?? null, entry.host ?? null,
        JSON.stringify(entry.participants ?? []), entry.filename ?? null,
        entry.url ?? null, entry.date ?? null, entry.dateProcessed ?? null,
        entry.session, entry.tier ?? 1, entry.status ?? 'active',
        JSON.stringify(entry.themes ?? []), entry.summary ?? null,
        entry.keyThemes ?? null, entry.postPotential ?? null,
        entry.postPotentialReasoning ?? null, entry._reconstructed ? 1 : 0
      ]
    })
  }
  console.log(`  Analysis entries: ${entries.length}`)

  // Theme registry
  const themes = Object.entries(state.themeRegistry || {})
  for (const [code, theme] of themes) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO themes (code, name, created_session, last_updated_session,
        document_count, archived) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [code, theme.name, theme.created ?? null, theme.lastUpdated ?? null,
        theme.documentCount ?? 0, theme.archived ? 1 : 0]
    })

    // Evidence
    for (const ev of (theme.evidence || [])) {
      await db.execute({
        sql: 'INSERT INTO theme_evidence (theme_code, session, source, content, url) VALUES (?, ?, ?, ?, ?)',
        args: [code, ev.session, ev.source ?? null, ev.content ?? null, ev.url ?? null]
      })
    }

    // Cross-connections
    for (const cc of (theme.crossConnections || [])) {
      await db.execute({
        sql: 'INSERT OR IGNORE INTO theme_connections (from_code, to_code, reasoning) VALUES (?, ?, ?)',
        args: [code, cc.theme, cc.reasoning ?? null]
      })
    }
  }
  console.log(`  Themes: ${themes.length}`)

  // Post backlog
  const posts = Object.entries(state.postBacklog || {})
  for (const [id, post] of posts) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO posts (id, title, working_title, status, date_added,
        session, core_argument, format, source_documents, source_urls, freshness,
        priority, notes, date_published) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        parseInt(id), post.title, post.workingTitle ?? null,
        post.status ?? 'suggested', post.dateAdded ?? null,
        post.session ?? null, post.coreArgument ?? null, post.format ?? null,
        JSON.stringify(post.sourceDocuments ?? []),
        JSON.stringify(post.sourceUrls ?? []),
        post.freshness ?? 'evergreen', post.priority ?? 'medium',
        post.notes ?? null, post.datePublished ?? null
      ]
    })
  }
  console.log(`  Posts: ${posts.length}`)

  // Decision log
  const decisions = state.decisionLog || []
  for (const d of decisions) {
    await db.execute({
      sql: `INSERT OR REPLACE INTO decisions (id, session, title, decision, reasoning, archived)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [d.id, d.session, d.title, d.decision, d.reasoning ?? null, d.archived ? 1 : 0]
    })
  }
  console.log(`  Decisions: ${decisions.length}`)

  // Permanent preferences
  for (const pref of (state.permanentPreferences || [])) {
    await db.execute({
      sql: 'INSERT INTO permanent_preferences (title, content) VALUES (?, ?)',
      args: [pref.title, pref.content]
    })
  }

  // Activity log
  try {
    const activity = JSON.parse(readFileSync(join(ROOT, 'data/editorial/activity.json'), 'utf8'))
    for (const entry of activity) {
      await db.execute({
        sql: 'INSERT INTO activity (type, title, detail, timestamp) VALUES (?, ?, ?, ?)',
        args: [entry.type, entry.title, entry.detail ?? '', entry.timestamp]
      })
    }
    console.log(`  Activity: ${activity.length}`)
  } catch { console.log('  Activity: skipped (file not found)') }

  // Notifications
  try {
    const notifs = JSON.parse(readFileSync(join(ROOT, 'data/editorial/notifications.json'), 'utf8'))
    for (const n of notifs) {
      await db.execute({
        sql: `INSERT OR REPLACE INTO notifications (id, post_id, title, priority, detail, timestamp, dismissed)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [n.id, n.postId ?? null, n.title, n.priority ?? null, n.detail ?? '', n.timestamp, n.dismissed ? 1 : 0]
      })
    }
    console.log(`  Notifications: ${notifs.length}`)
  } catch { console.log('  Notifications: skipped (file not found)') }

  // Cost log
  try {
    const costs = JSON.parse(readFileSync(join(ROOT, 'data/editorial/cost-log.json'), 'utf8'))
    for (const [id, entry] of Object.entries(costs.sessions || {})) {
      await db.execute({
        sql: 'INSERT OR REPLACE INTO cost_log (session_id, timestamp, elapsed, stage, costs, total) VALUES (?, ?, ?, ?, ?, ?)',
        args: [id, entry.timestamp ?? null, entry.elapsed ?? null, entry.stage ?? null,
          JSON.stringify(entry.costs ?? {}), entry.total ?? 0]
      })
    }
  } catch { console.log('  Cost log: skipped') }

  // Stories session files
  try {
    const editorial = join(ROOT, 'data/editorial')
    const storyFiles = readdirSync(editorial).filter(f => f.startsWith('stories-session-'))
    for (const file of storyFiles) {
      const session = parseInt(file.match(/stories-session-(\d+)/)?.[1] ?? '0')
      const stories = JSON.parse(readFileSync(join(editorial, file), 'utf8'))
      for (const s of stories) {
        await db.execute({
          sql: 'INSERT INTO stories (session, headline, detail, url, type, sector, source_file) VALUES (?, ?, ?, ?, ?, ?, ?)',
          args: [session, s.headline, s.detail ?? null, s.url ?? null, s.type ?? null, s.sector ?? null, s.sourceFile ?? null]
        })
      }
    }
    console.log(`  Stories: ${storyFiles.length} session files`)
  } catch { console.log('  Stories: skipped') }

  // Published tracking
  try {
    const pub = JSON.parse(readFileSync(join(ROOT, 'data/editorial/published.json'), 'utf8'))
    for (const item of (pub.linkedin || [])) {
      await db.execute({
        sql: 'INSERT INTO published (type, post_id, date, title) VALUES (?, ?, ?, ?)',
        args: ['linkedin', item.postId, item.date, item.title]
      })
    }
    for (const item of (pub.newsletters || [])) {
      await db.execute({
        sql: 'INSERT INTO published (type, week, date, title) VALUES (?, ?, ?, ?)',
        args: ['newsletter', item.week ?? null, item.date ?? null, item.title ?? null]
      })
    }
  } catch { console.log('  Published: skipped') }
}

async function migratePodcasts(db) {
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const [filename, meta] of Object.entries(manifest)) {
      // Insert episode from manifest
      const result = await db.execute({
        sql: `INSERT OR IGNORE INTO episodes (filename, date, source, source_slug, title, week, year)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [filename, meta.date, meta.source, meta.sourceSlug, meta.title, meta.week ?? null, meta.year ?? null]
      })

      // Try to load digest for additional fields
      if (meta.digestPath) {
        try {
          const digest = JSON.parse(readFileSync(join(ROOT, meta.digestPath), 'utf8'))
          await db.execute({
            sql: `UPDATE episodes SET duration = ?, episode_url = ?, tier = ?,
              summary = ?, archived = ? WHERE filename = ?`,
            args: [digest.duration ?? null, digest.episodeUrl ?? null, digest.tier ?? 1,
              digest.summary ?? null, digest.archived ? 1 : 0, filename]
          })

          // Episode stories
          const epResult = await db.execute({
            sql: 'SELECT id FROM episodes WHERE filename = ?', args: [filename]
          })
          if (epResult.rows.length > 0 && digest.key_stories) {
            const epId = epResult.rows[0].id
            for (const story of digest.key_stories) {
              await db.execute({
                sql: 'INSERT INTO episode_stories (episode_id, headline, detail, url, sector) VALUES (?, ?, ?, ?, ?)',
                args: [epId, story.headline, story.detail ?? null, story.url ?? null, story.sector ?? 'general-ai']
              })
            }
          }
        } catch { /* digest not found — manifest-only episode */ }
      }
    }
    console.log(`  Episodes: ${Object.keys(manifest).length}`)
  } catch { console.log('  Podcasts: skipped (no manifest)') }
}

// --- Main ---
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const articlesOnly = args.includes('--articles-only')
const editorialOnly = args.includes('--editorial-only')
const podcastsOnly = args.includes('--podcasts-only')
const allSections = !articlesOnly && !editorialOnly && !podcastsOnly

console.log(`\n=== SNI Research → Turso Migration ===\n`)
if (dryRun) console.log('DRY RUN — no data will be written\n')

const db = createSyncDb()
if (!db) { console.error('No database connection'); process.exit(1) }

console.log('Running schema migrations...')
await migrateSchema(db)

if (allSections || articlesOnly) {
  console.log('\n--- Articles (verified) ---')
  const verifiedStats = { inserted: 0, errors: 0 }
  await migrateArticles(db, 'verified', verifiedStats)
  console.log(`  Total: ${verifiedStats.inserted} inserted, ${verifiedStats.errors} errors`)

  console.log('\n--- Articles (review) ---')
  const reviewStats = { inserted: 0, errors: 0 }
  await migrateArticles(db, 'review', reviewStats)
  console.log(`  Total: ${reviewStats.inserted} inserted, ${reviewStats.errors} errors`)

  console.log('\n--- Articles (deleted) ---')
  const deletedStats = { inserted: 0, errors: 0 }
  await migrateArticles(db, 'deleted', deletedStats)
  console.log(`  Total: ${deletedStats.inserted} inserted, ${deletedStats.errors} errors`)

  console.log('\n--- Articles (podcast-articles) ---')
  const podcastArticleStats = { inserted: 0, errors: 0 }
  await migrateArticles(db, 'podcast-articles', podcastArticleStats)
  console.log(`  Total: ${podcastArticleStats.inserted} inserted, ${podcastArticleStats.errors} errors`)
}

if (allSections || editorialOnly) {
  console.log('\n--- Editorial State ---')
  await migrateEditorialState(db)
}

if (allSections || podcastsOnly) {
  console.log('\n--- Podcasts ---')
  await migratePodcasts(db)
}

// Verification
console.log('\n--- Verification ---')
const articleCount = await db.execute('SELECT COUNT(*) as n FROM articles')
const analysisCount = await db.execute('SELECT COUNT(*) as n FROM analysis_entries')
const themeCount = await db.execute('SELECT COUNT(*) as n FROM themes')
const postCount = await db.execute('SELECT COUNT(*) as n FROM posts')
const episodeCount = await db.execute('SELECT COUNT(*) as n FROM episodes')

console.log(`  Articles: ${articleCount.rows[0].n}`)
console.log(`  Analysis entries: ${analysisCount.rows[0].n}`)
console.log(`  Themes: ${themeCount.rows[0].n}`)
console.log(`  Posts: ${postCount.rows[0].n}`)
console.log(`  Episodes: ${episodeCount.rows[0].n}`)

console.log('\n=== Migration complete ===\n')
```

- [ ] **Step 2: Run migration against Turso**

```bash
bun scripts/db-migrate.js
```

Expected output:
```
=== SNI Research → Turso Migration ===
Running schema migrations...
--- Articles (verified) ---
  verified/2026-04-12: 9392 inserted, 0 errors
--- Articles (review) ---
  Total: ~200 inserted, 0 errors
--- Editorial State ---
  Counters: done
  Analysis entries: 203
  Themes: 50
  Posts: 126
  Decisions: 47
  Activity: ~55
--- Podcasts ---
  Episodes: 70
--- Verification ---
  Articles: ~9600
  Analysis entries: 203
  Themes: 50
  Posts: 126
  Episodes: 70
=== Migration complete ===
```

- [ ] **Step 3: Verify in Turso shell**

```bash
turso db shell sni-research "SELECT COUNT(*) FROM articles"
turso db shell sni-research "SELECT date_published, COUNT(*) FROM articles GROUP BY date_published ORDER BY date_published DESC LIMIT 5"
turso db shell sni-research "SELECT sector, COUNT(*) FROM articles GROUP BY sector"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/db-migrate.js
git commit -m "feat(db): add bulk migration script for JSON → Turso"
```

---

### Task 6: Sync script (replaces sync-to-cloud.sh)

**Files:**
- Create: `scripts/sync-to-turso.js`
- Modify: launchd plist

- [ ] **Step 1: Write sync script**

This script replaces `sync-to-cloud.sh`. It walks local JSON files and upserts to Turso via HTTP. Idempotent — safe to run repeatedly.

Key design:
- Walks `data/verified/`, `data/review/`, `data/deleted/`, `data/podcast-articles/` for articles
- Reads `data/editorial/state.json` for editorial state
- Reads `data/podcasts/manifest.json` + digest files for podcasts
- Reads `data/editorial/activity.json`, `notifications.json`, `cost-log.json`
- Uses `db.batch()` with transactions of 200 rows for articles
- Editorial state does a full replace (DROP + INSERT within transaction) for simplicity
- Reports sync stats to stdout for launchd log

- [ ] **Step 2: Test locally**

```bash
bun scripts/sync-to-turso.js
```

- [ ] **Step 3: Update launchd plist**

Replace `sync-to-cloud.sh` reference with `sync-to-turso.js`:

```xml
<key>ProgramArguments</key>
<array>
    <string>/Users/scott/.bun/bin/bun</string>
    <string>/Users/scott/Projects/sni-research-v2/scripts/sync-to-turso.js</string>
</array>
```

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-to-turso.js
git commit -m "feat(db): add sync-to-turso script replacing sync-to-cloud.sh"
```

---

### Task 7: Update API routes — articles + status

**Files:**
- Modify: `web/api/routes/articles.js`
- Modify: `web/api/routes/status.js`
- Modify: `web/api/lib/walk.js`
- Modify: `web/api/tests/articles.test.js`
- Modify: `web/api/tests/status.test.js`

- [ ] **Step 1: Update articles.test.js to use DB fixtures**

Replace filesystem setup (mkdirSync + writeFileSync) with DB inserts via `insertArticle()`. Keep all existing assertions — only the data source changes.

- [ ] **Step 2: Run tests to verify they fail (articles route still reads files)**

Run: `cd web/api && bun test tests/articles.test.js`
Expected: FAIL (tests use DB fixtures, route still reads files)

- [ ] **Step 3: Rewrite articles.js route handlers**

Replace each handler:
- `getArticles()`: call `articleQueries.getArticles(db, query)` instead of `getAllArticlesCached()`
- `getArticle()`: call `articleQueries.getArticle(db, date, sector, slug)`
- `getFlaggedArticles()`: call `articleQueries.getFlaggedArticles(db)`
- `manualIngest()`: call `articleQueries.insertArticle(db, article)`
- `patchArticle()`: call `articleQueries.updateArticle(db, ...)`
- `deleteArticle()`: call `articleQueries.deleteArticle(db, ...)`
- `getPublications()`: call `articleQueries.getPublications(db)`
- `getLastUpdated()`: `SELECT MAX(scraped_at) FROM articles`
- Remove: `_articlesCache`, `_articlesCacheAt`, `_articlesInflight`, `invalidateArticlesCache()`, `getAllArticlesCached()`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web/api && bun test tests/articles.test.js`
Expected: PASS

- [ ] **Step 5: Update status.test.js to use DB fixtures**

- [ ] **Step 6: Rewrite status.js route handlers**

Replace `getArticleCountsAsync()` walk with `articleQueries.getArticleCounts(db)`. Remove SWR cache, startup warming.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web/api && bun test tests/status.test.js`
Expected: PASS

- [ ] **Step 8: Strip walk.js of article functions**

Keep only `validateParam()`. Remove `walkArticleDir()` and `walkArticleDirAsync()`. They're no longer called.

- [ ] **Step 9: Commit**

```bash
git add web/api/routes/articles.js web/api/routes/status.js web/api/lib/walk.js \
  web/api/tests/articles.test.js web/api/tests/status.test.js
git commit -m "feat(db): articles + status routes read from Turso"
```

---

### Task 8: Update API routes — editorial

**Files:**
- Modify: `web/api/routes/editorial.js`
- Modify: `web/api/tests/editorial.test.js`
- Modify: `web/api/tests/editorial-triggers.test.js`

- [ ] **Step 1: Update editorial.test.js to use DB fixtures**

- [ ] **Step 2: Rewrite editorial.js GET handlers**

Replace `readJSON(STATE_PATH)` + in-memory filtering with editorial query functions:
- `getEditorialState()` → query appropriate table based on `section` param
- `searchEditorial()` → `editorialQueries.searchEditorial(db, q)`
- `getEditorialBacklog()` → `editorialQueries.getPosts(db, filters)`
- `getEditorialThemes()` → `editorialQueries.getThemes(db, filters)`
- `getEditorialNotifications()` → `SELECT * FROM notifications WHERE dismissed = 0`
- `getEditorialActivity()` → `editorialQueries.getActivity(db, limit)`
- `getEditorialCost()` → `SELECT * FROM cost_log WHERE stage IS NOT NULL` then reconstruct weekly view by grouping sessions that fall within the requested ISO week's date range
- `renderEditorialSection()` → query + render (keep render functions from editorial-state.js)

- [ ] **Step 3: Rewrite editorial.js PUT handlers**

Replace `loadState()` → mutate → `saveState()` with direct DB updates:
- `putBacklogStatus()` → `editorialQueries.updatePostStatus(db, id, status)`
- `putAnalysisArchive()` → `UPDATE analysis_entries SET archived = ? WHERE id = ?` (separate from status)
- `putThemeArchive()` → `UPDATE themes SET archived = ? WHERE code = ?`
- `putDecisionArchive()` → `UPDATE decisions SET archived = ? WHERE id = ?`
- `dismissNotification()` → `UPDATE notifications SET dismissed = 1 WHERE id = ?`

**Note:** Remove `withStateLock()` for these — DB handles concurrency via transactions.

- [ ] **Step 4: Keep these handlers on filesystem (do NOT move to DB)**

The following read per-session pipeline output files, not editorial state. They stay on filesystem:
- `getEditorialDraft()` — reads `data/editorial/drafts/draft-session-N-final.md`, `critique-session-N.json`, `metrics-session-N.json`
- `getDiscoverProgress()` — reads `data/editorial/discover/discover-progress-session-N.json`
- `getEditorialStatus()` — reads `.analyse.lock`, `.discover.lock`, `.draft.lock` lock files
- POST trigger handlers (`postTriggerAnalyse`, `postTriggerDiscover`, etc.) — spawn pipeline scripts that still write to local state.json. The sync script pushes state to Turso.

- [ ] **Step 5: Run tests**

Run: `cd web/api && bun test tests/editorial.test.js tests/editorial-triggers.test.js`

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/editorial.js web/api/tests/editorial.test.js web/api/tests/editorial-triggers.test.js
git commit -m "feat(db): editorial routes read/write Turso"
```

---

### Task 9: Update API routes — podcasts

**Files:**
- Modify: `web/api/routes/podcasts.js`
- Modify: `web/api/tests/podcasts.test.js`

- [ ] **Step 1: Update podcasts.test.js**

- [ ] **Step 2: Rewrite podcast route handlers**

- `handleGetPodcasts()` → `podcastQueries.getEpisodes(db, { week })`
- `handleGetTranscript()` → Keep reading from filesystem (transcripts are large markdown files, not in DB)
- `handlePatchPodcast()` → `podcastQueries.patchEpisode(db, ...)`
- Remove SWR cache for podcasts

- [ ] **Step 3: Run tests**

Run: `cd web/api && bun test tests/podcasts.test.js`

- [ ] **Step 4: Commit**

```bash
git add web/api/routes/podcasts.js web/api/tests/podcasts.test.js
git commit -m "feat(db): podcast routes read from Turso"
```

---

### Task 10: Update context assembly for co-pilot

**Files:**
- Modify: `web/api/lib/context.js`

- [ ] **Step 1: Replace loadArticlesForWeek with DB query**

```javascript
// Before: walks data/verified/ and data/podcast-articles/ directories
// After:
const articles = await getArticles(db, { dateFrom, dateTo, limit: 200 })
```

- [ ] **Step 2: Replace buildEditorialContext with DB query**

```javascript
// Before: reads state.json, filters in memory
// After:
const entries = await getAnalysisEntries(db, { status: 'active', tier: 1, limit: 30 })
const themes = await getThemes(db, { active: true })
const posts = await getPosts(db, { priority: 'high', limit: 15 })
```

- [ ] **Step 3: Replace loadArticleFullText and loadPodcastFullText**

```javascript
// loadArticleFullText — before: reads .md or .json from filesystem
// After: SELECT full_text FROM articles WHERE date_published = ? AND sector = ? AND slug = ?

// loadPodcastFullText — KEEP ON FILESYSTEM
// Transcripts are large markdown files (16K+ chars) not stored in DB.
// Read from data/podcasts/{date}/{source}/{slug}.md as before.
```

- [ ] **Step 4: Replace buildPodcastContext with DB query**

```javascript
// Before: reads manifest.json + digest files
// After:
const episodes = await getEpisodes(db, { week })  // includes stories via JOIN
```

- [ ] **Step 5: Run chat tests**

Run: `cd web/api && bun test tests/chat.test.js`

- [ ] **Step 6: Commit**

```bash
git add web/api/lib/context.js
git commit -m "feat(db): co-pilot context assembly reads from Turso"
```

---

### Task 11: Update server.js startup

**Files:**
- Modify: `web/api/server.js`

- [ ] **Step 1: Replace cache warming with DB migration**

Remove the 2-second setTimeout + three parallel cache warm calls. Replace with:

```javascript
import { getDb, migrateSchema } from './lib/db.js'

// Run DB migrations on startup
const db = getDb()
await migrateSchema(db)

// If embedded replica, force initial sync
if (process.env.FLY_MACHINE_ID) {
  await db.sync()
  console.log('[startup] Embedded replica synced')
}
```

- [ ] **Step 2: Remove SWR cache imports from server.js**

Remove any references to `invalidateStatusCache`, `invalidateArticlesCache`, cache warming functions.

- [ ] **Step 3: Run full test suite**

Run: `cd web/api && bun test`
Expected: 250 pass, 0 fail (1 skip is pre-existing)

- [ ] **Step 4: Commit**

```bash
git add web/api/server.js
git commit -m "feat(db): server startup runs DB migrations instead of cache warming"
```

---

### Task 12: Update Dockerfile + deploy

**Files:**
- Modify: `Dockerfile`
- Modify: `fly.toml` (if volume mount changes needed)

- [ ] **Step 1: Update Dockerfile**

- Add `@libsql/client` to dependencies (already in package.json from Task 1)
- Keep volume mount at `/app/data/` for `local.db` embedded replica
- Remove sync-to-cloud.sh from image (no longer needed)

- [ ] **Step 2: Build and verify locally**

```bash
cd web/app && bun run build
```
Expected: 0 errors

- [ ] **Step 3: Deploy to Fly**

```bash
fly deploy -a sni-research
```

- [ ] **Step 4: Verify post-deploy**

```bash
# Health check
curl -s https://sni-research.fly.dev/api/health

# Check from inside — embedded replica should have data
fly ssh console -a sni-research -C "sh -c 'ls -la /app/data/local.db'"
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile fly.toml
git commit -m "deploy: Turso embedded replica on Fly"
```

---

### Task 13: Remove old sync mechanism

**Files:**
- Delete: `scripts/sync-to-cloud.sh`
- Modify: launchd plist to point to `sync-to-turso.js`

- [ ] **Step 1: Unload old launchd job**

```bash
launchctl unload ~/Library/LaunchAgents/com.sni.sync-to-cloud.plist
```

- [ ] **Step 2: Update plist to use sync-to-turso.js**

- [ ] **Step 3: Load new job**

```bash
launchctl load ~/Library/LaunchAgents/com.sni.sync-to-cloud.plist
```

- [ ] **Step 4: Delete old sync script**

```bash
rm scripts/sync-to-cloud.sh
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old rsync sync, switch to sync-to-turso.js"
```

---

### Task 14: Full verification

- [ ] **Step 1: Run full test suite**

```bash
cd web/api && bun test
```
Expected: 250+ pass, 0 fail

- [ ] **Step 2: Run build**

```bash
cd web/app && bun run build
```
Expected: 0 errors

- [ ] **Step 3: Start local dev server and verify UI**

```bash
bun --watch web/api/server.js &
cd web/app && bun run dev
```

Check Dashboard, Database, Editorial pages render correctly.

- [ ] **Step 4: Run sync and verify data freshness**

```bash
bun scripts/sync-to-turso.js
```

Check Fly deployment shows latest data.

- [ ] **Step 5: Verify co-pilot context assembly**

Open co-pilot in UI, ask a question about recent articles. Verify it has context.

---

## What this eliminates

| Before | After |
|--------|-------|
| 209 MB rsync tarball 3×/day | HTTP upserts (~10 KB per article) |
| 5-minute SWR cache + startup warming | Direct DB queries (<1ms with embedded replica) |
| `walkArticleDirAsync` scanning 9,392 files | Indexed SQL queries |
| Silent sync failures (PATH, SSH, machine state) | Single HTTP connection, idempotent |
| In-memory text search | FTS5 full-text search |
| In-memory pagination (array slice) | SQL LIMIT/OFFSET |
| state.json (689 KB) full-file read/write for every query | Row-level queries |
| Co-pilot context from file walks | Co-pilot context from indexed queries |

## What this preserves

| Unchanged | Why |
|-----------|-----|
| Pipeline scripts (fetch, score, analyse, draft) | Continue writing JSON files locally |
| Chat threads + pins (JSONL files) | Per-session, low volume, not queried |
| Draft markdown files | Single files, read/written whole |
| Published newsletter files | Same |
| Config YAML files | Loaded at startup |
| All API endpoint signatures | UI consumes same shapes |
| Auth middleware | No data storage involvement |
| Pipeline trigger handlers | Spawn scripts, unchanged |
