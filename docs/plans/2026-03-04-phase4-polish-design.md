# Phase 4: Polish — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the editorial workbench with article CRUD actions, manual ingest, real-time updates, config management, and UI polish.

**Architecture:** All new code in `web/`. API server (port 3900) gains write endpoints for articles and config. Manual ingest proxies to the existing pipeline ingest server (port 3847). Real-time updates use stat-based polling — no websockets, no fs.watch(). Config writes use a write-validate-swap pattern for safety.

**Tech Stack:** Bun, React, js-yaml (new dependency for config serialisation), existing pipeline ingest server.

---

## 1. Inline Article Actions

### What changes

Each table row in the Articles page gains hover-revealed action controls. By default, the rightmost cell shows the sector badge (non-interactive). On row hover, it transforms into:

- **Sector dropdown** — `<select>` showing current sector. Changing fires PATCH. On success, the article file moves from `data/verified/:date/:oldSector/:slug.json` to `data/verified/:date/:newSector/:slug.json`.
- **Flag toggle** — icon button (outline = unflagged, filled = flagged). Flagging copies the file to `data/review/:date/:sector/:slug.json`. Unflagging removes it from `data/review/`.
- **Delete button** — trash icon. Inline confirmation replaces the row ("Delete this article? Yes / Cancel"). Soft-deletes: moves file to `data/deleted/:date/:sector/:slug.json` with `deleted_at` timestamp added to the JSON.

### API endpoints

```
PATCH /api/articles/:date/:sector/:slug
Body: { sector?, flagged?, score? }
Returns: { article: {...}, moved?: { from, to } }

DELETE /api/articles/:date/:sector/:slug
Returns: { deleted: true, path: "data/deleted/..." }
```

Both use `validateParam()` on all three path segments. Route regex: `([\\w-]+)` for each capture.

### Edge cases

| Scenario | Handling |
|----------|----------|
| Sector move + article is flagged | Update both `data/verified/` and `data/review/` atomically |
| Slug collision on sector move | Return 409: "An article with this name already exists in [sector]" |
| Article already deleted (404) | UI shows "Article no longer exists", removes from table |
| Filesystem error | Return 500: "Failed to update — try again" |
| Flagged tab + unflag action | Article disappears from flagged list on success |

### Soft delete detail

`DELETE` moves the file to `data/deleted/:date/:sector/:slug.json`. Creates directory structure if needed. Adds `deleted_at` ISO timestamp to the JSON before writing. Also removes from `data/review/` if flagged. No UI for browsing deleted articles — recovery is a manual filesystem operation.

---

## 2. Manual Ingest

### How it works

The Articles page header has a disabled "Ingest URL" button (from Phase 1). Phase 4 enables it.

Clicking opens an **inline form** below the header (not a modal):

- **URL input** — text field, paste-friendly width
- **Sector override** — optional dropdown (blank = auto-classify)
- **Submit button** — "Ingest" with loading states: "Scraping..." → "Processing..."
- **Result feedback:**
  - Success: green banner with title + sector + date, auto-dismisses after 5s, reloads article table
  - Error: red banner with error message (fetch failed, content too short, etc.)
  - Duplicate: amber banner with "Already exists" and article title
  - Off-limits warning: amber banner with the off-limits reason (article still saved)

### API endpoint

```
POST /api/articles/ingest
Body: { url, sectorOverride? }
→ Proxies to POST http://localhost:3847/ingest
→ 30s timeout on the proxy call
→ Returns ingest server response verbatim
```

### Ingest server dependency

The existing pipeline ingest server on port 3847 does the full pipeline treatment:
- Fetch + parse HTML (cheerio)
- Extract article text
- Verify date (schema.org, URL patterns, meta tags)
- Classify sector (keyword matching from sectors.yaml)
- Check off-limits list
- Duplicate check
- Save to `data/verified/:date/:sector/:slug.json`

Request body: `{ url, sectorOverride? }`. Response includes: status, title, sector, date_published, date_confidence, date_method, and optional warnings (date_warning, off_limits_warning).

### Health check

Folded into the existing `GET /api/status` response:

```js
// Added to getStatus() response:
ingestServer: { online: true|false }
```

The status endpoint pings `GET http://localhost:3847/health` on each call. The Articles page reads from `useStatus()` (already available via sidebar) to determine if ingest is available. When offline, button shows "Ingest (offline)" and is disabled.

### Score column

Ingested articles skip the scoring pipeline — they have no `score` field. The Articles table shows a "manual" badge in the score column instead of "—".

---

## 3. Real-Time Updates

### Problem

When the pipeline runs overnight and adds articles, or when you manually ingest a URL, the Articles page should reflect changes without a manual browser refresh.

### Approach: stat-based polling

No fs.watch(), no SSE, no websockets. Simple and reliable on macOS.

**Server side:**

```
GET /api/articles/last-updated
Returns: { timestamp: <max mtime across all sector directories> }
```

On each call, stat all sector subdirectories under `data/verified/` (currently ~53 directories). Return the maximum mtime. This is sub-millisecond — no caching needed.

Adding a file at `data/verified/2026-03-01/general/foo.json` changes the mtime of `data/verified/2026-03-01/general/`. The endpoint catches this by scanning all sector dirs, not just the top-level directory.

**Client side:**

- `useArticles` hook polls `/api/articles/last-updated` every 15s
- If the returned timestamp is newer than the last fetch timestamp, auto-reload the article list
- Dashboard `useStatus` already polls every 30s — add a `lastArticleUpdate` field to the status response so the dashboard can show fresh article counts
- Visual indicator below the filter bar: "Updated just now" / "Updated 2m ago"

**Worst case latency:** 15 seconds from file write to UI update. Acceptable.

---

## 4. Article Detail Panel

### Interaction

Click a table row to expand an inline detail panel below it. Click again (or click a different row) to collapse. Only one expanded at a time.

### Content

- **Full text** — plain text, scrollable, max-height 400px
- **Metadata grid:**
  - Source (name)
  - URL (linked, opens in new tab)
  - Date published
  - Date confidence + verification method
  - Scraped at
  - Source type (automated / manual)
  - Score reason (if present)
- **Keywords matched** — pill badges
- **Actions** — same hover-reveal actions as the table row (sector dropdown, flag toggle, delete), plus "View original" link

### API

Already exists: `GET /api/articles/:date/:sector/:slug` returns full article including `full_text` and all metadata. No new endpoint needed.

Does NOT expose `_raw_html` (huge, useless to the user).

---

## 5. Config Editor

### Navigation

New `/config` route. New "Config" link in the sidebar below Co-pilot. Tab navigation within the page: **Off-limits** | **Sources** | **Sectors**.

Off-limits first — it's the most frequently edited.

### 5a. Off-limits tab (`config/off-limits.yaml`)

- **Current week** — editable. Table of entries (company + topic) with remove button per row. "Add entry" form: company + topic fields, adds to current week.
- **Last 2 weeks** — read-only for reference, collapsed by default.
- **Older weeks** — "Show all" expander for full history, read-only.

Week number uses the ISO 8601 calculation from `web/api/lib/week.js` (built in Phase 3).

### 5b. Sources tab (`config/sources.yaml`)

- **RSS feeds** — grouped by category (biopharma, medtech, manufacturing, insurance, cross_sector, ai_labs, tech_press, newsletters, wire_services). Each feed shows name + URL with remove button. "Add feed" form per category: name + URL fields.
- **Search queries** — `general_search_queries` shown as an editable list. Add/remove individual queries.
- **Read-only sections** — `url_date_patterns` and `paywall_domains` displayed but not editable (rarely changed, high risk if wrong).

### 5c. Sectors tab (`config/sectors.yaml`)

- **Per sector** — display_name (editable text), required_any_group_1 (editable keyword list), required_any_group_2 (editable keyword list), boost (editable keyword list).
- **Keyword lists** — each keyword shown as a removable pill. "Add keyword" input at the bottom of each list.
- **No adding/removing entire sectors** — the pipeline hardcodes the five sector keys. Only the keywords and display names within each sector are editable.

### API endpoints

```
GET  /api/config/sectors    → parsed sectors.yaml
PUT  /api/config/sectors    → write-validate-swap, returns updated config
GET  /api/config/sources    → parsed sources.yaml
PUT  /api/config/sources    → write-validate-swap, returns updated config
GET  /api/config/off-limits → parsed off-limits.yaml
PUT  /api/config/off-limits → write-validate-swap, returns updated config
```

### Write safety: write-validate-swap

All three PUT endpoints follow the same pattern:

1. Receive new config object from client
2. Serialize to YAML with `js-yaml`
3. Write to `config/<name>.yaml.tmp`
4. Parse the tmp file back to verify it's valid YAML
5. Run structural validation (see schema below)
6. Copy current file to `config/<name>.yaml.bak`
7. Rename `.tmp` over original
8. Return updated config
9. If any step fails: return 500 with validation error, delete tmp, original untouched

### Structural validation schemas

| Config | Validation rules |
|--------|-----------------|
| sectors.yaml | Root key `sectors`. Each sector key is one of: general, biopharma, medtech, manufacturing, insurance. Each sector has `display_name` (non-empty string), `required_any_group_1` (non-empty array of strings), `required_any_group_2` (non-empty array of strings), `boost` (array of strings). |
| sources.yaml | `rss_feeds` object with known category keys, each value is array of `{url, name}` objects. `general_search_queries` is array of non-empty strings. `url_date_patterns` and `paywall_domains` preserved as-is (not editable). |
| off-limits.yaml | Each key matches `week_\d+`. Each value is array of objects with `company` (string) and `topic` (string). |

### Preview before save

When the user clicks Save, show a confirmation dialog summarising what changed:
- Added items (green)
- Removed items (red)
- Modified items (amber)

User confirms or cancels. Only on confirm does the PUT request fire.

### Dependency

`js-yaml` added to `web/api/package.json`. It's already in the root package.json for pipeline scripts but web/api maintains its own dependencies (isolation constraint).

---

## 6. UI Polish

General pass after all features land. Not designed upfront — driven by use.

- Consistent spacing/padding audit across all pages
- Hover states on all interactive elements
- Keyboard navigation for article table (arrow keys, Enter to expand detail)
- Empty state copy improvements
- Loading skeleton patterns instead of "Loading..." text
- Responsive check (sidebar collapse on narrow viewports)
- Verify all design tokens in use, no hardcoded colours/rgba

---

## 7. Build Order

| Order | Feature | Depends on | Parallelisable |
|-------|---------|-----------|----------------|
| 1 | Inline article actions (PATCH/DELETE + hover-reveal UI) | None | Yes — with 2, 3 |
| 2 | Manual ingest (proxy endpoint + inline form + health check) | None | Yes — with 1, 3 |
| 3 | Real-time updates (stat scan endpoint + polling in useArticles) | None | Yes — with 1, 2 |
| 4 | Article detail panel (expand row + full text + metadata) | After 1 (row interaction patterns) | No |
| 5 | Config editor — off-limits tab + API + write-validate-swap | js-yaml dependency | No |
| 6 | Config editor — sources tab | After 5 (same API patterns) | No |
| 7 | Config editor — sectors tab | After 5 (same API patterns) | Yes — with 6 |
| 8 | Config page routing + sidebar link | After 5-7 | No |
| 9 | UI polish pass | After everything | No |

Tasks 1-3 are fully independent and can be built in parallel.

---

## 8. Files Summary

### New files

```
web/api/routes/config.js          — GET/PUT for all three config files
web/api/lib/config-validator.js   — structural validation per config schema
web/app/src/pages/Config.jsx      — config editor page with tabs
web/app/src/pages/Config.css      — config editor styles
web/app/src/hooks/useConfig.js    — load/save config data
```

### Modified files

```
web/api/server.js                 — add PATCH/DELETE article routes, POST ingest proxy,
                                    GET/PUT config routes, GET last-updated
web/api/routes/articles.js        — add patchArticle, deleteArticle functions
web/api/routes/status.js          — add ingestServer health check to getStatus
web/api/package.json              — add js-yaml dependency
web/app/src/pages/Articles.jsx    — hover-reveal actions, ingest form, detail panel,
                                    real-time polling, "manual" score badge
web/app/src/pages/Articles.css    — action hover styles, detail panel, ingest form
web/app/src/hooks/useArticles.js  — add last-updated polling for auto-refresh
web/app/src/components/layout/Sidebar.jsx — add Config nav link
```

---

## 9. Exclusions

- **No undo for delete** — soft delete to `data/deleted/` is the safety net, no UI for recovery
- **No drag-and-drop** for keyword reordering in config editor
- **No config version history** — `.bak` file is a single-level backup only
- **No real-time updates for config changes** — reload the page to see changes
- **No scoring for manually ingested articles** — shown as "manual" in score column
- **No adding/removing sectors** — only keyword/display_name editing within existing five
- **No editing `url_date_patterns` or `paywall_domains`** — read-only display
