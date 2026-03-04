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
| Models | `claude-sonnet-4-20250514`, `claude-opus-4-20250512` |
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

## Phase 4: Polish 📐 Designed, plan pending

### Design & Plan
- Design doc: `docs/plans/2026-03-04-phase4-polish-design.md` (9 sections, approved)
- Implementation plan: pending (next step)

### What to build

**Inline article actions (PATCH/DELETE):**
- Hover-reveal actions cell per row: sector dropdown, flag toggle, delete button
- PATCH `/api/articles/:date/:sector/:slug` — sector move, flag/unflag
- DELETE `/api/articles/:date/:sector/:slug` — soft delete to `data/deleted/`
- Inline confirmation for delete, 409 on slug collision

**Manual ingest:**
- Inline form below Articles header (URL input, optional sector override)
- POST `/api/articles/ingest` proxies to pipeline ingest server (port 3847)
- 30s timeout, loading states ("Scraping..." → "Processing..."), colour-coded result banners
- Ingest health check folded into existing `GET /api/status` response

**Real-time updates:**
- `GET /api/articles/last-updated` — stat all ~53 sector directories, return max mtime
- Client polls every 15s, auto-reloads when timestamp is newer
- "Updated just now" / "Updated 2m ago" indicator below filter bar

**Article detail panel:**
- Click row to expand inline detail below it (one expanded at a time)
- Full text (scrollable, max-height 400px), metadata grid, keyword pills, actions

**Config editor (`/config` route):**
- Three tabs: Off-limits | Sources | Sectors
- Structured forms (not YAML editor), add/remove per item
- Write-validate-swap pattern: serialize → .tmp → parse back → validate → .bak → rename
- Structural validation schemas per config file
- Preview before save (added/removed/modified summary)
- `js-yaml` dependency added to `web/api/package.json`

**UI polish:**
- Spacing/padding audit, hover states, keyboard nav, loading skeletons, responsive check

### Key decisions
| Decision | Choice |
|----------|--------|
| Ingest approach | HTTP proxy to existing ingest server on port 3847 (no code duplication) |
| Real-time mechanism | Stat-based polling (no fs.watch, no websockets) |
| Config editing UX | Structured forms per item type (not raw YAML) |
| Config write safety | Write-validate-swap with .bak backup |
| Soft delete | Move to `data/deleted/` with `deleted_at` timestamp, no recovery UI |
| Ingested article scores | Show "manual" badge (no scoring pipeline runs) |
| Build order | Single phase, features 1-3 parallelisable, then sequential 4-8, polish last |

### Build order
| # | Feature | Depends on |
|---|---------|-----------|
| 1 | Inline article actions | None |
| 2 | Manual ingest | None |
| 3 | Real-time updates | None |
| 4 | Article detail panel | After 1 |
| 5 | Config editor — off-limits tab + API + write-validate-swap | js-yaml |
| 6 | Config editor — sources tab | After 5 |
| 7 | Config editor — sectors tab | After 5 |
| 8 | Config page routing + sidebar link | After 5-7 |
| 9 | UI polish pass | After everything |

### Deferred
- No undo for delete (soft delete is the safety net)
- No config version history (single .bak only)
- No real-time updates for config changes
- No scoring for manually ingested articles
- No adding/removing sectors (only keyword/display_name editing)
- No editing `url_date_patterns` or `paywall_domains` (read-only)
