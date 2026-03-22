# Dashboard, Time Ranges, Publishing & Pipeline Learning — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add time range filtering to Dashboard and Articles, a published newsletter management system, and AI-powered draft-vs-published comparison.

**Architecture:** Five features sharing a reusable TimeRangeSelector component and dateRange utility. Dashboard filtering is client-side (byDate already returned by API). Articles filtering is API-level via walk.js. Published system uses dual-file storage (`.md` + `-meta.json`) in `output/published/`. `/compare-draft` loads published exemplar server-side in chat.js.

**Tech Stack:** Bun 1.3.9, React 18, Vite, CSS custom properties, `bun:test`

**Design doc:** `docs/plans/2026-03-06-dashboard-publishing-design.md`

**Parallelism:** Tasks 2+3 parallel. Tasks 5+6 parallel. Tasks 8→9→10 sequential.

---

### Task 1: Sidebar Reorder

**Files:**
- Modify: `web/app/src/components/layout/Sidebar.jsx:9-10`

**Step 1: Swap Sources and Config in NAV_ITEMS**

In `Sidebar.jsx`, swap lines 9 and 10 so Sources appears before Config:

```jsx
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'grid' },
  { to: '/articles', label: 'Articles', icon: 'list' },
  { to: '/draft', label: 'Draft', icon: 'edit' },
  { to: '/copilot', label: 'Co-pilot', icon: 'chat' },
  { to: '/sources', label: 'Sources', icon: 'layers' },
  { to: '/config', label: 'Config', icon: 'settings' },
]
```

**Step 2: Verify in browser**

Run: `cd web/app && bun run dev`
Check sidebar order: Dashboard, Articles, Draft, Co-pilot, Sources, Config.

**Step 3: Commit**

```bash
git add web/app/src/components/layout/Sidebar.jsx
git commit -m "feat: reorder sidebar — Sources before Config"
```

---

### Task 2: dateRange.js — Write Failing Tests

**Files:**
- Create: `web/app/src/lib/dateRange.js`
- Create: `web/app/src/lib/dateRange.test.js`

**Step 1: Write the failing tests**

Create `web/app/src/lib/dateRange.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks } from './dateRange.js'

// Pin "today" to Wednesday 2026-03-04 for deterministic tests
const REAL_DATE = globalThis.Date
const FAKE_NOW = new Date('2026-03-04T12:00:00Z')

beforeEach(() => {
  globalThis.Date = class extends REAL_DATE {
    constructor(...args) {
      if (args.length === 0) return super(FAKE_NOW.getTime())
      return super(...args)
    }
    static now() { return FAKE_NOW.getTime() }
  }
})

afterEach(() => {
  globalThis.Date = REAL_DATE
})

describe('getDateRange', () => {
  it('week returns Monday of current ISO week to today', () => {
    const { startDate, endDate } = getDateRange('week')
    // 2026-03-04 is Wednesday → Monday is 2026-03-02
    expect(startDate).toBe('2026-03-02')
    expect(endDate).toBe('2026-03-04')
  })

  it('7d returns today minus 6 days to today', () => {
    const { startDate, endDate } = getDateRange('7d')
    expect(startDate).toBe('2026-02-26')
    expect(endDate).toBe('2026-03-04')
  })

  it('30d returns today minus 29 days to today', () => {
    const { startDate, endDate } = getDateRange('30d')
    expect(startDate).toBe('2026-02-03')
    expect(endDate).toBe('2026-03-04')
  })

  it('all returns null bounds', () => {
    const { startDate, endDate } = getDateRange('all')
    expect(startDate).toBeNull()
    expect(endDate).toBeNull()
  })
})

describe('filterByDateEntries', () => {
  const byDate = {
    '2026-02-28': 3,
    '2026-03-01': 5,
    '2026-03-02': 2,
    '2026-03-03': 7,
    '2026-03-04': 1,
  }

  it('filters to range', () => {
    const result = filterByDateEntries(byDate, '2026-03-01', '2026-03-03')
    expect(result).toEqual({ '2026-03-01': 5, '2026-03-02': 2, '2026-03-03': 7 })
  })

  it('null bounds returns everything', () => {
    const result = filterByDateEntries(byDate, null, null)
    expect(result).toEqual(byDate)
  })

  it('null startDate returns up to endDate', () => {
    const result = filterByDateEntries(byDate, null, '2026-03-01')
    expect(result).toEqual({ '2026-02-28': 3, '2026-03-01': 5 })
  })

  it('null endDate returns from startDate onward', () => {
    const result = filterByDateEntries(byDate, '2026-03-03', null)
    expect(result).toEqual({ '2026-03-03': 7, '2026-03-04': 1 })
  })

  it('empty object returns empty', () => {
    expect(filterByDateEntries({}, '2026-03-01', '2026-03-04')).toEqual({})
  })
})

describe('fillCalendarGaps', () => {
  it('fills missing days with zero', () => {
    const result = fillCalendarGaps({ '2026-03-01': 5, '2026-03-04': 2 })
    expect(result).toEqual([
      ['2026-03-01', 5],
      ['2026-03-02', 0],
      ['2026-03-03', 0],
      ['2026-03-04', 2],
    ])
  })

  it('single entry returns single entry', () => {
    const result = fillCalendarGaps({ '2026-03-01': 3 })
    expect(result).toEqual([['2026-03-01', 3]])
  })

  it('empty object returns empty array', () => {
    expect(fillCalendarGaps({})).toEqual([])
  })

  it('already contiguous returns sorted entries', () => {
    const result = fillCalendarGaps({ '2026-03-02': 1, '2026-03-01': 2 })
    expect(result).toEqual([['2026-03-01', 2], ['2026-03-02', 1]])
  })
})

describe('aggregateToWeeks', () => {
  it('aggregates daily entries into ISO week buckets', () => {
    // 2026-03-02 is W10 Monday, 2026-03-09 is W11 Monday
    const entries = [
      ['2026-03-02', 3], // W10
      ['2026-03-03', 2], // W10
      ['2026-03-04', 1], // W10
      ['2026-03-09', 5], // W11
      ['2026-03-10', 4], // W11
    ]
    const result = aggregateToWeeks(entries)
    expect(result).toEqual([
      ['W10', 6],
      ['W11', 9],
    ])
  })

  it('empty input returns empty array', () => {
    expect(aggregateToWeeks([])).toEqual([])
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `bun test web/app/src/lib/dateRange.test.js`
Expected: FAIL — "Cannot find module './dateRange.js'"

**Step 3: Commit failing tests**

```bash
git add web/app/src/lib/dateRange.test.js
git commit -m "test: add failing tests for dateRange utility"
```

---

### Task 2b: dateRange.js — Implement

**Step 4: Write implementation**

Create `web/app/src/lib/dateRange.js`:

```js
/**
 * Date range utilities for time-range filtering.
 * All dates are YYYY-MM-DD strings. Works client-side only.
 */

function fmt(d) {
  return d.toISOString().slice(0, 10)
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function getDateRange(preset) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const endDate = fmt(today)

  switch (preset) {
    case 'week': {
      const day = today.getDay()
      // getDay: 0=Sun, 1=Mon. ISO week starts Monday.
      const diff = day === 0 ? 6 : day - 1
      const monday = addDays(today, -diff)
      return { startDate: fmt(monday), endDate }
    }
    case '7d':
      return { startDate: fmt(addDays(today, -6)), endDate }
    case '30d':
      return { startDate: fmt(addDays(today, -29)), endDate }
    case 'all':
      return { startDate: null, endDate: null }
    default:
      return { startDate: null, endDate: null }
  }
}

export function filterByDateEntries(byDate, startDate, endDate) {
  const result = {}
  for (const [date, count] of Object.entries(byDate)) {
    if (startDate && date < startDate) continue
    if (endDate && date > endDate) continue
    result[date] = count
  }
  return result
}

export function fillCalendarGaps(byDate) {
  const dates = Object.keys(byDate).sort()
  if (dates.length === 0) return []
  if (dates.length === 1) return [[dates[0], byDate[dates[0]]]]

  const result = []
  const start = new Date(dates[0] + 'T00:00:00')
  const end = new Date(dates[dates.length - 1] + 'T00:00:00')

  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = fmt(d)
    result.push([key, byDate[key] || 0])
  }
  return result
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const jan4 = new Date(d.getFullYear(), 0, 4)
  return Math.round(((d - jan4) / 86400000 + jan4.getDay() + 6) / 7)
}

export function aggregateToWeeks(entries) {
  if (entries.length === 0) return []

  const weeks = new Map()
  for (const [date, count] of entries) {
    const w = `W${isoWeek(date)}`
    weeks.set(w, (weeks.get(w) || 0) + count)
  }
  return [...weeks.entries()]
}
```

**Step 5: Run tests to verify they pass**

Run: `bun test web/app/src/lib/dateRange.test.js`
Expected: All 13 tests PASS

**Step 6: Commit**

```bash
git add web/app/src/lib/dateRange.js web/app/src/lib/dateRange.test.js
git commit -m "feat: add dateRange utility with getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks"
```

---

### Task 3: walk.js Range Support — Write Failing Tests

**Files:**
- Modify: `web/api/lib/walk.js:11` (add `dateFrom`/`dateTo` to options destructure)
- Create: `web/api/walk.test.js`

**Step 1: Write the failing tests**

Create `web/api/walk.test.js`. Uses temp directories with fixture article JSON files:

```js
import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join, resolve } from 'path'

// walk.js resolves ROOT as three dirs up from import.meta.dir.
// We can't easily redirect ROOT, so we test via the articles route instead.
// For unit-level testing, we import walkArticleDir and mock the directory structure.

// Strategy: create a temp data/verified structure under the project root,
// run walkArticleDir, then clean up. This tests the real function.

const ROOT = resolve(import.meta.dir, '..')
const VERIFIED = join(ROOT, 'data/verified')

// Create fixture structure:
// data/verified/2026-02-28/general/article-a.json
// data/verified/2026-03-01/general/article-b.json
// data/verified/2026-03-02/biopharma/article-c.json
// data/verified/2026-03-04/general/article-d.json

const FIXTURES = [
  { date: '2026-02-28', sector: 'general', slug: 'article-a', data: { title: 'Article A', url: 'https://a.com', source: 'Test' } },
  { date: '2026-03-01', sector: 'general', slug: 'article-b', data: { title: 'Article B', url: 'https://b.com', source: 'Test' } },
  { date: '2026-03-02', sector: 'biopharma', slug: 'article-c', data: { title: 'Article C', url: 'https://c.com', source: 'Test' } },
  { date: '2026-03-04', sector: 'general', slug: 'article-d', data: { title: 'Article D', url: 'https://d.com', source: 'Test' } },
]

// Track created directories for cleanup
const createdDirs = new Set()

beforeAll(() => {
  for (const f of FIXTURES) {
    const dir = join(VERIFIED, f.date, f.sector)
    mkdirSync(dir, { recursive: true })
    createdDirs.add(join(VERIFIED, f.date))
    writeFileSync(join(dir, `${f.slug}.json`), JSON.stringify(f.data))
  }
})

afterAll(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

// Dynamic import to get fresh module after fixture creation
const { walkArticleDir } = await import('./lib/walk.js')

function collect(opts = {}) {
  const results = []
  walkArticleDir('verified', (raw, meta) => {
    results.push({ title: raw.title, ...meta })
  }, opts)
  return results
}

describe('walkArticleDir date range filtering', () => {
  it('dateFrom filters out earlier dates', () => {
    const results = collect({ dateFrom: '2026-03-01' })
    const dates = results.map(r => r.date)
    expect(dates).not.toContain('2026-02-28')
    expect(dates).toContain('2026-03-01')
    expect(dates).toContain('2026-03-04')
  })

  it('dateTo filters out later dates', () => {
    const results = collect({ dateTo: '2026-03-01' })
    const dates = results.map(r => r.date)
    expect(dates).toContain('2026-02-28')
    expect(dates).toContain('2026-03-01')
    expect(dates).not.toContain('2026-03-04')
  })

  it('dateFrom + dateTo returns only dates in range', () => {
    const results = collect({ dateFrom: '2026-03-01', dateTo: '2026-03-02' })
    const dates = [...new Set(results.map(r => r.date))]
    expect(dates.sort()).toEqual(['2026-03-01', '2026-03-02'])
  })

  it('exact date filter takes precedence over range', () => {
    const results = collect({ date: '2026-03-01', dateFrom: '2026-02-28', dateTo: '2026-03-04' })
    const dates = [...new Set(results.map(r => r.date))]
    expect(dates).toEqual(['2026-03-01'])
  })

  it('open-ended dateFrom returns from that date onward', () => {
    const results = collect({ dateFrom: '2026-03-02' })
    const dates = [...new Set(results.map(r => r.date))].sort()
    expect(dates).toEqual(['2026-03-02', '2026-03-04'])
  })

  it('sector + dateFrom compound filter works', () => {
    const results = collect({ sector: 'general', dateFrom: '2026-03-01' })
    expect(results.length).toBe(2) // article-b (03-01) + article-d (03-04)
    expect(results.every(r => r.sector === 'general')).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd web/api && bun test walk.test.js`
Expected: FAIL — dateFrom/dateTo not yet implemented in walk.js, tests will either pass vacuously (no filtering) or fail on assertions.

Note: The tests check that dateFrom/dateTo actually filter. Without the implementation, `collect({ dateFrom: '2026-03-01' })` will return ALL dates including `2026-02-28`, causing the `not.toContain('2026-02-28')` assertion to fail.

**Step 3: Commit failing tests**

```bash
git add web/api/walk.test.js
git commit -m "test: add failing tests for walk.js dateFrom/dateTo range filtering"
```

---

### Task 3b: walk.js — Implement Range Filtering

**Step 4: Add dateFrom/dateTo to walkArticleDir**

In `web/api/lib/walk.js`, change line 11 to destructure `dateFrom` and `dateTo`, then add range checks after line 21:

Change:
```js
export function walkArticleDir(baseDir, callback, { sector, date } = {}) {
```
To:
```js
export function walkArticleDir(baseDir, callback, { sector, date, dateFrom, dateTo } = {}) {
```

Then after the existing `if (date && d !== date) continue` line (line 21), add:

```js
    if (date && d !== date) continue
    if (dateFrom && d < dateFrom) continue
    if (dateTo && d > dateTo) continue
```

**Step 5: Run tests to verify they pass**

Run: `cd web/api && bun test walk.test.js`
Expected: All 6 tests PASS

**Step 6: Run full API test suite to check no regressions**

Run: `cd web/api && bun test`
Expected: All existing tests still PASS (68+ tests)

**Step 7: Commit**

```bash
git add web/api/lib/walk.js web/api/walk.test.js
git commit -m "feat: add dateFrom/dateTo range filtering to walkArticleDir"
```

---

### Task 4: TimeRangeSelector Component

**Files:**
- Create: `web/app/src/components/shared/TimeRangeSelector.jsx`
- Create: `web/app/src/components/shared/TimeRangeSelector.css`

**Step 1: Create the component**

Create `web/app/src/components/shared/TimeRangeSelector.jsx`:

```jsx
import './TimeRangeSelector.css'

const PRESETS = [
  { key: 'week', label: 'This week' },
  { key: '7d', label: 'Last 7d' },
  { key: '30d', label: 'Last 30d' },
  { key: 'all', label: 'All time' },
]

export default function TimeRangeSelector({ value, onChange }) {
  return (
    <div className="time-range-selector">
      {PRESETS.map(({ key, label }) => (
        <button
          key={key}
          className={`time-pill ${value === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
```

**Step 2: Create the stylesheet**

Create `web/app/src/components/shared/TimeRangeSelector.css`:

```css
.time-range-selector {
  display: flex;
  gap: 4px;
  background: var(--terra-bg);
  border-radius: var(--radius);
  padding: 3px;
}

.time-pill {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: var(--cloudy);
  transition: all 0.15s;
  white-space: nowrap;
}

.time-pill:hover {
  color: var(--text-primary);
  background: var(--terra-25);
}

.time-pill.active {
  background: var(--terra);
  color: white;
}
```

**Step 3: Verify component renders**

Temporarily import into Dashboard.jsx and check it renders. Remove temp import after visual check.

**Step 4: Commit**

```bash
git add web/app/src/components/shared/TimeRangeSelector.jsx web/app/src/components/shared/TimeRangeSelector.css
git commit -m "feat: add TimeRangeSelector pill-toggle component"
```

---

### Task 5: Dashboard Chart Refactor

**Files:**
- Modify: `web/app/src/pages/Dashboard.jsx:1-4,46-57,100-122`
- Modify: `web/app/src/pages/Dashboard.css` (add `.card-header`)

**Step 1: Add imports and range state to Dashboard**

In `Dashboard.jsx`, add imports at the top (after line 1):

```jsx
import { useState } from 'react'
import TimeRangeSelector from '../components/shared/TimeRangeSelector'
import { getDateRange, filterByDateEntries, fillCalendarGaps, aggregateToWeeks } from '../lib/dateRange'
```

Inside the `Dashboard` component, add state after the `useStatus` call (after line 7):

```jsx
const [chartRange, setChartRange] = useState('7d')
```

**Step 2: Replace the chart card with card-header layout**

Replace the chart card section (lines 47–57) with:

```jsx
        <div className="card">
          <div className="card-header">
            <div className="card-title">Articles by date</div>
            <TimeRangeSelector value={chartRange} onChange={setChartRange} />
          </div>
          <BarChart byDate={articles.byDate || {}} range={chartRange} />
          <div className="sector-badges">
            {Object.entries(articles.bySector || {}).map(([sector, count]) => (
              <span key={sector} className="sector-count">
                <SectorBadge sector={sector} /> {count}
              </span>
            ))}
          </div>
        </div>
```

**Step 3: Rewrite the BarChart function**

Replace the entire `BarChart` function (lines 100–122) with:

```jsx
function BarChart({ byDate, range }) {
  const { startDate, endDate } = getDateRange(range)
  const filtered = filterByDateEntries(byDate, startDate, endDate)
  const filled = fillCalendarGaps(filtered)

  if (filled.length === 0) {
    return <div className="bar-chart-empty">No articles in this period</div>
  }

  // Aggregate to weeks if >14 data points
  const entries = filled.length > 14 ? aggregateToWeeks(filled) : filled
  const isWeekly = filled.length > 14
  const max = Math.max(...entries.map(([, n]) => n), 1)

  return (
    <div className="bar-chart">
      {entries.map(([key, count]) => {
        let label
        if (isWeekly) {
          label = key // "W10"
        } else {
          const d = new Date(key + 'T00:00:00')
          const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' })
          const day = String(d.getDate()).padStart(2, '0')
          label = `${weekday} ${day}`
        }
        return (
          <div key={key} className="bar-group">
            <div
              className="bar"
              style={{
                height: `${(count / max) * 70}px`,
                background: count > 0 ? 'var(--terra)' : 'var(--light-gray)',
              }}
              title={`${key}: ${count} articles`}
            />
            <div className="bar-label">{label}</div>
          </div>
        )
      })}
    </div>
  )
}
```

**Step 4: Add card-header and empty state CSS**

In `Dashboard.css`, add after the `.card-title` block (after line 73):

```css
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.card-header .card-title {
  margin-bottom: 0;
}

.bar-chart-empty {
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  color: var(--cloudy);
  text-align: center;
  padding: 24px 0;
}
```

**Step 5: Verify in browser**

Run dev server. Check:
- Time range pills appear next to "Articles by date" title
- "Last 7d" is default, shows 7 bars with day labels ("Mon 03")
- "Last 30d" shows weekly buckets ("W9", "W10") if >14 days of data
- "This week" shows Mon–today
- "All time" shows all data
- Zero-count bars render with light gray fill
- Empty time range shows "No articles in this period"

**Step 6: Commit**

```bash
git add web/app/src/pages/Dashboard.jsx web/app/src/pages/Dashboard.css
git commit -m "feat: dashboard chart with time range selector, gap filling, weekly bucketing"
```

---

### Task 6: Articles Page Time Range Integration

**Files:**
- Modify: `web/api/routes/articles.js:8,34` (pass dateFrom/dateTo)
- Modify: `web/app/src/hooks/useArticles.js` (add dateFrom/dateTo to params)
- Modify: `web/app/src/pages/Articles.jsx:1,15,22,55-61` (add TimeRangeSelector)

**Step 1: Pass dateFrom/dateTo in articles route**

In `web/api/routes/articles.js`, change the `getArticles` function signature (line 8) to accept `dateFrom` and `dateTo`:

Change:
```js
export async function getArticles({ sector, date, search, limit, offset } = {}) {
```
To:
```js
export async function getArticles({ sector, date, dateFrom, dateTo, search, limit, offset } = {}) {
```

Then change the walkArticleDir call (around line 34) to pass them:

Change:
```js
  }, { sector, date })
```
To:
```js
  }, { sector, date, dateFrom, dateTo })
```

**Step 2: Add dateFrom/dateTo to the route handler in server.js**

Find the GET /api/articles handler in `web/api/server.js`. It already passes all query params via `parseQuery`. Verify that `getArticles` receives `dateFrom` and `dateTo` from the query object — it should work automatically since `parseQuery` returns all params and we spread them.

Check: In `server.js`, the articles route calls something like `getArticles(query)` where `query` comes from `parseQuery(url)`. The new `dateFrom`/`dateTo` params will pass through without changes to server.js.

**Step 3: Add dateFrom/dateTo to useArticles hook**

In `web/app/src/hooks/useArticles.js`, add to the URLSearchParams construction:

After the existing `if (filters.date)` line, add:
```js
if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
if (filters.dateTo) params.set('dateTo', filters.dateTo)
```

Add `filters.dateFrom` and `filters.dateTo` to the `useCallback` dependency array.

**Step 4: Add TimeRangeSelector to Articles page**

In `web/app/src/pages/Articles.jsx`:

Add imports (line 1 area):
```jsx
import TimeRangeSelector from '../components/shared/TimeRangeSelector'
import { getDateRange } from '../lib/dateRange'
```

Replace the `date` state (line 15) with range state:
```jsx
const [range, setRange] = useState('7d')
```

Compute dateFrom/dateTo from range and pass to useArticles (replace line 22):
```jsx
const { startDate: dateFrom, endDate: dateTo } = getDateRange(range)
const allResult = useArticles({ sector, dateFrom, dateTo, search: debouncedSearch })
```

Add TimeRangeSelector to the filter bar, between the sector dropdown and search input. In the filter bar JSX (around line 55), insert after the `</select>` and before the `<input`:

```jsx
          <TimeRangeSelector value={range} onChange={setRange} />
```

**Step 5: Verify compound filtering**

Run dev server. Check:
- Default "Last 7d" shows only last week's articles
- Changing sector + range filters together
- "All time" shows all articles
- Search works alongside range filter
- Article counts update correctly

**Step 6: Commit**

```bash
git add web/api/routes/articles.js web/app/src/hooks/useArticles.js web/app/src/pages/Articles.jsx
git commit -m "feat: articles page time range filtering with dateFrom/dateTo API support"
```

---

### Task 7: apiPut Helper

**Files:**
- Modify: `web/app/src/lib/api.js`

**Step 1: Add apiPut**

In `web/app/src/lib/api.js`, add after the `apiPost` function:

```js
export async function apiPut(path, body) {
  return apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

**Step 2: Commit**

```bash
git add web/app/src/lib/api.js
git commit -m "feat: add apiPut helper to api.js"
```

---

### Task 8: Published API — Write Failing Tests

**Files:**
- Create: `web/api/routes/published.js`
- Create: `web/api/published.test.js`
- Modify: `web/api/server.js` (add routes)

**Step 1: Write failing tests**

Create `web/api/published.test.js`:

```js
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '..')
const PUB_DIR = join(ROOT, 'output/published')

// Ensure clean state
beforeEach(() => {
  if (existsSync(PUB_DIR)) rmSync(PUB_DIR, { recursive: true, force: true })
  mkdirSync(PUB_DIR, { recursive: true })
})

afterAll(() => {
  if (existsSync(PUB_DIR)) rmSync(PUB_DIR, { recursive: true, force: true })
})

const { listPublished, getPublished, savePublished } = await import('./routes/published.js')

describe('listPublished', () => {
  it('returns empty array for empty directory', () => {
    const result = listPublished()
    expect(result).toEqual([])
  })

  it('returns sorted list of published newsletters', () => {
    writeFileSync(join(PUB_DIR, 'week-8.md'), '# Week 8')
    writeFileSync(join(PUB_DIR, 'week-8-meta.json'), JSON.stringify({ publishedDate: '2026-02-20', linkedinUrl: '' }))
    writeFileSync(join(PUB_DIR, 'week-10.md'), '# Week 10')
    writeFileSync(join(PUB_DIR, 'week-10-meta.json'), JSON.stringify({ publishedDate: '2026-03-06', linkedinUrl: 'https://linkedin.com/post/123' }))

    const result = listPublished()
    expect(result.length).toBe(2)
    expect(result[0].week).toBe('week-10')
    expect(result[1].week).toBe('week-8')
    expect(result[0].linkedinUrl).toBe('https://linkedin.com/post/123')
  })

  it('includes md files without meta', () => {
    writeFileSync(join(PUB_DIR, 'week-5.md'), '# Week 5')
    const result = listPublished()
    expect(result.length).toBe(1)
    expect(result[0].week).toBe('week-5')
  })
})

describe('getPublished', () => {
  it('returns null for missing week', () => {
    const result = getPublished('week-99')
    expect(result).toBeNull()
  })

  it('returns content and meta for existing week', () => {
    const content = '## Overview\n\nSome newsletter content\n\n## Biopharma\n\nBiopharma news'
    writeFileSync(join(PUB_DIR, 'week-10.md'), content)
    writeFileSync(join(PUB_DIR, 'week-10-meta.json'), JSON.stringify({
      publishedDate: '2026-03-06',
      linkedinUrl: 'https://linkedin.com/post/123',
    }))

    const result = getPublished('week-10')
    expect(result.content).toBe(content)
    expect(result.meta.publishedDate).toBe('2026-03-06')
    expect(result.meta.linkedinUrl).toBe('https://linkedin.com/post/123')
  })

  it('returns content without meta if meta missing', () => {
    writeFileSync(join(PUB_DIR, 'week-7.md'), '# Week 7')
    const result = getPublished('week-7')
    expect(result.content).toBe('# Week 7')
    expect(result.meta).toEqual({})
  })

  it('includes analysis if analysis file exists', () => {
    writeFileSync(join(PUB_DIR, 'week-10.md'), '# Content')
    writeFileSync(join(PUB_DIR, 'week-10-analysis.json'), JSON.stringify({ summary: 'Good structure' }))
    const result = getPublished('week-10')
    expect(result.analysis.summary).toBe('Good structure')
  })
})

describe('savePublished', () => {
  it('writes md and meta files', () => {
    const content = '## Overview\n\nNewsletter text here.\n\n## Biopharma\n\nBiopharma section.'
    savePublished('week-10', content, { linkedinUrl: 'https://linkedin.com/123' })

    expect(existsSync(join(PUB_DIR, 'week-10.md'))).toBe(true)
    expect(existsSync(join(PUB_DIR, 'week-10-meta.json'))).toBe(true)

    const savedContent = readFileSync(join(PUB_DIR, 'week-10.md'), 'utf-8')
    expect(savedContent).toBe(content)

    const meta = JSON.parse(readFileSync(join(PUB_DIR, 'week-10-meta.json'), 'utf-8'))
    expect(meta.linkedinUrl).toBe('https://linkedin.com/123')
    expect(meta.wordCount).toBeGreaterThan(0)
    expect(meta.sectionCount).toBe(2)
    expect(meta.sections.length).toBe(2)
    expect(meta.sections[0].heading).toBe('Overview')
    expect(typeof meta.savedAt).toBe('string')
  })

  it('rejects invalid week format', () => {
    expect(() => savePublished('invalid', 'content', {})).toThrow()
  })

  it('rejects empty content', () => {
    expect(() => savePublished('week-10', '', {})).toThrow()
  })

  it('computes section word counts', () => {
    const content = '## First\n\none two three\n\n## Second\n\nfour five six seven eight'
    savePublished('week-10', content, {})
    const meta = JSON.parse(readFileSync(join(PUB_DIR, 'week-10-meta.json'), 'utf-8'))
    expect(meta.sections[0].heading).toBe('First')
    expect(meta.sections[0].wordCount).toBe(3)
    expect(meta.sections[1].heading).toBe('Second')
    expect(meta.sections[1].wordCount).toBe(5)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd web/api && bun test published.test.js`
Expected: FAIL — "Cannot find module './routes/published.js'"

**Step 3: Commit failing tests**

```bash
git add web/api/published.test.js
git commit -m "test: add failing tests for published newsletter API"
```

---

### Task 8b: Published API — Implement

**Step 4: Create published.js route**

Create `web/api/routes/published.js`:

```js
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const PUB_DIR = join(ROOT, 'output/published')

const WEEK_RE = /^week-\d+$/

function ensureDir() {
  if (!existsSync(PUB_DIR)) mkdirSync(PUB_DIR, { recursive: true })
}

function parseSections(content) {
  const sections = []
  const parts = content.split(/^## /m)
  for (const part of parts) {
    if (!part.trim()) continue
    const lines = part.split('\n')
    const heading = lines[0].trim()
    if (!heading) continue
    const body = lines.slice(1).join('\n').trim()
    const wordCount = body ? body.split(/\s+/).filter(Boolean).length : 0
    sections.push({ heading, wordCount })
  }
  return sections
}

export function listPublished() {
  ensureDir()
  const files = readdirSync(PUB_DIR).filter(f => f.endsWith('.md'))
  const results = []

  for (const f of files) {
    const week = f.replace('.md', '')
    const metaPath = join(PUB_DIR, `${week}-meta.json`)
    let meta = {}
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* skip */ }
    }
    results.push({ week, ...meta })
  }

  // Sort descending by week number
  results.sort((a, b) => {
    const na = parseInt(a.week.replace('week-', ''), 10)
    const nb = parseInt(b.week.replace('week-', ''), 10)
    return nb - na
  })

  return results
}

export function getPublished(week) {
  ensureDir()
  const mdPath = join(PUB_DIR, `${week}.md`)
  if (!existsSync(mdPath)) return null

  const content = readFileSync(mdPath, 'utf-8')
  let meta = {}
  const metaPath = join(PUB_DIR, `${week}-meta.json`)
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* skip */ }
  }

  let analysis = null
  const analysisPath = join(PUB_DIR, `${week}-analysis.json`)
  if (existsSync(analysisPath)) {
    try { analysis = JSON.parse(readFileSync(analysisPath, 'utf-8')) } catch { /* skip */ }
  }

  return { content, meta, analysis }
}

export function savePublished(week, content, meta = {}) {
  if (!WEEK_RE.test(week)) throw new Error(`Invalid week format: ${week}`)
  if (!content || typeof content !== 'string' || !content.trim()) throw new Error('Content must be non-empty string')

  ensureDir()

  const sections = parseSections(content)
  const wordCount = content.split(/\s+/).filter(Boolean).length

  const fullMeta = {
    ...meta,
    wordCount,
    sectionCount: sections.length,
    sections,
    savedAt: new Date().toISOString(),
  }

  writeFileSync(join(PUB_DIR, `${week}.md`), content)
  writeFileSync(join(PUB_DIR, `${week}-meta.json`), JSON.stringify(fullMeta, null, 2))

  return fullMeta
}

export function saveAnalysis(week, analysis) {
  if (!WEEK_RE.test(week)) throw new Error(`Invalid week format: ${week}`)
  ensureDir()
  writeFileSync(join(PUB_DIR, `${week}-analysis.json`), JSON.stringify(analysis, null, 2))
}
```

**Step 5: Run tests to verify they pass**

Run: `cd web/api && bun test published.test.js`
Expected: All 11 tests PASS

**Step 6: Add routes to server.js**

In `web/api/server.js`, add the import at the top with other route imports:

```js
import { listPublished, getPublished, savePublished } from './routes/published.js'
```

Add three routes. Find a suitable location (before the health check route). Add:

```js
      // Published newsletters
      if (pathname === '/api/published' && req.method === 'GET') {
        return Response.json(listPublished())
      }

      const pubMatch = pathname.match(/^\/api\/published\/(week-\d+)$/)
      if (pubMatch) {
        const week = pubMatch[1]
        if (req.method === 'GET') {
          const result = getPublished(week)
          if (!result) return Response.json({ error: 'Not found' }, { status: 404 })
          return Response.json(result)
        }
        if (req.method === 'PUT') {
          const body = await req.json()
          const meta = savePublished(week, body.content, body.meta || {})
          return Response.json({ ok: true, meta })
        }
      }
```

**Step 7: Run full test suite**

Run: `cd web/api && bun test`
Expected: All tests PASS (existing + new published tests)

**Step 8: Commit**

```bash
git add web/api/routes/published.js web/api/published.test.js web/api/server.js
git commit -m "feat: published newsletter API — list, get, save with auto-computed metrics"
```

---

### Task 9: Published UI — usePublished Hook + Draft Panel

**Files:**
- Create: `web/app/src/hooks/usePublished.js`
- Modify: `web/app/src/pages/Draft.jsx`
- Modify: `web/app/src/pages/Draft.css`

**Step 1: Create usePublished hook**

Create `web/app/src/hooks/usePublished.js`:

```jsx
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiPut } from '../lib/api'

export function usePublished(week) {
  const [published, setPublished] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    if (!week) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch(`/api/published/week-${week}`)
      if (mountedRef.current) setPublished(data)
    } catch (err) {
      if (mountedRef.current) {
        // 404 = no published version yet — not an error
        if (err.message.includes('404') || err.message.includes('Not found')) {
          setPublished(null)
        } else {
          setError(err.message)
        }
      }
    }
    if (mountedRef.current) setLoading(false)
  }, [week])

  useEffect(() => { load() }, [load])

  const save = useCallback(async (content, meta = {}) => {
    if (!week) return
    setSaving(true)
    setError(null)
    try {
      const result = await apiPut(`/api/published/week-${week}`, { content, meta })
      if (mountedRef.current) {
        setPublished({ content, meta: result.meta })
        setSaving(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err.message)
        setSaving(false)
      }
    }
  }, [week])

  return { published, loading, saving, error, save, reload: load }
}
```

**Step 2: Add Published toggle and panel to Draft.jsx**

In `web/app/src/pages/Draft.jsx`:

Add import at the top:
```jsx
import { usePublished } from '../hooks/usePublished'
```

Add state and hook inside the Draft component (after existing hook calls):
```jsx
const [showPublished, setShowPublished] = useState(false)
const pub = usePublished(week)
```

Add the toggle button in the toolbar, after the review pill and before the chat toggle:
```jsx
              <button
                className={`draft-published-toggle ${showPublished ? 'active' : ''}`}
                onClick={() => setShowPublished(!showPublished)}
              >
                Published
              </button>
```

Add the PublishedPanel component below the draft footer (before DraftChatPanel):
```jsx
      {showPublished && (
        <PublishedPanel week={week} pub={pub} />
      )}
```

**Step 3: Create PublishedPanel as a local component in Draft.jsx**

Add before the `export default` or at the bottom of Draft.jsx:

```jsx
function PublishedPanel({ week, pub }) {
  const [content, setContent] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [saveMsg, setSaveMsg] = useState(null)

  // Sync from loaded published data
  useEffect(() => {
    if (pub.published) {
      setContent(pub.published.content || '')
      setLinkedinUrl(pub.published.meta?.linkedinUrl || '')
    }
  }, [pub.published])

  async function handleSave() {
    if (!content.trim()) return
    setSaveMsg(null)
    await pub.save(content, { linkedinUrl })
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(null), 3000)
  }

  if (pub.loading) return <div className="published-panel"><div className="placeholder-text">Loading...</div></div>

  return (
    <div className="published-panel">
      <div className="published-header">
        <h3>Published — Week {week}</h3>
        {pub.published?.meta?.wordCount && (
          <span className="published-meta">
            {pub.published.meta.wordCount} words · {pub.published.meta.sectionCount} sections
          </span>
        )}
      </div>

      <label className="published-label">LinkedIn URL</label>
      <input
        type="url"
        className="published-url"
        placeholder="https://linkedin.com/posts/..."
        value={linkedinUrl}
        onChange={e => setLinkedinUrl(e.target.value)}
      />

      <label className="published-label">Newsletter content</label>
      <textarea
        className="published-content"
        placeholder="Paste your published newsletter markdown here..."
        value={content}
        onChange={e => setContent(e.target.value)}
        rows={12}
      />

      {pub.published?.meta?.sections?.length > 0 && (
        <div className="published-sections">
          {pub.published.meta.sections.map((s, i) => (
            <span key={i} className="published-section-badge">
              {s.heading} <small>({s.wordCount}w)</small>
            </span>
          ))}
        </div>
      )}

      <div className="published-actions">
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={pub.saving || !content.trim()}
        >
          {pub.saving ? 'Saving...' : 'Save published'}
        </button>
        {saveMsg && <span className="published-save-msg">{saveMsg}</span>}
        {pub.error && <span className="published-error">{pub.error}</span>}
      </div>
    </div>
  )
}
```

Add `useState` and `useEffect` to the React import at the top of Draft.jsx if not already there.

**Step 4: Add Published panel CSS**

In `web/app/src/pages/Draft.css`, add:

```css
.draft-published-toggle {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  background: transparent;
  color: var(--cloudy);
  cursor: pointer;
  transition: all 0.15s;
}

.draft-published-toggle:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.draft-published-toggle.active {
  background: var(--sage-15);
  border-color: var(--sage);
  color: var(--sage);
}

.published-panel {
  background: var(--card-bg);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-top: 16px;
}

.published-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.published-header h3 {
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.published-meta {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}

.published-label {
  display: block;
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  font-weight: 500;
  color: var(--cloudy);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  margin-top: 12px;
}

.published-url {
  width: 100%;
  padding: 8px 12px;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  background: var(--surface);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  color: var(--text-primary);
}

.published-content {
  width: 100%;
  padding: 12px;
  font-family: 'Lora', serif;
  font-size: 13px;
  line-height: 1.6;
  background: var(--surface);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  color: var(--text-primary);
  resize: vertical;
  min-height: 200px;
}

.published-sections {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.published-section-badge {
  font-family: 'Poppins', sans-serif;
  font-size: 11px;
  padding: 3px 8px;
  background: var(--surface);
  border-radius: var(--radius);
  color: var(--cloudy);
}

.published-section-badge small {
  color: var(--cloudy);
  opacity: 0.7;
}

.published-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.published-save-msg {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--sage);
}

.published-error {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--terra);
}
```

**Step 5: Verify in browser**

Run dev server. Navigate to Draft page. Check:
- "Published" toggle button appears in toolbar
- Clicking toggles a panel below the editor
- Paste content, enter LinkedIn URL, click Save
- Word count and section count appear after save
- Section badges show per-section word counts
- Reload page — saved data persists

**Step 6: Commit**

```bash
git add web/app/src/hooks/usePublished.js web/app/src/pages/Draft.jsx web/app/src/pages/Draft.css web/app/src/lib/api.js
git commit -m "feat: published newsletter UI — toggle panel, paste content, save with metrics"
```

---

### Task 10: /compare-draft Command

**Files:**
- Modify: `web/api/routes/chat.js` (detect /compare-draft, load exemplar)
- Modify: `web/api/lib/context.js` (inject published exemplar in preamble)

**Step 1: Add published exemplar loading to chat.js**

In `web/api/routes/chat.js`, add import at the top:
```js
import { listPublished, getPublished } from './published.js'
```

In the `handleChat` function, BEFORE the `assembleContext` call, add /compare-draft detection:

```js
    // /compare-draft command: load published exemplar
    let publishedExemplar = null
    let userMessage = message
    if (message.startsWith('/compare-draft')) {
      userMessage = message.replace(/^\/compare-draft\s*/, '').trim()
      if (!userMessage) {
        userMessage = 'Compare this draft against the published exemplar. Analyse structure, tone, section balance and coverage gaps.'
      }
      // Load most recent published newsletter
      const published = listPublished()
      if (published.length > 0) {
        const latest = getPublished(published[0].week)
        if (latest?.content) {
          publishedExemplar = latest.content
        }
      }
    }
```

Then pass `publishedExemplar` to `assembleContext`:

Change the `assembleContext` call to include the new parameter:
```js
    const { systemPrompt, preamble, trimmedHistory } = assembleContext({
      week, threadHistory, articleRef, ephemeral: !!ephemeral, draftContext, publishedExemplar,
    })
```

And use `userMessage` instead of `message` when building the SDK messages array (the user content sent to Claude).

**Step 2: Inject exemplar in context.js**

In `web/api/lib/context.js`, update the `assembleContext` function signature to accept `publishedExemplar`:

```js
export function assembleContext({ week, year, threadHistory, articleRef, ephemeral, draftContext, publishedExemplar }) {
```

Then after the existing context block assembly (after the `if (ephemeral && draftContext)` block), add:

```js
    let exemplarBlock = ''
    if (publishedExemplar) {
      exemplarBlock = `\n## Published Exemplar\n\n<published_exemplar>\n${publishedExemplar}\n</published_exemplar>\n\nCompare the current draft against this published exemplar. Analyse structure, tone, section balance and coverage gaps.\n`
    }
```

Then include `exemplarBlock` in the preamble join:
```js
    const preamble = [contextBlock, injectedArticle, pinBlock, exemplarBlock].filter(Boolean).join('\n')
```

**Step 3: Handle edge case — no published newsletters**

If no published newsletters exist, the `publishedExemplar` will be `null` and the exemplar block won't be injected. The AI will receive the user's message without the exemplar context. The user message is already set to a comparison instruction, so the AI should respond explaining that no published exemplar is available.

To make this explicit, add after the published loading block in chat.js:

```js
      if (!publishedExemplar) {
        // No published newsletters — AI will be told there's nothing to compare against
        userMessage = 'The user asked to compare this draft against a published exemplar, but no published newsletters have been saved yet. Let them know they need to save a published newsletter first using the Published panel in the Draft page.'
      }
```

**Step 4: Verify in browser**

Run dev server. Navigate to Draft page, open chat panel. Test:
- Type `/compare-draft` — should compare current draft against most recent published exemplar
- Type `/compare-draft Focus on section balance` — custom instruction with exemplar
- Without any published newsletters, should tell user to save one first

**Step 5: Commit**

```bash
git add web/api/routes/chat.js web/api/lib/context.js
git commit -m "feat: /compare-draft command — compare draft against published exemplar"
```

---

### Task 11: Build + Full Test Pass

**Step 1: Run full API test suite**

Run: `cd web/api && bun test`
Expected: All tests PASS (existing + walk range tests + published tests)

**Step 2: Run dateRange tests**

Run: `bun test web/app/src/lib/dateRange.test.js`
Expected: All 13 tests PASS

**Step 3: Run production build**

Run: `cd web/app && bun run build`
Expected: 0 errors, 0 warnings (minor warnings acceptable)

**Step 4: Manual verification checklist**

- [ ] Sidebar: Sources before Config
- [ ] Dashboard: all four time range presets work
- [ ] Dashboard: "Mon 03" day labels for daily view
- [ ] Dashboard: weekly bucketing ("W10") for >14 days
- [ ] Dashboard: zero-count bars render light gray
- [ ] Dashboard: "No articles in this period" for empty ranges
- [ ] Articles: time range selector in filter bar
- [ ] Articles: range + sector compound filter
- [ ] Articles: "All time" returns everything
- [ ] Published: toggle button in Draft toolbar
- [ ] Published: paste content, LinkedIn URL, save
- [ ] Published: word count + section count displayed
- [ ] Published: section badges with per-section word counts
- [ ] Published: data persists across page reload
- [ ] /compare-draft: returns comparison with published exemplar
- [ ] /compare-draft: custom instruction works
- [ ] /compare-draft: graceful message when no published newsletters exist

**Step 5: Commit any final fixes, then tag**

```bash
git add -A
git commit -m "chore: build verification — all tests pass, clean build"
```

---

## Files Summary

**Create (7):**
- `web/app/src/components/shared/TimeRangeSelector.jsx`
- `web/app/src/components/shared/TimeRangeSelector.css`
- `web/app/src/lib/dateRange.js`
- `web/app/src/lib/dateRange.test.js`
- `web/api/routes/published.js`
- `web/app/src/hooks/usePublished.js`
- `web/api/published.test.js`

**Modify (12):**
- `web/app/src/components/layout/Sidebar.jsx`
- `web/app/src/pages/Dashboard.jsx`
- `web/app/src/pages/Dashboard.css`
- `web/api/lib/walk.js`
- `web/api/walk.test.js` (create — no existing tests)
- `web/api/routes/articles.js`
- `web/app/src/hooks/useArticles.js`
- `web/app/src/pages/Articles.jsx`
- `web/app/src/lib/api.js`
- `web/api/server.js`
- `web/app/src/pages/Draft.jsx`
- `web/app/src/pages/Draft.css`
- `web/api/routes/chat.js`
- `web/api/lib/context.js`
