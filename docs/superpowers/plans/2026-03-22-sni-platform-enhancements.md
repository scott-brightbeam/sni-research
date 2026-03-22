# SNI Platform Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix broken Dashboard data display, enhance the Database page into a full editorial workspace with chat/archive/ingest, fix the Sources page, add Exponential View newsletter processing, and add authenticated subscription content fetching.

**Architecture:** Six independent streams (A–F) modifying the existing Bun API server + React SPA. All new web code in `web/`, new pipeline scripts in `scripts/`. No existing scripts modified. Data stays as local JSON files. Playwright scripts run under Node.js (not Bun).

**Tech Stack:** Bun 1.3.9, React 18 (Vite), Node.js 22.17 (Playwright only), Playwright, cheerio, `bun:test`

**Spec:** `docs/superpowers/specs/2026-03-22-sni-platform-enhancements-design.md`

---

## File Structure

### Stream A (UI Polish)
- Modify: `web/app/src/pages/Editorial.jsx` — TABS array reorder
- Modify: `web/app/src/pages/Draft.jsx` — RIGHT_TABS reorder, default tab
- Modify: `web/app/src/pages/Draft.css` — panel-content flex fix

### Stream B (Dashboard Data Fix)
- Modify: `web/api/routes/status.js` — fix getPodcastImport() (3 bugs)
- Modify: `web/api/routes/editorial.js` — add counts to no-section response
- Modify: `web/app/src/pages/Dashboard.jsx` — fix EditorialSummaryCard destructuring
- Test: `web/api/tests/status.test.js` (new)

### Stream C (Database Enhancements)
- Create: `web/app/src/components/ManualIngestForm.jsx` — combobox ingest form
- Modify: `web/app/src/pages/Database.jsx` — chat sidebar, archive, search, draft-in-chat
- Modify: `web/app/src/pages/Database.css` — column layout, archive styles
- Modify: `web/api/routes/articles.js` — publications endpoint, manual ingest, archive
- Modify: `web/api/routes/podcasts.js` — archive PATCH endpoint
- Modify: `web/api/server.js` — wire new routes
- Modify: `web/api/lib/editorial-chat.js` — articles/podcasts/flagged context
- Modify: `web/app/src/components/EditorialChat.jsx` — Database tab labels/suggestions
- Test: `web/api/tests/articles.test.js` (new)
- Test: `web/api/tests/editorial-chat.test.js` (extend existing)

### Stream D (Sources Fix)
- Modify: `web/api/routes/sources.js` — graceful error handling
- Modify: `web/app/src/pages/Sources.jsx` — empty state handling

### Stream E (EV Newsletter Processing)
- Create: `scripts/lib/ev-parser.js` — link extraction, URL filtering
- Create: `scripts/ev-link-extract.js` — standalone extraction pipeline
- Create: `config/ev-extraction.yaml` — EV config (source name, exclusions)
- Create: `com.sni.ev-extract.plist` — launchd job
- Create: `web/api/routes/ev-recommendations.js` — API endpoints
- Modify: `web/api/server.js` — wire EV routes
- Modify: `web/app/src/pages/Dashboard.jsx` — EV recommendations card
- Test: `scripts/tests/ev-parser.test.js` (new)
- Test: `web/api/tests/ev-recommendations.test.js` (new)

### Stream F (Subscription Downloads)
- Create: `scripts/lib/credential-store.js` — AES-256-GCM encrypt/decrypt
- Create: `scripts/lib/adapters/ft.js` — FT adapter
- Create: `scripts/lib/adapters/substack.js` — generic Substack adapter
- Create: `scripts/subscription-fetch.js` — orchestrator script
- Create: `config/subscriptions.yaml` — source config
- Create: `web/api/routes/subscriptions.js` — credential + trigger endpoints
- Modify: `web/api/server.js` — wire subscription routes
- Modify: `web/app/src/pages/Config.jsx` — credential management UI
- Create: `com.sni.subscription-ft.plist` — FT launchd job
- Create: `com.sni.subscription-substack.plist` — Substack launchd job
- Test: `scripts/tests/credential-store.test.js` (new)
- Test: `web/api/tests/subscriptions.test.js` (new)

---

## Stream A: UI Polish

### Task 1: Reorder Editorial tabs and Draft sub-tabs

**Files:**
- Modify: `web/app/src/pages/Editorial.jsx:41-47`
- Modify: `web/app/src/pages/Draft.jsx:17-22,35`
- Modify: `web/app/src/pages/Draft.css:262-266`

- [ ] **Step 1: Reorder TABS in Editorial.jsx**

In `web/app/src/pages/Editorial.jsx`, change the TABS array (lines 41–47) from:

```javascript
const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity', label: 'Activity' },
  { key: 'newsletter', label: 'Newsletter' },
]
```

to:

```javascript
const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity', label: 'Activity' },
]
```

- [ ] **Step 2: Reorder RIGHT_TABS and change default in Draft.jsx**

In `web/app/src/pages/Draft.jsx`, change RIGHT_TABS (lines 17–22) from:

```javascript
const RIGHT_TABS = [
  { key: 'critique', label: 'AI Critique' },
  { key: 'preview', label: 'Preview' },
  { key: 'review', label: 'Review' },
  { key: 'links', label: 'Links' },
  { key: 'chat', label: 'Chat' },
]
```

to:

```javascript
const RIGHT_TABS = [
  { key: 'preview', label: 'Preview' },
  { key: 'critique', label: 'AI Critique' },
  { key: 'review', label: 'Review' },
  { key: 'links', label: 'Links' },
  { key: 'chat', label: 'Chat' },
]
```

Change line 35 from `useState('critique')` to `useState('preview')`.

- [ ] **Step 3: Fix AI Critique panel height in Draft.css**

In `web/app/src/pages/Draft.css`, update `.panel-content` (line 262) to:

```css
.panel-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
```

Add after it:

```css
.panel-content .placeholder-text {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 4: Visual verification**

Run: `cd web/app && bun run dev`

Check:
1. Editorial page: tabs show Analysis, Themes, Backlog, **Newsletter**, Decisions, Activity
2. Newsletter tab → Draft panel: sub-tabs show **Preview** first, AI Critique second
3. Preview is the default selected sub-tab
4. AI Critique panel fills the full right column height when content is short

- [ ] **Step 5: Build check and commit**

Run: `cd web/app && bun run build`
Expected: 0 errors

```bash
git add web/app/src/pages/Editorial.jsx web/app/src/pages/Draft.jsx web/app/src/pages/Draft.css
git commit -m "feat(ui): reorder tabs and fix AI Critique layout

Move Newsletter tab after Backlog, Preview sub-tab first.
Fix panel-content to fill available height with flex."
```

---

## Stream B: Dashboard Data Fix

### Task 2: Fix Podcast Import card (3 bugs in getPodcastImport)

**Files:**
- Modify: `web/api/routes/status.js:203-236`
- Test: `web/api/tests/status.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `web/api/tests/status.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

describe('getPodcastImport', () => {
  const manifestDir = join(ROOT, 'data/podcasts')
  const runsDir = join(ROOT, 'output/runs')
  const manifestPath = join(manifestDir, 'manifest.json')
  const bakPath = join(manifestDir, 'manifest.json.bak')

  // Save originals
  let origManifest = null
  let origBak = null

  beforeEach(() => {
    if (existsSync(manifestPath)) origManifest = Bun.file(manifestPath).text()
    if (existsSync(bakPath)) origBak = Bun.file(bakPath).text()
  })

  afterEach(async () => {
    // Restore originals
    if (origManifest !== null) writeFileSync(manifestPath, await origManifest)
    else if (existsSync(manifestPath)) rmSync(manifestPath)
    if (origBak !== null) writeFileSync(bakPath, await origBak)
  })

  it('reads from manifest.json.bak when manifest.json missing', async () => {
    // Remove manifest.json if it exists, write .bak with known data
    if (existsSync(manifestPath)) rmSync(manifestPath)

    const testManifest = {
      'test-ep.md': {
        date: new Date().toISOString().split('T')[0],
        source: 'Test Source',
        week: getISOWeek(new Date()),
        year: new Date().getFullYear(),
      }
    }
    writeFileSync(bakPath, JSON.stringify(testManifest))

    // Write a run summary so getPodcastImport doesn't return null
    const runFile = join(runsDir, `podcast-import-${new Date().toISOString().split('T')[0]}-test.json`)
    mkdirSync(runsDir, { recursive: true })
    writeFileSync(runFile, JSON.stringify({ completedAt: new Date().toISOString(), warnings: [] }))

    // Dynamic import to get fresh module
    const { default: handler } = await import('../routes/status.js')
    // We test via the API response shape
    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    expect(data.podcastImport).toBeDefined()
    expect(data.podcastImport.episodesThisWeek).toBeGreaterThanOrEqual(1)

    // Cleanup test run file
    if (existsSync(runFile)) rmSync(runFile)
  })

  it('extracts episodes from dict manifest with Object.values', async () => {
    const today = new Date().toISOString().split('T')[0]
    const testManifest = {
      'episode-a.md': { date: today, source: 'A', week: getISOWeek(new Date()), year: new Date().getFullYear() },
      'episode-b.md': { date: today, source: 'B', week: getISOWeek(new Date()), year: new Date().getFullYear() },
    }
    writeFileSync(manifestPath, JSON.stringify(testManifest))

    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    expect(data.podcastImport.episodesThisWeek).toBe(2)
  })

  it('filters by ep.date field (not ep.date_published)', async () => {
    const today = new Date().toISOString().split('T')[0]
    const testManifest = {
      'has-date.md': { date: today, source: 'A', week: getISOWeek(new Date()), year: new Date().getFullYear() },
      'has-date-published.md': { date_published: today, source: 'B', week: getISOWeek(new Date()), year: new Date().getFullYear() },
    }
    writeFileSync(manifestPath, JSON.stringify(testManifest))

    const resp = await fetch('http://localhost:3900/api/status')
    const data = await resp.json()

    // Both should count — ep.date and ep.date_published both accepted
    expect(data.podcastImport.episodesThisWeek).toBe(2)
  })
})

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web/api && bun test tests/status.test.js`
Expected: Tests fail (manifest.json missing → 0 episodes; dict not handled; date_published not checked)

**Note:** Tests require the API server running at port 3900. Start it first: `bun --watch web/api/server.js`

- [ ] **Step 3: Fix getPodcastImport in status.js**

In `web/api/routes/status.js`, replace lines 218–236 (the manifest reading section):

```javascript
    // Count episodes for current week from manifest
    let episodesThisWeek = 0
    const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
    const manifestBakPath = join(ROOT, 'data/podcasts/manifest.json.bak')

    // Try manifest.json, then .bak fallback
    let manifestFile = null
    if (existsSync(manifestPath)) manifestFile = manifestPath
    else if (existsSync(manifestBakPath)) manifestFile = manifestBakPath

    if (manifestFile) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'))
        const now = new Date()
        const currentWeek = getISOWeek(now)
        const currentYear = now.getFullYear()

        // Manifest is a dict keyed by filename — extract values
        const episodes = Array.isArray(manifest) ? manifest : Object.values(manifest)
        episodesThisWeek = episodes.filter(ep => {
          const dateStr = ep.date || ep.date_published
          if (!dateStr) return false
          const d = new Date(dateStr + 'T12:00:00Z')
          return getISOWeek(d) === currentWeek && d.getFullYear() === currentYear
        }).length
      } catch { /* ignore manifest parse errors */ }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web/api && bun test tests/status.test.js`
Expected: All 3 tests pass

- [ ] **Step 5: Run full test suite**

Run: `cd web/api && bun test`
Expected: All tests pass (68+ tests)

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/status.js web/api/tests/status.test.js
git commit -m "fix(dashboard): podcast import card reads manifest correctly

Fix 3 bugs: .bak fallback when manifest.json missing, Object.values()
for dict manifest, accept both ep.date and ep.date_published."
```

### Task 3: Fix Editorial Intelligence card (counter data shape)

**Files:**
- Modify: `web/api/routes/editorial.js:119-128`
- Modify: `web/app/src/pages/Dashboard.jsx:277-280`
- Test: `web/api/tests/editorial.test.js` (extend)

- [ ] **Step 1: Write failing test for computed counts**

Add to `web/api/tests/editorial.test.js`, in the `GET /api/editorial/state` describe block:

```javascript
  it('returns computed counts in no-section response', async () => {
    const result = await getEditorialState({})
    expect(result.entryCount).toBe(Object.keys(testState.analysisIndex).length)
    expect(result.themeCount).toBe(Object.keys(testState.themeRegistry).length)
    expect(result.postCount).toBe(Object.keys(testState.postBacklog).length)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/api && bun test tests/editorial.test.js -t "returns computed counts"`
Expected: FAIL — `result.entryCount` is `undefined`

- [ ] **Step 3: Add computed counts to editorial.js**

In `web/api/routes/editorial.js`, replace the no-section return (lines 123–128):

```javascript
  if (!section) {
    return {
      counters: state.counters,
      corpusStats: state.corpusStats,
      rotationCandidates: state.rotationCandidates || [],
      entryCount: Object.keys(state.analysisIndex || {}).length,
      themeCount: Object.keys(state.themeRegistry || {}).length,
      postCount: Object.keys(state.postBacklog || {}).length,
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web/api && bun test tests/editorial.test.js -t "returns computed counts"`
Expected: PASS

- [ ] **Step 5: Fix Dashboard component destructuring**

In `web/app/src/pages/Dashboard.jsx`, replace lines 277–280:

```javascript
  const entryCount = data.entryCount || 0
  const themeCount = data.themeCount || 0
  const postCount = data.postCount || 0
  const session = data.counters?.nextSession ? data.counters.nextSession - 1 : null
```

- [ ] **Step 6: Full test suite + build**

Run: `cd web/api && bun test`
Expected: All pass

Run: `cd web/app && bun run build`
Expected: 0 errors

- [ ] **Step 7: Commit**

```bash
git add web/api/routes/editorial.js web/app/src/pages/Dashboard.jsx web/api/tests/editorial.test.js
git commit -m "fix(dashboard): editorial intelligence card shows real counts

Add computed entryCount/themeCount/postCount to no-section API response.
Fix Dashboard to read these instead of trying to measure array lengths."
```

---

## Stream C: Database Enhancements

### Task 4: Publications endpoint + Manual ingest API

**Files:**
- Modify: `web/api/routes/articles.js`
- Modify: `web/api/server.js`
- Create: `web/api/tests/articles.test.js`

- [ ] **Step 1: Write failing tests for publications and manual ingest**

Create `web/api/tests/articles.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

describe('GET /api/articles/publications', () => {
  it('returns sorted unique source values', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/publications')
    const data = await resp.json()
    expect(Array.isArray(data.publications)).toBe(true)
    // Should be sorted
    const sorted = [...data.publications].sort((a, b) => a.localeCompare(b))
    expect(data.publications).toEqual(sorted)
    // Should have no duplicates
    expect(new Set(data.publications).size).toBe(data.publications.length)
  })
})

describe('POST /api/articles/manual', () => {
  const testDate = '2026-03-22'
  const testSector = 'general'
  let createdPath = null

  afterEach(() => {
    // Clean up created test article
    if (createdPath && existsSync(createdPath)) rmSync(createdPath)
  })

  it('rejects missing title', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Some content' }),
    })
    expect(resp.status).toBe(400)
  })

  it('rejects missing content', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Some title' }),
    })
    expect(resp.status).toBe(400)
  })

  it('creates article JSON with correct schema', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Manual Article',
        content: 'This is test content for the manual ingest.',
        source: 'Test Publication',
        sector: testSector,
        url: 'https://example.com/test',
        date_published: testDate,
      }),
    })

    expect(resp.status).toBe(200)
    const data = await resp.json()
    expect(data.article).toBeDefined()
    expect(data.article.title).toBe('Test Manual Article')
    expect(data.article.source).toBe('Test Publication')
    expect(data.article.source_type).toBe('manual')
    expect(data.article.found_by).toEqual(['manual-ingest'])
    expect(data.article.sector).toBe(testSector)
    expect(data.article.snippet).toBe('This is test content for the manual ingest.')
    expect(data.path).toContain(`data/verified/${testDate}/${testSector}/`)

    createdPath = join(ROOT, data.path)
    expect(existsSync(createdPath)).toBe(true)

    // Verify file content
    const saved = JSON.parse(readFileSync(createdPath, 'utf-8'))
    expect(saved.title).toBe('Test Manual Article')
    expect(saved.date_confidence).toBe('high')
    expect(saved.keywords_matched).toEqual([])
  })

  it('generates slug from title', async () => {
    const resp = await fetch('http://localhost:3900/api/articles/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'AI & The Future: A Test!',
        content: 'Content here.',
      }),
    })
    const data = await resp.json()
    expect(data.path).toContain('ai-the-future-a-test')
    createdPath = join(ROOT, data.path)
  })
})

describe('PATCH /api/articles - archive', () => {
  const testDate = '2026-03-22'
  const testSector = 'general'
  const testSlug = 'test-archive-article'
  const testDir = join(ROOT, 'data/verified', testDate, testSector)
  const testPath = join(testDir, `${testSlug}.json`)

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(testPath, JSON.stringify({
      title: 'Test Archive Article',
      source: 'test',
      sector: testSector,
      date_published: testDate,
    }))
  })

  afterEach(() => {
    if (existsSync(testPath)) rmSync(testPath)
  })

  it('sets archived flag on article', async () => {
    const resp = await fetch(`http://localhost:3900/api/articles/${testDate}/${testSector}/${testSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(testPath, 'utf-8'))
    expect(saved.archived).toBe(true)
  })

  it('removes archived flag on restore', async () => {
    // First archive
    writeFileSync(testPath, JSON.stringify({
      title: 'Test', source: 'test', sector: testSector,
      date_published: testDate, archived: true,
    }))

    const resp = await fetch(`http://localhost:3900/api/articles/${testDate}/${testSector}/${testSlug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(testPath, 'utf-8'))
    expect(saved.archived).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web/api && bun test tests/articles.test.js`
Expected: All fail (endpoints don't exist yet)

- [ ] **Step 3: Implement publications endpoint in articles.js**

Add to `web/api/routes/articles.js` after the existing exports:

```javascript
export async function getPublications() {
  const sources = new Set()
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { publications: [] }

  for (const dateDir of readdirSync(verifiedDir)) {
    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sectorDir of readdirSync(datePath)) {
      const sectorPath = join(datePath, sectorDir)
      if (!statSync(sectorPath).isDirectory()) continue
      for (const file of readdirSync(sectorPath)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          if (raw.source) sources.add(raw.source)
        } catch { /* skip malformed */ }
      }
    }
  }

  return { publications: [...sources].sort((a, b) => a.localeCompare(b)) }
}
```

- [ ] **Step 4: Implement manual ingest endpoint in articles.js**

Add to `web/api/routes/articles.js`:

```javascript
export async function manualIngest(body) {
  const { title, content, source, sector, url, date_published } = body || {}

  if (!title || !title.trim()) {
    const err = new Error('Title is required')
    err.status = 400
    throw err
  }
  if (!content || !content.trim()) {
    const err = new Error('Content is required')
    err.status = 400
    throw err
  }

  const dateStr = date_published || new Date().toISOString().split('T')[0]
  const sectorStr = (sector || 'general').toLowerCase()
  validateParam(sectorStr, 'sector')

  // Generate slug: lowercase, replace non-alphanum with hyphens, max 80 chars
  const slug = title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)

  const article = {
    title: title.trim(),
    url: url || null,
    source: source || null,
    source_type: 'manual',
    date_published: dateStr,
    date_confidence: 'high',
    date_verified_method: 'manual',
    sector: sectorStr,
    keywords_matched: [],
    snippet: content.trim().slice(0, 500),
    full_text: content.trim(),
    found_by: ['manual-ingest'],
    scraped_at: null,
    ingested_at: new Date().toISOString(),
    score: null,
    score_reason: null,
  }

  const destDir = join(ROOT, 'data/verified', dateStr, sectorStr)
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, `${slug}.json`)
  writeFileSync(destPath, JSON.stringify(article, null, 2))

  const relPath = `data/verified/${dateStr}/${sectorStr}/${slug}.json`
  return { article, path: relPath }
}
```

- [ ] **Step 5: Extend patchArticle for archived field**

In `web/api/routes/articles.js`, add after the sector move block in `patchArticle()` (after line ~149):

```javascript
  // Handle archive toggle
  if (body.archived === true) {
    raw.archived = true
    writeFileSync(filePath, JSON.stringify(raw, null, 2))
    result.article.archived = true
  } else if (body.archived === false) {
    delete raw.archived
    writeFileSync(filePath, JSON.stringify(raw, null, 2))
    delete result.article.archived
  }
```

- [ ] **Step 6: Wire routes in server.js**

In `web/api/server.js`, add the import at the top (alongside existing articles import):

```javascript
import { getArticles, getArticle, getFlaggedArticles, patchArticle, deleteArticle, ingestArticle, getLastUpdated, getPublications, manualIngest } from './routes/articles.js'
```

Add routes BEFORE the parameterised article regex (before line 65):

```javascript
      if (path === '/api/articles/publications' && req.method === 'GET') {
        return json(await getPublications())
      }

      if (path === '/api/articles/manual' && req.method === 'POST') {
        const body = await req.json()
        return json(await manualIngest(body))
      }
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd web/api && bun test tests/articles.test.js`
Expected: All tests pass

Run: `cd web/api && bun test`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add web/api/routes/articles.js web/api/server.js web/api/tests/articles.test.js
git commit -m "feat(api): publications endpoint, manual ingest, article archive

GET /api/articles/publications returns sorted unique sources.
POST /api/articles/manual saves article JSON directly to data/verified.
PATCH now accepts archived:true/false to toggle archive status."
```

### Task 5: ManualIngestForm component

**Files:**
- Create: `web/app/src/components/ManualIngestForm.jsx`
- Modify: `web/app/src/pages/Database.jsx:34-49`

- [ ] **Step 1: Create ManualIngestForm.jsx**

Create `web/app/src/components/ManualIngestForm.jsx`:

```jsx
import { useState, useEffect, useRef } from 'react'
import { apiFetch, apiPost } from '../lib/api'
import './ManualIngestForm.css'

const SECTORS = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function ManualIngestForm({ onSuccess }) {
  const [url, setUrl] = useState('')
  const [source, setSource] = useState('')
  const [sector, setSector] = useState('general')
  const [datePublished, setDatePublished] = useState(new Date().toISOString().split('T')[0])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [allPublications, setAllPublications] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const sourceRef = useRef(null)

  // Load publications list on mount
  useEffect(() => {
    apiFetch('/api/articles/publications')
      .then(data => setAllPublications(data.publications || []))
      .catch(() => {})
  }, [])

  // Filter suggestions as user types
  useEffect(() => {
    if (!source.trim()) {
      setSuggestions([])
      return
    }
    const q = source.toLowerCase()
    const matches = allPublications.filter(p =>
      p.toLowerCase().includes(q)
    ).slice(0, 8)
    setSuggestions(matches)
  }, [source, allPublications])

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      await apiPost('/api/articles/manual', {
        title, content, source, sector, url, date_published: datePublished,
      })
      setSuccess(true)
      setTitle('')
      setContent('')
      setUrl('')
      setSource('')
      setSector('general')
      if (onSuccess) onSuccess()
    } catch (err) {
      setError(err.message)
    }
    setSaving(false)
  }

  function selectSuggestion(pub) {
    setSource(pub)
    setShowSuggestions(false)
  }

  return (
    <form className="manual-ingest-form card" onSubmit={handleSubmit}>
      <div className="ingest-header">
        <h4>Manual Ingest</h4>
        <span className="ingest-hint">Saves directly — no ingest server needed</span>
      </div>

      <div className="ingest-row ingest-row-top">
        <div className="ingest-field">
          <label>URL <span className="optional">(optional)</span></label>
          <input type="text" value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://example.com/article" />
        </div>
        <div className="ingest-field ingest-field-pub" ref={sourceRef}>
          <label>Publication</label>
          <input type="text" value={source}
            onChange={e => { setSource(e.target.value); setShowSuggestions(true) }}
            onFocus={() => source && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="e.g. Financial Times" />
          {showSuggestions && suggestions.length > 0 && (
            <ul className="pub-suggestions">
              {suggestions.map(s => (
                <li key={s} onMouseDown={() => selectSuggestion(s)}
                  className={s.toLowerCase() === source.toLowerCase() ? 'highlighted' : ''}>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ingest-field">
          <label>Sector</label>
          <select value={sector} onChange={e => setSector(e.target.value)}>
            {SECTORS.map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="ingest-field">
          <label>Date published</label>
          <input type="date" value={datePublished} onChange={e => setDatePublished(e.target.value)} />
        </div>
      </div>

      <div className="ingest-field">
        <label>Title <span className="required">*</span></label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)}
          placeholder="Article title" required />
      </div>

      <div className="ingest-field">
        <label>Content <span className="required">*</span></label>
        <textarea value={content} onChange={e => setContent(e.target.value)}
          placeholder="Paste the full article text here..."
          rows={6} required />
      </div>

      <div className="ingest-footer">
        <button type="submit" className="btn btn-primary btn-md" disabled={saving}>
          {saving ? 'Saving...' : 'Save Article'}
        </button>
        {error && <span className="ingest-error">{error}</span>}
        {success && <span className="ingest-success">Article saved</span>}
      </div>
    </form>
  )
}
```

- [ ] **Step 2: Create ManualIngestForm.css**

Create `web/app/src/components/ManualIngestForm.css`:

```css
.manual-ingest-form {
  padding: var(--sp-4);
  margin-bottom: var(--sp-4);
}

.ingest-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
}

.ingest-header h4 {
  margin: 0;
  color: var(--terra);
}

.ingest-hint {
  font-size: var(--font-sm);
  color: var(--medium-gray);
}

.ingest-row-top {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: var(--sp-3);
  margin-bottom: var(--sp-3);
}

.ingest-field {
  margin-bottom: var(--sp-3);
  position: relative;
}

.ingest-field label {
  display: block;
  font-size: var(--font-sm);
  color: var(--medium-gray);
  margin-bottom: var(--sp-1);
}

.ingest-field .optional {
  color: var(--dark-gray);
}

.ingest-field .required {
  color: var(--terra);
}

.ingest-field input,
.ingest-field select,
.ingest-field textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-primary);
  padding: var(--sp-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-base);
  font-family: var(--font-body);
}

.ingest-field input:focus,
.ingest-field select:focus,
.ingest-field textarea:focus {
  border-color: var(--terra);
  outline: none;
}

.ingest-field textarea {
  resize: vertical;
  min-height: 120px;
  line-height: 1.5;
}

.pub-suggestions {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg);
  border: 1px solid var(--terra);
  border-top: none;
  border-radius: 0 0 var(--radius-sm) var(--radius-sm);
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 150px;
  overflow-y: auto;
  z-index: 10;
}

.pub-suggestions li {
  padding: var(--sp-2);
  cursor: pointer;
  font-size: var(--font-sm);
}

.pub-suggestions li:hover,
.pub-suggestions li.highlighted {
  background: var(--terra-faint, rgba(196, 168, 130, 0.1));
  color: var(--terra);
}

.ingest-footer {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.ingest-error {
  color: var(--rust);
  font-size: var(--font-sm);
}

.ingest-success {
  color: var(--sage);
  font-size: var(--font-sm);
}
```

- [ ] **Step 3: Wire ManualIngestForm into Database.jsx**

In `web/app/src/pages/Database.jsx`:

Replace the import of DraftLink (line 8) — keep it for now (removed in Task 9).

Add import:
```javascript
import ManualIngestForm from '../components/ManualIngestForm'
```

Replace the ingest button section (lines 40–49). Change:
```jsx
        <button
          className="btn btn-primary btn-md"
          disabled={!ingestOnline}
          onClick={() => setShowIngest(!showIngest)}
        >
          {ingestOnline ? '+ Ingest URL' : '+ Ingest (offline)'}
        </button>
      </div>

      {showIngest && <IngestForm onSuccess={() => { setShowIngest(false); allResult.reload() }} />}
```

to:
```jsx
        <button
          className="btn btn-primary btn-md"
          onClick={() => setShowIngest(!showIngest)}
        >
          {showIngest ? '− Close' : '+ Ingest'}
        </button>
      </div>

      {showIngest && <ManualIngestForm onSuccess={() => { setShowIngest(false); allResult.reload() }} />}
```

Remove the `ingestOnline` variable (line 34) and the `useStatus` import/call if no longer used elsewhere. Check — the status hook at line 32 may still be needed; if not, remove the import.

- [ ] **Step 4: Build check**

Run: `cd web/app && bun run build`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add web/app/src/components/ManualIngestForm.jsx web/app/src/components/ManualIngestForm.css web/app/src/pages/Database.jsx
git commit -m "feat(database): manual ingest form with publication combobox

Replace URL-only IngestForm with ManualIngestForm supporting title,
content paste, publication autocomplete, sector dropdown, date field."
```

### Task 6: Database chat sidebar + context assembly

**Files:**
- Modify: `web/app/src/pages/Database.jsx`
- Modify: `web/app/src/pages/Database.css`
- Modify: `web/api/lib/editorial-chat.js`
- Modify: `web/app/src/components/EditorialChat.jsx`

- [ ] **Step 1: Add Database tab context cases to editorial-chat.js**

In `web/api/lib/editorial-chat.js`, add three new cases in the `switch (tab)` block (after the `newsletter` case, before the `default`):

```javascript
    case 'articles': {
      // Recent articles from data/verified (last 7 days)
      const verifiedDir = join(ROOT, 'data/verified')
      if (existsSync(verifiedDir)) {
        const now = new Date()
        const cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - 7)
        const cutoffStr = cutoff.toISOString().split('T')[0]

        const articles = []
        for (const dateDir of readdirSync(verifiedDir).sort().reverse()) {
          if (dateDir < cutoffStr) break
          const datePath = join(verifiedDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sectorDir of readdirSync(datePath)) {
            const sectorPath = join(datePath, sectorDir)
            if (!statSync(sectorPath).isDirectory()) continue
            for (const file of readdirSync(sectorPath)) {
              if (!file.endsWith('.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
                if (raw.archived) continue
                articles.push({ title: raw.title, source: raw.source, sector: raw.sector || sectorDir, date: raw.date_published || dateDir })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Article Corpus (last 7 days, ${articles.length} articles)\n`)
        for (const a of articles) {
          const line = `- **${a.title}** (${a.source || 'unknown'}, ${a.sector}, ${a.date})`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }

        // Stats
        const bySector = {}
        for (const a of articles) {
          bySector[a.sector] = (bySector[a.sector] || 0) + 1
        }
        sections.push(`\n**Stats:** ${articles.length} total — ${Object.entries(bySector).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
      }
      break
    }

    case 'podcasts': {
      // Podcast digests from this week
      const podcastDir = join(ROOT, 'data/podcasts')
      if (existsSync(podcastDir)) {
        const digests = []
        for (const dateDir of readdirSync(podcastDir).sort().reverse().slice(0, 14)) {
          const datePath = join(podcastDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sourceDir of readdirSync(datePath)) {
            const sourcePath = join(datePath, sourceDir)
            if (!statSync(sourcePath).isDirectory()) continue
            for (const file of readdirSync(sourcePath)) {
              if (!file.endsWith('.digest.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
                if (raw.archived) continue
                digests.push({
                  title: raw.title || file, source: raw.source || sourceDir,
                  date: raw.date || dateDir, summary: raw.summary || '',
                  stories: (raw.key_stories || raw.stories || []).map(s => typeof s === 'string' ? s : s.headline || s.title || '').filter(Boolean),
                })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Podcast Digests (${digests.length} episodes)\n`)
        for (const d of digests) {
          const stories = d.stories.length > 0 ? `\n  Stories: ${d.stories.join('; ')}` : ''
          const line = `### ${d.title} (${d.source}, ${d.date})\n${d.summary.slice(0, 300)}${stories}\n`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }
      }
      break
    }

    case 'flagged': {
      // Flagged articles from data/review
      const reviewDir = join(ROOT, 'data/review')
      if (existsSync(reviewDir)) {
        const articles = []
        for (const dateDir of readdirSync(reviewDir).sort().reverse()) {
          const datePath = join(reviewDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sectorDir of readdirSync(datePath)) {
            const sectorPath = join(datePath, sectorDir)
            if (!statSync(sectorPath).isDirectory()) continue
            for (const file of readdirSync(sectorPath)) {
              if (!file.endsWith('.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
                articles.push({ title: raw.title, source: raw.source, sector: raw.sector || sectorDir, date: raw.date_published || dateDir, snippet: (raw.snippet || '').slice(0, 200) })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Flagged Articles (${articles.length})\n`)
        for (const a of articles) {
          const line = `- **${a.title}** (${a.source || 'unknown'}, ${a.sector}, ${a.date})\n  ${a.snippet}`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }
      }
      break
    }
```

Add `readdirSync` to the existing `fs` import at the top of editorial-chat.js. The file already imports `{ readFileSync, existsSync, statSync }` — extend it to include `readdirSync`:
```javascript
import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
```

- [ ] **Step 2: Add Database tab labels and suggestions to EditorialChat.jsx**

In `web/app/src/components/EditorialChat.jsx`, extend TAB_LABELS:

```javascript
const TAB_LABELS = {
  state: 'Analysis',
  themes: 'Themes',
  backlog: 'Backlog',
  decisions: 'Decisions',
  activity: 'Activity',
  newsletter: 'Newsletter',
  articles: 'Articles',
  podcasts: 'Podcasts',
  flagged: 'Flagged',
}
```

Add to SUGGESTIONS:

```javascript
  articles: [
    'What are the key themes across this week\'s articles?',
    'Which sectors have the most coverage?',
  ],
  podcasts: [
    'Summarise the main stories from this week\'s podcasts.',
    'Which podcast episodes cover similar topics?',
  ],
  flagged: [
    'Why were these articles flagged?',
    'Which flagged articles are most relevant to current themes?',
  ],
```

- [ ] **Step 3: Add chat sidebar layout to Database.jsx**

In `web/app/src/pages/Database.jsx`, add import:
```javascript
import EditorialChat from '../components/EditorialChat'
```

Add state for draft request:
```javascript
  const [draftRequest, setDraftRequest] = useState(null)
```

Wrap the main content in a two-column layout. Replace the outer `<div>` return with:

```jsx
  return (
    <div className="database-columns">
      <div className="database-content">
        {/* existing page-header, showIngest, tabs, tab content — all unchanged */}
      </div>
      <EditorialChat
        tab={tab}
        draftRequest={draftRequest}
        onDraftConsumed={() => setDraftRequest(null)}
      />
    </div>
  )
```

- [ ] **Step 4: Add column layout styles to Database.css**

Add to `web/app/src/pages/Database.css`:

```css
.database-columns {
  display: flex;
  gap: var(--sp-4);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.database-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

- [ ] **Step 5: Build check + visual verification**

Run: `cd web/app && bun run build`
Expected: 0 errors

Verify: Database page shows two-column layout with chat on right. Chat responds in context of the active tab.

- [ ] **Step 6: Commit**

```bash
git add web/api/lib/editorial-chat.js web/app/src/components/EditorialChat.jsx web/app/src/pages/Database.jsx web/app/src/pages/Database.css
git commit -m "feat(database): chat sidebar with articles/podcasts/flagged context

Add 380px chat panel to Database page. Context assembly reads recent
articles, podcast digests, and flagged items per active tab."
```

### Task 7: Podcast archive PATCH + keyword search

**Files:**
- Modify: `web/api/routes/podcasts.js`
- Modify: `web/api/server.js`
- Modify: `web/app/src/pages/Database.jsx`
- Test: `web/api/tests/podcasts.test.js` (extend)

- [ ] **Step 1: Write failing test for podcast archive**

Add to `web/api/tests/podcasts.test.js`:

```javascript
describe('PATCH /api/podcasts - archive', () => {
  const TEST_DATE = '2026-01-15'
  const TEST_SOURCE = 'test-archive-pod'
  const TEST_SLUG = 'test-episode'
  const digestDir = join(ROOT, 'data/podcasts', TEST_DATE, TEST_SOURCE)
  const digestPath = join(digestDir, `${TEST_SLUG}.digest.json`)

  beforeEach(() => {
    mkdirSync(digestDir, { recursive: true })
    writeFileSync(digestPath, JSON.stringify({
      title: 'Test Episode', source: 'Test', date: TEST_DATE, summary: 'Test summary',
    }))
  })

  afterEach(() => {
    if (existsSync(digestPath)) rmSync(digestPath)
    try { rmSync(digestDir, { recursive: true }) } catch {}
    try { rmSync(join(ROOT, 'data/podcasts', TEST_DATE), { recursive: true }) } catch {}
  })

  it('sets archived flag on digest', async () => {
    const resp = await fetch(`http://localhost:3900/api/podcasts/${TEST_DATE}/${TEST_SOURCE}/${TEST_SLUG}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(digestPath, 'utf-8'))
    expect(saved.archived).toBe(true)
  })

  it('removes archived flag on restore', async () => {
    writeFileSync(digestPath, JSON.stringify({
      title: 'Test', source: 'Test', date: TEST_DATE, archived: true,
    }))

    const resp = await fetch(`http://localhost:3900/api/podcasts/${TEST_DATE}/${TEST_SOURCE}/${TEST_SLUG}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: false }),
    })
    expect(resp.status).toBe(200)

    const saved = JSON.parse(readFileSync(digestPath, 'utf-8'))
    expect(saved.archived).toBeUndefined()
  })
})
```

- [ ] **Step 2: Implement podcast PATCH handler**

Add to `web/api/routes/podcasts.js`:

```javascript
export async function handlePatchPodcast(date, source, slug, body) {
  validateParam(date, 'date')
  validateParam(source, 'source')

  const digestPath = join(ROOT, 'data/podcasts', date, source, `${slug}.digest.json`)
  if (!existsSync(digestPath)) {
    const err = new Error('Podcast digest not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(digestPath, 'utf-8'))

  if (body.archived === true) {
    raw.archived = true
  } else if (body.archived === false) {
    delete raw.archived
  }

  writeFileSync(digestPath, JSON.stringify(raw, null, 2))
  return { digest: raw }
}
```

Add imports at top if missing: `readFileSync, writeFileSync` from `'fs'`.
Add `validateParam` import from `'../lib/walk.js'`.

- [ ] **Step 3: Wire podcast PATCH in server.js**

Add import:
```javascript
import { handleGetPodcasts, handleGetTranscript, handlePatchPodcast } from './routes/podcasts.js'
```

Add route (near existing podcast routes):
```javascript
      const podcastMatch = path.match(/^\/api\/podcasts\/(\d{4}-\d{2}-\d{2})\/([\w-]+)\/([\w-]+)$/)
      if (podcastMatch && req.method === 'PATCH') {
        const [, date, source, slug] = podcastMatch
        const body = await req.json()
        return json(await handlePatchPodcast(date, source, slug, body))
      }
```

- [ ] **Step 4: Add keyword search to PodcastsTab in Database.jsx**

In the `PodcastsTab` function, add search state:

```javascript
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebouncedValue(searchQuery, 300)
```

Add search filtering after existing tier/source filters:

```javascript
  if (debouncedSearch) {
    const q = debouncedSearch.toLowerCase()
    filtered = filtered.filter(ep => {
      const digest = ep.digest || {}
      const haystack = [
        ep.title, ep.source, digest.summary,
        ...(digest.key_stories || digest.stories || []).map(s => typeof s === 'string' ? s : s.headline || s.title || ''),
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }
```

Add search input in the filter-bar:

```jsx
        <input
          type="text"
          placeholder="Search podcasts..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="filter-search"
        />
```

- [ ] **Step 5: Run tests + build**

Run: `cd web/api && bun test`
Expected: All pass

Run: `cd web/app && bun run build`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/podcasts.js web/api/server.js web/api/tests/podcasts.test.js web/app/src/pages/Database.jsx
git commit -m "feat(database): podcast archive + keyword search

PATCH /api/podcasts/:date/:source/:slug accepts archived flag.
PodcastsTab now has keyword search across title, source, stories."
```

### Task 8: Archive UI (articles + podcasts)

**Files:**
- Modify: `web/app/src/pages/Database.jsx`
- Modify: `web/app/src/pages/Database.css`

- [ ] **Step 1: Add archive toggle state and UI to Database.jsx**

In the `Database` main component, add state:
```javascript
  const [showArchived, setShowArchived] = useState(false)
```

In the articles filter-bar, add toggle:
```jsx
            <label className="archive-toggle">
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
              Show archived
            </label>
```

- [ ] **Step 2: Add archive button to ArticleRow**

In `ArticleRow` actions column, add archive/restore button:

```jsx
              <button
                className="btn-icon"
                title={a.archived ? 'Restore' : 'Archive'}
                onClick={e => { e.stopPropagation(); onArchiveToggle() }}
              >
                {a.archived ? '↩' : '📦'}
              </button>
```

Add `onArchiveToggle` to the ArticleRow props destructure, and wire it from ArticleTable:

```javascript
  async function handleArchiveToggle(a) {
    setActionError(null)
    try {
      await apiPatch(`/api/articles/${a.date_published}/${a.sector}/${a.slug}`, { archived: !a.archived })
      onReload()
    } catch (err) {
      setActionError(err.message)
    }
  }
```

- [ ] **Step 3: Filter archived articles in display**

In the articles tab rendering, filter based on `showArchived`:

```javascript
  const displayArticles = showArchived
    ? allResult.articles
    : (allResult.articles || []).filter(a => !a.archived)
```

Pass `displayArticles` to `ArticleTable` instead of `allResult.articles`.

For podcasts, similarly filter archived in `PodcastsTab`:
```javascript
  let filtered = showArchived ? episodes : episodes.filter(e => !e.archived)
```

Add `showArchived` prop to PodcastsTab.

- [ ] **Step 4: Add archive CSS styles**

Add to `web/app/src/pages/Database.css`:

```css
.archive-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  font-size: var(--font-sm);
  color: var(--medium-gray);
  cursor: pointer;
}

.archive-toggle input {
  cursor: pointer;
}

tr.archived td {
  opacity: 0.5;
}

tr.archived .article-title {
  text-decoration: line-through;
}

.badge-archived {
  font-size: var(--font-xs);
  background: var(--dark-gray);
  color: var(--light-gray);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  margin-left: var(--sp-1);
}

.podcast-card.archived {
  opacity: 0.5;
}

.podcast-card.archived .podcast-card-title {
  text-decoration: line-through;
}
```

- [ ] **Step 5: Build check + commit**

Run: `cd web/app && bun run build`
Expected: 0 errors

```bash
git add web/app/src/pages/Database.jsx web/app/src/pages/Database.css
git commit -m "feat(database): archive UI for articles and podcasts

Show archived toggle, archive/restore buttons, visual indicators
for archived items (opacity, strikethrough, badge)."
```

### Task 9: Draft-in-chat buttons (replacing DraftLink)

**Files:**
- Modify: `web/app/src/pages/Database.jsx`

- [ ] **Step 1: Replace DraftLink with draft-in-chat buttons**

In `ArticleRow`, replace the DraftLink usage with a button that triggers chat:

```jsx
  <button
    className="btn-icon draft-chat-btn"
    title="Draft in chat"
    onClick={e => { e.stopPropagation(); onDraftInChat() }}
  >
    ✏️ Draft
  </button>
```

Wire `onDraftInChat` prop through ArticleTable → ArticleRow. In ArticleTable, add handler:

```javascript
  function handleDraftInChat(a) {
    const prompt = `Draft a newsletter post about this article:\n\n**${a.title}** (${a.source || 'unknown'}, ${a.sector})\n\n${a.snippet || ''}`
    onDraftInChat(prompt)
  }
```

Add `onDraftInChat` prop to ArticleTable and wire from Database:

```jsx
  <ArticleTable
    articles={displayArticles}
    tab="all"
    onReload={() => { allResult.reload(); flaggedResult.reload?.() }}
    onDraftInChat={prompt => setDraftRequest(prompt)}
  />
```

- [ ] **Step 2: Replace DraftLink in PodcastCard**

In `PodcastCard`, replace the DraftLink (lines 248–252) with:

```jsx
  <button
    className="draft-link"
    onClick={e => {
      e.stopPropagation()
      const stories = (digest.stories || digest.key_stories || [])
        .map(s => typeof s === 'string' ? s : s.headline || s.title || '')
        .filter(Boolean)
        .join('\n- ')
      const prompt = `Draft a newsletter post about this podcast episode:\n\n**${ep.title || 'Untitled'}** (${ep.source})\n\n${digest.summary || ''}\n\nKey stories:\n- ${stories}`
      onDraftInChat(prompt)
    }}
  >
    ✏️ Draft in chat
  </button>
```

Thread `onDraftInChat` prop from PodcastsTab → PodcastCard → Database.

- [ ] **Step 3: Remove DraftLink import if no longer used**

Check if DraftLink is used anywhere else in Database.jsx. If not, remove the import:
```javascript
// Remove: import DraftLink from '../components/shared/DraftLink'
```

- [ ] **Step 4: Build check + commit**

Run: `cd web/app && bun run build`
Expected: 0 errors

```bash
git add web/app/src/pages/Database.jsx
git commit -m "feat(database): replace DraftLink with draft-in-chat buttons

Articles and podcasts now send draft prompts to the chat sidebar
instead of navigating to the old Draft page."
```

---

## Stream D: Sources Page Fix

### Task 10: Fix Sources page rendering

**Files:**
- Modify: `web/api/routes/sources.js`
- Modify: `web/app/src/pages/Sources.jsx`

- [ ] **Step 1: Diagnose API failures**

Run: `curl -s http://localhost:3900/api/sources/overview | head -100`

Check for errors. If the endpoint returns 500 or malformed data, read `web/api/routes/sources.js` to find where it crashes.

- [ ] **Step 2: Add graceful error handling to sources.js**

Wrap all file reads in try-catch blocks. Ensure missing `data/last-run-*.json` or `data/source-health.json` returns empty results instead of crashing:

```javascript
export function getOverview() {
  const runs = []
  try {
    const runFiles = readdirSync(join(ROOT, 'data'))
      .filter(f => f.startsWith('last-run-') && f.endsWith('.json'))
      .sort()
    // ... existing aggregation logic with try-catch per file
  } catch { /* data dir missing or unreadable */ }

  let health = {}
  try {
    const healthPath = join(ROOT, 'data/source-health.json')
    if (existsSync(healthPath)) {
      health = JSON.parse(readFileSync(healthPath, 'utf-8'))
    }
  } catch { /* ignore */ }

  return { runs, health }
}
```

- [ ] **Step 3: Add empty state handling to Sources.jsx**

Ensure the component handles `{ runs: [], health: {} }` gracefully:

```jsx
{runs.length === 0 && (
  <div className="placeholder-text">No pipeline runs found. The fetch pipeline needs to run at least once to generate source data.</div>
)}
```

- [ ] **Step 4: Visual verification + commit**

Check: Sources page loads without crashing. Shows empty state if no run data.

```bash
git add web/api/routes/sources.js web/app/src/pages/Sources.jsx
git commit -m "fix(sources): graceful handling for missing data files

Sources page no longer crashes when last-run or source-health files
are missing. Shows empty state with explanation."
```

### Task 11: Source query performance analysis

**Files:**
- Create: `docs/source-query-analysis.md`

- [ ] **Step 1: Analyse run data**

If run data exists, examine the most recent `data/last-run-*.json`:
- Count queries with 0 results
- Identify paywalled sources
- Check consecutive failures in `source-health.json`
- Review sector coverage gaps

- [ ] **Step 2: Write analysis report**

Save findings to `docs/source-query-analysis.md` with:
- Summary statistics
- Dead queries (recommend removal)
- Paywall-blocked sources (candidates for Stream F)
- Missing coverage areas
- Recommended changes to `config/sources.yaml` (for Scott to review)

- [ ] **Step 3: Commit**

```bash
git add docs/source-query-analysis.md
git commit -m "docs: source query performance analysis and recommendations"
```

---

## Stream E: EV Newsletter Processing

### Task 12: EV link parser library

**Files:**
- Create: `scripts/lib/ev-parser.js`
- Create: `config/ev-extraction.yaml`
- Create: `scripts/tests/ev-parser.test.js`

- [ ] **Step 1: Create EV extraction config**

Create `config/ev-extraction.yaml`:

```yaml
# EV Newsletter Link Extraction Config
source_name_pattern: "Exponential View Newsletter"

url_exclusions:
  # EV's own domains
  - exponentialview.co
  - azeemazhar.substack.com

  # Social media
  - twitter.com
  - x.com
  - linkedin.com
  - facebook.com
  - instagram.com
  - threads.net
  - bsky.app
  - mastodon.social

  # Podcast players
  - apple.com/podcasts
  - podcasts.apple.com
  - spotify.com
  - overcast.fm
  - pocketcasts.com

  # Video platforms
  - youtube.com
  - youtu.be
  - vimeo.com

  # Other non-article
  - github.com
  - docs.google.com
  - drive.google.com
```

- [ ] **Step 2: Write failing tests for ev-parser**

Create `scripts/tests/ev-parser.test.js`:

```javascript
import { describe, it, expect } from 'bun:test'
import { extractUrls, filterUrls, classifySector } from '../lib/ev-parser.js'

describe('extractUrls', () => {
  it('extracts HTTP URLs from text', () => {
    const text = 'Check out https://example.com/article and http://other.com/page for details.'
    const urls = extractUrls(text)
    expect(urls).toContain('https://example.com/article')
    expect(urls).toContain('http://other.com/page')
  })

  it('ignores mailto links', () => {
    const urls = extractUrls('Contact mailto:user@example.com or visit https://example.com')
    expect(urls).not.toContain('mailto:user@example.com')
    expect(urls).toContain('https://example.com')
  })

  it('deduplicates URLs', () => {
    const text = 'Visit https://example.com and again https://example.com'
    const urls = extractUrls(text)
    expect(urls.length).toBe(1)
  })
})

describe('filterUrls', () => {
  it('removes excluded domains', () => {
    const urls = ['https://twitter.com/user', 'https://example.com/article', 'https://exponentialview.co/post']
    const filtered = filterUrls(urls)
    expect(filtered).toEqual(['https://example.com/article'])
  })

  it('removes anchor-only and image URLs', () => {
    const urls = ['#section', 'https://example.com/photo.jpg', 'https://example.com/article']
    const filtered = filterUrls(urls)
    expect(filtered).toEqual(['https://example.com/article'])
  })
})

describe('classifySector', () => {
  it('classifies pharma content as biopharma', () => {
    const sector = classifySector('New drug discovery using AI in pharmaceutical research and clinical trials')
    expect(sector).toBe('biopharma')
  })

  it('defaults to general for ambiguous content', () => {
    const sector = classifySector('Interesting developments in artificial intelligence')
    expect(sector).toBe('general')
  })
})
```

- [ ] **Step 3: Implement ev-parser.js**

Create `scripts/lib/ev-parser.js`:

```javascript
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'

const ROOT = resolve(import.meta.dir, '../..')
let _config = null

function getConfig() {
  if (_config) return _config
  const configPath = join(ROOT, 'config/ev-extraction.yaml')
  _config = yaml.load(readFileSync(configPath, 'utf-8'))
  return _config
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico']

export function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g
  const matches = text.match(urlRegex) || []
  // Clean trailing punctuation
  const cleaned = matches.map(u => u.replace(/[.,;:!?)]+$/, ''))
  return [...new Set(cleaned)]
}

export function filterUrls(urls) {
  const config = getConfig()
  const exclusions = config.url_exclusions || []

  return urls.filter(url => {
    // Skip anchors
    if (url.startsWith('#')) return false

    // Skip images
    const path = new URL(url).pathname.toLowerCase()
    if (IMAGE_EXTS.some(ext => path.endsWith(ext))) return false

    // Skip excluded domains
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return !exclusions.some(excl => hostname === excl || hostname.endsWith('.' + excl))
  })
}

// Simple keyword-based sector classification
const SECTOR_KEYWORDS = {
  biopharma: ['pharma', 'drug', 'clinical trial', 'biotech', 'gene therapy', 'fda', 'ema', 'oncology', 'therapeutic'],
  medtech: ['medical device', 'diagnostic', 'imaging', 'surgical robot', 'wearable health', 'digital health', 'telemedicine'],
  manufacturing: ['manufacturing', 'supply chain', 'industrial robot', 'digital twin', 'factory', 'automation'],
  insurance: ['insurance', 'underwriting', 'claims', 'actuarial', 'insurtech', 'reinsurance'],
}

export function classifySector(text) {
  const lower = text.toLowerCase()
  let bestSector = 'general'
  let bestScore = 0

  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestSector = sector
    }
  }

  return bestSector
}

export async function fetchAndExtract(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SNI-Research/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return null

    const html = await resp.text()
    const { load } = await import('cheerio')
    const $ = load(html)

    // Remove nav, footer, script, style
    $('nav, footer, script, style, noscript, aside').remove()

    const title = $('h1').first().text().trim()
      || $('meta[property="og:title"]').attr('content')
      || $('title').text().trim()
      || ''

    const text = $('article').text().trim()
      || $('main').text().trim()
      || $('body').text().trim()

    const datePublished = $('meta[property="article:published_time"]').attr('content')
      || $('time[datetime]').attr('datetime')
      || null

    const source = new URL(url).hostname.replace(/^www\./, '')

    return { title, text: text.slice(0, 50000), datePublished, source, url }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd scripts && bun test tests/ev-parser.test.js`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/ev-parser.js config/ev-extraction.yaml scripts/tests/ev-parser.test.js
git commit -m "feat(ev): link parser library with URL filtering and sector classification

Extracts URLs from text, filters excluded domains (social, podcast players,
EV's own), classifies sector by keyword scoring."
```

### Task 13: EV extraction pipeline script

**Files:**
- Create: `scripts/ev-link-extract.js`
- Create: `com.sni.ev-extract.plist`

- [ ] **Step 1: Create the main extraction script**

Create `scripts/ev-link-extract.js`:

```javascript
#!/usr/bin/env bun
/**
 * EV Newsletter Link Extraction Pipeline
 *
 * Runs independently via launchd (daily at 07:30, after podcast import at 07:00).
 * Reads podcast manifest/digests for EV newsletter entries, extracts links,
 * fetches articles, saves to data/verified/, and generates domain recommendations.
 *
 * Does NOT modify any existing scripts or config files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'
import { extractUrls, filterUrls, classifySector, fetchAndExtract } from './lib/ev-parser.js'

const ROOT = resolve(import.meta.dir, '..')
const EDITORIAL_DIR = join(ROOT, 'data/editorial')
const PROCESSED_PATH = join(EDITORIAL_DIR, 'ev-processed.json')
const RECOMMENDATIONS_PATH = join(EDITORIAL_DIR, 'ev-recommendations.json')

function log(msg) {
  console.log(`[ev-extract] ${new Date().toISOString().slice(11, 19)} ${msg}`)
}

function getConfig() {
  return yaml.load(readFileSync(join(ROOT, 'config/ev-extraction.yaml'), 'utf-8'))
}

function getProcessed() {
  if (!existsSync(PROCESSED_PATH)) return []
  try { return JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8')) } catch { return [] }
}

function saveProcessed(list) {
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  writeFileSync(PROCESSED_PATH, JSON.stringify(list, null, 2))
}

// Find EV newsletter digests — try manifest first, then scan directories
function findEvDigests(config) {
  const pattern = (config.source_name_pattern || 'Exponential View Newsletter').toLowerCase()
  const digests = []

  // Try manifest.json, then .bak
  for (const fname of ['manifest.json', 'manifest.json.bak']) {
    const mpath = join(ROOT, 'data/podcasts', fname)
    if (!existsSync(mpath)) continue
    try {
      const manifest = JSON.parse(readFileSync(mpath, 'utf-8'))
      const entries = Array.isArray(manifest) ? manifest : Object.values(manifest)
      for (const entry of entries) {
        if ((entry.source || '').toLowerCase().includes(pattern.toLowerCase())) {
          digests.push({
            id: entry.digestPath || entry.filename,
            digestPath: entry.digestPath ? join(ROOT, entry.digestPath) : null,
            transcriptPath: entry.transcriptPath ? join(ROOT, entry.transcriptPath) : null,
            date: entry.date,
            source: entry.source,
          })
        }
      }
      if (digests.length > 0) return digests
    } catch { continue }
  }

  // Fallback: scan data/podcasts/ directories
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) return []
  for (const dateDir of readdirSync(podcastDir).sort().reverse()) {
    const datePath = join(podcastDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sourceDir of readdirSync(datePath)) {
      if (!sourceDir.toLowerCase().includes('exponential')) continue
      const sourcePath = join(datePath, sourceDir)
      if (!statSync(sourcePath).isDirectory()) continue
      for (const file of readdirSync(sourcePath)) {
        if (!file.endsWith('.digest.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
          if ((raw.source || '').toLowerCase().includes(pattern.toLowerCase())) {
            digests.push({
              id: join(dateDir, sourceDir, file),
              digestPath: join(sourcePath, file),
              transcriptPath: join(sourcePath, file.replace('.digest.json', '.md')),
              date: raw.date || dateDir,
              source: raw.source,
            })
          }
        } catch { /* skip */ }
      }
    }
  }

  return digests
}

// Check if URL already exists in corpus
function isInCorpus(url) {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return false

  // Only check recent dates for performance
  const dirs = readdirSync(verifiedDir).sort().reverse().slice(0, 14)
  for (const dateDir of dirs) {
    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sectorDir of readdirSync(datePath)) {
      const sectorPath = join(datePath, sectorDir)
      if (!statSync(sectorPath).isDirectory()) continue
      for (const file of readdirSync(sectorPath)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          if (raw.url === url) return true
        } catch { /* skip */ }
      }
    }
  }
  return false
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  log('Starting EV newsletter link extraction')
  const config = getConfig()
  const processed = getProcessed()
  const processedSet = new Set(processed)

  const digests = findEvDigests(config)
  log(`Found ${digests.length} EV digest(s) total`)

  const newDigests = digests.filter(d => !processedSet.has(d.id))
  if (newDigests.length === 0) {
    log('No new EV digests to process. Exiting.')
    return
  }

  log(`Processing ${newDigests.length} new EV digest(s)`)

  const now = new Date()
  const currentWeek = getISOWeek(now)
  const currentYear = now.getFullYear()
  const allDomains = new Map() // domain → { count, articles }
  let savedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const digest of newDigests) {
    log(`\nProcessing: ${digest.source} (${digest.date})`)

    // Read transcript for link extraction
    let text = ''
    if (digest.transcriptPath && existsSync(digest.transcriptPath)) {
      text = readFileSync(digest.transcriptPath, 'utf-8')
    }
    if (!text && digest.digestPath && existsSync(digest.digestPath)) {
      const digestData = JSON.parse(readFileSync(digest.digestPath, 'utf-8'))
      text = JSON.stringify(digestData) // Extract URLs from JSON too
    }

    if (!text) {
      log(`  No content found, skipping`)
      continue
    }

    const rawUrls = extractUrls(text)
    const urls = filterUrls(rawUrls)
    log(`  Extracted ${rawUrls.length} URLs, ${urls.length} after filtering`)

    for (const url of urls) {
      // Track domains for recommendations
      const domain = new URL(url).hostname.replace(/^www\./, '')
      if (!allDomains.has(domain)) allDomains.set(domain, { count: 0, articles: [] })
      allDomains.get(domain).count++

      // Dedup against corpus
      if (isInCorpus(url)) {
        skippedCount++
        continue
      }

      // Fetch and extract
      log(`  Fetching: ${url}`)
      await new Promise(r => setTimeout(r, 2000)) // Rate limit
      const article = await fetchAndExtract(url)
      if (!article || !article.text || article.text.length < 100) {
        failedCount++
        continue
      }

      // Classify sector
      const sector = classifySector(article.text)

      // Date filter — articles from current week are priority
      let isCurrentWeek = false
      if (article.datePublished) {
        const pubDate = new Date(article.datePublished)
        isCurrentWeek = getISOWeek(pubDate) === currentWeek && pubDate.getFullYear() === currentYear
      }

      // Save to corpus
      const dateStr = article.datePublished?.split('T')[0] || now.toISOString().split('T')[0]
      const slug = (article.title || 'untitled').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

      const destDir = join(ROOT, 'data/verified', dateStr, sector)
      mkdirSync(destDir, { recursive: true })

      const articleJson = {
        title: article.title,
        url: article.url,
        source: article.source,
        source_type: 'ev-newsletter',
        date_published: dateStr,
        date_confidence: article.datePublished ? 'medium' : 'low',
        date_verified_method: article.datePublished ? 'meta-tag' : 'inferred',
        sector,
        keywords_matched: [],
        snippet: article.text.slice(0, 500),
        full_text: article.text,
        found_by: ['ev-newsletter'],
        scraped_at: new Date().toISOString(),
        ingested_at: new Date().toISOString(),
        score: null,
        score_reason: isCurrentWeek ? 'ev-current-week' : null,
        ev_priority: isCurrentWeek,
      }

      writeFileSync(join(destDir, `${slug}.json`), JSON.stringify(articleJson, null, 2))
      savedCount++
      allDomains.get(domain).articles.push({ title: article.title, url })

      log(`  Saved: ${article.title} (${sector}, ${isCurrentWeek ? 'current week' : 'older'})`)
    }

    // Mark as processed
    processed.push(digest.id)
    saveProcessed(processed)
  }

  // Generate domain recommendations
  const existingSources = loadExistingSources()
  const recommendations = []
  for (const [domain, info] of allDomains) {
    if (!existingSources.has(domain) && info.count >= 1) {
      recommendations.push({
        domain,
        linkCount: info.count,
        firstSeen: now.toISOString(),
        articles: info.articles.slice(0, 5),
      })
    }
  }

  if (recommendations.length > 0) {
    // Merge with existing recommendations
    let existing = []
    if (existsSync(RECOMMENDATIONS_PATH)) {
      try { existing = JSON.parse(readFileSync(RECOMMENDATIONS_PATH, 'utf-8')).domains || [] } catch {}
    }
    const merged = mergeRecommendations(existing, recommendations)
    writeFileSync(RECOMMENDATIONS_PATH, JSON.stringify({ domains: merged, lastUpdated: now.toISOString() }, null, 2))
    log(`\nWrote ${merged.length} domain recommendations`)
  }

  log(`\nComplete: ${savedCount} saved, ${skippedCount} skipped (dedup), ${failedCount} failed`)
}

function loadExistingSources() {
  const sources = new Set()
  try {
    const cfg = yaml.load(readFileSync(join(ROOT, 'config/sources.yaml'), 'utf-8'))
    // Extract domains from source config (structure varies)
    const text = JSON.stringify(cfg)
    const domainRegex = /[\w-]+\.[\w-]+\.[\w]+|[\w-]+\.[\w]+/g
    for (const m of text.match(domainRegex) || []) {
      sources.add(m.toLowerCase())
    }
  } catch { /* no sources config */ }
  return sources
}

function mergeRecommendations(existing, newRecs) {
  const byDomain = new Map()
  for (const r of existing) byDomain.set(r.domain, r)
  for (const r of newRecs) {
    if (byDomain.has(r.domain)) {
      const prev = byDomain.get(r.domain)
      prev.linkCount += r.linkCount
      prev.articles = [...prev.articles, ...r.articles].slice(0, 10)
    } else {
      byDomain.set(r.domain, r)
    }
  }
  return [...byDomain.values()].sort((a, b) => b.linkCount - a.linkCount)
}

main().catch(err => {
  console.error('[ev-extract] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Create launchd plist**

Create `com.sni.ev-extract.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.sni.ev-extract</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/scott/.bun/bin/bun</string>
        <string>scripts/ev-link-extract.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/Users/scott/Projects/sni-research-v2</string>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>7</integer>
        <key>Minute</key>
        <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/Users/scott/Projects/sni-research-v2/logs/ev-extract.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/scott/Projects/sni-research-v2/logs/ev-extract-error.log</string>
    <key>Nice</key>
    <integer>10</integer>
</dict>
</plist>
```

- [ ] **Step 3: Commit**

```bash
git add scripts/ev-link-extract.js com.sni.ev-extract.plist
git commit -m "feat(ev): extraction pipeline script + launchd schedule

Standalone script reads EV digests from podcast data, extracts links,
fetches articles, saves to data/verified. Runs daily at 07:30."
```

### Task 14: EV recommendations API + Dashboard card

**Files:**
- Create: `web/api/routes/ev-recommendations.js`
- Modify: `web/api/server.js`
- Modify: `web/app/src/pages/Dashboard.jsx`
- Create: `web/api/tests/ev-recommendations.test.js`

- [ ] **Step 1: Write failing tests**

Create `web/api/tests/ev-recommendations.test.js`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const recsPath = join(ROOT, 'data/editorial/ev-recommendations.json')

describe('GET /api/editorial/ev-recommendations', () => {
  afterEach(() => {
    if (existsSync(recsPath)) rmSync(recsPath)
  })

  it('returns empty domains when no file exists', async () => {
    if (existsSync(recsPath)) rmSync(recsPath)
    const resp = await fetch('http://localhost:3900/api/editorial/ev-recommendations')
    const data = await resp.json()
    expect(data.domains).toEqual([])
  })

  it('returns domains from file', async () => {
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(recsPath, JSON.stringify({
      domains: [{ domain: 'example.com', linkCount: 3, firstSeen: '2026-03-22', articles: [] }],
    }))

    const resp = await fetch('http://localhost:3900/api/editorial/ev-recommendations')
    const data = await resp.json()
    expect(data.domains.length).toBe(1)
    expect(data.domains[0].domain).toBe('example.com')
  })
})
```

- [ ] **Step 2: Implement ev-recommendations.js**

Create `web/api/routes/ev-recommendations.js`:

```javascript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const RECS_PATH = join(ROOT, 'data/editorial/ev-recommendations.json')
const PENDING_PATH = join(ROOT, 'data/editorial/sources-pending.json')

export function getEvRecommendations() {
  if (!existsSync(RECS_PATH)) return { domains: [] }
  try {
    return JSON.parse(readFileSync(RECS_PATH, 'utf-8'))
  } catch {
    return { domains: [] }
  }
}

export function updateEvRecommendation(domain, body) {
  const { action } = body || {}
  if (!action || !['accept', 'dismiss'].includes(action)) {
    const err = new Error('action must be "accept" or "dismiss"')
    err.status = 400
    throw err
  }

  const data = getEvRecommendations()
  const idx = data.domains.findIndex(d => d.domain === domain)
  if (idx === -1) {
    const err = new Error('Domain not found in recommendations')
    err.status = 404
    throw err
  }

  const removed = data.domains.splice(idx, 1)[0]

  if (action === 'accept') {
    // Add to pending sources
    let pending = []
    if (existsSync(PENDING_PATH)) {
      try { pending = JSON.parse(readFileSync(PENDING_PATH, 'utf-8')) } catch {}
    }
    pending.push({ domain, addedAt: new Date().toISOString(), linkCount: removed.linkCount })
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2))
  }

  writeFileSync(RECS_PATH, JSON.stringify(data, null, 2))
  return { success: true, action, domain }
}
```

- [ ] **Step 3: Wire routes in server.js**

Add import and routes:

```javascript
import { getEvRecommendations, updateEvRecommendation } from './routes/ev-recommendations.js'
```

```javascript
      if (path === '/api/editorial/ev-recommendations' && req.method === 'GET') {
        return json(getEvRecommendations())
      }

      const evRecMatch = path.match(/^\/api\/editorial\/ev-recommendations\/([\w.-]+)$/)
      if (evRecMatch && req.method === 'PUT') {
        const body = await req.json()
        return json(updateEvRecommendation(evRecMatch[1], body))
      }
```

- [ ] **Step 4: Add EV recommendations card to Dashboard**

In `web/app/src/pages/Dashboard.jsx`, add a new card component:

```jsx
function EvRecommendationsCard() {
  const [data, setData] = useState(null)

  useEffect(() => {
    apiFetch('/api/editorial/ev-recommendations')
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data || !data.domains || data.domains.length === 0) return null

  async function handleAction(domain, action) {
    try {
      await apiPut(`/api/editorial/ev-recommendations/${domain}`, { action })
      setData(prev => ({
        ...prev,
        domains: prev.domains.filter(d => d.domain !== domain),
      }))
    } catch {}
  }

  return (
    <div className="card">
      <div className="card-title">EV Source Recommendations</div>
      <div className="ev-recs">
        {data.domains.slice(0, 10).map(d => (
          <div key={d.domain} className="ev-rec-row">
            <span className="ev-rec-domain">{d.domain}</span>
            <span className="ev-rec-count">{d.linkCount} link{d.linkCount !== 1 ? 's' : ''}</span>
            <button className="btn btn-sm" onClick={() => handleAction(d.domain, 'accept')}>Add</button>
            <button className="btn btn-sm btn-ghost" onClick={() => handleAction(d.domain, 'dismiss')}>Dismiss</button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

Add `<EvRecommendationsCard />` in the dashboard layout.

Add `apiPut` to the imports from `'../lib/api'` and `useEffect, useState` from `'react'`.

- [ ] **Step 5: Run tests + build**

Run: `cd web/api && bun test`
Expected: All pass

Run: `cd web/app && bun run build`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/ev-recommendations.js web/api/tests/ev-recommendations.test.js web/api/server.js web/app/src/pages/Dashboard.jsx
git commit -m "feat(ev): recommendations API + Dashboard card

GET/PUT /api/editorial/ev-recommendations for domain review.
Dashboard shows new domains with add/dismiss actions."
```

---

## Stream F: Subscription Content Downloads

### Task 15: Credential store library

**Files:**
- Create: `scripts/lib/credential-store.js`
- Create: `scripts/tests/credential-store.test.js`

- [ ] **Step 1: Write failing tests**

Create `scripts/tests/credential-store.test.js`:

```javascript
import { describe, it, expect, afterEach } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const testCredPath = join(ROOT, '.credentials-test.enc')

// Set test env
process.env.SNI_CREDENTIAL_KEY = 'a'.repeat(64) // 32 bytes hex
process.env.SNI_CREDENTIAL_FILE = testCredPath

const { encrypt, decrypt, saveCredentials, loadCredentials } = await import('../lib/credential-store.js')

afterEach(() => {
  if (existsSync(testCredPath)) rmSync(testCredPath)
})

describe('credential-store', () => {
  it('encrypts and decrypts round-trip', () => {
    const plaintext = 'hello world secret'
    const encrypted = encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext for same plaintext (random IV)', () => {
    const plaintext = 'same input'
    const a = encrypt(plaintext)
    const b = encrypt(plaintext)
    expect(a).not.toBe(b)
  })

  it('saves and loads credentials', () => {
    const creds = [
      { name: 'FT', email: 'test@example.com', password: 'secret123' },
      { name: 'EV', email: 'test@example.com', password: 'pass456' },
    ]
    saveCredentials(creds)
    expect(existsSync(testCredPath)).toBe(true)

    const loaded = loadCredentials()
    expect(loaded).toEqual(creds)
  })

  it('returns empty array when no credential file', () => {
    if (existsSync(testCredPath)) rmSync(testCredPath)
    const loaded = loadCredentials()
    expect(loaded).toEqual([])
  })
})
```

- [ ] **Step 2: Implement credential-store.js**

Create `scripts/lib/credential-store.js`:

```javascript
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const CRED_FILE = process.env.SNI_CREDENTIAL_FILE || join(ROOT, '.credentials.enc')

function getKey() {
  const keyHex = process.env.SNI_CREDENTIAL_KEY
  if (!keyHex) throw new Error('SNI_CREDENTIAL_KEY not set in environment')
  // Derive a 32-byte key via PBKDF2
  return pbkdf2Sync(Buffer.from(keyHex, 'hex'), 'sni-credential-salt', 100000, 32, 'sha256')
}

export function encrypt(plaintext) {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Format: IV (12) + Tag (16) + Ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decrypt(encoded) {
  const key = getKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final('utf-8')
}

export function saveCredentials(credentials) {
  const json = JSON.stringify(credentials)
  const encrypted = encrypt(json)
  writeFileSync(CRED_FILE, encrypted)
}

export function loadCredentials() {
  if (!existsSync(CRED_FILE)) return []
  try {
    const encrypted = readFileSync(CRED_FILE, 'utf-8')
    const json = decrypt(encrypted)
    return JSON.parse(json)
  } catch {
    return []
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd scripts && bun test tests/credential-store.test.js`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/credential-store.js scripts/tests/credential-store.test.js
git commit -m "feat(subscriptions): AES-256-GCM credential store

Encrypt/decrypt with random IV, PBKDF2 key derivation.
Saves credential JSON to .credentials.enc."
```

### Task 16: Subscription adapters + orchestrator

**Files:**
- Create: `scripts/lib/adapters/substack.js`
- Create: `scripts/lib/adapters/ft.js`
- Create: `scripts/subscription-fetch.js`
- Create: `config/subscriptions.yaml`

- [ ] **Step 1: Create subscriptions config**

Create `config/subscriptions.yaml`:

```yaml
# Subscription sources for authenticated content fetching
sources:
  - name: Financial Times
    type: ft
    url: https://www.ft.com
    schedule: wednesday
    enabled: true

  - name: Exponential View
    type: substack
    url: https://www.exponentialview.co
    schedule: daily
    enabled: true

  - name: AI Realist
    type: substack
    url: https://www.airealist.com
    schedule: daily
    enabled: true

  - name: David Oks
    type: substack
    url: https://davidoks.substack.com
    schedule: daily
    enabled: true
```

- [ ] **Step 2: Create Substack adapter**

Create `scripts/lib/adapters/substack.js`:

```javascript
import RssParser from 'rss-parser'

const parser = new RssParser()

export async function checkNewPosts(publicationUrl, browser) {
  const rssUrl = publicationUrl.replace(/\/$/, '') + '/feed'
  const feed = await parser.parseURL(rssUrl)
  return (feed.items || []).map(item => ({
    title: item.title,
    url: item.link,
    date: item.isoDate || item.pubDate,
    content: item['content:encoded'] || item.content || '',
  }))
}

export async function login(page, email, password) {
  await page.goto('https://substack.com/sign-in')
  await page.waitForSelector('input[type="email"]', { timeout: 10000 })
  await page.fill('input[type="email"]', email)
  await page.click('button:has-text("Continue")')
  await page.waitForSelector('input[type="password"]', { timeout: 10000 })
  await page.fill('input[type="password"]', password)
  await page.click('button:has-text("Log in")')
  await page.waitForTimeout(3000)
}

export async function fetchArticle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const content = await page.evaluate(() => {
    const article = document.querySelector('.available-content, .body.markup, article')
    return article ? article.innerText : document.body.innerText
  })

  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    return h1 ? h1.innerText : document.title
  })

  return { title, content, url }
}
```

- [ ] **Step 3: Create FT adapter**

Create `scripts/lib/adapters/ft.js`:

```javascript
export async function login(page, email, password) {
  await page.goto('https://accounts.ft.com/login')
  await page.waitForSelector('input[type="email"], #email', { timeout: 10000 })
  await page.fill('input[type="email"], #email', email)
  await page.click('button[type="submit"]')
  await page.waitForSelector('input[type="password"], #password', { timeout: 10000 })
  await page.fill('input[type="password"], #password', password)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(3000)
}

export async function search(page, query, maxResults = 10) {
  const searchUrl = `https://www.ft.com/search?q=${encodeURIComponent(query)}&sort=date`
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const urls = await page.evaluate((max) => {
    const links = Array.from(document.querySelectorAll('a.js-teaser-heading-link, .o-teaser__heading a'))
    return links.slice(0, max).map(a => a.href).filter(h => h.includes('/content/'))
  }, maxResults)

  return urls
}

export async function fetchArticle(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  const title = await page.evaluate(() => {
    const h1 = document.querySelector('h1')
    return h1 ? h1.innerText : document.title
  })

  const content = await page.evaluate(() => {
    const article = document.querySelector('.article-body, .n-content-body, article')
    return article ? article.innerText : ''
  })

  const datePublished = await page.evaluate(() => {
    const time = document.querySelector('time[datetime]')
    return time ? time.getAttribute('datetime') : null
  })

  return { title, content, url, datePublished }
}
```

- [ ] **Step 4: Create orchestrator script**

Create `scripts/subscription-fetch.js`:

```javascript
#!/usr/bin/env node
/**
 * Subscription Content Fetcher
 *
 * Runs under Node.js (not Bun) due to Playwright dependency.
 * Usage:
 *   node scripts/subscription-fetch.js [--test] [--source ft|substack]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const testMode = args.includes('--test')
const sourceFilter = args.find((a, i) => args[i - 1] === '--source')

function log(msg) {
  console.log(`[subscription-fetch] ${new Date().toISOString().slice(11, 19)} ${msg}`)
}

async function main() {
  log(testMode ? 'Running in TEST mode (login only)' : 'Starting subscription fetch')

  const config = yaml.load(readFileSync(join(ROOT, 'config/subscriptions.yaml'), 'utf-8'))
  const sources = config.sources.filter(s => s.enabled !== false)
    .filter(s => !sourceFilter || s.type === sourceFilter)

  // Load credentials
  const { loadCredentials } = await import('./lib/credential-store.js')
  const credentials = loadCredentials()

  // Lazy-load Playwright
  let chromium
  try {
    const pw = await import('playwright')
    chromium = pw.chromium
  } catch (err) {
    log(`ERROR: Playwright not available: ${err.message}`)
    log('Install with: npx playwright install chromium')
    process.exit(1)
  }

  const browserStatePath = join(ROOT, 'data/.browser-state')
  mkdirSync(browserStatePath, { recursive: true })

  const results = []

  for (const source of sources) {
    const cred = credentials.find(c => c.name === source.name)
    if (!cred) {
      log(`Skipping ${source.name}: no credentials`)
      results.push({ source: source.name, success: false, error: 'No credentials' })
      continue
    }

    log(`\nProcessing: ${source.name} (${source.type})`)
    const stateDir = join(browserStatePath, source.name.toLowerCase().replace(/\s+/g, '-'))
    mkdirSync(stateDir, { recursive: true })

    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({
        storageState: existsSync(join(stateDir, 'state.json')) ? join(stateDir, 'state.json') : undefined,
      })
      const page = await context.newPage()

      if (source.type === 'substack') {
        const adapter = await import('./lib/adapters/substack.js')
        await adapter.login(page, cred.email, cred.password)
        log(`  Login successful`)

        if (!testMode) {
          const posts = await adapter.checkNewPosts(source.url, browser)
          log(`  Found ${posts.length} posts`)
          for (const post of posts.slice(0, 5)) {
            await new Promise(r => setTimeout(r, 2000))
            const article = await adapter.fetchArticle(page, post.url)
            if (article.content.length > 100) {
              saveArticle(article, source.name)
              log(`  Saved: ${article.title}`)
            }
          }
        }
      } else if (source.type === 'ft') {
        const adapter = await import('./lib/adapters/ft.js')
        await adapter.login(page, cred.email, cred.password)
        log(`  Login successful`)

        if (!testMode) {
          // Load search queries from sources.yaml
          const queries = loadFtQueries()
          for (const query of queries.slice(0, 5)) {
            await new Promise(r => setTimeout(r, 2000))
            const urls = await adapter.search(page, query)
            log(`  Query "${query}": ${urls.length} results`)
            for (const url of urls.slice(0, 3)) {
              await new Promise(r => setTimeout(r, 2000))
              const article = await adapter.fetchArticle(page, url)
              if (article.content.length > 100) {
                saveArticle(article, 'Financial Times')
                log(`  Saved: ${article.title}`)
              }
            }
          }
        }
      }

      // Save browser state for next run
      await context.storageState({ path: join(stateDir, 'state.json') })
      results.push({ source: source.name, success: true })

      await browser.close()
    } catch (err) {
      log(`  ERROR: ${err.message}`)
      results.push({ source: source.name, success: false, error: err.message })
      if (browser) await browser.close().catch(() => {})
    }
  }

  // Write run summary
  const summary = {
    startedAt: new Date().toISOString(),
    testMode,
    results,
  }
  const summaryDir = join(ROOT, 'output/runs')
  mkdirSync(summaryDir, { recursive: true })
  writeFileSync(
    join(summaryDir, `subscription-${new Date().toISOString().split('T')[0]}.json`),
    JSON.stringify(summary, null, 2)
  )

  log(`\nComplete. ${results.filter(r => r.success).length}/${results.length} sources succeeded.`)
  if (results.some(r => !r.success)) process.exit(1)
}

function saveArticle(article, sourceName) {
  const dateStr = article.datePublished?.split('T')[0] || new Date().toISOString().split('T')[0]
  const slug = (article.title || 'untitled').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

  const sector = 'general' // Subscription articles default to general
  const destDir = join(ROOT, 'data/verified', dateStr, sector)
  mkdirSync(destDir, { recursive: true })

  const json = {
    title: article.title,
    url: article.url,
    source: sourceName,
    source_type: 'subscription',
    date_published: dateStr,
    date_confidence: article.datePublished ? 'high' : 'low',
    sector,
    keywords_matched: [],
    snippet: article.content.slice(0, 500),
    full_text: article.content,
    found_by: ['subscription'],
    scraped_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    score: null,
    score_reason: null,
  }

  writeFileSync(join(destDir, `${slug}.json`), JSON.stringify(json, null, 2))
}

function loadFtQueries() {
  try {
    const cfg = yaml.load(readFileSync(join(ROOT, 'config/sources.yaml'), 'utf-8'))
    // Extract FT-relevant queries from sources config
    const queries = []
    for (const [key, val] of Object.entries(cfg || {})) {
      if (typeof val === 'object' && val.queries) {
        queries.push(...val.queries.slice(0, 3))
      }
    }
    return queries.length > 0 ? queries : ['artificial intelligence', 'machine learning', 'AI regulation']
  } catch {
    return ['artificial intelligence', 'machine learning', 'AI regulation']
  }
}

main()
```

- [ ] **Step 5: Create launchd plists**

Create `com.sni.subscription-ft.plist` and `com.sni.subscription-substack.plist` (same structure as ev-extract but with `node` runtime and appropriate schedules — Wednesday for FT, daily for Substack).

- [ ] **Step 6: Add .credentials.enc to .gitignore**

Append to `.gitignore`:
```
.credentials.enc
.credentials-test.enc
```

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/adapters/ft.js scripts/lib/adapters/substack.js scripts/subscription-fetch.js config/subscriptions.yaml com.sni.subscription-ft.plist com.sni.subscription-substack.plist .gitignore
git commit -m "feat(subscriptions): adapters, orchestrator, and scheduling

FT adapter (search + fetch), Substack adapter (RSS + fetch).
Orchestrator supports --test mode and per-source filtering.
Launchd plists for Wednesday FT and daily Substack."
```

### Task 17: Subscription API + Config UI

**Files:**
- Create: `web/api/routes/subscriptions.js`
- Modify: `web/api/server.js`
- Modify: `web/app/src/pages/Config.jsx`
- Create: `web/api/tests/subscriptions.test.js`

- [ ] **Step 1: Write failing tests**

Create `web/api/tests/subscriptions.test.js`:

```javascript
import { describe, it, expect } from 'bun:test'

describe('GET /api/subscriptions', () => {
  it('returns configured sources', async () => {
    const resp = await fetch('http://localhost:3900/api/subscriptions')
    const data = await resp.json()
    expect(Array.isArray(data.sources)).toBe(true)
    expect(data.sources.length).toBeGreaterThan(0)
    expect(data.sources[0].name).toBeDefined()
  })
})
```

- [ ] **Step 2: Implement subscriptions.js**

Create `web/api/routes/subscriptions.js`:

```javascript
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import yaml from 'js-yaml'

const ROOT = resolve(import.meta.dir, '../../..')

export function getSubscriptions() {
  const configPath = join(ROOT, 'config/subscriptions.yaml')
  if (!existsSync(configPath)) return { sources: [] }

  const config = yaml.load(readFileSync(configPath, 'utf-8'))
  const sources = (config.sources || []).map(s => {
    // Find latest run for this source
    const runsDir = join(ROOT, 'output/runs')
    let lastRun = null
    if (existsSync(runsDir)) {
      const runFiles = readdirSync(runsDir)
        .filter(f => f.startsWith('subscription-') && f.endsWith('.json'))
        .sort()
      if (runFiles.length > 0) {
        try {
          const data = JSON.parse(readFileSync(join(runsDir, runFiles[runFiles.length - 1]), 'utf-8'))
          const result = (data.results || []).find(r => r.source === s.name)
          if (result) lastRun = { date: data.startedAt, success: result.success, error: result.error }
        } catch { /* ignore */ }
      }
    }

    // Check if credentials exist by checking the encrypted file
    const hasCredentials = existsSync(join(ROOT, '.credentials.enc'))

    return { ...s, lastRun, hasCredentials }
  })

  return { sources }
}

export function saveCredentials(body) {
  const { sources } = body || {}
  if (!Array.isArray(sources)) {
    const err = new Error('sources array required')
    err.status = 400
    throw err
  }

  // Write credentials via the credential store (spawns Node for ESM compatibility)
  const proc = Bun.spawnSync({
    cmd: ['node', '--input-type=module', '-e', `
      import { saveCredentials } from './scripts/lib/credential-store.js';
      saveCredentials(JSON.parse(process.argv[1]));
    `, JSON.stringify(sources)],
    cwd: ROOT,
  })

  if (proc.exitCode !== 0) {
    const err = new Error('Failed to save credentials')
    err.status = 500
    throw err
  }

  return { saved: true }
}

export function testLogins() {
  return new Promise((resolve) => {
    const proc = spawn('node', ['scripts/subscription-fetch.js', '--test'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    proc.stdout.on('data', d => { output += d })
    proc.stderr.on('data', d => { output += d })

    proc.on('close', (code) => {
      resolve({ success: code === 0, output: output.slice(-2000) })
    })

    // Timeout after 60s
    setTimeout(() => {
      proc.kill()
      resolve({ success: false, output: 'Timeout after 60s' })
    }, 60000)
  })
}

export function triggerFetch(body) {
  const sourceArg = body?.source ? ['--source', body.source] : []
  const proc = spawn('node', ['scripts/subscription-fetch.js', ...sourceArg], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
  proc.unref()

  return { started: true, pid: proc.pid }
}
```

- [ ] **Step 3: Wire routes in server.js**

```javascript
import { getSubscriptions, saveCredentials as saveSubCredentials, testLogins, triggerFetch } from './routes/subscriptions.js'
```

```javascript
      if (path === '/api/subscriptions' && req.method === 'GET') {
        return json(getSubscriptions())
      }
      if (path === '/api/subscriptions/credentials' && req.method === 'PUT') {
        const body = await req.json()
        return json(saveSubCredentials(body))
      }
      if (path === '/api/subscriptions/test' && req.method === 'POST') {
        return json(await testLogins())
      }
      if (path === '/api/subscriptions/fetch' && req.method === 'POST') {
        const body = await req.json()
        return json(triggerFetch(body))
      }
```

- [ ] **Step 4: Add credential management section to Config.jsx**

Add a "Subscription Credentials" section to `web/app/src/pages/Config.jsx`:

```jsx
function SubscriptionCredentials() {
  const [sources, setSources] = useState([])
  const [creds, setCreds] = useState({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    apiFetch('/api/subscriptions').then(data => {
      setSources(data.sources || [])
      const initial = {}
      for (const s of data.sources || []) {
        initial[s.name] = { email: '', password: '', hasSaved: s.hasCredentials }
      }
      setCreds(initial)
    }).catch(() => {})
  }, [])

  async function handleSave() {
    setSaving(true)
    try {
      const credList = Object.entries(creds)
        .filter(([, v]) => v.email && v.password)
        .map(([name, v]) => ({ name, email: v.email, password: v.password }))
      await apiPut('/api/subscriptions/credentials', { sources: credList })
    } catch {}
    setSaving(false)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await apiPost('/api/subscriptions/test')
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, output: err.message })
    }
    setTesting(false)
  }

  if (sources.length === 0) return null

  return (
    <div className="card config-section">
      <h3>Subscription Credentials</h3>
      <p className="config-hint">Encrypted at rest with AES-256-GCM.</p>
      {sources.map(s => (
        <div key={s.name} className="credential-row">
          <span className="credential-name">{s.name}</span>
          <input type="email" placeholder="email@example.com"
            value={creds[s.name]?.email || ''}
            onChange={e => setCreds(prev => ({ ...prev, [s.name]: { ...prev[s.name], email: e.target.value } }))} />
          <input type="password" placeholder={creds[s.name]?.hasSaved ? '••••••••' : 'password'}
            value={creds[s.name]?.password || ''}
            onChange={e => setCreds(prev => ({ ...prev, [s.name]: { ...prev[s.name], password: e.target.value } }))} />
          {s.lastRun && (
            <span className={`credential-status ${s.lastRun.success ? 'success' : 'error'}`}>
              {s.lastRun.success ? '✓' : '✗'}
            </span>
          )}
        </div>
      ))}
      <div className="credential-actions">
        <button className="btn btn-primary btn-md" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save All'}
        </button>
        <button className="btn btn-md" onClick={handleTest} disabled={testing}>
          {testing ? 'Testing...' : 'Test Logins'}
        </button>
      </div>
      {testResult && (
        <pre className="test-output">{testResult.output || (testResult.success ? 'All logins succeeded' : 'Some logins failed')}</pre>
      )}
    </div>
  )
}
```

Add `<SubscriptionCredentials />` to the Config page render.

- [ ] **Step 5: Run tests + build**

Run: `cd web/api && bun test`
Expected: All pass

Run: `cd web/app && bun run build`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/subscriptions.js web/api/tests/subscriptions.test.js web/api/server.js web/app/src/pages/Config.jsx
git commit -m "feat(subscriptions): credential API + Config page UI

GET/PUT /api/subscriptions for source listing and credential management.
POST test/fetch endpoints for login testing and manual trigger.
Config page section for managing subscription credentials."
```

---

## Final Verification

### Task 18: Full test suite + build + visual check

- [ ] **Step 1: Run complete test suite**

Run: `cd web/api && bun test`
Expected: All tests pass (68 existing + ~20 new)

- [ ] **Step 2: Build check**

Run: `cd web/app && bun run build`
Expected: 0 errors, 0 warnings

- [ ] **Step 3: Visual verification checklist**

With both servers running (`bun --watch web/api/server.js` and `cd web/app && bun run dev`):

1. **Dashboard:** Podcast import shows real episode count. Editorial intelligence shows real entry/theme/post counts. EV recommendations card appears if data exists.
2. **Editorial page:** Newsletter tab after Backlog. Draft sub-tabs: Preview first.
3. **Database page:** Manual ingest form works (publication combobox autocompletes). Chat sidebar responds contextually. Archive toggle works for articles and podcasts. Podcast search filters correctly. "Draft in chat" buttons send prompts to sidebar.
4. **Sources page:** Renders without error (may show empty state).
5. **Config page:** Subscription credentials section appears.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final fixes from visual verification"
```
