# SNI Research v2 — Editorial Intelligence Platform

## Cost protection — mandatory

**Never send queries to the Anthropic API without explicit user permission.** This includes:
- Calling the editorial chat endpoint (`/api/editorial/chat`)
- Running pipeline scripts that use Opus/Sonnet (`editorial-analyse.js`, `editorial-draft.js`, `editorial-discover.js`)
- Any `curl` or programmatic call that hits the Anthropic API

Ask first. Every time. No exceptions. A single unguarded session burned $231 on 23 March 2026.

## What this is

SNI (Sector News Intelligence) is an end-to-end editorial intelligence platform covering AI news across five sectors: general AI, biopharma, medtech, manufacturing and insurance. It produces a weekly newsletter and LinkedIn content pipeline.

The system is a single unified whole — not separate pipelines with upstream/downstream boundaries. Every component is part of the same system:

### The complete system

```
DISCOVER (automated, daily)
  ├─ AI NewsHub fetch      API fetch from ainewshub.ie (7,000+ sources) → data/verified/
  │   └─ scripts/ainewshub-fetch.js  launchd 03:30 daily
  ├─ Article fetching      Brave Search + RSS feeds → data/verified/
  │   └─ scripts/fetch.js  launchd 04:00 daily
  ├─ Article scoring       Heuristic relevance scoring → data/verified/
  │   └─ scripts/score.js  runs after fetch (heuristic mode, no API key)
  ├─ Podcast monitoring    RSS feed checking → new episode detection
  │   └─ ~/Projects/Claude/HomeBrew/podcasts/scripts/run_pipeline.py
  │       launchd 22:00-06:00 (6 runs nightly)
  └─ Podcast transcription Whisper API / website / YouTube → ~/Desktop/Podcast Transcripts/*.md
      └─ same script as above, delivers .md files

ANALYSE (Claude Code, scheduled daily 07:00-07:30)
  ├─ Podcast digest        Generate episode summaries → data/podcasts/
  │   └─ Claude Code /podcast-import skill (07:00)
  ├─ Transcript analysis   Read .md transcripts → themes, evidence, post ideas
  │   └─ Claude Code /editorial-analyse skill (07:30)
  ├─ Story discovery       WebSearch for story references from transcripts
  │   └─ Claude Code /editorial-discover skill (09:00)
  └─ Sector gap-fill       WebSearch for underserved sectors
      └─ Claude Code /editorial-sector-search skill (10:00)

PRODUCE (Claude Code, Thursday + on-demand)
  ├─ Newsletter draft      Claude Code generates → data/editorial/drafts/
  │   └─ Claude Code /editorial-draft skill
  ├─ External critique     Gemini + GPT parallel → critique JSON
  │   └─ scripts/editorial-draft.js --critique-only
  ├─ Draft revision        Claude Code revises based on critique
  ├─ LinkedIn ideation     Claude Code /editorial-analyse IDEATE mode
  └─ LinkedIn drafting     Claude Code /editorial-analyse DRAFT mode

PRESENT (web UI, always-on)
  ├─ Dashboard             Pipeline status, article stats, editorial summary
  ├─ Database              Articles, podcasts, flagged items with archive/search
  ├─ Editorial             Analysis index, themes, backlog, ideation, notes
  ├─ Sources               RSS feed health, query performance
  └─ Config                Sector keywords, search queries, pipeline settings

STATE (persistent, shared by all components)
  ├─ data/editorial/state.json     Analysis index, theme registry, post backlog, decisions
  ├─ data/verified/                Scored articles (JSON per article)
  ├─ data/podcasts/                Episode digests + manifest
  ├─ data/editorial/activity.json  Pipeline activity log
  ├─ config/                       Search queries, sectors, sources, prompts
  └─ output/                       Drafts, reports, run summaries
```

### URL provenance — non-negotiable

Every content item must carry the URL of its original source from the moment it enters the system:
- **Articles:** `url` field set by RSS feed entry, Brave Search result, or AI NewsHub `external_url` at fetch time
- **Podcasts:** `episodeUrl` field set by RSS feed parser at episode detection time
- **Analysis entries:** `url` field inherited from the source article or podcast digest
- **Theme evidence:** `url` field linking back to the source
- **Post candidates:** `sourceUrls` linking to evidence sources

URLs flow forward through every stage. They are never reconstructed after the fact.

## Success criteria

- Phase 2 (Draft Editor): side-by-side markdown editor + preview with review overlay, evaluation scores, and link verification badges
- Phase 3 (Co-pilot): streaming chat with context assembly (<30k tokens), pins, model toggle
- Phase 4 (Polish): article CRUD, detail panel, manual ingest, config viewer, real-time updates
- All phases: zero modification to pipeline scripts, all code in `web/`, tests pass, Vite builds clean

## Architecture constraints

- Web UI code lives in `web/`. Pipeline scripts in `scripts/`. Config in `config/`.
- Pipeline scripts may be modified when the change is necessary for system-wide concerns (API key removal, URL propagation, etc.)
- Two servers: pipeline ingest (port 3847), UI API (port 3900)
- API server reads `data/`, `output/`, `config/`, `logs/`
- Vite dev server on port 5173 proxies `/api` to 3900
- Runtime: Bun (ES modules), Python 3.13 (podcast transcription pipeline)

## Environment

- **Runtime:** Bun 1.3.9 (ES modules, no CommonJS) + Python 3.13 (podcast pipeline)
- **Node:** v22.17.1 (available for subscription scripts)
- **API keys in `.env`:**
  - `BRAVE_API_KEY` — article fetching via Brave Search
  - `OPENAI_API_KEY` — critique pair (GPT), evaluation
  - `GOOGLE_AI_API_KEY` — critique pair (Gemini), DISCOVER (Google Search grounding)
  - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — alerts via Zaphod
  - `AINEWSHUB_EMAIL` + `AINEWSHUB_PASSWORD` — AI NewsHub premium API access (ainewshub.ie)
  - ~~`ANTHROPIC_API_KEY`~~ — **REMOVED 23 Mar 2026.** All Anthropic/Claude processing now runs through Claude Code (Max subscription). Scripts exit cleanly when key is missing.
- **No external services** — all data is local files. No database.
- **Scheduling:** launchd for automated stages (fetch, podcast transcription). Claude Code scheduled tasks for analysis and drafting. See "Scheduled jobs" section below.

## Scheduled jobs

| Job | Schedule | Runner | What |
|-----|----------|--------|------|
| `com.sni.ainewshub.plist` | Daily 03:30 | launchd → Bun | Fetch curated AI articles from ainewshub.ie API (IE, GB, EU, US) |
| `com.sni.fetch.plist` | Daily 04:00 | launchd → Bun | Fetch articles (Brave + RSS), score (heuristic) |
| `com.scott.podcast-pipeline.plist` | 22:00–06:00 (6 runs) | launchd → Python | Monitor podcast RSS, transcribe new episodes |
| `podcast-import-daily` | Daily 07:00 | Claude Code | Import new podcast digests, update manifest |
| `editorial-analyse-daily` | Daily 07:30 | Claude Code | Process all unprocessed transcripts → state + stories file |
| `editorial-discover` | Daily 09:00 | Claude Code | Three-tier WebSearch for podcast story references + verification |
| `editorial-headlines` | Daily 10:30 | Claude Code | Broad AI news sweep (US + EU + UK + Ireland), fill corpus gaps |
| `editorial-wednesday-sweep` | Wednesday 20:00 | Claude Code | Final quality gate: story completeness, headline coverage, sector thresholds |
| `pipeline-weekly-newsletter` | Thursday 14:00 | Claude Code | Generate newsletter: draft (Opus) → critique (Gemini + GPT) → revision |
| `com.sni.pipeline.plist` | Thursday 13:00 | launchd → Bun | Full pipeline (fetch → score → discover → report → draft). Note: discover stage uses GPT+Gemini (separate from the Claude Code discover at 09:00). May produce duplicate articles. |
| ~~`com.sni.podcast-import.plist`~~ | ~~07:00~~ | ~~launchd~~ | **Disabled** — replaced by Claude Code `podcast-import-daily` |

### Daily flow (Mon–Wed)
```
22:00–06:00  Podcast pipeline (launchd)    — detect episodes, transcribe
03:30        AI NewsHub fetch (launchd)    — curated articles from 7,000+ sources (IE/GB/EU/US)
04:00        Brave fetch (launchd)         — 312 queries, volume sweep
07:00        Podcast import (Claude Code)  — digests + manifest
07:30        Editorial analyse             — transcript → state + stories-session-N.json
09:00        Editorial discover            — three-tier search for podcast stories + verification
10:30        Headlines                     — broad AI news sweep (US + EU + UK + Ireland)
```

### Thursday flow
```
03:30        AI NewsHub fetch (launchd)    — runs before Brave fetch
04:00        Brave fetch (launchd)
13:00        Full pipeline (launchd)       — fetch → score → discover (GPT+Gemini) → report → draft
14:00        Newsletter pipeline           — draft (Opus) → critique (Gemini + GPT) → revision
```

### Key design decisions (Week 13 post-mortem)
- **DISCOVER uses three-tier search** with mandatory verification agent — primary search → rephrase → site-specific. Stories from key podcasts have wide coverage; there is no excuse for not finding them.
- **Headlines skill** fills the gap between RSS/Brave (volume) and DISCOVER (podcast references) — asks "what are the week's biggest AI stories?" including Irish, EU and UK sources.
- **The tl;dr is editor-rewritten.** The pipeline generates a tl;dr draft, but it consistently requires editorial rewriting to achieve the right analytical voice. The pipeline's draft context now includes post backlog, theme cross-connections, and ranked analysis entries as editorial fuel. The editor rewrites the tl;dr and podcast sections from this material.
- **Draft follows week 13 published structure** — welcome line → tl;dr editorial prose → sector bullets inline → expanded analysis → podcast commentary with zero URL overlap.
- **Geographic balance is mandatory** — Irish, EU and UK stories are first-class content, not footnotes. The audience is global enterprise leaders.
- **Date validation at write time** — every article must be within the newsletter window (Friday–Thursday). Reject anything outside.

## How to run

- **API server:** `bun --watch web/api/server.js` (port 3900)
- **Vite dev server:** `cd web/app && bun run dev` (port 5173, proxies `/api` to 3900)
- **Pipeline ingest server:** `bun scripts/server.js` (port 3847 — rarely needed for UI work)
- **Tests:** `cd web/api && bun test` (228 tests, 728 assertions)
- **Build:** `cd web/app && bun run build` (check for 0 errors)
- **Launch configs:** `.claude/launch.json` has `web-api` and `ingest-server`

## Known issues

- **`scripts/report.js` `getWeekNumber()`** uses naive day-of-year/7 math — produces wrong week numbers at year boundaries. Fix with date-fns when touched. (Web UI's `getCurrentWeekNumber()` in Config.jsx was fixed in Phase 4 with ISO 8601 algorithm.)
- **Bun >=1.3 `.env` bug:** `process.env` doesn't auto-load `.env`. Pipeline scripts use `loadEnvKey()` workaround. Web API uses same workaround in `web/api/lib/env.js`.
- **CORS:** API server only allows `localhost:5173`. If Vite port changes, update `server.js`.

## Current phase status

- **Phase 1: Foundation** ✅ Complete (10 commits) — Dashboard, Articles, API server, design system
- **Phase 2: Draft Editor** ✅ Complete — side-by-side editor, react-markdown preview, link badges, review highlights
- **Phase 3: Co-pilot** ✅ Complete — streaming chat, thread/pin CRUD, article picker, model toggle, Draft panel
- **Phase 4: Polish** ✅ Complete (10 commits) — article CRUD, detail panel, manual ingest, config editor, real-time polling, UI polish

## When to read context files

Context files live in `.claude/context/`. Read them based on what you're doing:

| Situation | Read |
|-----------|------|
| **Starting a new phase** | `web-ui-spec.md` + `phase-status.md` + `coding-patterns.md` |
| **Bug fix or small change** | Codebase is source of truth. `coding-patterns.md` if unsure on conventions |
| **Status question** | `phase-status.md` |
| **Design system work** | `coding-patterns.md` (has all token values and CSS conventions) |

### Context file inventory

- **`.claude/context/web-ui-spec.md`** — Full design spec: architecture, pages, API surface, co-pilot design, component architecture, build order, visual design. This is the living spec — updated when reality diverges from plan.
- **`.claude/context/phase-status.md`** — What's built per phase, what files exist, what was deferred, deviations from spec and why.
- **`.claude/context/coding-patterns.md`** — Established patterns from Phase 1: API routing, React hooks, design tokens, CSS conventions.

## Skill guidance

Analyse the current situation and invoke relevant skills:

| Situation | Suggest |
|-----------|---------|
| No spec or spec is thin | brainstorming → writing-plans |
| Phase transition | brainstorming (if design needed), writing-plans |
| Implementation tasks pending | TDD + subagent-driven-development or executing-plans |
| Multiple independent tasks | dispatching-parallel-agents |
| Feature needs isolation | using-git-worktrees |
| Bug or test failure | systematic-debugging |
| Implementation complete | requesting-code-review + pr-review-toolkit |
| PR ready | finishing-a-development-branch |
| Review feedback received | receiving-code-review |
| About to claim completion | verification-before-completion |
| Context files may be stale | project-context-management (maintenance) |
| Research needed | firecrawl |

## Key conventions

- **API routing:** `Bun.serve()` with regex matching on `url.pathname`. Route handlers in `web/api/routes/`.
- **Path safety:** Route regex uses `([\w-]+)` captures. Handlers call `validateParam()` from `web/api/lib/walk.js`.
- **React pages:** Self-contained in `web/app/src/pages/`. Hooks for data, CSS modules per page.
- **Hooks:** Return `{ data, loading, error }` shape. Always handle all three states. Use `mountedRef` guard for post-await state updates.
- **Config writes:** Write-validate-swap pattern (`→ .tmp → parse-back → .bak → rename`). See `coding-patterns.md`.
- **Design system:** Dark mode. CSS custom properties in `web/app/src/styles/tokens.css`. Poppins (headings/UI) + Lora (body). See `coding-patterns.md` for full token list.
- **No inline styles** — use CSS classes. No hardcoded `rgba()` — use tokens.

## Domain terminology

- **Sector:** One of five news categories — general-ai, biopharma, medtech, manufacturing, insurance
- **DISCOVER stage:** Automated content acquisition — article fetching (Brave + RSS), podcast monitoring and transcription
- **ANALYSE stage:** Content processing — transcript analysis, theme extraction, post ideation (Claude Code)
- **PRODUCE stage:** Content creation — newsletter drafting, critique, revision, LinkedIn posts (Claude Code + Gemini/GPT)
- **PRESENT stage:** Web UI — dashboard, editorial workbench, database browser
- **Ingest:** Manual article submission (separate from automated fetch)
- **Flagged:** Articles marked for editorial review (high relevance score or manual flag)
- **Week N:** Pipeline runs weekly; data directories named by week number (e.g., `data/verified/week-9/`)
- **State document:** `data/editorial/state.json` — the persistent memory of the editorial intelligence system (analysis index, theme registry, post backlog, decision log)

## Sector keyword config rules — non-negotiable

- **Canonical AI terms:** `required_any_group_1` in `config/sectors.yaml` MUST be identical across all five sectors. One list, copied exactly. Never add sector-specific terms to group 1.
- **Sector-specific AI phrasings** (e.g. "computational drug design", "digital twin", "computer-aided detection") belong in that sector's `required_any_group_2`, not group 1.
- **Company names** never go in group 1. They belong in `required_any_group_2` or `boost` for the relevant sector.
- **When updating AI terms**, update all five sectors simultaneously to maintain parity.

## Scott's preferences

- Detailed specs with exact code patterns, not prose descriptions
- Edge case and failure mode coverage for every component
- Build order with parallel identification for implementation efficiency
- UK English in newsletter output (single quotes, spaced en dashes, no Oxford commas)

## Project structure

```
sni-research-v2/                          # Main project
├── scripts/                              # Pipeline scripts (Bun)
│   ├── ainewshub-fetch.js                # AI NewsHub API fetch (IE/GB/EU/US, launchd 03:30)
│   ├── fetch.js                          # Article fetching (Brave + RSS)
│   ├── score.js                          # Relevance scoring (heuristic fallback)
│   ├── draft.js                          # Newsletter generation (needs Claude Code now)
│   ├── review.js, revise.js              # Draft review/revision (needs Claude Code now)
│   ├── select.js                         # Evaluation (OpenAI + Gemini)
│   ├── report.js                         # Research pack generation
│   ├── podcast-import.js                 # Podcast digest creation (needs Claude Code now)
│   ├── editorial-analyse.js              # Editorial analysis (needs Claude Code now)
│   ├── editorial-draft.js                # Editorial draft + critique-only mode
│   ├── editorial-discover.js             # Story discovery (Gemini + Google Search)
│   └── lib/                              # Shared libraries
├── config/                               # Pipeline configuration
│   ├── search-queries.yaml               # Brave Search query tiers (L1-L4)
│   ├── sources.yaml                      # RSS feeds
│   ├── sectors.yaml                      # Sector keyword rules
│   ├── editorial-sources.yaml            # Podcast source metadata
│   └── prompts/                          # LLM prompts (editorial-context, analyse, draft, etc.)
├── data/                                 # All persistent data
│   ├── verified/                         # Scored articles (JSON per article, has url field)
│   ├── review/                           # Flagged articles
│   ├── podcasts/                         # Episode digests + manifest.json
│   └── editorial/                        # Editorial state
│       ├── state.json                    # THE source of truth (analysis, themes, backlog, decisions)
│       ├── activity.json                 # Activity log
│       ├── drafts/                       # Newsletter drafts and critiques
│       └── stories-session-N.json        # Story references for DISCOVER
├── output/                               # Drafts, reports, run summaries
├── logs/                                 # Pipeline logs
├── web/                                  # Web UI
│   ├── api/                              # Bun HTTP server (port 3900)
│   │   ├── server.js, routes/, lib/
│   │   └── tests/                        # 228 tests, 739 assertions
│   └── app/                              # Vite + React SPA
│       └── src/
│           ├── pages/                    # Dashboard, Database, Editorial, Copilot, Sources, Config
│           ├── components/, hooks/, lib/, styles/
├── .claude/
│   ├── commands/                         # Claude Code skills
│   │   ├── editorial-analyse.md          # Process transcripts → state.json
│   │   ├── editorial-draft.md            # Generate newsletter
│   │   ├── podcast-import.md             # Import podcast digests
│   │   └── pipeline-weekly.md            # Thursday pipeline coordinator
│   ├── context/                          # Design specs, phase status, coding patterns
│   └── launch.json                       # Dev server configs
├── docs/                                 # Specs, plans
└── .env                                  # API keys (no ANTHROPIC_API_KEY)

~/Projects/Claude/HomeBrew/podcasts/      # Podcast transcription pipeline (Python)
├── scripts/
│   ├── run_pipeline.py                   # Main orchestrator (launchd)
│   ├── rss_parser.py                     # RSS feed parsing, episode detection
│   ├── transcript_whisper.py             # Whisper API transcription
│   ├── transcript_website.py             # Website transcript extraction
│   ├── transcript_youtube.py             # YouTube transcript extraction
│   └── qa.py                             # Quality checks
├── feeds.json                            # Podcast feed URLs
├── episodes-log.json                     # All detected episodes (HAS episodeUrl + audioUrl)
└── Delivers to: ~/Desktop/Podcast Transcripts/*.md
```
