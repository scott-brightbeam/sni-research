# Web UI Design Spec

Living document. Updated when reality diverges from plan.

---

## 1. Architecture & Isolation

The UI is a read/write layer over the existing file-based data. Pipeline scripts are never modified or wrapped — they keep running via launchd exactly as they do now.

Two servers, two concerns:
- **Port 3847** — existing ingest server (`scripts/server.js`), untouched
- **Port 3900** — new API + SPA server (`web/api/server.js`), serves the dashboard

The API server reads `data/`, `output/`, `config/`, `logs/`. It never imports pipeline modules — it reads their output files. If the API server is down, the pipeline doesn't care.

For the Claude co-pilot: the API server holds the Anthropic SDK connection. Chat messages go to `/api/chat` which streams responses back via SSE.

## 2. Pages & Features

### Dashboard (`/`)
- Pipeline status: last run, next scheduled, stage-by-stage results
- Article counts by day and sector (this week vs last)
- Scoring stats: kept vs flagged, threshold warnings
- Recent errors from logs

### Articles (`/articles`)
- Table of all scraped articles, filterable by date, sector, score
- Search with debounce (300ms)
- Flagged articles tab (reads from `data/review/`)
- Click to expand: full text, metadata, date confidence, source (Phase 4)
- Actions: override sector, flag/unflag, delete (Phase 4)
- Manual ingest form (Phase 4)

### Draft (`/draft`)
- Markdown preview of the current week's draft (from `output/draft-week-N.md`)
- Side-by-side: rendered preview on left, raw markdown editor on right
- Review results overlay (from `review-week-N.json`)
- Evaluation scores (from `evaluate-week-N.json`)
- Link verification status inline (from `links-week-N.json`)
- Edit and save back to file

### Co-pilot (`/copilot`)
- Chat interface with Claude (Sonnet for speed, Opus for depth — toggle)
- Claude sees the current week's article corpus as context
- Can ask: "What themes are emerging?", "Compare these two stories", "Draft a paragraph about the Merck news"
- Claude's outputs can be pinned as notes that carry into Friday's draft context
- One conversation per week, saved to `data/copilot/`

## 3. API Surface

All endpoints read from / write to the existing file-based data — no database.

### Dashboard
- `GET /api/status` — pipeline health, last run, next scheduled, article counts

### Articles
- `GET /api/articles?sector=&date=&search=&limit=&offset=` — list with filtering + pagination
- `GET /api/articles/:date/:sector/:slug` — single article detail
- `PATCH /api/articles/:date/:sector/:slug` — override sector, update score, flag/unflag (Phase 4)
- `DELETE /api/articles/:date/:sector/:slug` — remove article (Phase 4)
- `GET /api/articles/flagged` — list articles in `data/review/`
- `POST /api/articles/ingest` — manual ingest (Phase 4)

### Draft
- `GET /api/draft?week=N` — current draft markdown + review + evaluation + link check results
- `PUT /api/draft?week=N` — save edited draft back to file
- `GET /api/draft/history?week=N` — list output artifacts for a week

### Co-pilot
- `POST /api/chat` — send message, returns SSE stream of Claude's response
- `GET /api/chat/history?week=N` — load saved conversation
- `POST /api/chat/pin` — pin a Claude response as a note for draft context
- `GET /api/chat/pins?week=N` — list pinned notes

### Config (read-only)
- `GET /api/config/sectors` — sector definitions
- `GET /api/config/sources` — RSS feeds and search queries
- `GET /api/config/off-limits` — current off-limits list

## 4. Claude Co-pilot Detail

### Context window management
- On each message, the API assembles context: this week's article titles + snippets (not full text — too large), any pinned notes, the conversation history
- If the user asks about a specific article, the API injects that article's full text into the next message
- Target: keep context under 30k tokens so responses are fast and cheap

### Model selection
- Default: Sonnet for conversational back-and-forth (fast, cheap)
- Toggle to Opus for deep analysis
- Model choice shown in the UI, switchable per-message

### Pinned notes
- Any Claude response can be "pinned" — saved to `data/copilot/pins/week-N/`
- Pinned notes are injected into `draft.js` context on Friday (read by the pipeline as supplementary editorial direction)
- This is how daily co-pilot conversations feed into the automated Friday draft

### Persistence
- Conversations saved to `data/copilot/chats/week-N/` as JSONL
- One file per week so Claude sees the full editorial arc

## 5. Component Architecture

Pages are self-contained — hooks for data, components inline. Extract sub-components only when complexity demands it (agreed during Phase 1 implementation).

```
web/app/src/
├── components/
│   └── layout/
│       ├── Shell.jsx          # App shell: sidebar + main content area
│       ├── Shell.css
│       ├── Sidebar.jsx        # Nav links + pipeline status indicator
│       └── Sidebar.css
├── hooks/
│   ├── useArticles.js         # Fetch + filter articles
│   ├── useFlaggedArticles.js  # Fetch flagged articles from /api/articles/flagged
│   ├── useDebouncedValue.js   # Generic debounce hook
│   ├── useStatus.js           # Pipeline status polling (30s)
│   ├── useDraft.js            # Load/save draft (Phase 2)
│   ├── useChat.js             # SSE streaming + history (Phase 3)
│   └── useWeek.js             # Current week context (when needed)
├── pages/
│   ├── Dashboard.jsx + .css   # Pipeline status, article stats, bar chart
│   ├── Articles.jsx + .css    # Article table, filters, flagged tab
│   ├── Draft.jsx + .css       # Markdown editor + preview (Phase 2)
│   └── Copilot.jsx + .css     # Chat interface (Phase 3)
├── lib/
│   ├── api.js                 # fetch() wrapper for /api/*
│   └── format.js              # Date formatting, sector colours, SectorBadge
├── styles/
│   └── tokens.css             # Design system tokens
├── App.jsx                    # Router + Shell
└── main.jsx                   # Entry point
```

## 6. Build Order

### Phase 1: Foundation ✅
Vite + React scaffold, Bun API server, Dashboard, Articles, routing, layout, design system.

### Phase 2: Draft Editor
- `/api/draft` endpoints (GET, PUT, history)
- Side-by-side markdown editor + preview
- Review/evaluation/link-check overlays
- Save back to file

### Phase 3: Co-pilot
- `/api/chat` with SSE streaming (Anthropic SDK)
- Chat UI component with message history
- Context assembly (article corpus + pins)
- Model toggle (Sonnet/Opus)
- Pin system + persistence to `data/copilot/`

### Phase 4: Polish
- Article actions (sector override, flag, delete, manual ingest)
- Article detail expand panel
- Config viewer
- Real-time updates (file watcher or polling)
- UI refinements

Each phase is independently useful.

## 7. Visual Design

### Colour palette (dark mode)
| Token | Value | Use |
|-------|-------|-----|
| `--terra` | `#D4714E` | Primary accent — active nav, buttons |
| `--terra-light` | `#e08a6a` | Hover states |
| `--terra-dark` | `#c15f3c` | Active/pressed states |
| `--pampas` | `#1a1816` | Page background |
| `--card-bg` | `#242220` | Card backgrounds |
| `--surface` | `#2c2a27` | Elevated surfaces |
| `--sidebar-bg` | `#1e1c1a` | Sidebar background |
| `--text-primary` | `#e8e6dc` | Primary text |
| `--cloudy` | `#8a8778` | Secondary text, labels |
| `--light-gray` | `rgba(255,255,255,0.08)` | Borders, dividers |

### Sector colours
| Sector | Token | Hex |
|--------|-------|-----|
| General AI | `--terra` | `#D4714E` |
| Biopharma | `--sage` | `#6FA584` |
| MedTech | `--blue` | `#7CADD6` |
| Manufacturing | `--brown` | `#A08B6D` |
| Insurance | `--purple` | `#ADA0D0` |

Each has a `-15` variant (15% opacity) for badge backgrounds.

### Typography
- **Headings / UI:** Poppins, weight 500-700
- **Body text:** Lora (serif), weight 400

### Component style
- Border radius: `8px` default (`--radius`), `12px` for cards (`--radius-lg`)
- Shadows: `--shadow-subtle` for cards
- Generous whitespace: 24px card padding, 16-24px between elements
- Outline-style icons (SVG, `aria-hidden="true"`)
- 260px sidebar, warm dark tones
