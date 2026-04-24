# Phase Status

Updated after each phase. Records what's built, what was deferred, and where reality differs from spec.

---

## Phase 1: Foundation ✅ Complete

**Branch:** `feature/web-ui` (10 commits, pushed to origin)

### What was built

**API server (`web/api/`):**
- `server.js` — Bun.serve on port 3900, regex routing, CORS restricted to localhost:5173
- `routes/articles.js` — getArticles (with pagination), getArticle (with param validation), getFlaggedArticles
- `routes/status.js` — getStatus (article counts, last run, next pipeline, recent errors)
- `lib/walk.js` — shared `walkArticleDir()` + `validateParam()` for path traversal prevention
- `package.json` — zero runtime dependencies (date-fns and js-yaml removed as unused)
- `tests/` — 8 tests, 162 assertions

**React app (`web/app/`):**
- `App.jsx` — BrowserRouter with Shell layout wrapping 4 routes: /, /articles, /draft, /copilot
- `pages/Dashboard.jsx` — pipeline status, article counts, sector bar chart, stage progress, error handling
- `pages/Articles.jsx` — article table, sector/date filters, debounced search, flagged tab, disabled ingest button
- `pages/Draft.jsx` — placeholder (Phase 2)
- `pages/Copilot.jsx` — placeholder (Phase 3)
- `components/layout/Shell.jsx` — layout shell, useStatus for sidebar status text
- `components/layout/Sidebar.jsx` — nav links, pipeline status indicator, aria-hidden SVGs
- `hooks/useStatus.js` — polls /api/status every 30s, returns { status, loading, error }
- `hooks/useArticles.js` — fetches /api/articles with filters, returns { articles, total, loading, error, reload }
- `hooks/useFlaggedArticles.js` — fetches /api/articles/flagged
- `hooks/useDebouncedValue.js` — generic debounce (300ms default)
- `lib/api.js` — fetch wrapper with error handling
- `lib/format.js` — SECTOR_COLOURS, SECTOR_LABELS, formatDuration, formatRelativeTime, formatDate
- `styles/tokens.css` — full dark-mode design system (31 tokens)

**Verified:**
- 8/8 API tests pass (162 assertions)
- Vite build succeeds (0 errors, 59 modules)
- Path traversal blocked (404 on encoded traversal)
- CORS restricted to localhost:5173
- Pagination works (limit/offset with total count)
- Pipeline isolation confirmed (dry run succeeds)

### Code review fixes applied (commit 10)

All 15 findings from final code review addressed:
- Critical: path traversal prevention (regex + validateParam)
- Security: CORS restricted, route regex hardened
- Architecture: shared walk utility, pagination, dedicated flagged endpoint
- UI: sidebar status live, dashboard error state, search debounce, disabled ingest button
- Cleanup: 3 unused deps removed, 7 new design tokens, all hardcoded rgba eliminated, inline styles removed, aria-hidden on SVGs, pre-4am pipeline schedule bug fixed

### Deviations from spec

1. **Components are inline, not extracted.** The spec (Section 5) originally called for separate files: ArticleTable, ArticleRow, ArticleDetail, ArticleFilters, SectorBadge, etc. In practice, pages are self-contained — components live inline. Extract only when complexity demands it.

2. **No shared DataTable, DatePicker, LoadingSpinner, EmptyState.** The spec listed reusable shared components. Not needed yet — pages handle their own loading/empty states with CSS classes (`.loading`, `.empty`, `.placeholder-text`).

3. **SectorBadge is inline in format.js.** Not a separate component file. The `SECTOR_COLOURS` object + a few lines of JSX in Articles.jsx handles it.

4. **No Header component.** The spec listed a Header with week selector. The sidebar handles navigation. A week selector will be added when Phase 2 needs it.

### Deferred to Phase 4

- Article detail panel (click-to-expand with full text, metadata)
- Article actions (PATCH sector, flag/unflag, DELETE)
- Manual ingest form (POST /api/articles/ingest)
- Config viewer endpoints

---

## Phase 2: Draft Editor ✅ Complete

### Design & Plan
- Design doc: `docs/plans/2026-03-03-draft-editor-design.md`
- Implementation plan: `docs/plans/2026-03-03-draft-editor-plan.md`
- Execution method: subagent-driven-development (same session)

### Completed tasks
1. ✅ **react-markdown installed** (v10.1.0) — `web/app/package.json`
2. ✅ **getDraft route** — `web/api/routes/draft.js` + 8 tests
3. ✅ **saveDraft route** — added to draft.js + 4 tests (12 total)
4. ✅ **getDraftHistory route** — added to draft.js + 2 tests (14 total)
5. ✅ **Routes wired into server.js** — import, 3 route handlers (GET/PUT draft, GET history), err.status passthrough in catch
6. ✅ **useDraft hook** — `web/app/src/hooks/useDraft.js` — load/save/goToWeek/dirty tracking
7. ✅ **Draft page rewrite** — `Draft.jsx` + `Draft.css` — side-by-side editor + react-markdown preview, link badges (✓/✗), review highlight overlays, week nav, save button, word count footer

8. ✅ **Full verification** — 22 tests pass (195 assertions), Vite build clean (222 modules), pipeline isolation confirmed
9. ✅ **Context files updated**

### Verified
- 22/22 API tests pass (195 assertions across 3 test files)
- Vite build succeeds (222 modules, 0 errors)
- Pipeline isolation confirmed (dry run succeeds)
- Draft routes: GET /api/draft, PUT /api/draft, GET /api/draft/history
- err.status passthrough in server.js catch block

### Key decisions
| Decision | Choice |
|----------|--------|
| Editor component | Plain textarea |
| Markdown renderer | react-markdown (~50KB) |
| Review flags | Inline markers in preview (highlighted with tooltip) |
| Link badges | Icon after each link (✓/✗ with hover tooltip) |
| API approach | Single bundled endpoint (GET returns everything, PUT returns full bundle) |
| Eval scores | Placeholder panel ("No data" until pipeline generates evaluate-week-N.json) |

### Key data files
- `output/draft-week-N.md` — the markdown draft
- `output/review-week-N.json` — review results
- `output/evaluate-week-N.json` — evaluation scores
- `output/links-week-N.json` — link verification

---

## Phase 3: Co-pilot ✅ Complete

### Design & Plan
- Design doc: `docs/plans/2026-03-04-copilot-design.md` (12 sections, approved)
- Implementation plan: `docs/plans/2026-03-04-copilot-plan.md` (16 tasks with exact code)
- Execution method: executing-plans skill, batched with checkpoint reviews

### What was built

**API (`web/api/`):**
- `lib/env.js` — `loadEnvKey()` copy (pipeline isolation)
- `lib/week.js` — ISO 8601 week calculation (fixes naive `getWeekNumber` bug)
- `lib/pricing.js` — MODEL_PRICING, estimateCost, formatCost, formatTokens
- `lib/claude.js` — Anthropic SDK lazy singleton client
- `lib/context.js` — tiered context assembly (articles + pins + history, two system prompts, 28k token budget)
- `routes/chat.js` — SSE streaming, thread CRUD, pin CRUD, usage tracking
- 9 route handlers wired into `server.js`
- `week.test.js` — 8 tests, `context.test.js` — 7 tests, `chat.test.js` — 11 tests

**React app (`web/app/src/`):**
- `lib/api.js` — added `apiStream()` SSE helper
- `hooks/useChat.js` — full chat hook (threads, SSE streaming, pins, usage, abort)
- `hooks/useChatPanel.js` — ephemeral hook for draft panel (accepts `week` param)
- `pages/Copilot.jsx` + `Copilot.css` — thread sidebar, message list, article picker, model toggle, usage display, week nav
- `components/DraftChatPanel.jsx` + `DraftChatPanel.css` — slide-out panel for draft page
- `pages/Draft.jsx` + `Draft.css` — chat panel toggle button + DraftChatPanel integration

### Verified
- 48/48 API tests pass (246 assertions across 6 test files)
- Vite build succeeds (227 modules, 0 errors)
- Pipeline isolation confirmed (no scripts/ or config/ files modified)

### Key decisions
| Decision | Choice |
|----------|--------|
| Architecture | Shared `POST /api/chat` endpoint with `ephemeral` flag — DRY |
| Context assembly | Tiered: all titles + full snippets for top ~30 by score, 28k token budget |
| Threads | Multiple named per week (not one conversation per week) |
| Draft panel | Ephemeral slide-out from Draft page, draft markdown as context |
| Model toggle | Per-message everywhere — Sonnet (default) / Opus |
| Models | `claude-sonnet-4-20250514`, `claude-opus-4-6` |
| Token/cost counting | Per-message usage, per-thread totals, daily ceiling (500k), pricing lib |
| Article injection | Explicit article picker in chat UI, not magic detection |
| Thread naming | Auto-name from first message, renamable |
| Pin format | Markdown + YAML frontmatter (pipeline-readable for future `draft.js` integration) |
| Cross-boundary fix | `useChatPanel` accepts `week` as param instead of importing API module |

### Key data directories
- `data/copilot/chats/week-N/` — `threads.json` index + `thread-*.jsonl` messages
- `data/copilot/pins/week-N/` — `pins.json` index + `pin-*.md` files

### Deferred to Phase 4
- Ad hoc materials upload
- Pin integration into `draft.js` pipeline script
- Thread deletion

---

## Phase 4: Polish ✅ Complete

### Design & Plan
- Design doc: `docs/plans/2026-03-04-phase4-polish-design.md` (9 sections, approved)
- Implementation plan: `docs/plans/2026-03-04-phase4-polish-plan.md` (8 tasks with exact code)
- Execution method: subagent-driven-development (same session)

### Completed tasks
1. ✅ **Inline article actions — API** — PATCH/DELETE `/api/articles/:date/:sector/:slug` (sector move, flag/unflag, soft delete to `data/deleted/`)
2. ✅ **Manual ingest — API proxy** — POST `/api/articles/ingest` proxies to pipeline ingest server (port 3847), 30s timeout, ingest health check in status endpoint
3. ✅ **Real-time updates** — GET `/api/articles/last-updated` (stat-based mtime), client polls every 15s, "Updated just now" indicator
4. ✅ **Inline article actions — React UI** — hover-reveal actions, sector dropdown, flag toggle, delete with confirmation, detail panel (click-to-expand), ingest form with colour-coded banners
5. ✅ **Config editor — API + write-validate-swap** — GET/PUT `/api/config/:name`, structural validation, `.tmp` → parse → validate → `.bak` → rename, js-yaml dependency
6. ✅ **Config editor — React page** — Three tabs (Off-limits, Sources, Sectors), `useConfig` hook, inline editing, keyword pills, read-only sections
7. ✅ **UI polish pass** — rgba() token compliance, hover/transition states, focus rings, inline style extraction, 3 new tokens
8. ✅ **Context files updated**

### Verified
- 68/68 API tests pass (279 assertions across 7 test files)
- Vite build succeeds (230 modules, 0 errors)
- Pipeline isolation confirmed (dry run succeeds)

### What was built

**API (`web/api/`):**
- `routes/articles.js` — added patchArticle, deleteArticle, ingestArticle, getLastUpdated
- `routes/config.js` — getConfig, putConfig with write-validate-swap pattern
- `routes/status.js` — added ingest health check
- `lib/walk.js` — added moveArticle, deleteArticle helpers
- `config.test.js` — 20 tests for config read/write/validation
- `server.js` — 5 new route handlers wired

**React app (`web/app/src/`):**
- `pages/Articles.jsx` — inline actions, detail panel, ingest form, real-time polling
- `pages/Config.jsx` — three-tab config editor (OffLimitsTab, SourcesTab, SectorsTab)
- `hooks/useConfig.js` — config load/save hook with mounted guard
- `components/layout/Sidebar.jsx` — Config nav item + settings icon
- `App.jsx` — Config route added
- CSS polish across all pages — token compliance, hover states, focus rings

### Key decisions
| Decision | Choice |
|----------|--------|
| Ingest approach | HTTP proxy to existing ingest server on port 3847 (no code duplication) |
| Real-time mechanism | Stat-based polling (no fs.watch, no websockets) |
| Config editing UX | Structured forms per item type (not raw YAML) |
| Config write safety | Write-validate-swap with .bak backup |
| Soft delete | Move to `data/deleted/` with `deleted_at` timestamp, no recovery UI |
| Ingested article scores | Show "manual" badge (no scoring pipeline runs) |
| Config page structure | Single component with three tab sub-components, shared useConfig hook |
| Week number fix | ISO 8601 algorithm in Config.jsx (fixes known getWeekNumber bug) |

### Deferred
- No undo for delete (soft delete is the safety net)
- No config version history (single .bak only)
- No real-time updates for config changes
- No scoring for manually ingested articles
- No adding/removing sectors (only keyword/display_name editing)
- No editing `url_date_patterns` or `paywall_domains` (read-only)

---

## Fetch Pipeline Enhancement: Multi-Layer Sourcing + Attribution ✅ Complete

**Branch:** `claude/lucid-sinoussi` (worktree)
**Design plan:** `/Users/scott/.claude/plans/vivid-greeting-hare.md`

### What was built

**New config (`config/search-queries.yaml`):**
- Layer 1: 69 sector sweep queries across 5 sectors (biopharma, medtech, manufacturing, insurance, general) with `{month} {year}` templates
- Layer 2: 24 `site:` queries targeting high-value publications (Reuters, CNBC, BioSpace, IndustryWeek, InsuranceERM, etc.)
- Layer 3: 29 cross-sector theme queries (workforce, compute, geopolitics, agent security, platform disruption)
- Layer 4: Daily experiment — L1 queries with `{date}` template for last 3 days (207 queries)
- 7 headline sources with CSS selectors (FT, STAT News, Insurance Journal, HBR, Economist, Wired, Endpoints News)
- Per-layer freshness settings (`pm`/`pw`)

**New modules:**
- `scripts/lib/queries.js` (279 lines) — `loadQueries()`, `resolveTemplates()`, template variables (`{month}`, `{year}`, `{date}`), month-boundary duplication, Layer 4 generation, sector filtering
- `scripts/lib/headlines.js` (260 lines) — `scrapeHeadlines()`, `searchHeadlineOnBrave()`, `extractHeadlinesFromHtml()`, fallback selector cascade, source health tracking (`data/source-health.json`)

**Modified modules:**
- `scripts/lib/extract.js` — `saveArticle()` returns `jsonPath`, merge-on-save (reads existing JSON, merges `found_by` arrays), `found_by` in MD frontmatter
- `scripts/fetch.js` (466 → 702 lines) — `seen` Map replacing Set, `processSearchQueries()` replaces `processGeneralFeed()`, `processHeadlines()`, `reconcileFoundBy()`, per-query stats, `--layer` CLI flag, dry-run per-layer counts
- `config/sources.yaml` — removed `general_search_queries` section (moved to search-queries.yaml)

**New tests:**
- `scripts/tests/queries.test.js` — 15 tests, 46 assertions
- `scripts/tests/headlines.test.js` — 23 tests, 42 assertions

### Verified
- 38/38 unit tests pass (88 assertions across 2 test files)
- `--dry-run` shows correct per-layer counts: L1=69, L2=24, L3=29, L4=207, Headlines=7, RSS=29
- `--sector biopharma` correctly filters L1 to 14 queries, L4 to 42, RSS to 21 feeds
- `--layer L1` suppresses L2/L3/L4, shows only L1 queries
- `--layer headlines` shows 7 sources, 0 Brave queries
- Combined `--sector insurance --layer L1` shows 13 queries

### Key decisions
| Decision | Choice |
|----------|--------|
| Query storage | Separate `config/search-queries.yaml` (not in sources.yaml) |
| Template variables | `{month}`, `{year}`, `{date}` resolved at runtime |
| Attribution | `found_by` array on every article JSON, reconciled at end of run |
| URL dedup | `seen` Map<url, {path, foundBy[]}> replacing Set |
| Headline strategy | Scrape SSR-rendered index pages, search Brave for open copies |
| Source health | Auto-skip after 3 consecutive failures, reset on success |
| Layer 4 | Same as L1 but with `{date}` for last 3 days — experimental |
| CLI flags | `--layer L1\|L2\|L3\|L4\|headlines\|rss` for debugging |

### Deferred (Phase 2 — Web UI)
- Attribution UI: `found_by` display in article detail panel
- Config tab: query productivity dashboard (per-query hit rates from stats)
- Source health viewer in Config page

---

## Phase 5: Turso migration ✅ Complete

The web UI outgrew file-based reads. `getStatus` was walking 4,500+ article JSON files per request and OOM-killing the Fly machine. Moved the query layer to Turso (libSQL), kept the file system as the ingest path.

### What was built

**New tables (`web/api/lib/db.js` — schema v4, 26 tables total):**
- `articles` + `articles_fts` (FTS5 index + supporting tables) — canonical article store with full-text search
- `analysis_entries` — editorial analysis entries (mirrors `state.analysisIndex`)
- `themes` + `theme_evidence` + `theme_connections` — theme registry (mirrors `state.themeRegistry`)
- `posts` — post backlog (mirrors `state.postBacklog`)
- `published_posts` — canonical blog archive (seed for vocabulary fingerprint)
- `published` — alias table for post-publication tracking
- `counters`, `activity`, `decisions`, `notifications`, `stories`, `episode_stories`, `episodes`, `rotation_candidates`
- `style_edits`, `permanent_preferences` — feedback loop for evolving style
- `bug_reports` — inline bug reporting from the UI
- `cost_log` — session + weekly cost tracking
- `schema_version` — migration marker

**New scripts:**
- `scripts/db-migrate.js` — one-time bulk migration from `data/verified/*.json` + `state.json` → Turso
- `scripts/sync-to-turso.js` — incremental sync (upserts last 7 days of articles, editorial state, podcasts, drafts). launchd 07:40, 13:00, 22:00.
- `scripts/load-published-posts.js` — load captured blog archive into `published_posts`

**Web API query layer (`web/api/lib/editorial-queries.js` + route rewrites):**
- `getAnalysisEntries`, `getAnalysisEntry`, `getThemes`, `getThemeWithEvidence`, `getPosts`, `updatePostStatus`, `getCounters`, `incrementCounter`, `getCorpusStats`, `searchEditorial`, `getActivity`, `addActivity`, `getNotifications`, `dismissNotification`, `getDecisions`, `addDecision`, archive operations
- Article query layer (`web/api/lib/article-queries.js`): `insertArticle`, `upsertArticle`, `getArticles`, `getArticle`, `getArticleCounts`, `searchArticles`, `flagArticle`, `getFlaggedArticles`, `deleteArticle`, `getPublications`, `updateArticle`
- All routes rewritten to query Turso rather than walk `data/`

**Fly deployment:**
- Region `lhr`, single `shared-cpu-1x` machine, 1GB memory (was 256MB — OOM), `sni_data` volume (3GB) mounted at `/app/data`
- Embedded replica: libSQL syncs from Turso every 30s
- `/app/output` → `/app/data/output` symlink (Fly allows only one volume per machine)

### Verified
- `scripts/sync-to-turso.js` completes in ~3min for full data sync
- `/api/status` responds in <100ms (was OOM-killed at ~2min under file reads)
- FTS5 search across 4,500+ articles in <50ms
- In-memory test DB (`createTestDb()`) isolates tests from real Turso

### Key decisions
| Decision | Choice |
|----------|--------|
| Sync cadence | 3 launchd runs (07:40, 13:00, 22:00) — catches morning editorial, midday headlines, nightly catch-up |
| State.json vs Turso | File remains the ingest path (scripts write `state.json`); Turso is the read layer for the web UI |
| Test isolation | `createTestDb()` returns an in-memory `:memory:` libSQL client; `getDb()` throws in test mode unless `SNI_TEST_MODE=1` gives permission |
| Schema evolution | `schema_version` table + JS-side `ensureSchema()` idempotent migrations |

---

## Phase 6: Editorial intelligence platform ✅ Complete

The editorial workflow moved from ad-hoc scripts to a named, scheduled pipeline with persistent state (`data/editorial/state.json`) and explicit stages.

### What was built

**Pipeline stages:**
- **ANALYSE** — `/editorial-analyse` slash command (`.claude/commands/editorial-analyse.md`). Processes unprocessed podcast transcripts in `~/Desktop/Podcast Transcripts/`. For each: produces analysis entry, theme evidence, cross-connections, post candidates, story references. Writes state.json via write-validate-swap. Dispatches a sub-agent to audit every entry against the source transcript (69% fabrication rate on the first run prompted this guard).
- **DISCOVER** — `/editorial-discover` (daily 09:00). Three-tier search for podcast-mentioned stories: primary WebSearch → rephrase → site-specific. Mandatory verification agent before saving URLs.
- **HEADLINES** — `/editorial-headlines` (daily 10:30). Broad AI news sweep across US + EU + UK + Ireland.
- **GEOGRAPHIC-SWEEP** — `/editorial-geographic-sweep` (daily 11:00). Explicit Ireland/EU/UK gap-fill after headlines.
- **WEDNESDAY-SWEEP** — `/editorial-sweep` (Wednesday 20:00). Final quality gate before Thursday newsletter.
- **QUALITY-DIGEST** — `/editorial-quality-digest` (weekly). Schema validation + coverage + drift report.
- **DRAFT** — `/editorial-draft` (Thursday 14:00). Newsletter generation (Opus 4.7) → CEO empathy → external critique (Gemini + GPT) → revision.
- **CRITIQUE-REVISE** — `/editorial-critique-revise` (on-demand). Re-run critique + revision against an existing draft.
- **AUDIT-UPSTREAM** — `/editorial-audit-upstream` (daily 08:00 once registered). Applies editorial principles to raw upstream material — see Phase 7.

**State schema (`data/editorial/state.json`):**
- `analysisIndex` — keyed by numeric ID; every entry has `title, source, host, participants, filename, url (required), date, dateProcessed, session, tier, status, themes[], summary, keyThemes, postPotential, postPotentialReasoning`
- `themeRegistry` — keyed by code (`T01`–`T##`); each theme has `name, created, lastUpdated, documentCount, evidence[] (last 12), crossConnections[]`
- `postBacklog` — keyed by numeric ID; each post has `title (20-80 chars), status, dateAdded, session, coreArgument (300+ chars), format, sourceDocuments[], freshness, priority, notes (200+ chars)`
- `counters` — `nextSession, nextDocument, nextPost` monotonically-increasing
- `editorialAudits[]` — append-only audit log added in Phase 7 (see below)
- `decisions[]`, `notifications[]`, `corpusStats`, `activity` log

**Writing rules (`data/editorial/writing-preferences.md`) — gitignored, synced to Fly volume separately:**
- Embedded in the drafting + audit system prompts (Fly) and the analyse skill (local)
- 343 lines covering voice, evidence calibration, must-catch patterns, CEO empathy
- 10 references to "matters" — because the section explaining the "matters" ban has to quote the pattern

**Draft co-pilot with multi-pass refinement (`web/api/routes/editorial.js`):**
- Initial draft (Opus 4.7, tools enabled, up to 6 rounds): `get_backlog_item`, `get_analysis_entry`, `search_published_posts`, `get_published_post`
- Style audit (Opus 4.7, no tools): applies the 14-point must-catch checklist + evidence calibration
- Style revision (Opus 4.7, no tools, buffered output)
- CEO empathy pass — see Phase 7
- CEO revision (Opus 4.7, streams to user)
- Hard caps: `DRAFT_OUTPUT_TOKENS`, `MAX_TOOL_ROUNDS: 6`, `MIN_REVISION_LENGTH: 200`
- Bun `idleTimeout: 255` to avoid killing long draft streams

### Verified
- 885+ tests pass across 48 files
- Production drafts from the Opus 4.7 pipeline rated "100% better" vs 4.6 baseline

### Key decisions
| Decision | Choice |
|----------|--------|
| Scheduler | Claude Code scheduled-tasks — runs under subscription, no metered API cost |
| State location | `data/editorial/state.json` (local file) + Turso mirror (web UI) |
| Prompt location | `config/prompts/editorial-analyse.v1.txt` — YAML-embedded rules + JSON schema |
| Source fidelity | Mandatory sub-agent audit after every analyse entry. Fabrications fixed before next transcript |
| URL provenance | Every entry must carry its origin URL forward. Never reconstructed |
| Theme codes | `T\d{2}` regex; new themes on pattern/tension/phenomenon; expected rate ~1 new theme per 2-3 sessions |

---

## Phase 7: Opus 4.7 drafting + CEO empathy ✅ Complete

Full voice alignment with Scott's published canon. Three interlocking pieces: shared principles module, CEO empathy pass in the drafting pipeline, Claude-Code-native upstream audit.

### What was built

**Shared principles module (`scripts/lib/editorial-principles.js`) — 205 lines, single source of truth:**
- `SECTORS`, `SECTOR_CEO_LABELS`, `SECTOR_PATTERNS` (regex per sector for detection)
- `detectSectors(text)` — heuristic sector detection (returns at least `['general-ai']`)
- `buildEvidenceCalibrationSection()` — attribution test, voicing ladder, source-document-not-gospel, ITEATE-earns-directness, quote cap
- `buildMustCatchPatternsSection()` — 14 patterns including the full "matters" ban (word + construct, restructure don't substitute)
- `buildCEOEmpathySection()` — four lenses: systemic vs specific, control, empathy before influence, naivety
- `buildCEOCritiquePrompt(sector)` — per-sector CEO read prompt
- `buildCEORevisionInstruction(notes)` — CEO-aware revision applier with guardrails against re-introducing banned patterns

**Consumed by both sides of the API boundary:**
- `web/api/lib/draft-flow.js` — re-exports + composes `buildAuditSystemPrompt` (used by the Fly-hosted drafting pipeline)
- `scripts/lib/editorial-audit-lib.js` — builds `buildUpstreamAuditSystemPrompt` for the local upstream audit
- `config/prompts/editorial-analyse.v1.txt` — rules section quotes the principles inline (not an import; Claude Code reads the file)
- Dockerfile updated to `COPY scripts/lib/ ./scripts/lib/` so the Fly image has access to the module

**CEO empathy pass (`web/api/routes/editorial.js`):**
- Fires after the style revision, before streaming to the user
- `detectSectors()` returns the sectors mentioned in the revised draft
- One parallel Opus 4.7 call per sector (`Promise.all`) — each reads the draft as that sector's CEO
- Clean responses (`NO CHANGES` or <50 chars) filtered out via `isCleanResponse()`
- Substantive notes consolidated → `buildCEORevisionInstruction()` → CEO revision (Opus 4.7, streamed)
- Pristine drafts (audit returned no corrections) still get the CEO read ("pristine drafts are not pristine without the CEO read")
- Style revision is now BUFFERED (not streamed) so the CEO pass can rewrite before the user sees anything — the user only ever sees the final CEO-revised output

**Upstream audit — Claude-Code-native (`scripts/editorial-audit-upstream.js` + `scripts/lib/editorial-audit-lib.js`):**
- CLI with three I/O modes: `--list-targets` (outputs JSON with batches + rendered material + system prompt), `--print-principles` (outputs the audit prompt text), `--apply-patches FILE` (applies patches JSON)
- No `callOpus` — the Claude Code session that runs `/editorial-audit-upstream` does the reasoning
- Idempotency: every audited target is recorded in `state.editorialAudits[]` with `auditVersion` (currently 1). Next run's `collectAuditTargets()` skips items already at the current version.
- Patch format: `{ analysisPatches, themeEvidencePatches, backlogPatches, auditedTargetIds }` — each patch has `id, field, oldValue, newValue, ruleBroken`
- Whitelisted fields per kind: analysis (summary, keyThemes, postPotentialReasoning); theme evidence (claim, content, significance); backlog (title, coreArgument, notes)
- Stale-snapshot rejection: applier checks `oldValue` matches exactly (whitespace-tolerant); patches against stale state are skipped and logged
- `write-validate-swap` on every state save (`.tmp` → `parse-back` → `.bak` → `rename`)

**Slash command + scheduled task:**
- `.claude/commands/editorial-audit-upstream.md` — drives Claude Code through list → reason → patches → apply
- `~/.claude/scheduled-tasks/editorial-audit-upstream-daily/SKILL.md` — daily runner at 08:00 (NOT yet registered with scheduler; register after two manual runs look clean)

**Model upgrade (`scripts/lib/editorial-multi-model.js`):**
- `OPUS_MODEL: 'claude-opus-4-6' → 'claude-opus-4-7'`
- New `buildAnthropicCreateOpts(contextWindow)` helper — adds `context-1m-2025-08-07` beta header when `contextWindow: '1m'` passed
- Applied to both `callOpus` and `callOpusStreaming`

**SDK maxRetries=0 in `web/api/lib/claude.js`** — was silently 3x-multiplying tokens on transient failures

### Verified
- Live smoke test: backlog 118 (manufacturing) draft produced CEO-empathy rewrites explicitly crediting prior executive judgement as correct ("regulated-industry leaders were right to conclude...") and reframing industry contraction as systemic ("as procurement volumes collapsed and capital flowed to offshore supply chains")
- Live smoke test: upstream audit against 3 real targets (backlog 44, backlog 118, theme T01:0) produced 4 clean patches; idempotency confirmed on re-run
- 4 re-analysed entries (239, 263, 303, 310) after podcast-transcription truncation fix — major rewrites for 263 and 303 (the episodes where the truncated transcript missed the editorial substance)

### Key decisions
| Decision | Choice |
|----------|--------|
| Module location | `scripts/lib/editorial-principles.js` — both sides of the API boundary import it |
| Fly image | Dockerfile copies `scripts/lib/` (read-only, no runtime writes needed) |
| CEO pass gating | Every draft, not just audit-failing ones |
| Parallel critiques | `Promise.all` over sectors — one failure doesn't kill the others (per-call try/catch) |
| Audit idempotency | AUDIT_VERSION constant + per-target record in `editorialAudits[]` |
| Upstream audit runtime | Claude Code session (subscription), not callOpus (metered) |

---

## Phase 8: Ops + production readiness 🟡 In progress

### What's built

**Pre-push deploy hook (`scripts/git-hooks/pre-push`):**
- Runs `fly deploy --remote-only` when pushing to master
- If deploy fails, push aborts — GitHub and Fly can't drift
- Activated via `git config core.hooksPath scripts/git-hooks` (one-time per clone)
- Escape hatch: `git push --no-verify`

**CI simplification (`.github/workflows/deploy.yml`):**
- Renamed "Deploy" → "CI"
- Deploy job removed (it required `FLY_API_TOKEN` in GitHub Secrets, never configured — 39 failed runs accumulated before diagnosis)
- Test job now passes — subscriptions tests skip when no live server is reachable, draft tests skip when `output/drafts/` fixtures are absent
- Fly token stays in `~/.fly/` on the dev machine (not proliferated)

**Cost-protection guards:**
- `web/api/bunfig.toml` + `web/api/tests/guard.ts` — preloaded before every `bun test`, refuses to proceed unless `SNI_TEST_MODE=1`
- Root `bunfig.toml` — same guard at project-root test runs
- `getDb()` in `web/api/lib/db.js` — throws if bun test detected but `SNI_TEST_MODE` missing
- `SNI_TEST_MODE` stubs real API calls + Turso writes + subprocess spawns in tests
- `scripts/editorial-analyse.js` retired: running directly prints "use /editorial-analyse" and exits (callOpus path dead code)

**web/api dependency audit:**
- `@anthropic-ai/sdk`, `@libsql/client`, `hono`, `jose`, `js-yaml` all explicitly declared (were hoisted from repo root → broke CI)
- `bun.lock` committed

**Podcast pipeline fixes (sibling repo `~/Projects/Claude/HomeBrew/podcasts/`):**
- `transcript_whisper.py` — `MAX_DURATION` lowered from 1450s to 480s so any audio longer than one chunk gets chunked. Fixes gpt-4o-mini-transcribe's silent ~2K output-token cap that was truncating 15-25 min episodes.
- `transcript_youtube.py` — added duration-aware length check (`duration_hint * 8` chars/sec minimum). Short results fall through to Whisper.
- `scripts/retranscribe.py` — one-off recovery helper (date range or episode keys; backs up old .md to `.truncated.bak`)

### Deferred / pending
- Register `editorial-audit-upstream-daily` scheduled task with the MCP scheduler (after 2 manual validations)
- Fix `getLastFridayRunAt()` mode check — currently returns Feb 27 for "this week" (known-issue in CLAUDE.md)
- Produce `.claude/context/production-migration.md` (✅ done)
- Fix podcast pipeline repo's lack of version control (transcript_whisper + retranscribe + transcript_youtube are the first committed files)
