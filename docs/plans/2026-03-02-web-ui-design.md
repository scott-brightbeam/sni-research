# SNI Research — Web UI Design

## Context

SNI Research v2 is a fully automated newsletter pipeline (fetch → score → draft → publish) running on Scott's Mac via launchd. Currently all interaction is CLI-based: `status.js`, log files, Chrome extension for manual ingest. Scott wants a browser-based UI that serves as a full editorial workbench — monitoring, article curation, draft editing, and an AI co-pilot that helps shape the newsletter throughout the week.

**Constraint:** The existing pipeline must remain fully independent. All new code lives in `web/`. No pipeline scripts are modified. The UI is a read/write layer over the existing file-based data.

---

## Architecture

**Approach:** Bun API server + Vite React SPA (Approach B)

```
sni-research-v2/
├── scripts/          # UNCHANGED — pipeline, CLI tools
├── config/           # UNCHANGED — YAML configs
├── data/             # UNCHANGED — articles, reviews, copilot (new subdir)
├── output/           # UNCHANGED — drafts, reports, runs
├── logs/             # UNCHANGED — pipeline logs
├── web/              # NEW — all UI code
│   ├── api/          # Bun HTTP API server
│   │   └── server.js # Serves /api/* + static SPA files
│   ├── app/          # Vite + React SPA
│   └── package.json  # Separate dependency tree
└── package.json      # UNCHANGED — pipeline deps
```

- **Port 3847** — existing ingest server (untouched)
- **Port 3900** — new API + SPA server
- **Branch:** `feature/web-ui` (pipeline runs from `master` via launchd)

---

## Pages

### 1. Dashboard (`/`)
- Pipeline status: last run, next scheduled, stage results
- Article counts by day and sector (current week vs last)
- Scoring stats: kept vs flagged, threshold warnings
- Recent errors from logs
- Reads: `output/runs/`, `data/verified/`, `logs/`

### 2. Articles (`/articles`)
- Filterable table: date, sector, score
- Expand to see full text, metadata, date confidence
- Actions: override sector, flag/unflag, delete
- Flagged articles tab (`data/review/`)
- Manual ingest form
- Reads/writes: `data/verified/`, `data/review/`

### 3. Draft (`/draft`)
- Side-by-side: markdown editor (left) + rendered preview (right)
- Review flags overlay (from `review-week-N.json`)
- Evaluation scores sidebar (from `evaluate-week-N.json`)
- Link verification badges inline (from `links-week-N.json`)
- Save edits back to file
- Reads/writes: `output/draft-week-N.md` and related JSON

### 4. Co-pilot (`/copilot`)
- Chat interface with Claude (SSE streaming)
- Model toggle: Sonnet (fast) / Opus (deep)
- Claude sees current week's article corpus as context
- Pin responses as editorial notes for Friday's draft
- One conversation per week, persisted to `data/copilot/chats/week-N.jsonl`
- Pinned notes saved to `data/copilot/pins/week-N/`

---

## API Surface

**Dashboard:**
- `GET /api/status` — pipeline health, last run, article counts

**Articles:**
- `GET /api/articles?week=&sector=&date=` — list with filtering
- `GET /api/articles/:date/:sector/:slug` — single article
- `PATCH /api/articles/:date/:sector/:slug` — override sector, score, flag
- `DELETE /api/articles/:date/:sector/:slug` — remove
- `GET /api/articles/flagged?week=` — review queue
- `POST /api/articles/ingest` — manual URL submission

**Draft:**
- `GET /api/draft?week=` — draft + review + eval + links
- `PUT /api/draft?week=` — save edited draft

**Co-pilot:**
- `POST /api/chat` — send message, SSE stream response
- `GET /api/chat/history?week=` — load conversation
- `POST /api/chat/pin` — pin a response as editorial note
- `GET /api/chat/pins?week=` — list pinned notes

**Config (read-only):**
- `GET /api/config/sectors`
- `GET /api/config/sources`
- `GET /api/config/off-limits`

---

## Co-pilot Detail

**Context assembly:** Each message includes this week's article titles + snippets (not full text). When user references a specific article, its full text is injected. Target <30k tokens per request.

**Model selection:** Sonnet default for conversation, Opus toggle for deep analysis. Switchable per-message.

**Pinned notes:** Any Claude response can be pinned → saved to `data/copilot/pins/week-N/`. The pipeline's `draft.js` reads these as supplementary editorial direction on Friday.

**Persistence:** One JSONL file per week at `data/copilot/chats/week-N.jsonl`.

---

## React Component Architecture

```
web/app/src/
├── components/
│   ├── layout/
│   │   ├── Shell.jsx            # Sidebar nav + main content area
│   │   ├── Sidebar.jsx          # Nav links + pipeline status indicator
│   │   └── Header.jsx           # Page title + week selector
│   ├── dashboard/
│   │   ├── PipelineStatus.jsx   # Last run, stages, errors
│   │   ├── ArticleStats.jsx     # Counts by day/sector
│   │   └── AlertBanner.jsx      # Threshold warnings
│   ├── articles/
│   │   ├── ArticleTable.jsx     # Filterable, sortable table
│   │   ├── ArticleRow.jsx       # Single row with expand
│   │   ├── ArticleDetail.jsx    # Full article + metadata
│   │   ├── ArticleFilters.jsx   # Date, sector, score filters
│   │   ├── FlaggedList.jsx      # Review queue
│   │   └── IngestForm.jsx       # Manual URL submission
│   ├── draft/
│   │   ├── DraftEditor.jsx      # Markdown textarea + auto-save
│   │   ├── DraftPreview.jsx     # Rendered markdown
│   │   ├── ReviewOverlay.jsx    # Quality gate flags
│   │   ├── EvalScores.jsx       # Multi-model scores sidebar
│   │   └── LinkStatus.jsx       # Per-link verification badges
│   ├── copilot/
│   │   ├── ChatPanel.jsx        # Message list + input
│   │   ├── ChatMessage.jsx      # Single message bubble
│   │   ├── StreamingMessage.jsx # SSE token-by-token render
│   │   ├── ModelToggle.jsx      # Sonnet / Opus selector
│   │   ├── PinnedNotes.jsx      # Pinned responses list
│   │   └── ArticleContext.jsx   # Which articles Claude can see
│   └── shared/
│       ├── SectorBadge.jsx      # Coloured sector label
│       ├── DatePicker.jsx       # Week/date selector
│       ├── Markdown.jsx         # react-markdown renderer
│       ├── DataTable.jsx        # Reusable sortable table
│       ├── LoadingSpinner.jsx
│       └── EmptyState.jsx
├── hooks/
│   ├── useArticles.js           # Fetch + cache articles
│   ├── useDraft.js              # Load/save draft
│   ├── useStatus.js             # Pipeline status polling
│   ├── useChat.js               # SSE streaming + history
│   └── useWeek.js               # Current week context
├── pages/
│   ├── Dashboard.jsx
│   ├── Articles.jsx
│   ├── Draft.jsx
│   └── Copilot.jsx
├── lib/
│   ├── api.js                   # fetch() wrapper for /api/*
│   └── format.js                # Date formatting, sector colours
├── App.jsx                      # Router + Shell
└── main.jsx                     # Entry point
```

---

## Build Order

### Phase 1: Foundation
- Vite + React scaffold in `web/app/`
- Bun API server in `web/api/` with `/api/status` and `/api/articles`
- Dashboard page — pipeline status, article counts
- Articles page — table with filtering, article detail panel
- Layout shell, sidebar, shared components

### Phase 2: Draft Editor
- `/api/draft` endpoints
- Side-by-side markdown editor + rendered preview
- Review/evaluation/link-check overlays
- Save back to file

### Phase 3: Co-pilot
- `/api/chat` with SSE streaming
- Chat UI with message history
- Context assembly (article corpus + pins)
- Model toggle, pin system, persistence

### Phase 4: Polish
- Article actions (sector override, flag, manual ingest)
- Config viewer
- Real-time updates (file watcher or polling)
- UI refinements from use

---

## Visual Design — Dark Mode

**Theme:** Dark mode with Claude-inspired warmth. Mockup at `web/mockup.html`.

**Palette:**
- Background: `#1a1816` (warm near-black)
- Sidebar: `#1e1c1a`
- Surface/cards: `#2c2a27` (warm dark brown)
- Surface hover: `#353330`
- Text primary: `#e8e6dc` (warm off-white)
- Text muted: `#8a8778`
- Accent: `#D4714E` (terra cotta, slightly brighter for dark)
- Borders: `rgba(255,255,255,0.08)`

**Sector colours (boosted for dark backgrounds):**
- General: `#D4714E` terra
- Biopharma: `#6FA584` sage
- MedTech: `#7CADD6` blue
- Manufacturing: `#A08B6D` brown
- Insurance: `#ADA0D0` purple

**Typography:** Poppins (headings, UI labels) + Lora (body, editor). Same as light design.

**Key patterns:**
- Cards use `--surface` with subtle `rgba(255,255,255,0.08)` borders
- Badges use 15% opacity sector colour backgrounds
- Hover states use `--surface-hover`
- Scrollbars: `rgba(255,255,255,0.15)`

---

## Verification

After each phase:

```bash
# Phase 1
cd web && bun run dev          # Vite dev server on :5173
cd web/api && bun server.js    # API on :3900
# Open http://localhost:5173 — dashboard shows pipeline status, articles load

# Phase 2
# Navigate to /draft — markdown editor renders current draft
# Edit and save — verify output/draft-week-N.md is updated

# Phase 3
# Navigate to /copilot — send a message, see streaming response
# Pin a response — verify data/copilot/pins/week-N/ has the file
# Check draft.js can read pinned notes (future pipeline integration)

# Throughout
bun scripts/pipeline.js --mode daily --dry-run  # Pipeline still works independently
curl http://localhost:3847/health               # Ingest server unaffected
```
