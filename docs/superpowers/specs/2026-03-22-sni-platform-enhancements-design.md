# SNI Platform Enhancements — Design Spec

## Goal

Fix broken data display, enhance the Database page into a full editorial workspace, fix the Sources page, add Exponential View newsletter processing as a curated link feed, and add authenticated subscription content fetching for paywalled sources (FT, Substack).

## Streams

Seven independent work streams, ordered by dependency:

| Stream | Scope | Dependencies |
|--------|-------|-------------|
| A: UI polish | Small | None |
| B: Dashboard data fix | Small | None |
| C: Database enhancements | Medium | None |
| D: Sources fix | Medium | None |
| E: EV newsletter processing | Large | Podcast import pipeline |
| F: Subscription downloads | Large | None (but E benefits from F for paywalled EV links) |
| G: Database "Draft in chat" | Small | C §2 (chat sidebar must exist first) — covered in C §5 |

---

## Stream A: UI Polish

### Tab reorder — Editorial page

Current order: Analysis, Themes, Backlog, Decisions, Activity, Newsletter

New order: Analysis, Themes, Backlog, **Newsletter**, Decisions, Activity

**File:** `web/app/src/pages/Editorial.jsx` — reorder TABS array.

### Sub-tab reorder — Newsletter/Draft panel

Current order: AI Critique, Preview, Review, Links, Chat

New order: **Preview**, AI Critique, Review, Links, Chat

**File:** `web/app/src/pages/Draft.jsx` — reorder `RIGHT_TABS` array (line 16), change default tab to `'preview'`.

### AI Critique layout fix

The critique panel's `panel-content` container doesn't fill available vertical space when content is short. The panel should always stretch to fill the right column, regardless of content length.

**File:** `web/app/src/pages/Draft.css` — ensure `.panel-content` has `min-height: 0` and `flex: 1` within its flex parent so it fills available space. The empty state placeholder should be vertically centred within the full panel height.

---

## Stream B: Dashboard Data Fix

### Podcast Import card shows zeros

The `PodcastStatusCard` receives data from `useStatus()` which calls `GET /api/status`. The status route's `getPodcastImport()` function reads the latest run summary from `output/runs/podcast-import-*.json` and counts manifest entries filtered by the current ISO week.

**Actual data flow:**
1. `Dashboard.jsx` calls `useStatus()` hook
2. Hook calls `GET /api/status`
3. Status route calls `getPodcastImport()` in `web/api/routes/status.js`
4. Returns: `{ lastRun, episodesThisWeek, storiesGapFilled, warnings }`
5. `PodcastStatusCard` destructures `{ lastRun, episodesThisWeek, storiesGapFilled, warnings }`

**Three concrete bugs in `getPodcastImport()` (`web/api/routes/status.js`):**

1. **Missing manifest file:** `manifest.json` does not exist — only `manifest.json.bak` exists. The function checks `existsSync(manifestPath)` for `manifest.json`, which returns false, so `episodesThisWeek` is always 0. **Fix:** Try `manifest.json` first, fall back to `manifest.json.bak`, then fall back to digest file scanner.

2. **Dict, not array:** The manifest is an object keyed by filename (`{ "filename.md": { ... }, ... }`), not an array. The function does `manifest.episodes || manifest || []` then `Array.isArray(episodes)`. Since the manifest is a dict (no `episodes` property), it assigns the dict to `episodes`, the `Array.isArray()` check fails, and `episodesThisWeek` stays 0. **Fix:** Extract entries with `Object.values(manifest)` to get an array of episode objects.

3. **Wrong field name:** The week filter uses `ep.date_published` but manifest entries use the field `date` (e.g., `"date": "2026-03-20"`). The filter always returns false. **Fix:** Change filter to use `ep.date`.

**Files:**
- Modify: `web/api/routes/status.js` — fix all three bugs in `getPodcastImport()`: manifest file fallback, Object.values() extraction, correct field name for date filter

### Editorial Intelligence card shows zeros

The `EditorialSummaryCard` (Dashboard.jsx line 253) calls `useEditorialState()` with no section parameter, which calls `GET /api/editorial/state`. The response shape is `{ counters, corpusStats, rotationCandidates }`.

The component destructures (line 277–280):
```js
const entryCount = data.entries?.length || data.analysisIndex?.entries?.length || 0
const themeCount = data.themes?.length || data.themeRegistry?.themes?.length || 0
const postCount = data.posts?.length || data.postBacklog?.posts?.length || 0
```

**Root cause:** The no-section response returns `counters: { nextSession: 16, nextDocument: 138, nextPost: 92 }` — these are sequence counters (next ID), not counts. There are no `entries`, `themes`, or `posts` arrays at the top level. The fallback `analysisIndex` is also absent from this response. Every destructure path returns `undefined`, so all stats show 0.

**Fix (two-part):**
1. **API handler** (`web/api/routes/editorial.js`, line 123–128): Add computed counts to the no-section response. The handler already reads the full state — compute `Object.keys(state.analysisIndex || {}).length`, `Object.keys(state.themeRegistry || {}).length` (themeRegistry is keyed by theme code like `T01`, `T02` — no `.themes` sub-property), `Object.keys(state.postBacklog || {}).length`.
2. **Dashboard component** (`web/app/src/pages/Dashboard.jsx`, lines 277–280): Replace the broken destructuring with `data.entryCount || 0`, `data.themeCount || 0`, `data.postCount || 0`.

**Updated no-section API response shape:**
```json
{
  "counters": { "nextSession": 16, "nextDocument": 138, "nextPost": 92 },
  "corpusStats": { ... },
  "rotationCandidates": [...],
  "entryCount": 137,
  "themeCount": 26,
  "postCount": 55
}
```

**Files:**
- Modify: `web/api/routes/editorial.js` — add computed counts to no-section response
- Modify: `web/app/src/pages/Dashboard.jsx` — fix `EditorialSummaryCard` to read `data.entryCount`, `data.themeCount`, `data.postCount`

---

## Stream C: Database Page Enhancements

### 1. Enhanced ingest form

Replace the URL-only ingest form with a full manual ingest that saves directly via the API server (port 3900). No ingest server dependency.

**Fields:**
- URL (optional) — text input
- Publication — combobox with autocomplete from existing corpus publications. Fuzzy matching, case-insensitive. Free-type for new publications.
- Sector — dropdown, default "general". Options: general, biopharma, medtech, manufacturing, insurance. Values are lowercase to match corpus conventions.
- Date published (optional) — date input, defaults to today. Used for the file path and `date_published` field.
- Title — text input (required)
- Content — textarea for pasting article text (required)

**API changes:**
- New endpoint: `GET /api/articles/publications` — returns distinct `source` values from the article corpus, sorted alphabetically. Scans `data/verified/` JSON files for unique `source` values. Response: `{ publications: ["Financial Times", "Reuters", ...] }`
- New endpoint: `POST /api/articles/manual` — validates required fields (title, content), generates slug from title (lowercase, hyphens, max 80 chars), writes article JSON to `data/verified/{date_published}/{sector}/{slug}.json` in the standard schema. Date defaults to today if not provided.

**Article JSON schema (matches pipeline output):**
```json
{
  "title": "...",
  "url": "..." or null,
  "source": "Financial Times",
  "source_type": "manual",
  "date_published": "2026-03-22",
  "date_confidence": "high",
  "date_verified_method": "manual",
  "sector": "general",
  "keywords_matched": [],
  "snippet": "first 500 chars of content",
  "full_text": "full pasted content",
  "found_by": ["manual-ingest"],
  "scraped_at": null,
  "ingested_at": "2026-03-22T15:00:00Z",
  "score": null,
  "score_reason": null
}
```

**Note:** Pipeline articles have ~22 fields including schema.org metadata (`@context`, `@type`, `mainEntityOfPage`). Manual ingest articles omit these web-scraping artefacts but include all fields that the article list view and consumers depend on (`score`, `keywords_matched`, `date_verified_method`, `scraped_at`).

**Route wiring:** Add exact-path matches in `web/api/server.js`:
- `path === '/api/articles/publications' && method === 'GET'`
- `path === '/api/articles/manual' && method === 'POST'`

These use exact string matching (same pattern as existing `/api/articles/flagged` and `/api/articles/last-updated` routes), so they are naturally safe before the regex-based parameterised route.

**Existing ingest endpoint:** The current `POST /api/articles/ingest` (proxies to ingest server on port 3847) remains unchanged. The new `POST /api/articles/manual` is a separate endpoint for direct text-paste ingest. The Database page will use `ManualIngestForm` calling `/api/articles/manual`, replacing the old `IngestForm` that called `/api/articles/ingest`. The old endpoint stays wired in server.js for backward compatibility but is no longer referenced by the UI.

**Files:**
- Create: `web/app/src/components/ManualIngestForm.jsx` — the form component with combobox. Accepts `onSuccess` callback prop that Database.jsx uses to refresh the article list after successful ingest. Shows success/error feedback inline.
- Modify: `web/app/src/pages/Database.jsx` — replace `IngestForm` with `ManualIngestForm`, wire `onSuccess` to trigger article list reload
- Modify: `web/api/routes/articles.js` — add `handleGetPublications()` and `handleManualIngest()` handlers
- Modify: `web/api/server.js` — wire new routes before parameterised article routes

### 2. Chat sidebar

Add the same 380px persistent chat panel used on the Editorial page. Per-tab threads (Articles, Podcasts, Flagged). Reuses `EditorialChat` component and `useEditorialChat` hook.

**Context assembly:** Add three new tab types to `buildEditorialContext()` in `web/api/lib/editorial-chat.js`:

- **`articles`** tab context:
  - Section: "Article Corpus (last 7 days)" — list articles from `data/verified/` with title, source, sector, date_published, snippet (truncated to 200 chars). Sort by date descending. Budget: 20k tokens. **Performance:** Filter by date directory names (format `YYYY-MM-DD`) to avoid scanning entire corpus — only read directories within the last 7 days.
  - Section: "Corpus Statistics" — total count, count by sector, count by source.

- **`podcasts`** tab context:
  - Section: "Podcast Digests (this week)" — for each digest: episode title, source, date, summary, story headlines. Read from manifest + digest JSON files. Budget: 20k tokens.
  - Section: "Podcast Statistics" — total episodes, episodes by source, stories extracted count.

- **`flagged`** tab context:
  - Section: "Flagged Articles" — all articles with `flagged: true`, including title, source, sector, snippet, flag reason. Budget: 15k tokens.
  - Section: "Flagged Statistics" — count by sector, count by source.

All follow the existing pattern: markdown-formatted context string with token estimate.

**Layout:** Two-column flex layout matching Editorial page pattern:
```css
.database-columns { display: flex; gap: var(--sp-4); flex: 1; min-height: 0; overflow: hidden; }
.database-content { flex: 1; min-width: 0; overflow-y: auto; }
```

**Files:**
- Modify: `web/app/src/pages/Database.jsx` — wrap content in two-column layout, add EditorialChat with `tabId` mapped to active Database tab
- Modify: `web/app/src/pages/Database.css` — add column layout styles
- Modify: `web/api/lib/editorial-chat.js` — add `articles`, `podcasts`, `flagged` context cases in `buildEditorialContext()`
- Modify: `web/app/src/components/EditorialChat.jsx` — add Database tab labels to TAB_LABELS and SUGGESTIONS maps
- Modify: `web/api/server.js` — no new routes needed (reuses existing `/api/editorial/chat` endpoint at server.js line 283 with tab context)

### 3. Archive functionality

Add `archived: true` flag to article and podcast JSON. Reversible. Uses the existing PATCH pattern for articles.

**Articles — extend existing PATCH endpoint:**
- `PATCH /api/articles/:date/:sector/:slug` already accepts `{ flagged, sector }` in the body. Extend it to also accept `{ archived: true/false }`. When `archived: true`, set the flag in the JSON file. When `archived: false`, remove the flag.
- Database article list filters out archived by default. Add "Show archived" toggle.
- Archived articles shown with reduced opacity, strikethrough title, "archived" badge, and "Restore" button.
- **Note:** The newsletter draft pipeline (in `scripts/`) cannot be modified to skip archived articles. Archiving is a UI-only concept — archived articles are hidden from the Database page display and from the editorial chat context, but remain on disk in their original location. If Scott needs to exclude an article from the pipeline, the existing soft-delete (`DELETE /api/articles/...` which moves to `data/deleted/`) already serves that purpose.

**Podcasts — new PATCH endpoint:**
- New endpoint: `PATCH /api/podcasts/:date/:source/:slug` — accepts `{ archived: true/false }`. The slug maps to a `{slug}.digest.json` file in `data/podcasts/{date}/{source}/`. Reads the digest JSON, sets/removes `archived` flag, writes back using write-validate-swap pattern.
- Same UI pattern as articles.
- **Note on file naming:** Podcast digest files use `.digest.json` suffix and some slugs start with a hyphen (e.g., `-jensens-openclaw-thesis.digest.json`). The route handler must append `.digest.json` to the slug when constructing the file path, and the regex must allow leading hyphens.

**Route wiring:** Add to `web/api/server.js`:
- Podcast PATCH: regex match on `/api/podcasts/(\d{4}-\d{2}-\d{2})/([\w-]+)/([\w-]+)` with method `PATCH`. The handler appends `.digest.json` to the captured slug to find the file. The `([\w-]+)` pattern allows leading hyphens which occur in real digest filenames (e.g., `-jensens-openclaw-thesis`).

**Files:**
- Modify: `web/api/routes/articles.js` — extend `handlePatchArticle()` to accept `archived` field
- Create: `web/api/routes/podcasts.js` — add `handlePatchPodcast()` handler (or extend existing file)
- Modify: `web/api/server.js` — wire podcast PATCH route
- Modify: `web/app/src/pages/Database.jsx` — add archive buttons, show/hide toggle, archived styling

### 4. Podcast keyword search

Add a search input to the Podcasts tab that filters episodes by keyword across title, source, summary, and story headlines.

**Implementation:** Client-side filtering on the already-loaded podcast data. The search input debounces at 300ms and filters the displayed episode list. Uses the existing `useDebouncedValue` hook.

**Files:**
- Modify: `web/app/src/pages/Database.jsx` — add search input to PodcastsTab, filter logic

### 5. "Draft in chat" buttons

Replace all "Open in Draft" (`DraftLink`) usage on Database page with "Draft in chat" buttons that send a prompt to the chat sidebar. Same pattern as Editorial page's `buildDraftPrompt()`.

For articles: prompt includes title, source, sector, snippet.
For podcasts: prompt includes episode title, source, key stories from digest.

**Files:**
- Modify: `web/app/src/pages/Database.jsx` — replace DraftLink with inline draft buttons, add `draftRequest` state, wire to EditorialChat

---

## Stream D: Sources Page Fix

### Phase 1: Get the page rendering

The Sources page uses `useSources()` hook which calls two endpoints:
1. `GET /api/sources/overview` — expects `{ runs: [...], health: {...} }`
2. `GET /api/sources/runs/:date` — expects `{ date, saved, window, queryStats, headlineStats }`

**Likely causes of breakage:**
- `data/last-run-*.json` files missing or in unexpected format (the overview handler scans these)
- `data/source-health.json` missing (the overview handler reads this)
- API route handler errors not caught, returning 500s

**Approach:** Check the API responses, verify data files exist, fix any schema mismatches. Add error boundaries so missing data files return empty results rather than crashing.

**Files:**
- Modify: `web/api/routes/sources.js` — fix data loading, add graceful handling for missing files
- Modify: `web/app/src/pages/Sources.jsx` — fix any rendering issues, handle empty data states

### Phase 2: Analyse query performance

Once the page renders, pull stats from the most recent run:
- Which queries return results vs zeros
- Which hit paywalls
- Which sources have consecutive failures
- Recommend search term changes (remove dead queries, add missing coverage)

**Deliverable:** A written summary of findings and recommended changes, saved to `docs/source-query-analysis.md`. This is a report for Scott to review — the actual `config/sources.yaml` changes are made by Scott manually (config files are read-only per project constraints).

---

## Stream E: EV Newsletter Processing

### Overview

Exponential View newsletters are a curated link feed. After the podcast import pipeline processes an EV newsletter, a separate scheduled script extracts all third-party links, fetches the content, and saves articles to the corpus. Recommends new source domains.

### Trigger mechanism

**Constraint:** Existing scripts in `scripts/` must not be modified. The EV extraction runs as an independent script triggered by its own launchd schedule.

**Approach:** New launchd job `com.sni.ev-extract.plist` runs `scripts/ev-link-extract.js` daily at 07:30 (30 minutes after podcast import's 07:00 schedule). The script:
1. Scans for EV digests using two strategies (in order of preference):
   - Read `data/podcasts/manifest.json` (if it exists) for entries where `source` matches "Exponential View Newsletter" (exact name, case-insensitive). Note: manifest may not exist — only `.bak` may be present. Try `.bak` as fallback. If neither exists, fall through.
   - Scan `data/podcasts/` directories for `.digest.json` files whose source field matches "Exponential View Newsletter" (same fallback scanner pattern used by `web/api/routes/podcasts.js`).
2. Identifies EV **newsletter** entries specifically (not the "Exponential View Podcast" which is a regular audio episode). Uses source name matching, not `isTrustSource` flag (which may be `false` in manifest despite config `trust: true`). The exact source name pattern is configurable in `config/ev-extraction.yaml`.
3. Tracks which EV digests have been processed in `data/editorial/ev-processed.json` (list of digest file paths)
4. Skips already-processed digests
5. For new EV digests, reads the transcript/digest and runs the link extraction pipeline
6. Writes results to `data/editorial/ev-recommendations.json`

This approach requires **no modifications** to the existing podcast import script. The EV extraction script only reads data that podcast import produces.

### Pipeline flow

1. **Check for new EV digests** — scan manifest for entries matching EV source. Compare against `ev-processed.json`. If no new digests, exit early.

2. **Extract links** — parse the transcript text for URLs. Filter using exclusion patterns from `config/ev-extraction.yaml`. Default exclusions:
   - EV's own domains (`exponentialview.co`, `azeemazhar.substack.com`)
   - Social media (`twitter.com`, `x.com`, `linkedin.com`, `facebook.com`, etc.)
   - Podcast players (`apple.com/podcasts`, `spotify.com`, etc.)
   - Non-content URLs (anchor/hash links, mailto links, image URLs)

3. **Fetch and classify** — for each third-party URL:
   - Dedup against existing corpus by URL (scan `data/verified/` for matching URLs)
   - Fetch page, extract text using cheerio (same pattern as existing `fetchAndExtractArticle()` — reimplemented in the new script, not imported from existing scripts)
   - Auto-classify sector using keyword scoring. Load sector keywords from `config/sectors.yaml` (read-only), score each article's text against sector keyword lists, assign highest-scoring sector.
   - Log paywalled articles (FT, WSJ, etc.) — Stream F handles those later

4. **Date filter** — if the linked article's publication date falls within the current editorial week:
   - Save to `data/verified/{date}/{sector}/` with `found_by: ['ev-newsletter']`
   - These are presumed worth publishing
   - Older articles saved to corpus but not flagged as priority

5. **Recommend new source domains** — collect unique domains from extracted links. Compare against existing sources in `config/sources.yaml` (read-only). Write new domains to `data/editorial/ev-recommendations.json`. Dashboard displays recommendations with "Add to sources" / "Dismiss" buttons.

6. **Mark processed** — append the digest filename to `data/editorial/ev-processed.json`

### New files

- `scripts/ev-link-extract.js` — the extraction pipeline script (standalone, runs independently)
- `scripts/lib/ev-parser.js` — link extraction, URL filtering, and article fetching logic
- `config/ev-extraction.yaml` — EV source name pattern, URL exclusion lists
- `com.sni.ev-extract.plist` — launchd job definition (daily at 07:30)
- `data/editorial/ev-processed.json` — tracking file for processed EV digests (created on first run)
- `data/editorial/ev-recommendations.json` — pending domain recommendations (created on first run)

### Config changes

- New: `config/ev-extraction.yaml` — EV-specific extraction config. Contains: EV source name pattern for manifest matching, URL exclusion patterns (social media, podcast players, EV's own domains), domain comparison list path. This avoids modifying any existing config files.
- The EV source is identified by name matching against manifest/digest entries, not by any flag in `config/editorial-sources.yaml`. No changes to existing config files.

### API changes

- New endpoint: `GET /api/editorial/ev-recommendations` — returns pending domain recommendations from `data/editorial/ev-recommendations.json`. Response: `{ domains: [{ domain, linkCount, firstSeen, articles: [{title, url}] }] }`
- New endpoint: `PUT /api/editorial/ev-recommendations/:domain` — accepts `{ action: 'accept' | 'dismiss' }`. Accept writes domain to `data/editorial/sources-pending.json` (staging file — Scott reviews and manually merges approved domains into `config/sources.yaml`). Dismiss removes from recommendations. The pending file is **not** read by any existing pipeline script — it's a human-review queue only.

**Route wiring:** Add to `web/api/server.js`:
- `path === '/api/editorial/ev-recommendations' && method === 'GET'`
- Regex match on `/api/editorial/ev-recommendations/([\w.-]+)` with method `PUT`

### Dashboard changes

- New card or section: "EV Source Recommendations" — shows new domains with link count and add/dismiss buttons

**Files:**
- Modify: `web/app/src/pages/Dashboard.jsx` — add EV recommendations card
- Create: `web/api/routes/ev-recommendations.js` — handler for the two endpoints
- Modify: `web/api/server.js` — wire new routes

---

## Stream F: Subscription Content Downloads

### Overview

Automated browser-based login and content fetching for paywalled sources: Financial Times, Exponential View (Substack), AI Realist (Substack), David Oks (Substack).

### Architecture

**Browser automation:** Playwright (headless Chromium). Handles login, cookie management, page navigation, content extraction. Browser context (cookies, localStorage) persisted to `data/.browser-state/` between runs to minimise re-logins.

**Runtime decision:** Subscription fetch scripts run under **Node.js** (not Bun). Playwright has no official Bun support and its binary management relies on Node.js APIs. Since Node v22.17.1 is available on this machine, subscription scripts use `#!/usr/bin/env node` shebangs. The API server (Bun) triggers them via `Bun.spawn(['node', 'scripts/subscription-fetch.js', ...args])`. Adapter modules use standard ES module syntax compatible with Node.js 22. This is a concrete architectural decision, not a fallback — Playwright scripts always run under Node.

**Credential store:** Encrypted file at `.credentials.enc`. Encryption: AES-256-GCM with random 12-byte IV prepended to ciphertext. Key derived from `SNI_CREDENTIAL_KEY` env var in `.env` using PBKDF2 (100k iterations, SHA-256). File format: first 12 bytes = IV, next 16 bytes = GCM auth tag, remainder = ciphertext. Never committed to git.

**Key bootstrapping:** On first use (no `.credentials.enc` exists), the credential store module generates a random 32-byte hex key via `crypto.randomBytes(32).toString('hex')` and writes it to `.env` as `SNI_CREDENTIAL_KEY=<hex>`. If `.env` already has the key, it is reused. The API server and launchd scripts both read from the same `.env` file. Launchd plist files include `EnvironmentVariables` loading from `.env` (same pattern as existing `ANTHROPIC_API_KEY` usage). If the key is lost, credentials must be re-entered via the Config UI — there is no recovery mechanism (acceptable for single-user system).

**Per-site adapters:** Each source gets its own module with `login()`, `search()` (FT only), `fetchArticle()`, and `checkNewPosts()` (Substack only) methods.

| Source | Path | Method |
|--------|------|--------|
| Financial Times | Search → Fetch | Keyword queries from `config/sources.yaml` (read-only), authenticated fetch |
| Exponential View | RSS → Fetch | Check Substack RSS for new posts, fetch full subscriber content |
| AI Realist | RSS → Fetch | Same as EV |
| David Oks | RSS → Fetch | Same as EV |

### Scheduling

- **FT:** Wednesday mornings alongside existing fetch pipeline. New launchd job: `com.sni.subscription-ft.plist`
- **Substacks:** Daily check for new posts. New launchd job: `com.sni.subscription-substack.plist`
- **Manual trigger:** "Fetch subscriptions" button on Dashboard, triggers via API endpoint

### Credential management UI

New section on Config page: "Subscription Credentials". For each source: email field, password field, saved/unsaved status indicator. "Save All" button encrypts and writes to `.credentials.enc`. "Test Logins" button runs a headless login attempt for each source and reports success/failure.

The UI never displays stored passwords. On load, it shows masked placeholder text for sources that have saved credentials. The "Test Logins" endpoint spawns the subscription-fetch script in test mode (login only, no content fetch).

### New files

- `scripts/subscription-fetch.js` — main script, orchestrates adapters. Accepts `--test` flag for login-only mode, `--source ft|substack` for selective runs.
- `scripts/lib/adapters/ft.js` — FT login, search, fetch
- `scripts/lib/adapters/substack.js` — generic Substack login, RSS check, fetch (parameterised by publication URL)
- `scripts/lib/credential-store.js` — encrypt/decrypt credential file (AES-256-GCM, PBKDF2 key derivation)
- `web/api/routes/subscriptions.js` — credential CRUD and trigger endpoints
- `com.sni.subscription-ft.plist` — launchd job for FT (Wednesday)
- `com.sni.subscription-substack.plist` — launchd job for Substacks (daily)

### Config changes

- New: `config/subscriptions.yaml` — list of subscription sources with URLs, types, and schedule
- Add `.credentials.enc` to `.gitignore` (note: `data/` is already gitignored, so `data/.browser-state/` needs no explicit entry)

### API changes

- `GET /api/subscriptions` — list configured subscriptions with status (last run, last success, errors). Reads from `config/subscriptions.yaml` and `output/runs/subscription-*.json`.
- `PUT /api/subscriptions/credentials` — save encrypted credentials. Body: `{ sources: [{ name, email, password }] }`. Encrypts and writes to `.credentials.enc`.
- `POST /api/subscriptions/test` — test logins. Spawns `scripts/subscription-fetch.js --test` as child process, streams output. Response: `{ results: [{ source, success, error? }] }`
- `POST /api/subscriptions/fetch` — trigger manual fetch. Spawns script as child process. Response: `{ started: true, pid }`. Progress tracked via run summary files.

**Route wiring:** Add to `web/api/server.js`:
- `path === '/api/subscriptions' && method === 'GET'`
- `path === '/api/subscriptions/credentials' && method === 'PUT'`
- `path === '/api/subscriptions/test' && method === 'POST'`
- `path === '/api/subscriptions/fetch' && method === 'POST'`

**Files:**
- Modify: `web/app/src/pages/Config.jsx` — add "Subscription Credentials" section
- Modify: `web/api/server.js` — wire new routes

### Rate limiting

2-second delay between fetches to avoid anti-bot protections. FT search limited to 5 queries per run.

### Failure handling

If login fails: log error, write to run summary, notify via Dashboard. Do not retry with bad credentials (mark source as `login_failed` in run summary). If content extraction fails: log the URL and continue to next article. If browser crashes: clean up browser context, log error, exit gracefully.

---

## Stream G: Database "Draft in Chat"

Covered in Stream C section 5. Replace all `DraftLink` ("Open in Draft") usage on Database page with "Draft in chat" buttons. Same `buildDraftPrompt()` + `draftRequest` state pattern as Editorial page. Depends on Stream C chat sidebar being in place.

---

## Route Wiring Summary

All new API routes must be added to `web/api/server.js` in the `fetch()` handler. The server uses regex matching on `url.pathname` with method checks. New routes grouped by stream:

**Stream C:**
- `GET /api/articles/publications` (before parameterised article routes)
- `POST /api/articles/manual` (before parameterised article routes)
- `PATCH /api/podcasts/:date/:source/:slug` (new regex)

**Stream E:**
- `GET /api/editorial/ev-recommendations`
- `PUT /api/editorial/ev-recommendations/:domain`

**Stream F:**
- `GET /api/subscriptions`
- `PUT /api/subscriptions/credentials`
- `POST /api/subscriptions/test`
- `POST /api/subscriptions/fetch`

---

## Test Strategy

Each stream includes tests alongside implementation:

**Stream A:** Manual visual verification. No automated tests needed (CSS/array reorder).

**Stream B:** Update existing Dashboard-related tests to verify correct data shape handling. Add tests for `getPodcastImport()` with mock manifest data and for Editorial counter destructuring.

**Stream C:**
- `web/api/tests/articles.test.js` — add tests for `GET /api/articles/publications` (returns sorted unique sources), `POST /api/articles/manual` (validates required fields, generates correct file path, writes valid JSON schema), PATCH with `archived` field.
- `web/api/tests/podcasts.test.js` — add tests for `PATCH /api/podcasts/:date/:source/:slug` with archive/restore.
- `web/api/tests/editorial-chat.test.js` — add tests for new context tab types (`articles`, `podcasts`, `flagged`).
- Manual verification for chat sidebar layout and draft-in-chat flow.

**Stream D:** Manual verification that Sources page renders. Test that API returns graceful empty responses when data files missing.

**Stream E:**
- `scripts/tests/ev-parser.test.js` — unit tests for link extraction (URL filtering, domain exclusion, dedup logic).
- `web/api/tests/ev-recommendations.test.js` — API endpoint tests for get/update recommendations.
- Integration test: mock manifest with EV entry, run extraction, verify articles saved to correct paths.

**Stream F:**
- `scripts/tests/credential-store.test.js` — encrypt/decrypt round-trip, key derivation, IV uniqueness.
- `web/api/tests/subscriptions.test.js` — API endpoint tests for CRUD and trigger.
- Adapter tests require live credentials (manual verification only).

---

## Execution Order

1. **A** (UI polish) — quick wins, no dependencies
2. **B** (Dashboard data fix) — bug fix, no dependencies
3. **C** (Database enhancements) — medium scope, includes G
4. **D** (Sources fix) — independent, can parallel with C
5. **E** (EV newsletter processing) — new pipeline script
6. **F** (Subscription downloads) — largest scope, new infrastructure

Streams A+B can run in parallel. C+D can run in parallel. E depends on the podcast import pipeline working (already confirmed). F is independent but E benefits from F being available (for paywalled EV links).

---

## Non-goals

- No changes to existing pipeline scripts in `scripts/` (only adding new scripts)
- No changes to `config/sectors.yaml` or `config/sources.yaml` structure (only reading them)
- No database — all data remains as local JSON files
- No multi-user support — single editor (Scott)
- Config files in `config/` are read-only for existing entries; new config files may be added to `config/`
- New data tracking files may be added to `data/editorial/`
