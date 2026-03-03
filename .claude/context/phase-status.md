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

## Phase 2: Draft Editor ⬜ Not started

### What to build
- `web/api/routes/draft.js` — GET/PUT /api/draft, GET /api/draft/history
- Rewrite `web/app/src/pages/Draft.jsx` — side-by-side editor + preview
- `web/app/src/hooks/useDraft.js` — load/save draft
- Review overlay (quality gate flags inline)
- Evaluation scores sidebar
- Link verification badges

### Key data files
- `output/draft-week-N.md` — the markdown draft
- `output/review-week-N.json` — review results
- `output/evaluate-week-N.json` — evaluation scores
- `output/links-week-N.json` — link verification

### Dependencies
- None on Phase 1 changes (uses same API server, same Shell layout)
- May need a markdown renderer (evaluate options when starting)

---

## Phase 3: Co-pilot ⬜ Not started

### What to build
- `web/api/routes/chat.js` — POST /api/chat (SSE), GET /api/chat/history, POST/GET pins
- Rewrite `web/app/src/pages/Copilot.jsx` — chat interface
- `web/app/src/hooks/useChat.js` — SSE streaming + message history
- Context assembly logic (article corpus + pins, <30k tokens)
- Model toggle (Sonnet/Opus)
- Pin system + persistence

### Key data directories
- `data/copilot/chats/week-N/` — JSONL conversation files (one per week)
- `data/copilot/pins/week-N/` — pinned notes

### Dependencies
- Anthropic SDK (add to web/api/package.json)
- `loadEnvKey()` workaround for Bun >=1.3 .env bug (see pipeline pattern)

---

## Phase 4: Polish ⬜ Not started

### What to build
- PATCH/DELETE article endpoints + UI actions
- Article detail expand panel
- Manual ingest (POST /api/articles/ingest)
- Config viewer (sectors, sources, off-limits)
- Real-time updates (file watcher or polling for new articles)
- UI refinements based on use
