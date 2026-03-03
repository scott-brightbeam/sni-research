# Web UI — Phase 1: Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship a working Dashboard and Articles page backed by a Bun API server that reads the pipeline's file-based data.

**Architecture:** Bun HTTP server (`web/api/server.js`, port 3900) serves `/api/*` routes that read from `data/`, `output/`, `config/`, and `logs/`. Vite + React SPA (`web/app/`) provides the UI. Both live in `web/` on a `feature/web-ui` branch. The existing pipeline and ingest server (port 3847) are never modified.

**Tech Stack:** Bun, React 18, Vite, React Router, date-fns

**Design reference:** `web/mockup.html` — dark mode, Claude-inspired. All CSS variables and component patterns come from this file.

---

## Task 1: Create branch and scaffold

### Step 1: Create feature branch

```bash
cd /Users/scott/Projects/sni-research-v2
git checkout -b feature/web-ui
```

### Step 2: Scaffold Vite + React app

```bash
cd /Users/scott/Projects/sni-research-v2
mkdir -p web/app web/api
cd web/app
bun create vite . --template react
```

When prompted, overwrite existing files if asked.

### Step 3: Install app dependencies

```bash
cd /Users/scott/Projects/sni-research-v2/web/app
bun add react-router-dom react-markdown
```

### Step 4: Create web/api/package.json

Create: `web/api/package.json`

```json
{
  "name": "sni-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun --watch server.js",
    "start": "bun server.js",
    "test": "bun test"
  },
  "dependencies": {
    "date-fns": "^3.6.0",
    "js-yaml": "^4.1.0"
  }
}
```

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun install
```

### Step 5: Create web/package.json (workspace root)

Create: `web/package.json`

```json
{
  "name": "sni-web",
  "private": true,
  "scripts": {
    "dev": "cd app && bun run dev",
    "api": "cd api && bun run dev",
    "build": "cd app && bun run build"
  }
}
```

### Step 6: Update .claude/launch.json

Modify: `/Users/scott/Projects/sni-research-v2/.claude/launch.json`

Add the new API server configuration alongside the existing ingest-server:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "ingest-server",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["scripts/server.js"],
      "port": 3847
    },
    {
      "name": "web-api",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["--watch", "web/api/server.js"],
      "port": 3900
    }
  ]
}
```

### Step 7: Commit

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/ .claude/launch.json
git commit -m "scaffold web UI: Vite React app + API server skeleton"
```

---

## Task 2: API server with /api/status

### Step 1: Write the test

Create: `web/api/status.test.js`

```javascript
import { describe, it, expect } from 'bun:test'
import { getStatus } from './routes/status.js'

describe('getStatus', () => {
  it('returns an object with lastRun, articles, and nextPipeline', async () => {
    const result = await getStatus()
    expect(result).toHaveProperty('lastRun')
    expect(result).toHaveProperty('articles')
    expect(result).toHaveProperty('nextPipeline')
  })

  it('lastRun contains mode and stages array', async () => {
    const { lastRun } = await getStatus()
    // lastRun may be null if no runs exist
    if (lastRun) {
      expect(lastRun).toHaveProperty('mode')
      expect(lastRun).toHaveProperty('stages')
      expect(Array.isArray(lastRun.stages)).toBe(true)
    }
  })

  it('articles contains today and byDate counts', async () => {
    const { articles } = await getStatus()
    expect(typeof articles.today).toBe('number')
    expect(typeof articles.total).toBe('number')
    expect(typeof articles.byDate).toBe('object')
  })
})
```

### Step 2: Run test to verify it fails

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun test status.test.js
```

Expected: FAIL — `Cannot find module './routes/status.js'`

### Step 3: Write routes/status.js

Create: `web/api/routes/status.js`

This reads from the project root. Paths are resolved relative to the project root, not web/api/.

```javascript
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getStatus() {
  return {
    lastRun: getLastRun(),
    articles: getArticleCounts(),
    nextPipeline: getNextPipeline(),
    errors: getRecentErrors()
  }
}

function getLastRun() {
  const runsDir = join(ROOT, 'output/runs')
  if (!existsSync(runsDir)) return null

  const files = readdirSync(runsDir)
    .filter(f => f.startsWith('pipeline-') && f.endsWith('.json'))
    .sort()
    .reverse()

  if (files.length === 0) return null

  try {
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    return {
      runId: data.runId,
      mode: data.mode,
      weekNumber: data.weekNumber,
      year: data.year,
      dateWindow: data.dateWindow,
      stages: (data.stages || []).map(s => ({
        name: s.name,
        status: s.status,
        duration: s.duration,
        stats: s.stats || {},
        errors: s.errors || []
      })),
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      totalDuration: data.totalDuration
    }
  } catch {
    return null
  }
}

function getArticleCounts() {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { today: 0, total: 0, byDate: {}, bySector: {} }

  const byDate = {}
  const bySector = {}
  let total = 0

  const dates = readdirSync(verifiedDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))

  for (const date of dates) {
    const datePath = join(verifiedDir, date)
    if (!statSync(datePath).isDirectory()) continue

    let dateCount = 0
    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const sector of sectors) {
      const sectorPath = join(datePath, sector)
      const articles = readdirSync(sectorPath).filter(f => f.endsWith('.json'))
      dateCount += articles.length
      bySector[sector] = (bySector[sector] || 0) + articles.length
    }

    byDate[date] = dateCount
    total += dateCount
  }

  const today = new Date().toISOString().split('T')[0]

  return {
    today: byDate[today] || 0,
    total,
    byDate,
    bySector
  }
}

function getNextPipeline() {
  // Friday at 05:30 is the full pipeline run
  const now = new Date()
  const day = now.getDay() // 0=Sun, 5=Fri
  let daysUntilFriday = (5 - day + 7) % 7
  if (daysUntilFriday === 0) {
    // It's Friday — check if pipeline already ran today
    const hour = now.getHours()
    if (hour >= 6) daysUntilFriday = 7 // Already ran, next Friday
  }

  const nextFriday = new Date(now)
  nextFriday.setDate(now.getDate() + daysUntilFriday)
  nextFriday.setHours(5, 30, 0, 0)

  // Next daily fetch at 04:00 tomorrow
  const nextDaily = new Date(now)
  nextDaily.setDate(now.getDate() + 1)
  nextDaily.setHours(4, 0, 0, 0)

  return {
    nextFriday: nextFriday.toISOString(),
    nextDaily: nextDaily.toISOString()
  }
}

function getRecentErrors() {
  const logPaths = [
    join(ROOT, 'logs/fetch-error.log'),
    join(ROOT, 'logs/pipeline-error.log')
  ]

  const errors = []
  for (const p of logPaths) {
    if (!existsSync(p)) continue
    try {
      const content = readFileSync(p, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean).slice(-10)
      errors.push(...lines)
    } catch { /* ignore */ }
  }
  return errors.slice(-20)
}
```

### Step 4: Run test to verify it passes

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun test status.test.js
```

Expected: 3 tests PASS

### Step 5: Commit

```bash
git add web/api/routes/status.js web/api/status.test.js
git commit -m "feat(api): /api/status endpoint — pipeline health and article counts"
```

---

## Task 3: API server with /api/articles

### Step 1: Write the test

Create: `web/api/articles.test.js`

```javascript
import { describe, it, expect } from 'bun:test'
import { getArticles, getArticle } from './routes/articles.js'

describe('getArticles', () => {
  it('returns an array of articles', async () => {
    const result = await getArticles({})
    expect(Array.isArray(result.articles)).toBe(true)
  })

  it('articles have required fields', async () => {
    const { articles } = await getArticles({})
    if (articles.length > 0) {
      const a = articles[0]
      expect(a).toHaveProperty('title')
      expect(a).toHaveProperty('url')
      expect(a).toHaveProperty('sector')
      expect(a).toHaveProperty('date_published')
      expect(a).toHaveProperty('slug')
    }
  })

  it('filters by sector', async () => {
    const { articles } = await getArticles({ sector: 'general' })
    for (const a of articles) {
      expect(a.sector).toBe('general')
    }
  })

  it('filters by date', async () => {
    const { articles } = await getArticles({ date: '2026-03-02' })
    for (const a of articles) {
      expect(a.date_published).toBe('2026-03-02')
    }
  })
})

describe('getArticle', () => {
  it('returns null for non-existent article', async () => {
    const result = await getArticle('9999-01-01', 'general', 'nonexistent')
    expect(result).toBeNull()
  })
})
```

### Step 2: Run test to verify it fails

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun test articles.test.js
```

Expected: FAIL — `Cannot find module './routes/articles.js'`

### Step 3: Write routes/articles.js

Create: `web/api/routes/articles.js`

```javascript
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export async function getArticles({ sector, date, week, search } = {}) {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return { articles: [], total: 0 }

  const articles = []
  const dates = readdirSync(verifiedDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  for (const d of dates) {
    if (date && d !== date) continue

    const datePath = join(verifiedDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      if (sector && s !== sector) continue

      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          const slug = basename(f, '.json')

          const article = {
            slug,
            title: raw.title,
            url: raw.url,
            source: raw.source,
            sector: raw.sector || s,
            date_published: raw.date_published || d,
            date_confidence: raw.date_confidence,
            date_verified_method: raw.date_verified_method,
            snippet: raw.snippet || (raw.full_text || '').slice(0, 300),
            score: raw.score ?? null,
            keywords_matched: raw.keywords_matched || [],
            scraped_at: raw.scraped_at,
            source_type: raw.source_type
          }

          if (search) {
            const hay = `${article.title} ${article.source} ${article.snippet}`.toLowerCase()
            if (!hay.includes(search.toLowerCase())) continue
          }

          articles.push(article)
        } catch { /* skip malformed files */ }
      }
    }
  }

  return { articles, total: articles.length }
}

export async function getArticle(date, sector, slug) {
  const filePath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)
  if (!existsSync(filePath)) return null

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
    return {
      slug,
      ...raw,
      // Include full_text for detail view
      full_text: raw.full_text || ''
    }
  } catch {
    return null
  }
}

export async function getFlaggedArticles() {
  const reviewDir = join(ROOT, 'data/review')
  if (!existsSync(reviewDir)) return { articles: [], total: 0 }

  const articles = []
  const dates = readdirSync(reviewDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  for (const d of dates) {
    const datePath = join(reviewDir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          const slug = basename(f, '.json')

          // Check for reason file
          const reasonPath = join(sectorPath, `${slug}-reason.txt`)
          const reason = existsSync(reasonPath)
            ? readFileSync(reasonPath, 'utf-8').trim()
            : null

          articles.push({
            slug,
            title: raw.title,
            url: raw.url,
            source: raw.source,
            sector: raw.sector || s,
            date_published: raw.date_published || d,
            score: raw.score ?? null,
            reason,
            flagged: true
          })
        } catch { /* skip */ }
      }
    }
  }

  return { articles, total: articles.length }
}
```

### Step 4: Run test to verify it passes

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun test articles.test.js
```

Expected: All tests PASS

### Step 5: Commit

```bash
git add web/api/routes/articles.js web/api/articles.test.js
git commit -m "feat(api): /api/articles endpoint — list, filter, detail, flagged"
```

---

## Task 4: API server — HTTP layer

### Step 1: Write the server

Create: `web/api/server.js`

```javascript
import { getStatus } from './routes/status.js'
import { getArticles, getArticle, getFlaggedArticles } from './routes/articles.js'

const PORT = 3900

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  })
}

function parseQuery(url) {
  const params = new URL(url).searchParams
  const obj = {}
  for (const [k, v] of params) obj[k] = v
  return obj
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      // --- Status ---
      if (path === '/api/status' && req.method === 'GET') {
        return json(await getStatus())
      }

      // --- Articles ---
      if (path === '/api/articles' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getArticles(query))
      }

      if (path === '/api/articles/flagged' && req.method === 'GET') {
        return json(await getFlaggedArticles())
      }

      // Single article: /api/articles/:date/:sector/:slug
      const articleMatch = path.match(/^\/api\/articles\/(\d{4}-\d{2}-\d{2})\/([^/]+)\/([^/]+)$/)
      if (articleMatch && req.method === 'GET') {
        const [, date, sector, slug] = articleMatch
        const article = await getArticle(date, sector, slug)
        if (!article) return json({ error: 'Not found' }, 404)
        return json(article)
      }

      // --- Health ---
      if (path === '/api/health') {
        return json({ status: 'ok', port: PORT })
      }

      // --- 404 ---
      return json({ error: 'Not found' }, 404)

    } catch (err) {
      console.error('API error:', err)
      return json({ error: err.message }, 500)
    }
  }
})

console.log(`SNI API server listening on http://localhost:${PORT}`)
```

### Step 2: Test it manually

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun server.js &
sleep 1
curl -s http://localhost:3900/api/health | head
curl -s http://localhost:3900/api/status | head -c 200
curl -s 'http://localhost:3900/api/articles?sector=general' | head -c 200
kill %1
```

Expected: JSON responses for each endpoint.

### Step 3: Commit

```bash
git add web/api/server.js
git commit -m "feat(api): HTTP server on port 3900 — status, articles, health"
```

---

## Task 5: React app — design tokens and layout shell

### Step 1: Clean Vite scaffold

Remove default Vite boilerplate:

- Delete: `web/app/src/App.css`
- Delete: `web/app/src/index.css`
- Delete: `web/app/src/assets/react.svg`
- Delete: `web/app/public/vite.svg`

### Step 2: Create design tokens

Create: `web/app/src/styles/tokens.css`

Copy the CSS variables from `web/mockup.html` `:root` block — the full dark mode palette:

```css
:root {
  --terra: #D4714E;
  --terra-light: #e08a6a;
  --terra-dark: #c15f3c;
  --pampas: #1a1816;
  --white: #242220;
  --cloudy: #8a8778;
  --dark: #e8e6dc;
  --light-gray: rgba(255, 255, 255, 0.08);
  --sage: #6FA584;
  --blue: #7CADD6;
  --brown: #A08B6D;
  --purple: #ADA0D0;
  --shadow-subtle: 0 0.25rem 1.25rem rgba(0, 0, 0, 0.2);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.3);
  --radius: 8px;
  --radius-lg: 12px;
  --surface: #2c2a27;
  --surface-hover: #353330;
  --sidebar-bg: #1e1c1a;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Lora', Georgia, serif;
  background: var(--pampas);
  color: var(--dark);
}

h1, h2, h3, h4, h5, h6, button, input, select, textarea, .label {
  font-family: 'Poppins', Arial, sans-serif;
}

::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
```

### Step 3: Create index.html with Google Fonts

Modify: `web/app/index.html`

Replace the default Vite index.html. Keep it minimal — just add the Google Fonts link in `<head>`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SNI Research</title>
    <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

### Step 4: Create API helper

Create: `web/app/src/lib/api.js`

```javascript
const API_BASE = 'http://localhost:3900'

export async function apiFetch(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API ${res.status}`)
  }
  return res.json()
}
```

### Step 5: Create format helpers

Create: `web/app/src/lib/format.js`

```javascript
export const SECTOR_COLOURS = {
  general: { color: 'var(--terra)', bg: 'rgba(212, 113, 78, 0.15)' },
  biopharma: { color: 'var(--sage)', bg: 'rgba(111, 165, 132, 0.15)' },
  medtech: { color: 'var(--blue)', bg: 'rgba(124, 173, 214, 0.15)' },
  manufacturing: { color: 'var(--brown)', bg: 'rgba(160, 139, 109, 0.15)' },
  insurance: { color: 'var(--purple)', bg: 'rgba(173, 160, 208, 0.15)' },
}

export const SECTOR_LABELS = {
  general: 'General',
  biopharma: 'Biopharma',
  medtech: 'MedTech',
  manufacturing: 'Mfg',
  insurance: 'Insurance',
}

export function formatDuration(ms) {
  if (!ms) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

export function formatRelativeTime(isoString) {
  if (!isoString) return '—'
  const diff = Date.now() - new Date(isoString).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}
```

### Step 6: Create Sidebar component

Create: `web/app/src/components/layout/Sidebar.jsx`

```jsx
import { NavLink } from 'react-router-dom'
import './Sidebar.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'grid' },
  { to: '/articles', label: 'Articles', icon: 'list' },
  { to: '/draft', label: 'Draft', icon: 'edit' },
  { to: '/copilot', label: 'Co-pilot', icon: 'chat' },
]

const ICONS = {
  grid: <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  list: <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>,
  edit: <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>,
  chat: <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
}

export default function Sidebar({ status }) {
  return (
    <nav className="sidebar">
      <div className="sidebar-logo">
        <h1>SNI Research</h1>
        <span>Editorial workbench</span>
      </div>

      <div className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{ICONS[icon]}</span>
            {label}
          </NavLink>
        ))}
      </div>

      <div className="sidebar-status">
        <span className="status-dot" />
        <span className="status-text">
          {status
            ? `Pipeline healthy \u00B7 ${status}`
            : 'Checking...'
          }
        </span>
      </div>
    </nav>
  )
}
```

### Step 7: Create Sidebar CSS

Create: `web/app/src/components/layout/Sidebar.css`

```css
.sidebar {
  width: 260px;
  min-width: 260px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--light-gray);
  display: flex;
  flex-direction: column;
  padding: 24px 0;
  height: 100vh;
}

.sidebar-logo {
  padding: 0 24px 24px;
  border-bottom: 1px solid var(--light-gray);
  margin-bottom: 16px;
}

.sidebar-logo h1 {
  font-size: 20px;
  font-weight: 700;
  color: var(--dark);
  letter-spacing: -0.3px;
}

.sidebar-logo span {
  font-family: 'Lora', serif;
  font-size: 12px;
  color: var(--cloudy);
  display: block;
  margin-top: 2px;
}

.sidebar-nav { flex: 1; }

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 24px;
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 500;
  color: var(--cloudy);
  cursor: pointer;
  transition: all 0.15s;
  border-left: 3px solid transparent;
  text-decoration: none;
}

.nav-item:hover { color: var(--dark); background: rgba(255, 255, 255, 0.04); }
.nav-item.active {
  color: var(--terra);
  background: rgba(212, 113, 78, 0.1);
  border-left-color: var(--terra);
}

.nav-icon {
  width: 20px;
  height: 20px;
  display: flex;
}

.nav-icon svg {
  width: 20px;
  height: 20px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.sidebar-status {
  margin-top: auto;
  padding: 16px 24px;
  border-top: 1px solid var(--light-gray);
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--sage);
  flex-shrink: 0;
}

.status-text {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}
```

### Step 8: Create Shell layout

Create: `web/app/src/components/layout/Shell.jsx`

```jsx
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import './Shell.css'

export default function Shell({ statusText }) {
  return (
    <div className="shell">
      <Sidebar status={statusText} />
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
```

Create: `web/app/src/components/layout/Shell.css`

```css
.shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.main {
  flex: 1;
  overflow-y: auto;
  padding: 32px 40px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 28px;
}

.page-header h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--dark);
}
```

### Step 9: Create SectorBadge shared component

Create: `web/app/src/components/shared/SectorBadge.jsx`

```jsx
import { SECTOR_COLOURS, SECTOR_LABELS } from '../../lib/format'

export default function SectorBadge({ sector }) {
  const { color, bg } = SECTOR_COLOURS[sector] || SECTOR_COLOURS.general
  const label = SECTOR_LABELS[sector] || sector

  return (
    <span
      className="badge"
      style={{ background: bg, color, display: 'inline-block', fontSize: 11, fontFamily: "'Poppins', sans-serif", fontWeight: 600, padding: '2px 10px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: 0.3 }}
    >
      {label}
    </span>
  )
}
```

### Step 10: Commit

```bash
git add web/app/
git commit -m "feat(ui): layout shell, sidebar, design tokens, shared components"
```

---

## Task 6: React app — hooks and Dashboard page

### Step 1: Create useStatus hook

Create: `web/app/src/hooks/useStatus.js`

```javascript
import { useState, useEffect } from 'react'
import { apiFetch } from '../lib/api'

export function useStatus(pollInterval = 30000) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const data = await apiFetch('/api/status')
        if (mounted) {
          setStatus(data)
          setLoading(false)
        }
      } catch (err) {
        if (mounted) {
          setError(err.message)
          setLoading(false)
        }
      }
    }

    load()
    const id = setInterval(load, pollInterval)
    return () => { mounted = false; clearInterval(id) }
  }, [pollInterval])

  return { status, loading, error }
}
```

### Step 2: Create useArticles hook

Create: `web/app/src/hooks/useArticles.js`

```javascript
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useArticles(filters = {}) {
  const [articles, setArticles] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [filters.sector, filters.date, filters.search])

  useEffect(() => { load() }, [load])

  return { articles, total, loading, error, reload: load }
}
```

### Step 3: Create Dashboard page

Create: `web/app/src/pages/Dashboard.jsx`

```jsx
import { useStatus } from '../hooks/useStatus'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDuration, formatRelativeTime } from '../lib/format'
import './Dashboard.css'

export default function Dashboard() {
  const { status, loading } = useStatus()

  if (loading) return <div className="loading">Loading...</div>
  if (!status) return <div className="empty">No data available</div>

  const { lastRun, articles, nextPipeline } = status

  return (
    <div>
      <div className="page-header">
        <h2>Dashboard</h2>
      </div>

      <div className="dashboard-grid">
        <StatCard
          label="Articles today"
          value={articles.today}
          detail={`${articles.total} total across all dates`}
        />
        <StatCard
          label="Sectors"
          value={Object.keys(articles.bySector || {}).length}
          detail={Object.entries(articles.bySector || {}).map(([s, n]) => `${s}: ${n}`).join(' \u00B7 ')}
        />
        <StatCard
          label="Next pipeline"
          value={nextPipeline ? formatNextRun(nextPipeline.nextFriday) : '—'}
          detail="Full friday run"
          smallValue
        />
      </div>

      <div className="dashboard-panels">
        <div className="card">
          <div className="card-title">Articles by date</div>
          <BarChart byDate={articles.byDate || {}} />
          <div className="sector-badges">
            {Object.entries(articles.bySector || {}).map(([sector, count]) => (
              <span key={sector} className="sector-count">
                <SectorBadge sector={sector} /> {count}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Last pipeline run</div>
          {lastRun ? (
            <>
              <div className="stages">
                {lastRun.stages.map(stage => (
                  <div key={stage.name} className={`stage-row ${stage.status === 'success' ? '' : 'pending'}`}>
                    <div className={`stage-icon ${stage.status === 'success' ? 'ok' : 'off'}`}>
                      {stage.status === 'success' ? '\u2713' : '\u00B7'}
                    </div>
                    <div className="stage-name">{stage.name}</div>
                    <div className="stage-stat">
                      {summariseStageStats(stage)}
                    </div>
                    <div className="stage-time">{formatDuration(stage.duration)}</div>
                  </div>
                ))}
              </div>
              <div className="run-footer">
                {lastRun.mode} mode \u00B7 completed {formatRelativeTime(lastRun.completedAt)} \u00B7 {formatDuration(lastRun.totalDuration)} total
              </div>
            </>
          ) : (
            <div className="empty">No runs found</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, detail, smallValue }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${smallValue ? 'small' : ''}`}>{value}</div>
      <div className="stat-detail">{detail}</div>
    </div>
  )
}

function BarChart({ byDate }) {
  const entries = Object.entries(byDate).sort().slice(-7)
  const max = Math.max(...entries.map(([, n]) => n), 1)

  return (
    <div className="bar-chart">
      {entries.map(([date, count]) => {
        const d = new Date(date + 'T00:00:00')
        const label = d.toLocaleDateString('en-GB', { weekday: 'short' })
        return (
          <div key={date} className="bar-group">
            <div
              className="bar"
              style={{ height: `${(count / max) * 70}px`, background: 'var(--terra)' }}
              title={`${date}: ${count} articles`}
            />
            <div className="bar-label">{label}</div>
          </div>
        )
      })}
    </div>
  )
}

function formatNextRun(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { weekday: 'short' }) + ' ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function summariseStageStats(stage) {
  const s = stage.stats
  if (!s || Object.keys(s).length === 0) {
    return stage.status === 'success' ? 'done' : 'friday only'
  }
  if (s.saved !== undefined) return `${s.saved} saved`
  if (s.kept !== undefined) return `${s.kept} kept, ${s.moved || 0} flagged`
  return 'done'
}
```

### Step 4: Create Dashboard CSS

Create: `web/app/src/pages/Dashboard.css`

```css
.loading, .empty {
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  color: var(--cloudy);
  padding: 40px 0;
  text-align: center;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  box-shadow: var(--shadow-subtle);
  border: 1px solid var(--light-gray);
}

.stat-label {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-family: 'Poppins', sans-serif;
  font-size: 32px;
  font-weight: 700;
  color: var(--dark);
  margin: 4px 0;
}

.stat-value.small {
  font-size: 22px;
  margin-top: 8px;
}

.stat-detail {
  font-size: 13px;
  color: var(--cloudy);
}

.dashboard-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.card {
  background: var(--surface);
  border-radius: var(--radius-lg);
  padding: 24px;
  box-shadow: var(--shadow-subtle);
  border: 1px solid var(--light-gray);
}

.card-title {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 16px;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 80px;
  margin-top: 12px;
}

.bar-group {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.bar {
  width: 100%;
  border-radius: 4px 4px 0 0;
  transition: height 0.3s;
  min-height: 2px;
}

.bar-label {
  font-family: 'Poppins', sans-serif;
  font-size: 10px;
  color: var(--cloudy);
}

.sector-badges {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.sector-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}

.stages {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stage-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: var(--radius);
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
}

.stage-row.pending { opacity: 0.4; }

.stage-icon {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: white;
  flex-shrink: 0;
}

.stage-icon.ok { background: var(--sage); }
.stage-icon.off { background: var(--cloudy); }

.stage-name { font-weight: 500; color: var(--dark); flex: 1; }
.stage-stat { color: var(--cloudy); font-size: 12px; }
.stage-time { color: var(--cloudy); font-size: 12px; min-width: 50px; text-align: right; }

.run-footer {
  margin-top: 12px;
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}
```

### Step 5: Commit

```bash
git add web/app/src/
git commit -m "feat(ui): Dashboard page with pipeline status, article stats, bar chart"
```

---

## Task 7: React app — Articles page

### Step 1: Create Articles page

Create: `web/app/src/pages/Articles.jsx`

```jsx
import { useState } from 'react'
import { useArticles } from '../hooks/useArticles'
import SectorBadge from '../components/shared/SectorBadge'
import { formatDate } from '../lib/format'
import './Articles.css'

const SECTORS = ['', 'general', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export default function Articles() {
  const [sector, setSector] = useState('')
  const [date, setDate] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('all')

  const { articles, total, loading } = useArticles(
    tab === 'all' ? { sector, date, search } : {}
  )

  return (
    <div>
      <div className="page-header">
        <h2>Articles</h2>
        <button className="btn btn-primary">+ Ingest URL</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          All articles <span className="tab-count">({total})</span>
        </button>
        <button className={`tab ${tab === 'flagged' ? 'active' : ''}`} onClick={() => setTab('flagged')}>
          Flagged
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
            style={{ flex: 1 }}
          />
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="loading" style={{ padding: 40 }}>Loading...</div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Sector</th>
                  <th>Date</th>
                  <th>Score</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {articles.map(a => (
                  <tr key={`${a.date_published}-${a.sector}-${a.slug}`}>
                    <td>
                      <div className="article-title">{a.title}</div>
                      <div className="article-source">{a.source}</div>
                    </td>
                    <td><SectorBadge sector={a.sector} /></td>
                    <td className="cell-meta">{formatDate(a.date_published)}</td>
                    <td>
                      <span className={`score ${scoreClass(a.score)}`}>
                        {a.score ?? '—'}
                      </span>
                    </td>
                    <td className="cell-meta cell-confidence">
                      {a.date_confidence || '—'}
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--cloudy)' }}>
                      No articles found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function scoreClass(score) {
  if (score == null) return ''
  if (score >= 8) return 'high'
  if (score >= 6) return 'medium'
  return 'low'
}
```

### Step 2: Create Articles CSS

Create: `web/app/src/pages/Articles.css`

```css
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--light-gray);
}

.tab {
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

.tab:hover { color: var(--dark); }
.tab.active { color: var(--terra); border-bottom-color: var(--terra); }
.tab-count { color: var(--cloudy); }

.filter-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  align-items: center;
}

.filter-bar select,
.filter-bar input {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  padding: 8px 14px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--dark);
  outline: none;
}

.filter-bar select:focus,
.filter-bar input:focus {
  border-color: var(--terra);
  box-shadow: 0 0 0 2px rgba(212, 113, 78, 0.2);
}

.table-wrapper { overflow-x: auto; }

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 600;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid var(--light-gray);
}

td {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  vertical-align: middle;
}

tr:hover td { background: var(--surface-hover); }

.article-title {
  font-weight: 500;
  color: var(--dark);
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.article-source {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}

.cell-meta {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  color: var(--cloudy);
}

.cell-confidence { font-size: 12px; }

.score {
  font-family: 'Poppins', sans-serif;
  font-weight: 600;
  font-size: 14px;
}

.score.high { color: var(--sage); }
.score.medium { color: var(--terra-light); }
.score.low { color: var(--cloudy); }

.btn {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: var(--radius);
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-primary { background: var(--terra); color: white; }
.btn-primary:hover { background: var(--terra-dark); }
```

### Step 3: Commit

```bash
git add web/app/src/pages/Articles.jsx web/app/src/pages/Articles.css
git commit -m "feat(ui): Articles page with table, sector badges, filters, search"
```

---

## Task 8: Wire it all together — App router and main entry

### Step 1: Create placeholder pages for Draft and Copilot

Create: `web/app/src/pages/Draft.jsx`

```jsx
export default function Draft() {
  return (
    <div>
      <div className="page-header"><h2>Draft</h2></div>
      <div className="card">
        <div className="card-title">Coming in Phase 2</div>
        <p style={{ color: 'var(--cloudy)' }}>
          Side-by-side markdown editor with rendered preview, review overlays, and link verification.
        </p>
      </div>
    </div>
  )
}
```

Create: `web/app/src/pages/Copilot.jsx`

```jsx
export default function Copilot() {
  return (
    <div>
      <div className="page-header"><h2>Co-pilot</h2></div>
      <div className="card">
        <div className="card-title">Coming in Phase 3</div>
        <p style={{ color: 'var(--cloudy)' }}>
          Chat interface with Claude. See this week's articles, suggest themes, pin editorial notes for the Friday draft.
        </p>
      </div>
    </div>
  )
}
```

### Step 2: Create App.jsx with router

Overwrite: `web/app/src/App.jsx`

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Shell from './components/layout/Shell'
import Dashboard from './pages/Dashboard'
import Articles from './pages/Articles'
import Draft from './pages/Draft'
import Copilot from './pages/Copilot'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/draft" element={<Draft />} />
          <Route path="/copilot" element={<Copilot />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
```

### Step 3: Create main.jsx entry point

Overwrite: `web/app/src/main.jsx`

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
```

### Step 4: Configure Vite proxy for API

Modify: `web/app/vite.config.js`

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3900'
    }
  }
})
```

With the proxy in place, update the API base URL to use relative paths.

Modify: `web/app/src/lib/api.js`

```javascript
export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API ${res.status}`)
  }
  return res.json()
}
```

### Step 5: Commit

```bash
git add web/app/
git commit -m "feat(ui): wire App router, Vite proxy, placeholder pages for Draft and Co-pilot"
```

---

## Task 9: Verify Phase 1

### Step 1: Run API tests

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun test
```

Expected: All tests pass.

### Step 2: Start API server

```bash
cd /Users/scott/Projects/sni-research-v2/web/api
bun server.js &
```

### Step 3: Start Vite dev server

```bash
cd /Users/scott/Projects/sni-research-v2/web/app
bun run dev
```

### Step 4: Verify in browser

Open `http://localhost:5173`:

1. **Dashboard** — should show article counts, bar chart by date, pipeline stages from last run
2. **Articles** — should list real articles from `data/verified/`, sector badges, scores, search works
3. **Draft** — placeholder card
4. **Co-pilot** — placeholder card
5. **Sidebar** — navigation works, active state highlights

### Step 5: Verify pipeline isolation

```bash
cd /Users/scott/Projects/sni-research-v2
bun scripts/pipeline.js --mode daily --dry-run
curl http://localhost:3847/health
```

Both should work unaffected.

### Step 6: Final commit and push

```bash
cd /Users/scott/Projects/sni-research-v2
git add -A
git commit -m "phase 1 complete: Dashboard + Articles with live data"
git push -u origin feature/web-ui
```

---

## Summary

| Task | What it builds | Files created |
|------|---------------|---------------|
| 1 | Branch + scaffolding | web/app/*, web/api/package.json, web/package.json |
| 2 | /api/status | web/api/routes/status.js, status.test.js |
| 3 | /api/articles | web/api/routes/articles.js, articles.test.js |
| 4 | HTTP server | web/api/server.js |
| 5 | Design tokens + layout | tokens.css, Shell, Sidebar, SectorBadge |
| 6 | Dashboard page | Dashboard.jsx, useStatus, useArticles hooks |
| 7 | Articles page | Articles.jsx with filters, table, badges |
| 8 | Router wiring | App.jsx, main.jsx, vite.config.js, placeholders |
| 9 | Verification | Manual testing, pipeline isolation check |
