# Phase 4: Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the editorial workbench with article CRUD, manual ingest, real-time updates, article detail panel, config management, and UI polish.

**Architecture:** All new code in `web/`. API server (port 3900) gains write endpoints for articles and config. Manual ingest proxies to the existing pipeline ingest server (port 3847). Real-time updates use stat-based polling. Config writes use a write-validate-swap pattern. UI changes concentrate in Articles.jsx and a new Config.jsx page.

**Tech Stack:** Bun, React, js-yaml (new dependency for config serialisation), existing pipeline ingest server (port 3847).

**Test runner:** `cd web/api && bun test` (bun:test with describe/it/expect). Currently 48 tests, 246 assertions across 6 files.

**Build check:** `cd web/app && bunx vite build` (must produce 0 errors).

---

## Parallelisation Note

Tasks 1, 2 and 3 are fully independent. They can be built in parallel by separate agents or sequentially in any order. Tasks 4+ are sequential.

---

## Task 1: Inline Article Actions — API (PATCH/DELETE)

**Files:**
- Modify: `web/api/routes/articles.js` — add `patchArticle()`, `deleteArticle()`
- Modify: `web/api/server.js` — wire PATCH and DELETE routes
- Create: `web/api/articles-write.test.js` — tests for write operations
- Reference: `web/api/lib/walk.js` — `validateParam()`, `ROOT`

### Step 1: Write failing tests for patchArticle

Create `web/api/articles-write.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { patchArticle, deleteArticle } from './routes/articles.js'

const ROOT = resolve(import.meta.dir, '../..')
const TEST_DATE = '2099-01-01'
const TEST_SECTOR = 'general'
const TEST_SLUG = 'test-article-write'

const testArticle = {
  title: 'Test Article',
  url: 'https://example.com/test',
  source: 'Test Source',
  sector: 'general',
  date_published: TEST_DATE,
  full_text: 'Test content for article write tests.',
  score: 7,
  keywords_matched: ['test'],
  scraped_at: '2099-01-01T00:00:00Z',
}

beforeAll(() => {
  const dir = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${TEST_SLUG}.json`), JSON.stringify(testArticle))
})

afterAll(() => {
  // Clean up test directories
  const verifiedDir = join(ROOT, 'data/verified', TEST_DATE)
  if (existsSync(verifiedDir)) rmSync(verifiedDir, { recursive: true })
  const deletedDir = join(ROOT, 'data/deleted', TEST_DATE)
  if (existsSync(deletedDir)) rmSync(deletedDir, { recursive: true })
  const reviewDir = join(ROOT, 'data/review', TEST_DATE)
  if (existsSync(reviewDir)) rmSync(reviewDir, { recursive: true })
})

describe('patchArticle', () => {
  it('rejects invalid params', async () => {
    try {
      await patchArticle('../etc', 'general', 'slug', {})
      expect(true).toBe(false) // should not reach
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })

  it('returns 404 for non-existent article', async () => {
    try {
      await patchArticle('9999-01-01', 'general', 'nonexistent', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })

  it('flags an article (copies to review)', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: true })
    expect(result.article.title).toBe('Test Article')
    const reviewPath = join(ROOT, 'data/review', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(reviewPath)).toBe(true)
  })

  it('unflags an article (removes from review)', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { flagged: false })
    expect(result.article.title).toBe('Test Article')
    const reviewPath = join(ROOT, 'data/review', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(reviewPath)).toBe(false)
  })

  it('moves article to new sector', async () => {
    const result = await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'medtech' })
    expect(result.moved).toBeTruthy()
    expect(result.moved.to).toContain('medtech')
    const newPath = join(ROOT, 'data/verified', TEST_DATE, 'medtech', `${TEST_SLUG}.json`)
    expect(existsSync(newPath)).toBe(true)
    const oldPath = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(oldPath)).toBe(false)

    // Move back for subsequent tests
    await patchArticle(TEST_DATE, 'medtech', TEST_SLUG, { sector: 'general' })
  })

  it('returns 409 on slug collision during sector move', async () => {
    // Create a file at the destination
    const destDir = join(ROOT, 'data/verified', TEST_DATE, 'biopharma')
    mkdirSync(destDir, { recursive: true })
    writeFileSync(join(destDir, `${TEST_SLUG}.json`), JSON.stringify(testArticle))

    try {
      await patchArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG, { sector: 'biopharma' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(409)
    }

    // Clean up collision file
    rmSync(join(destDir, `${TEST_SLUG}.json`))
  })
})

describe('deleteArticle', () => {
  it('soft-deletes an article to data/deleted/', async () => {
    const result = await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
    expect(result.deleted).toBe(true)
    const deletedPath = join(ROOT, 'data/deleted', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(deletedPath)).toBe(true)
    const deletedContent = JSON.parse(readFileSync(deletedPath, 'utf-8'))
    expect(deletedContent.deleted_at).toBeTruthy()
    const originalPath = join(ROOT, 'data/verified', TEST_DATE, TEST_SECTOR, `${TEST_SLUG}.json`)
    expect(existsSync(originalPath)).toBe(false)
  })

  it('returns 404 for already-deleted article', async () => {
    try {
      await deleteArticle(TEST_DATE, TEST_SECTOR, TEST_SLUG)
      expect(true).toBe(false)
    } catch (err) {
      expect(err.status).toBe(404)
    }
  })
})
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test articles-write.test.js`
Expected: FAIL — `patchArticle` and `deleteArticle` not exported from articles.js

### Step 3: Implement patchArticle and deleteArticle

Add to `web/api/routes/articles.js` (after existing imports, add new fs imports and two new exported functions):

```js
// Add to existing imports at top:
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'fs'

// ... existing getArticles, getArticle, getFlaggedArticles ...

export async function patchArticle(date, sector, slug, body) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  const result = { article: { slug, ...raw } }

  // Handle flagging
  if (body.flagged === true) {
    const reviewDir = join(ROOT, 'data/review', date, sector)
    mkdirSync(reviewDir, { recursive: true })
    writeFileSync(join(reviewDir, `${slug}.json`), JSON.stringify(raw, null, 2))
  } else if (body.flagged === false) {
    const reviewPath = join(ROOT, 'data/review', date, sector, `${slug}.json`)
    if (existsSync(reviewPath)) rmSync(reviewPath)
  }

  // Handle sector move
  if (body.sector && body.sector !== sector) {
    validateParam(body.sector, 'sector')
    const destDir = join(ROOT, 'data/verified', date, body.sector)
    const destPath = join(destDir, `${slug}.json`)

    if (existsSync(destPath)) {
      const err = new Error(`An article with this name already exists in ${body.sector}`)
      err.status = 409
      throw err
    }

    mkdirSync(destDir, { recursive: true })
    raw.sector = body.sector
    writeFileSync(destPath, JSON.stringify(raw, null, 2))
    rmSync(filePath)

    // Also move review copy if flagged
    const oldReview = join(ROOT, 'data/review', date, sector, `${slug}.json`)
    if (existsSync(oldReview)) {
      const newReviewDir = join(ROOT, 'data/review', date, body.sector)
      mkdirSync(newReviewDir, { recursive: true })
      writeFileSync(join(newReviewDir, `${slug}.json`), JSON.stringify(raw, null, 2))
      rmSync(oldReview)
    }

    result.article.sector = body.sector
    result.moved = {
      from: `data/verified/${date}/${sector}/${slug}.json`,
      to: `data/verified/${date}/${body.sector}/${slug}.json`,
    }
  }

  return result
}

export async function deleteArticle(date, sector, slug) {
  validateParam(date, 'date')
  validateParam(sector, 'sector')
  validateParam(slug, 'slug')

  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) {
    const err = new Error('Article not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  raw.deleted_at = new Date().toISOString()

  // Move to data/deleted/
  const deletedDir = join(ROOT, 'data/deleted', date, sector)
  mkdirSync(deletedDir, { recursive: true })
  writeFileSync(join(deletedDir, `${slug}.json`), JSON.stringify(raw, null, 2))
  rmSync(filePath)

  // Also remove from review if flagged
  const reviewPath = join(ROOT, 'data/review', date, sector, `${slug}.json`)
  if (existsSync(reviewPath)) rmSync(reviewPath)

  return { deleted: true, path: `data/deleted/${date}/${sector}/${slug}.json` }
}
```

Note: The existing import line `import { readFileSync, existsSync } from 'fs'` must be updated to include `mkdirSync, writeFileSync, renameSync, rmSync`.

### Step 4: Run tests to verify they pass

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test articles-write.test.js`
Expected: All 8 tests PASS

### Step 5: Wire PATCH and DELETE into server.js

Add imports to the top of `web/api/server.js`:

```js
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle } from './routes/articles.js'
```

Add route handlers after the existing GET single-article block (after line 62):

```js
      if (articleMatch && req.method === 'PATCH') {
        const [, date, sector, slug] = articleMatch
        const body = await req.json()
        return json(await patchArticle(date, sector, slug, body))
      }

      if (articleMatch && req.method === 'DELETE') {
        const [, date, sector, slug] = articleMatch
        return json(await deleteArticle(date, sector, slug))
      }
```

### Step 6: Run all tests and build

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`
Expected: All tests pass (48 existing + 8 new = 56 tests)

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`
Expected: 0 errors

### Step 7: Commit

```bash
git add web/api/routes/articles.js web/api/server.js web/api/articles-write.test.js
git commit -m "feat: add PATCH/DELETE article endpoints for inline actions"
```

---

## Task 2: Manual Ingest — API Proxy + Status Health Check

**Files:**
- Modify: `web/api/server.js` — add POST /api/articles/ingest route
- Modify: `web/api/routes/articles.js` — add `ingestArticle()` proxy function
- Modify: `web/api/routes/status.js` — add ingest health check to `getStatus()`
- Modify: `web/api/articles-write.test.js` — add ingest proxy tests
- Reference: `scripts/server.js` lines 35-164 — ingest server response format

### Step 1: Write failing tests for ingestArticle and status health check

Append to `web/api/articles-write.test.js`:

```js
import { ingestArticle } from './routes/articles.js'
import { getStatus } from './routes/status.js'

describe('ingestArticle', () => {
  it('rejects missing URL', async () => {
    try {
      await ingestArticle({})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('url')
    }
  })

  it('rejects invalid URL format', async () => {
    try {
      await ingestArticle({ url: 'not-a-url' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('url')
    }
  })

  // Integration test — only passes when ingest server is running on 3847
  // Skipped by default since ingest server may not be available
  it.skip('proxies to ingest server', async () => {
    const result = await ingestArticle({ url: 'https://example.com' })
    expect(result).toHaveProperty('status')
  })
})

describe('getStatus with ingest health', () => {
  it('includes ingestServer field', async () => {
    const status = await getStatus()
    expect(status).toHaveProperty('ingestServer')
    expect(status.ingestServer).toHaveProperty('online')
    expect(typeof status.ingestServer.online).toBe('boolean')
  })
})
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test articles-write.test.js`
Expected: FAIL — `ingestArticle` not exported

### Step 3: Implement ingestArticle proxy

Add to `web/api/routes/articles.js`:

```js
const INGEST_URL = 'http://127.0.0.1:3847'

export async function ingestArticle(body) {
  if (!body.url || typeof body.url !== 'string') {
    throw new Error('Missing or invalid url')
  }

  try {
    new URL(body.url)
  } catch {
    throw new Error('Invalid url format')
  }

  const payload = { url: body.url }
  if (body.sectorOverride) payload.sectorOverride = body.sectorOverride

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(`${INGEST_URL}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const data = await res.json()

    if (!res.ok) {
      const err = new Error(data.error || `Ingest server error ${res.status}`)
      err.status = res.status
      throw err
    }

    return data
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeout_err = new Error('Ingest request timed out after 30s')
      timeout_err.status = 504
      throw timeout_err
    }
    if (err.status) throw err
    const conn_err = new Error('Ingest server unavailable')
    conn_err.status = 503
    throw conn_err
  } finally {
    clearTimeout(timeout)
  }
}
```

### Step 4: Add ingest health check to getStatus

Modify `web/api/routes/status.js` — update `getStatus()`:

```js
export async function getStatus() {
  return {
    lastRun: getLastRun(),
    articles: getArticleCounts(),
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors(),
    ingestServer: await getIngestHealth(),
  }
}

async function getIngestHealth() {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch('http://127.0.0.1:3847/health', { signal: controller.signal })
    clearTimeout(timeout)
    return { online: res.ok }
  } catch {
    return { online: false }
  }
}
```

### Step 5: Wire POST /api/articles/ingest into server.js

Add to imports in `server.js`:

```js
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle } from './routes/articles.js'
```

Add route handler (before the 404 fallback):

```js
      if (path === '/api/articles/ingest' && req.method === 'POST') {
        const body = await req.json()
        return json(await ingestArticle(body))
      }
```

### Step 6: Run tests to verify they pass

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`
Expected: All tests pass

### Step 7: Commit

```bash
git add web/api/routes/articles.js web/api/routes/status.js web/api/server.js web/api/articles-write.test.js
git commit -m "feat: add ingest proxy endpoint and health check"
```

---

## Task 3: Real-Time Updates — Last-Updated Endpoint

**Files:**
- Modify: `web/api/routes/articles.js` — add `getLastUpdated()`
- Modify: `web/api/server.js` — wire GET /api/articles/last-updated
- Modify: `web/api/articles-write.test.js` — add tests
- Reference: `web/api/lib/walk.js` — ROOT constant

### Step 1: Write failing test for getLastUpdated

Append to `web/api/articles-write.test.js`:

```js
import { getLastUpdated } from './routes/articles.js'

describe('getLastUpdated', () => {
  it('returns a timestamp object', async () => {
    const result = await getLastUpdated()
    expect(result).toHaveProperty('timestamp')
    expect(typeof result.timestamp).toBe('number')
  })

  it('timestamp is a valid epoch ms', async () => {
    const result = await getLastUpdated()
    // Should be a reasonable timestamp (after 2020)
    expect(result.timestamp).toBeGreaterThan(1577836800000)
  })
})
```

### Step 2: Run tests to verify they fail

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test articles-write.test.js`
Expected: FAIL — `getLastUpdated` not exported

### Step 3: Implement getLastUpdated

Add to `web/api/routes/articles.js` (add `statSync` to the fs imports):

```js
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'fs'

// ... existing code ...

export async function getLastUpdated() {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { timestamp: 0 }

  let maxMtime = 0

  const dates = readdirSync(verifiedDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  for (const d of dates) {
    const datePath = join(verifiedDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath)
    for (const s of sectors) {
      const sectorPath = join(datePath, s)
      try {
        const mtime = statSync(sectorPath).mtimeMs
        if (mtime > maxMtime) maxMtime = mtime
      } catch { /* skip */ }
    }
  }

  return { timestamp: maxMtime }
}
```

### Step 4: Wire into server.js

Add `getLastUpdated` to the articles import:

```js
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle, getLastUpdated } from './routes/articles.js'
```

Add route handler. **Important:** This must go BEFORE the `/api/articles/flagged` route to avoid regex conflicts, or just add it right after the flagged route since it's a static path:

```js
      if (path === '/api/articles/last-updated' && req.method === 'GET') {
        return json(await getLastUpdated())
      }
```

### Step 5: Run tests and build

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`
Expected: All tests pass

### Step 6: Commit

```bash
git add web/api/routes/articles.js web/api/server.js web/api/articles-write.test.js
git commit -m "feat: add last-updated endpoint for real-time polling"
```

---

## Checkpoint Review 1

After Tasks 1-3, verify:
- All API tests pass: `cd web/api && bun test`
- Build clean: `cd web/app && bunx vite build`
- Pipeline isolation: `bun scripts/pipeline.js --mode daily --dry-run`
- No files outside `web/` modified (except test data created/cleaned in `data/`)

Count expected tests: 48 existing + ~14 new = ~62 tests.

---

## Task 4: Inline Article Actions — React UI

**Files:**
- Modify: `web/app/src/pages/Articles.jsx` — hover-reveal actions per row, ingest form, "manual" badge
- Modify: `web/app/src/pages/Articles.css` — action styles, ingest form styles
- Modify: `web/app/src/hooks/useArticles.js` — add real-time polling, add `patchArticle`/`deleteArticle` API calls
- Modify: `web/app/src/lib/api.js` — add `apiPatch()`, `apiDelete()` helpers

### Step 1: Add apiPatch and apiDelete helpers

Modify `web/app/src/lib/api.js` — add after existing `apiStream`:

```js
export async function apiPatch(path, body) {
  return apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function apiDelete(path) {
  return apiFetch(path, { method: 'DELETE' })
}

export async function apiPost(path, body) {
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
```

### Step 2: Add real-time polling to useArticles

Rewrite `web/app/src/hooks/useArticles.js`:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useArticles(filters = {}) {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)
  const lastFetchTs = useRef(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filters.sector) params.set('sector', filters.sector)
      if (filters.date) params.set('date', filters.date)
      if (filters.search) params.set('search', filters.search)

      const qs = params.toString()
      const data = await apiFetch(`/api/articles${qs ? '?' + qs : ''}`)
      setArticles(data.articles)
      setTotal(data.total)
      setLoading(false)
      lastFetchTs.current = Date.now()
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [filters.sector, filters.date, filters.search])

  useEffect(() => { load() }, [load])

  // Poll for changes every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const { timestamp } = await apiFetch('/api/articles/last-updated')
        setLastUpdated(timestamp)
        if (timestamp > lastFetchTs.current) {
          load()
        }
      } catch { /* ignore polling errors */ }
    }, 15000)
    return () => clearInterval(interval)
  }, [load])

  return { articles, total, loading, error, reload: load, lastUpdated }
}
```

### Step 3: Rewrite Articles.jsx with inline actions

Full rewrite of `web/app/src/pages/Articles.jsx`:

```jsx
import { useState } from 'react'
import { useArticles } from '../hooks/useArticles'
import { useFlaggedArticles } from '../hooks/useFlaggedArticles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useStatus } from '../hooks/useStatus'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate, formatRelativeTime } from '../lib/format'
import { apiFetch, apiPatch, apiDelete, apiPost } from '../lib/api'
import './Articles.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function Articles() {
  const [sector, setSector] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')
  const [showIngest, setShowIngest] = useState(false)

  const debouncedSearch = useDebouncedValue(search, 300)

  const allResult = useArticles({ sector, date, search: debouncedSearch })
  const flaggedResult = useFlaggedArticles()
  const { status } = useStatus()

  const ingestOnline = status?.ingestServer?.online ?? false

  const { articles, total, loading, error, reload, lastUpdated } = tab === 'all' ? allResult : flaggedResult

  return (
    <div>
      <div className="page-header">
        <h2>Articles</h2>
        <button
          className="btn btn-primary"
          disabled={!ingestOnline}
          onClick={() => setShowIngest(!showIngest)}
        >
          {ingestOnline ? '+ Ingest URL' : '+ Ingest (offline)'}
        </button>
      </div>

      {showIngest && <IngestForm onSuccess={() => { setShowIngest(false); reload() }} />}

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All articles <span className="tab-count">({allResult.total})</span>
        </button>
        <button className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged <span className="tab-count">({flaggedResult.total})</span>
        </button>
      </div>

      {tab === 'all' && (
        <div className="filter-bar">
          <select value={sector} onChange={e => setSector(e.target.value)}>
            <option value="">All sectors</option>
            {SECTORS.filter(Boolean).map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Search articles..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="filter-search"
          />
          {lastUpdated && (
            <span className="updated-indicator">
              Updated {formatRelativeTime(new Date(lastUpdated).toISOString())}
            </span>
          )}
        </div>
      )}

      <div className="card card-flush">
        {loading ? (
          <div className="placeholder-text">Loading...</div>
        ) : error ? (
          <div className="placeholder-text">Failed to load articles: {error}</div>
        ) : (
          <ArticleTable
            articles={articles}
            tab={tab}
            onReload={() => { reload(); flaggedResult.reload?.() }}
          />
        )}
      </div>
    </div>
  )
}

function ArticleTable({ articles, tab, onReload }) {
  const [expandedSlug, setExpandedSlug] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [actionError, setActionError] = useState(null)

  async function handleSectorChange(a, newSector) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { sector: newSector })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleFlagToggle(a) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { flagged: !a.flagged })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function handleDelete(a) {
    setActionError(null)
    try {
      await apiDelete(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`)
      setDeleteConfirm(null)
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }

  function handleRowClick(a) {
    const key = `${a.date_published}-${a.sector}-${a.slug}`
    setExpandedSlug(expandedSlug === key ? null : key)
  }

  return (
    <>
      {actionError && <div className="action-error">{actionError}</div>}
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Sector</th>
              <th>Date</th>
              <th>Score</th>
              <th>{tab === 'flagged' ? 'Reason' : 'Actions'}</th>
            </tr>
          </thead>
          <tbody>
            {articles.map(a => {
              const key = `${a.date_published}-${a.sector}-${a.slug}`
              const isExpanded = expandedSlug === key
              const isDeleting = deleteConfirm === key

              return (
                <ArticleRow
                  key={key}
                  article={a}
                  tab={tab}
                  isExpanded={isExpanded}
                  isDeleting={isDeleting}
                  onRowClick={() => handleRowClick(a)}
                  onSectorChange={(s) => handleSectorChange(a, s)}
                  onFlagToggle={() => handleFlagToggle(a)}
                  onDeleteClick={() => setDeleteConfirm(key)}
                  onDeleteConfirm={() => handleDelete(a)}
                  onDeleteCancel={() => setDeleteConfirm(null)}
                />
              )
            })}
            {articles.length === 0 && (
              <tr>
                <td colSpan={5} className="placeholder-text">No articles found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ArticleRow({
  article: a, tab, isExpanded, isDeleting,
  onRowClick, onSectorChange, onFlagToggle,
  onDeleteClick, onDeleteConfirm, onDeleteCancel
}) {
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function loadDetail() {
    if (detail) return
    setDetailLoading(true)
    try {
      const data = await apiFetch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`)
      setDetail(data)
    } catch { /* ignore */ }
    setDetailLoading(false)
  }

  function handleClick() {
    onRowClick()
    if (!isExpanded) loadDetail()
  }

  if (isDeleting) {
    return (
      <tr className="delete-confirm-row">
        <td colSpan={5}>
          <span>Delete "{a.title}"?</span>
          <button className="btn btn-danger btn-sm" onClick={onDeleteConfirm}>Yes, delete</button>
          <button className="btn btn-ghost btn-sm" onClick={onDeleteCancel}>Cancel</button>
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr className={`article-row ${isExpanded ? 'expanded' : ''}`} onClick={handleClick}>
        <td>
          <div className="article-title">{a.title}</div>
          <div className="article-source">{a.source}</div>
        </td>
        <td><SectorBadge sector={a.sector} /></td>
        <td className="cell-meta">{formatDate(a.date_published)}</td>
        <td>
          <span className={`score ${scoreClass(a.score)}`}>
            {a.score != null ? a.score : (a.source_type === 'manual' ? 'manual' : '\u2014')}
          </span>
        </td>
        <td className="cell-actions" onClick={e => e.stopPropagation()}>
          {tab === 'flagged' ? (
            <span className="cell-meta">{a.reason || '\u2014'}</span>
          ) : (
            <div className="row-actions">
              <select
                className="action-sector-select"
                value={a.sector}
                onChange={e => onSectorChange(e.target.value)}
              >
                {SECTORS.filter(Boolean).map(s => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
              <button
                className={`action-btn flag-btn ${a.flagged ? 'flagged' : ''}`}
                onClick={onFlagToggle}
                title={a.flagged ? 'Unflag' : 'Flag for review'}
              >
                {a.flagged ? '\u2691' : '\u2690'}
              </button>
              <button className="action-btn delete-btn" onClick={onDeleteClick} title="Delete">
                \u2715
              </button>
            </div>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className="detail-row">
          <td colSpan={5}>
            <ArticleDetail article={a} detail={detail} loading={detailLoading} />
          </td>
        </tr>
      )}
    </>
  )
}

function ArticleDetail({ article, detail, loading }) {
  if (loading) return <div className="detail-panel"><div className="placeholder-text">Loading...</div></div>
  const d = detail || article

  return (
    <div className="detail-panel">
      <div className="detail-grid">
        <div className="detail-text">
          <h4>Full text</h4>
          <div className="detail-fulltext">{d.full_text || 'No text available'}</div>
        </div>
        <div className="detail-meta">
          <h4>Metadata</h4>
          <dl>
            <dt>Source</dt><dd>{d.source}</dd>
            <dt>URL</dt><dd><a href={d.url} target="_blank" rel="noopener noreferrer">{d.url}</a></dd>
            <dt>Published</dt><dd>{d.date_published}</dd>
            <dt>Confidence</dt><dd>{d.date_confidence || '\u2014'}</dd>
            <dt>Method</dt><dd>{d.date_verified_method || '\u2014'}</dd>
            <dt>Scraped</dt><dd>{d.scraped_at ? formatDate(d.scraped_at) : '\u2014'}</dd>
            <dt>Type</dt><dd>{d.source_type || 'automated'}</dd>
            {d.score != null && <><dt>Score reason</dt><dd>{d.score_reason || '\u2014'}</dd></>}
          </dl>
          {d.keywords_matched?.length > 0 && (
            <div className="detail-keywords">
              <h4>Keywords</h4>
              <div className="keyword-pills">
                {d.keywords_matched.map(k => <span key={k} className="keyword-pill">{k}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function IngestForm({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [sectorOverride, setSectorOverride] = useState('')
  const [status, setStatus] = useState(null) // { type: 'loading'|'success'|'error'|'duplicate'|'warning', message }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!url.trim()) return

    setStatus({ type: 'loading', message: 'Scraping...' })

    try {
      const body = { url: url.trim() }
      if (sectorOverride) body.sectorOverride = sectorOverride

      const result = await apiPost('/api/articles/ingest', body)

      if (result.status === 'duplicate') {
        setStatus({ type: 'duplicate', message: `Already exists: ${result.title}` })
      } else if (result.off_limits_warning) {
        setStatus({ type: 'warning', message: `Saved with warning: ${result.off_limits_warning}` })
        setTimeout(() => onSuccess(), 3000)
      } else {
        setStatus({ type: 'success', message: `Added: ${result.title} (${result.sector})` })
        setTimeout(() => onSuccess(), 2000)
      }
    } catch (err) {
      setStatus({ type: 'error', message: err.message })
    }
  }

  return (
    <form className="ingest-form" onSubmit={handleSubmit}>
      <input
        type="url"
        placeholder="Paste article URL..."
        value={url}
        onChange={e => setUrl(e.target.value)}
        className="ingest-url"
        required
        disabled={status?.type === 'loading'}
      />
      <select
        value={sectorOverride}
        onChange={e => setSectorOverride(e.target.value)}
        className="ingest-sector"
        disabled={status?.type === 'loading'}
      >
        <option value="">Auto-classify</option>
        {SECTORS.filter(Boolean).map(s => (
          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={status?.type === 'loading'}
      >
        {status?.type === 'loading' ? status.message : 'Ingest'}
      </button>
      {status && status.type !== 'loading' && (
        <div className={`ingest-banner ingest-${status.type}`}>{status.message}</div>
      )}
    </form>
  )
}

function scoreClass(score) {
  if (score == null) return ''
  if (score >= 8) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}
```

### Step 4: Add CSS for new UI elements

Append to `web/app/src/pages/Articles.css`:

```css
/* --- Inline actions --- */
.article-row { cursor: pointer; }
.article-row.expanded td { background: var(--surface); }

.cell-actions { position: relative; width: 180px; }

.row-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s;
}

tr:hover .row-actions { opacity: 1; }

.action-sector-select {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  padding: 4px 8px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  cursor: pointer;
}

.action-btn {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--cloudy);
  cursor: pointer;
  border-radius: var(--radius);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s;
}

.action-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.flag-btn.flagged { color: var(--terra); }
.delete-btn:hover { color: #e74c3c; }

/* --- Delete confirm --- */
.delete-confirm-row td {
  background: rgba(231, 76, 60, 0.05);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-sm { padding: 4px 12px; font-size: 12px; }
.btn-danger { background: #e74c3c; color: white; }
.btn-danger:hover { background: #c0392b; }
.btn-ghost { background: var(--surface); color: var(--text-primary); border: 1px solid var(--light-gray); }
.btn-ghost:hover { background: var(--surface-hover); }

.action-error {
  background: rgba(231, 76, 60, 0.1);
  color: #e74c3c;
  padding: 8px 16px;
  font-size: 13px;
  border-bottom: 1px solid rgba(231, 76, 60, 0.2);
}

/* --- Detail panel --- */
.detail-row td { padding: 0 !important; border-bottom: 2px solid var(--terra-15); }

.detail-panel {
  padding: 20px 24px;
  background: var(--surface);
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 300px;
  gap: 24px;
}

.detail-text h4, .detail-meta h4 {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.detail-fulltext {
  font-size: 14px;
  line-height: 1.7;
  max-height: 400px;
  overflow-y: auto;
  color: var(--text-primary);
}

.detail-meta dl { display: grid; grid-template-columns: 100px 1fr; gap: 6px 12px; font-size: 13px; }
.detail-meta dt { color: var(--cloudy); font-family: 'Poppins', sans-serif; }
.detail-meta dd { color: var(--text-primary); margin: 0; word-break: break-all; }
.detail-meta a { color: var(--terra); text-decoration: none; }
.detail-meta a:hover { text-decoration: underline; }

.keyword-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.keyword-pill {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  background: var(--terra-15);
  color: var(--terra);
}

/* --- Ingest form --- */
.ingest-form {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding: 16px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--light-gray);
}

.ingest-url { flex: 1; min-width: 300px; }

.ingest-url,
.ingest-sector {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  padding: 8px 14px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--card-bg);
  color: var(--text-primary);
  outline: none;
}

.ingest-url:focus,
.ingest-sector:focus {
  border-color: var(--terra);
  box-shadow: var(--focus-ring);
}

.ingest-banner {
  width: 100%;
  padding: 8px 14px;
  border-radius: var(--radius);
  font-size: 13px;
  font-family: 'Poppins', sans-serif;
}

.ingest-success { background: rgba(46, 204, 113, 0.1); color: #2ecc71; }
.ingest-error { background: rgba(231, 76, 60, 0.1); color: #e74c3c; }
.ingest-duplicate { background: rgba(241, 196, 15, 0.1); color: #f1c40f; }
.ingest-warning { background: rgba(241, 196, 15, 0.1); color: #f1c40f; }

/* --- Updated indicator --- */
.updated-indicator {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
  margin-left: auto;
}

/* --- Score manual badge --- */
.score-manual {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--cloudy);
  border: 1px solid var(--light-gray);
}
```

### Step 5: Run build to verify

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`
Expected: 0 errors

### Step 6: Commit

```bash
git add web/app/src/pages/Articles.jsx web/app/src/pages/Articles.css web/app/src/hooks/useArticles.js web/app/src/lib/api.js
git commit -m "feat: add inline article actions, detail panel, ingest form, real-time polling"
```

---

## Checkpoint Review 2

After Task 4, verify:
- All API tests pass: `cd web/api && bun test`
- Build clean: `cd web/app && bunx vite build`
- Manual smoke test: start API server (`bun --watch web/api/server.js`) and Vite dev server (`cd web/app && bun run dev`), check articles page works, hover reveals actions, clicking a row shows detail panel

---

## Task 5: Config Editor — Off-limits Tab + API + Write-Validate-Swap

**Files:**
- Create: `web/api/routes/config.js` — GET/PUT for all three config files
- Create: `web/api/lib/config-validator.js` — structural validation per schema
- Create: `web/api/config.test.js` — tests for config routes
- Modify: `web/api/server.js` — wire config routes
- Modify: `web/api/package.json` — add js-yaml dependency

### Step 1: Install js-yaml

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun add js-yaml`

### Step 2: Write failing tests for config GET/PUT

Create `web/api/config.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getConfig, putConfig } from './routes/config.js'

const ROOT = resolve(import.meta.dir, '../..')

describe('getConfig', () => {
  it('reads off-limits config', async () => {
    const result = await getConfig('off-limits')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('object')
  })

  it('reads sources config', async () => {
    const result = await getConfig('sources')
    expect(result).toHaveProperty('rss_feeds')
  })

  it('reads sectors config', async () => {
    const result = await getConfig('sectors')
    expect(result).toHaveProperty('sectors')
  })

  it('rejects unknown config name', async () => {
    try {
      await getConfig('unknown')
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('Unknown config')
    }
  })
})

describe('putConfig', () => {
  // Use off-limits since it's the least risky to test with
  let originalContent

  beforeAll(() => {
    const path = join(ROOT, 'config/off-limits.yaml')
    originalContent = readFileSync(path, 'utf-8')
  })

  afterAll(() => {
    // Restore original
    const path = join(ROOT, 'config/off-limits.yaml')
    writeFileSync(path, originalContent)
    // Clean up tmp and bak
    const tmpPath = path + '.tmp'
    const bakPath = path + '.bak'
    if (existsSync(tmpPath)) require('fs').rmSync(tmpPath)
  })

  it('writes and validates off-limits config', async () => {
    const current = await getConfig('off-limits')
    // Write back the same content — should succeed
    const result = await putConfig('off-limits', current)
    expect(result).toBeTruthy()
    // .bak should exist
    const bakPath = join(ROOT, 'config/off-limits.yaml.bak')
    expect(existsSync(bakPath)).toBe(true)
  })

  it('rejects invalid off-limits structure', async () => {
    try {
      await putConfig('off-limits', { invalid_key: 'not valid' })
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('validation')
    }
  })

  it('rejects unknown config name', async () => {
    try {
      await putConfig('unknown', {})
      expect(true).toBe(false)
    } catch (err) {
      expect(err.message).toContain('Unknown config')
    }
  })
})
```

### Step 3: Run tests to verify they fail

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test config.test.js`
Expected: FAIL — module not found

### Step 4: Create config-validator.js

Create `web/api/lib/config-validator.js`:

```js
const VALID_SECTORS = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

const VALID_FEED_CATEGORIES = [
  'biopharma', 'medtech', 'manufacturing', 'insurance',
  'cross_sector', 'ai_labs', 'tech_press', 'newsletters', 'wire_services'
]

export function validateOffLimits(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Off-limits config must be an object')
  }
  for (const [key, value] of Object.entries(data)) {
    if (!/^week_\d+$/.test(key)) {
      throw validationError(`Invalid key "${key}" — must match week_N`)
    }
    if (!Array.isArray(value)) {
      throw validationError(`"${key}" must be an array`)
    }
    for (const entry of value) {
      if (!entry.company || typeof entry.company !== 'string') {
        throw validationError(`Each entry in "${key}" must have a "company" string`)
      }
      if (!entry.topic || typeof entry.topic !== 'string') {
        throw validationError(`Each entry in "${key}" must have a "topic" string`)
      }
    }
  }
}

export function validateSources(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Sources config must be an object')
  }
  if (!data.rss_feeds || typeof data.rss_feeds !== 'object') {
    throw validationError('Sources must have "rss_feeds" object')
  }
  for (const [cat, feeds] of Object.entries(data.rss_feeds)) {
    if (!VALID_FEED_CATEGORIES.includes(cat)) {
      throw validationError(`Unknown feed category "${cat}"`)
    }
    if (!Array.isArray(feeds)) {
      throw validationError(`"${cat}" feeds must be an array`)
    }
    for (const feed of feeds) {
      if (!feed.url || typeof feed.url !== 'string') {
        throw validationError(`Each feed in "${cat}" must have a "url" string`)
      }
      if (!feed.name || typeof feed.name !== 'string') {
        throw validationError(`Each feed in "${cat}" must have a "name" string`)
      }
    }
  }
  if (data.general_search_queries) {
    if (!Array.isArray(data.general_search_queries)) {
      throw validationError('"general_search_queries" must be an array')
    }
    for (const q of data.general_search_queries) {
      if (typeof q !== 'string' || q.trim().length === 0) {
        throw validationError('Each search query must be a non-empty string')
      }
    }
  }
}

export function validateSectors(data) {
  if (!data || typeof data !== 'object') {
    throw validationError('Sectors config must be an object')
  }
  if (!data.sectors || typeof data.sectors !== 'object') {
    throw validationError('Must have "sectors" key')
  }
  for (const [key, sector] of Object.entries(data.sectors)) {
    if (!VALID_SECTORS.includes(key)) {
      throw validationError(`Unknown sector "${key}"`)
    }
    if (!sector.display_name || typeof sector.display_name !== 'string') {
      throw validationError(`Sector "${key}" must have a "display_name" string`)
    }
    if (!Array.isArray(sector.required_any_group_1) || sector.required_any_group_1.length === 0) {
      throw validationError(`Sector "${key}" must have a non-empty "required_any_group_1" array`)
    }
    if (!Array.isArray(sector.required_any_group_2) || sector.required_any_group_2.length === 0) {
      throw validationError(`Sector "${key}" must have a non-empty "required_any_group_2" array`)
    }
    if (!Array.isArray(sector.boost)) {
      throw validationError(`Sector "${key}" must have a "boost" array`)
    }
  }
}

function validationError(message) {
  const err = new Error(`Config validation failed: ${message}`)
  err.status = 422
  return err
}
```

### Step 5: Create config routes

Create `web/api/routes/config.js`:

```js
import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'
import { validateOffLimits, validateSources, validateSectors } from '../lib/config-validator.js'

const ROOT = resolve(import.meta.dir, '../../..')

const CONFIGS = {
  'off-limits': { file: 'off-limits.yaml', validate: validateOffLimits },
  'sources':    { file: 'sources.yaml',    validate: validateSources },
  'sectors':    { file: 'sectors.yaml',    validate: validateSectors },
}

export async function getConfig(name) {
  const cfg = CONFIGS[name]
  if (!cfg) throw new Error(`Unknown config: ${name}`)

  const filePath = join(ROOT, 'config', cfg.file)
  const content = readFileSync(filePath, 'utf-8')
  return yaml.load(content)
}

export async function putConfig(name, data) {
  const cfg = CONFIGS[name]
  if (!cfg) throw new Error(`Unknown config: ${name}`)

  const filePath = join(ROOT, 'config', cfg.file)
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'

  try {
    // 1. Serialize to YAML
    const yamlStr = yaml.dump(data, { lineWidth: 120, noRefs: true })

    // 2. Write to .tmp
    writeFileSync(tmpPath, yamlStr)

    // 3. Parse back to verify valid YAML
    const parsed = yaml.load(readFileSync(tmpPath, 'utf-8'))

    // 4. Structural validation
    cfg.validate(parsed)

    // 5. Backup current file
    if (existsSync(filePath)) {
      copyFileSync(filePath, bakPath)
    }

    // 6. Rename .tmp over original
    const { renameSync } = await import('fs')
    renameSync(tmpPath, filePath)

    // 7. Return updated config
    return parsed

  } catch (err) {
    // Clean up tmp on failure
    if (existsSync(tmpPath)) rmSync(tmpPath)
    throw err
  }
}
```

### Step 6: Wire config routes into server.js

Add import to `server.js`:

```js
import { getConfig, putConfig } from './routes/config.js'
```

Add route handlers (before the 404 fallback):

```js
      // --- Config ---
      const configMatch = path.match(/^\/api\/config\/([\w-]+)$/)
      if (configMatch && req.method === 'GET') {
        return json(await getConfig(configMatch[1]))
      }

      if (configMatch && req.method === 'PUT') {
        const body = await req.json()
        return json(await putConfig(configMatch[1], body))
      }
```

### Step 7: Run tests and build

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`
Expected: All tests pass

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`
Expected: 0 errors

### Step 8: Commit

```bash
git add web/api/routes/config.js web/api/lib/config-validator.js web/api/config.test.js web/api/server.js web/api/package.json web/api/bun.lockb
git commit -m "feat: add config read/write API with write-validate-swap"
```

---

## Task 6: Config Editor — React Page (All Three Tabs)

**Files:**
- Create: `web/app/src/pages/Config.jsx` — config editor page with three tabs
- Create: `web/app/src/pages/Config.css` — config editor styles
- Create: `web/app/src/hooks/useConfig.js` — load/save config data
- Modify: `web/app/src/App.jsx` — add /config route
- Modify: `web/app/src/components/layout/Sidebar.jsx` — add Config nav link

### Step 1: Create useConfig hook

Create `web/app/src/hooks/useConfig.js`:

```js
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useConfig(name) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/config/${name}`)
      setData(result)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [name])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (newData) => {
    setSaving(true)
    setError(null)
    try {
      const result = await apiFetch(`/api/config/${name}`, {
        method: 'PUT',
        body: JSON.stringify(newData),
      })
      setData(result)
      setSaving(false)
      return result
    } catch (err) {
      setError(err.message)
      setSaving(false)
      throw err
    }
  }, [name])

  return { data, loading, error, saving, save, reload: load }
}
```

### Step 2: Create Config.jsx

Create `web/app/src/pages/Config.jsx`. This is a large file — build it incrementally. The structure is:

- `Config` — page component with tab state, renders the active tab
- `OffLimitsTab` — editable current week, read-only older weeks
- `SourcesTab` — RSS feeds by category, search queries, read-only sections
- `SectorsTab` — per-sector keyword editing

```jsx
import { useState } from 'react'
import { useConfig } from '../hooks/useConfig'
import { getISOWeek } from '../lib/week'
import './Config.css'

export default function Config() {
  const [tab, setTab] = useState('off-limits')

  return (
    <div>
      <div className="page-header">
        <h2>Config</h2>
      </div>
      <div className="config-tabs">
        {['off-limits', 'sources', 'sectors'].map(t => (
          <button
            key={t}
            className={`config-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'off-limits' ? 'Off-limits' : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'off-limits' && <OffLimitsTab />}
      {tab === 'sources' && <SourcesTab />}
      {tab === 'sectors' && <SectorsTab />}
    </div>
  )
}

function OffLimitsTab() {
  const { data, loading, error, saving, save } = useConfig('off-limits')
  const [draft, setDraft] = useState(null)
  const [newCompany, setNewCompany] = useState('')
  const [newTopic, setNewTopic] = useState('')
  const [showOlder, setShowOlder] = useState(false)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const currentWeek = `week_${getCurrentWeekNumber()}`
  const working = draft || data
  const currentEntries = working[currentWeek] || []

  // Sort weeks descending
  const weeks = Object.keys(working).filter(k => k.startsWith('week_')).sort((a, b) => {
    const na = parseInt(a.split('_')[1])
    const nb = parseInt(b.split('_')[1])
    return nb - na
  })

  const recentWeeks = weeks.filter(w => w !== currentWeek).slice(0, 2)
  const olderWeeks = weeks.filter(w => w !== currentWeek).slice(2)

  function addEntry() {
    if (!newCompany.trim() || !newTopic.trim()) return
    const updated = { ...working }
    updated[currentWeek] = [...currentEntries, { company: newCompany.trim(), topic: newTopic.trim() }]
    setDraft(updated)
    setNewCompany('')
    setNewTopic('')
  }

  function removeEntry(idx) {
    const updated = { ...working }
    updated[currentWeek] = currentEntries.filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    await save(draft)
    setDraft(null)
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>Current week ({currentWeek})</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      <table className="config-table">
        <thead>
          <tr><th>Company</th><th>Topic</th><th></th></tr>
        </thead>
        <tbody>
          {currentEntries.map((entry, i) => (
            <tr key={i}>
              <td>{entry.company}</td>
              <td>{entry.topic}</td>
              <td><button className="action-btn delete-btn" onClick={() => removeEntry(i)}>{'\u2715'}</button></td>
            </tr>
          ))}
          <tr className="add-row">
            <td><input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Company" className="config-input" /></td>
            <td><input value={newTopic} onChange={e => setNewTopic(e.target.value)} placeholder="Topic" className="config-input" /></td>
            <td><button className="btn btn-primary btn-sm" onClick={addEntry}>Add</button></td>
          </tr>
        </tbody>
      </table>

      {recentWeeks.length > 0 && (
        <div className="config-readonly">
          <h3>Recent weeks</h3>
          {recentWeeks.map(w => (
            <ReadOnlyWeek key={w} week={w} entries={working[w]} />
          ))}
        </div>
      )}

      {olderWeeks.length > 0 && (
        <div className="config-readonly">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowOlder(!showOlder)}>
            {showOlder ? 'Hide older' : `Show ${olderWeeks.length} older weeks`}
          </button>
          {showOlder && olderWeeks.map(w => (
            <ReadOnlyWeek key={w} week={w} entries={working[w]} />
          ))}
        </div>
      )}
    </div>
  )
}

function ReadOnlyWeek({ week, entries }) {
  return (
    <details className="readonly-week">
      <summary>{week} ({entries.length} entries)</summary>
      <ul>
        {entries.map((e, i) => <li key={i}><strong>{e.company}</strong>: {e.topic}</li>)}
      </ul>
    </details>
  )
}

function SourcesTab() {
  const { data, loading, error, saving, save } = useConfig('sources')
  const [draft, setDraft] = useState(null)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const working = draft || data

  function addFeed(category) {
    const name = prompt('Feed name:')
    const url = prompt('Feed URL:')
    if (!name || !url) return
    const updated = { ...working, rss_feeds: { ...working.rss_feeds } }
    updated.rss_feeds[category] = [...(updated.rss_feeds[category] || []), { name, url }]
    setDraft(updated)
  }

  function removeFeed(category, idx) {
    const updated = { ...working, rss_feeds: { ...working.rss_feeds } }
    updated.rss_feeds[category] = updated.rss_feeds[category].filter((_, i) => i !== idx)
    setDraft(updated)
  }

  function addQuery() {
    const q = prompt('Search query:')
    if (!q) return
    const updated = { ...working }
    updated.general_search_queries = [...(updated.general_search_queries || []), q]
    setDraft(updated)
  }

  function removeQuery(idx) {
    const updated = { ...working }
    updated.general_search_queries = updated.general_search_queries.filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    await save(draft)
    setDraft(null)
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>RSS Feeds</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      {Object.entries(working.rss_feeds || {}).map(([cat, feeds]) => (
        <div key={cat} className="feed-category">
          <h4>{cat.replace(/_/g, ' ')}</h4>
          <ul className="feed-list">
            {feeds.map((feed, i) => (
              <li key={i} className="feed-item">
                <span className="feed-name">{feed.name}</span>
                <span className="feed-url">{feed.url}</span>
                <button className="action-btn delete-btn" onClick={() => removeFeed(cat, i)}>{'\u2715'}</button>
              </li>
            ))}
          </ul>
          <button className="btn btn-ghost btn-sm" onClick={() => addFeed(cat)}>+ Add feed</button>
        </div>
      ))}

      <div className="feed-category">
        <h4>Search queries</h4>
        <ul className="feed-list">
          {(working.general_search_queries || []).map((q, i) => (
            <li key={i} className="feed-item">
              <span className="feed-name">{q}</span>
              <button className="action-btn delete-btn" onClick={() => removeQuery(i)}>{'\u2715'}</button>
            </li>
          ))}
        </ul>
        <button className="btn btn-ghost btn-sm" onClick={addQuery}>+ Add query</button>
      </div>

      {working.url_date_patterns && (
        <div className="feed-category readonly">
          <h4>URL date patterns (read-only)</h4>
          <pre className="config-readonly-block">{JSON.stringify(working.url_date_patterns, null, 2)}</pre>
        </div>
      )}

      {working.paywall_domains && (
        <div className="feed-category readonly">
          <h4>Paywall domains (read-only)</h4>
          <ul className="feed-list">
            {working.paywall_domains.map((d, i) => (
              <li key={i} className="feed-item"><span className="feed-name">{d}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function SectorsTab() {
  const { data, loading, error, saving, save } = useConfig('sectors')
  const [draft, setDraft] = useState(null)

  if (loading) return <div className="placeholder-text">Loading...</div>
  if (error) return <div className="placeholder-text">Failed to load: {error}</div>

  const working = draft || data

  function updateDisplayName(sectorKey, value) {
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey].display_name = value
    setDraft(updated)
  }

  function addKeyword(sectorKey, group, value) {
    if (!value.trim()) return
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey][group] = [...updated.sectors[sectorKey][group], value.trim()]
    setDraft(updated)
  }

  function removeKeyword(sectorKey, group, idx) {
    const updated = JSON.parse(JSON.stringify(working))
    updated.sectors[sectorKey][group] = updated.sectors[sectorKey][group].filter((_, i) => i !== idx)
    setDraft(updated)
  }

  async function handleSave() {
    if (!draft) return
    await save(draft)
    setDraft(null)
  }

  return (
    <div className="config-section">
      <div className="config-section-header">
        <h3>Sector Keywords</h3>
        {draft && (
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        )}
      </div>

      {Object.entries(working.sectors || {}).map(([key, sector]) => (
        <div key={key} className="sector-config">
          <div className="sector-header">
            <input
              className="sector-display-name"
              value={sector.display_name}
              onChange={e => updateDisplayName(key, e.target.value)}
            />
            <span className="sector-key">({key})</span>
          </div>

          {['required_any_group_1', 'required_any_group_2', 'boost'].map(group => (
            <KeywordGroup
              key={group}
              label={group.replace(/_/g, ' ')}
              keywords={sector[group] || []}
              onAdd={(val) => addKeyword(key, group, val)}
              onRemove={(idx) => removeKeyword(key, group, idx)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function KeywordGroup({ label, keywords, onAdd, onRemove }) {
  const [input, setInput] = useState('')

  function handleAdd() {
    if (!input.trim()) return
    onAdd(input)
    setInput('')
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleAdd()
    }
  }

  return (
    <div className="keyword-group">
      <span className="keyword-group-label">{label}</span>
      <div className="keyword-pills">
        {keywords.map((k, i) => (
          <span key={i} className="keyword-pill editable">
            {k}
            <button className="pill-remove" onClick={() => onRemove(i)}>{'\u2715'}</button>
          </span>
        ))}
        <input
          className="keyword-input"
          placeholder="Add..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleAdd}
        />
      </div>
    </div>
  )
}

function getCurrentWeekNumber() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  const diff = now - start
  const oneWeek = 604800000
  return Math.ceil((diff / oneWeek) + start.getDay() / 7)
}
```

### Step 3: Create Config.css

Create `web/app/src/pages/Config.css`:

```css
.config-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 24px;
  border-bottom: 1px solid var(--light-gray);
}

.config-tab {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--cloudy);
  padding: 10px 16px;
  cursor: pointer;
  border: none;
  background: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: all 0.15s;
}

.config-tab:hover { color: var(--text-primary); }
.config-tab.active { color: var(--terra); border-bottom-color: var(--terra); }

.config-section { max-width: 900px; }

.config-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.config-section-header h3 {
  font-family: 'Poppins', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.config-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.config-table th {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--light-gray);
}

.config-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--hover-subtle);
  font-size: 14px;
  color: var(--text-primary);
}

.config-input {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  padding: 6px 10px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text-primary);
  width: 100%;
  outline: none;
}

.config-input:focus {
  border-color: var(--terra);
  box-shadow: var(--focus-ring);
}

.add-row td { background: var(--surface); }

/* --- Read-only weeks --- */
.config-readonly { margin-top: 24px; }
.config-readonly h3 {
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--cloudy);
  margin-bottom: 8px;
}

.readonly-week {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--cloudy);
}

.readonly-week summary {
  cursor: pointer;
  font-family: 'Poppins', sans-serif;
  font-weight: 500;
}

.readonly-week ul {
  padding-left: 20px;
  margin-top: 4px;
}

.readonly-week li { margin-bottom: 2px; color: var(--text-primary); }

/* --- Feed categories --- */
.feed-category {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--light-gray);
}

.feed-category h4 {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.feed-category.readonly { opacity: 0.7; }

.feed-list { list-style: none; padding: 0; margin: 0 0 8px; }

.feed-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--hover-subtle);
  font-size: 13px;
}

.feed-name { color: var(--text-primary); font-weight: 500; }
.feed-url { color: var(--cloudy); font-size: 12px; flex: 1; overflow: hidden; text-overflow: ellipsis; }

.config-readonly-block {
  font-family: 'Fira Code', monospace;
  font-size: 12px;
  color: var(--cloudy);
  background: var(--card-bg);
  padding: 12px;
  border-radius: var(--radius);
  overflow-x: auto;
}

/* --- Sector config --- */
.sector-config {
  margin-bottom: 24px;
  padding: 16px;
  background: var(--surface);
  border-radius: var(--radius);
  border: 1px solid var(--light-gray);
}

.sector-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}

.sector-display-name {
  font-family: 'Poppins', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  background: none;
  border: none;
  border-bottom: 1px solid transparent;
  outline: none;
  padding: 2px 4px;
}

.sector-display-name:focus { border-bottom-color: var(--terra); }
.sector-key { font-size: 12px; color: var(--cloudy); }

.keyword-group {
  margin-bottom: 10px;
}

.keyword-group-label {
  display: block;
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.keyword-pill.editable {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.pill-remove {
  border: none;
  background: none;
  color: var(--cloudy);
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
  line-height: 1;
}

.pill-remove:hover { color: #e74c3c; }

.keyword-input {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  border: 1px dashed var(--light-gray);
  border-radius: 12px;
  padding: 3px 10px;
  background: none;
  color: var(--text-primary);
  width: 80px;
  outline: none;
}

.keyword-input:focus { border-color: var(--terra); }
```

### Step 4: Add Config route to App.jsx

Modify `web/app/src/App.jsx`:

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Shell from './components/layout/Shell'
import Dashboard from './pages/Dashboard'
import Articles from './pages/Articles'
import Draft from './pages/Draft'
import Copilot from './pages/Copilot'
import Config from './pages/Config'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/config" element={<Config />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
```

### Step 5: Add Config nav link to Sidebar.jsx

Modify `web/app/src/components/layout/Sidebar.jsx`:

Add to `NAV_ITEMS`:
```js
{ to: '/config', label: 'Config', icon: 'settings' },
```

Add to `ICONS`:
```js
settings: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
```

### Step 6: Run build to verify

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`
Expected: 0 errors

### Step 7: Commit

```bash
git add web/app/src/pages/Config.jsx web/app/src/pages/Config.css web/app/src/hooks/useConfig.js web/app/src/App.jsx web/app/src/components/layout/Sidebar.jsx
git commit -m "feat: add config editor page with off-limits, sources, sectors tabs"
```

---

## Checkpoint Review 3

Full verification:
- All API tests pass: `cd web/api && bun test`
- Build clean: `cd web/app && bunx vite build`
- Pipeline isolation: `bun scripts/pipeline.js --mode daily --dry-run`
- Manual smoke test: navigate to /config, check all three tabs render

---

## Task 7: UI Polish Pass

**Files:**
- Modify: various CSS files for spacing/padding audit
- Modify: `Articles.jsx` — keyboard nav if time permits
- No new files

### Step 1: Audit and fix

This is a visual/manual task. Start both servers:

```bash
bun --watch web/api/server.js &
cd web/app && bun run dev
```

Check each page:
1. **Dashboard** — spacing, chart alignment, card consistency
2. **Articles** — hover states on all buttons, action visibility, detail panel layout
3. **Draft** — no changes expected
4. **Co-pilot** — no changes expected
5. **Config** — form alignment, button spacing, read-only section distinction

Fix issues found. Common patterns:
- Ensure all `rgba()` values use tokens from `tokens.css`
- Ensure no inline styles
- Verify hover states on all interactive elements
- Check dark mode contrast

### Step 2: Run final verification

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`
Expected: All tests pass

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`
Expected: 0 errors

Run: `bun scripts/pipeline.js --mode daily --dry-run`
Expected: Pipeline succeeds (isolation confirmed)

### Step 3: Commit

```bash
git add -A web/
git commit -m "style: UI polish pass — spacing, hover states, consistency"
```

---

## Task 8: Update Context Files

**Files:**
- Modify: `.claude/context/phase-status.md` — mark Phase 4 as ✅ Complete
- Modify: `.claude/context/coding-patterns.md` — add new patterns (PATCH/DELETE, config routes, etc.)
- Modify: `CLAUDE.md` — update Phase 4 status line

### Step 1: Update phase-status.md

Update Phase 4 section from "📐 Designed" to "✅ Complete" with full record of what was built, verified, key decisions, and deferred items.

### Step 2: Update coding-patterns.md

Add new patterns:
- PATCH/DELETE article routes
- Config write-validate-swap pattern
- Ingest proxy pattern
- Config validation pattern
- `apiPatch()`, `apiDelete()`, `apiPost()` helpers
- `useConfig` hook pattern
- Real-time polling pattern

### Step 3: Update CLAUDE.md

Change Phase 4 line to `✅ Complete`.

### Step 4: Commit

```bash
git add .claude/context/phase-status.md .claude/context/coding-patterns.md CLAUDE.md
git commit -m "docs: update context files — Phase 4 complete"
```

---

## Final Verification Checklist

Before claiming Phase 4 complete:

- [ ] All API tests pass: `cd web/api && bun test`
- [ ] Vite build clean: `cd web/app && bunx vite build`
- [ ] Pipeline isolation: `bun scripts/pipeline.js --mode daily --dry-run`
- [ ] No files outside `web/` modified (except context files)
- [ ] Manual smoke test: all five pages work, actions function, config saves
- [ ] Context files updated and committed
