# Dashboard, Time Ranges, Publishing & Pipeline Learning

**Date:** 2026-03-06
**Branch:** `claude/lucid-sinoussi`
**Phase:** Post-Phase 4 enhancements

## Overview

Five enhancements to the web UI: sidebar reorder, dashboard chart improvements with time range toggles, article date range filtering, published newsletter management, and AI-powered draft-vs-published comparison.

Split into five sections with clear dependencies. No pipeline script modifications.

---

## Section 1: Sidebar Reorder

Swap Sources and Config in `Sidebar.jsx` NAV_ITEMS array so Sources (daily use) appears before Config (occasional use).

**Files modified:** `web/app/src/components/layout/Sidebar.jsx`

---

## Section 2: Dashboard Chart Improvements

### TimeRangeSelector Component

Reusable pill-toggle component with four presets: This week, Last 7d, Last 30d, All time.

**New files:**
- `web/app/src/components/shared/TimeRangeSelector.jsx` — renders pill buttons, takes `{ value, onChange }` props
- `web/app/src/components/shared/TimeRangeSelector.css` — pill styling using `--terra-bg`, `--terra-25` tokens

**Props interface:**
```
value: 'week' | '7d' | '30d' | 'all'
onChange: (key: string) => void
```

### Date Range Helper

**New file:** `web/app/src/lib/dateRange.js`

Exports:
- `getDateRange(preset)` — returns `{ startDate, endDate }` as YYYY-MM-DD strings
  - `'week'`: Monday of current ISO week to today
  - `'7d'`: today minus 6 days (inclusive 7 days)
  - `'30d'`: today minus 29 days
  - `'all'`: `{ startDate: null, endDate: null }`
- `filterByDateEntries(byDate, startDate, endDate)` — filter `{ date: count }` object by range
- `fillCalendarGaps(byDate)` — fill missing calendar days with zero counts, returns sorted `[date, count][]`
- `aggregateToWeeks(entries)` — aggregate daily entries into ISO week buckets `[weekLabel, count][]`

### BarChart Refactor

Replace existing BarChart in `Dashboard.jsx`:
- Accept `range` prop, compute filtered entries via `getDateRange` + `filterByDateEntries`
- Fill calendar gaps with `fillCalendarGaps`
- If >14 bars, aggregate to weekly buckets via `aggregateToWeeks`
- Labels: daily = "Mon 03" format, weekly = "W10" format
- Zero-count bars render with `var(--light-gray)` fill (2px min-height from existing CSS)
- Empty state: "No articles in this period" message

Dashboard gets new `.card-header` flex container with title + TimeRangeSelector side by side.

**Files modified:** `web/app/src/pages/Dashboard.jsx`, `web/app/src/pages/Dashboard.css`

---

## Section 3: Articles Time Range

### walk.js Range Support

Add `dateFrom` and `dateTo` to `walkArticleDir` options. Existing `date` (exact match) takes precedence for backward compatibility.

```js
if (date && d !== date) continue
if (dateFrom && d < dateFrom) continue
if (dateTo && d > dateTo) continue
```

### Articles Route

Pass `dateFrom`/`dateTo` from query params through to `walkArticleDir`. No other changes — `parseQuery` already returns all params.

### useArticles Hook

Add `dateFrom`/`dateTo` to URLSearchParams construction.

### Articles Page

Replace unused `date` state with `range` state. Add TimeRangeSelector to `.filter-bar` between sector dropdown and search input. Default: `'7d'`.

Compound filtering: sector + range + search all work independently. "All time" sends no dateFrom/dateTo (omitted from URLSearchParams).

**Files modified:**
- `web/api/lib/walk.js` — range filter
- `web/api/routes/articles.js` — pass range params
- `web/app/src/hooks/useArticles.js` — add range params
- `web/app/src/pages/Articles.jsx` — TimeRangeSelector, range state

---

## Section 4: Published Newsletter System

### API

**New file:** `web/api/routes/published.js`

Exports:
- `listPublished()` — scan `output/published/` for `.md` files, return list with meta
- `getPublished(week)` — return content + meta + analysis for a specific week
- `savePublished(week, content, meta)` — write `.md` + `-meta.json`, auto-compute metrics

Dual file format:
- `week-N.md` — pipeline-compatible markdown (used by `draft.js:loadPreviousReport()`)
- `week-N-meta.json` — UI metadata: publishedDate, linkedinUrl, wordCount, sectionCount, sections[], savedAt
- `week-N-analysis.json` — optional AI editorial analysis (from /compare-draft)

Section parsing: split by `##` headings, compute per-section word counts.

Validation: week format must match `week-\d+`. Content must be non-empty string.

### Server Routes

Three routes added to `server.js`:
- `GET /api/published` — list all
- `GET /api/published/week-N` — get specific (404 if not found)
- `PUT /api/published/week-N` — save content + meta

### Client

**New file:** `web/app/src/hooks/usePublished.js`

Returns `{ published, loading, saving, error, save }`. 404 treated as null (no published version yet), not error.

**New helper in `api.js`:** `apiPut(path, body)` — PUT with JSON body.

### Draft Page Integration

Toggle button "Published" in Draft toolbar. Opens collapsible PublishedPanel below editor with:
- LinkedIn URL input
- Textarea for pasting newsletter content
- Save button with auto-computed metrics feedback
- Per-section word count display

State is independent from draft state (separate `usePublished` hook).

**Files modified:** `web/app/src/pages/Draft.jsx`, `web/app/src/pages/Draft.css`, `web/app/src/lib/api.js`
**Files added:** `web/api/routes/published.js`, `web/app/src/hooks/usePublished.js`

---

## Section 5: /compare-draft Command

### Trigger

In `DraftChatPanel.jsx`, detect `/compare-draft` prefix. Strip command, pass remaining text as custom instruction (or use default comparison prompt).

### Server Handling

In `chat.js:handleChat`, when message starts with `/compare-draft`:
1. Load most recent published `.md` from `output/published/`
2. Inject as `<published_exemplar>` in system prompt addendum
3. Include instruction to compare structure, tone, section balance, coverage gaps
4. Strip prefix from user message

### Edge Cases

- No published newsletters → AI tells user to save one first
- Empty draft → handled by existing draftContext logic
- Custom instruction → passed through, exemplar still loaded
- Large published file → included in full (typical 3-5K words, within context)

### Optional: Analysis Storage

`saveAnalysis(week, analysis)` in `published.js` writes `week-N-analysis.json`. Called manually, not on every comparison.

**Files modified:** `web/app/src/components/DraftChatPanel.jsx`, `web/api/routes/chat.js`

---

## Test Plan

### Unit Tests

**`web/api/tests/published.test.js`:**
- listPublished: sorted list, empty dir, includes meta
- getPublished: returns content+meta+analysis, null for missing
- savePublished: writes md+json, computes metrics, validates week format
- parseSections: heading parsing, no headings, nested headings

**`web/api/tests/walk.test.js` (extend):**
- walkArticleDir with dateFrom/dateTo range
- Open-ended ranges (only dateFrom, only dateTo)
- date + dateFrom precedence (backward compat)

### Manual Verification

1. Sidebar: Sources before Config
2. Dashboard chart: all four presets, weekly bucketing for >14 days, gap filling
3. Articles: range + sector compound filter, "All time" returns everything
4. Published: toggle, paste, save, metrics display, page reload persistence
5. /compare-draft: with and without published exemplar, custom instruction

### Build

- `cd web/app && bun run build` — 0 errors
- `cd web/api && bun test` — all tests pass

---

## Implementation Order

1. Sidebar reorder (zero dependencies)
2. `dateRange.js` + `TimeRangeSelector` (shared component, parallel with 3)
3. `walk.js` range support + walk tests (API foundation, parallel with 2)
4. Dashboard chart refactor (depends on 2)
5. Articles page integration (depends on 2 + 3)
6. `api.js` apiPut helper (needed by 7)
7. Published API + tests (depends on 6)
8. Published UI in Draft (depends on 7)
9. `/compare-draft` in chat (depends on 7)
10. Build + full test pass

Steps 2-3 parallel. Steps 4-5 parallel. Steps 7-9 sequential.

---

## Files Summary

**Create (6):**
- `web/app/src/components/shared/TimeRangeSelector.jsx`
- `web/app/src/components/shared/TimeRangeSelector.css`
- `web/app/src/lib/dateRange.js`
- `web/api/routes/published.js`
- `web/app/src/hooks/usePublished.js`
- `web/api/tests/published.test.js`

**Modify (14):**
- `web/app/src/components/layout/Sidebar.jsx`
- `web/app/src/pages/Dashboard.jsx`
- `web/app/src/pages/Dashboard.css`
- `web/api/lib/walk.js`
- `web/api/routes/articles.js`
- `web/app/src/hooks/useArticles.js`
- `web/app/src/pages/Articles.jsx`
- `web/app/src/pages/Draft.jsx`
- `web/app/src/pages/Draft.css`
- `web/app/src/lib/api.js`
- `web/api/server.js`
- `web/api/routes/chat.js`
- `web/api/tests/walk.test.js`
- `web/app/src/components/DraftChatPanel.jsx`
