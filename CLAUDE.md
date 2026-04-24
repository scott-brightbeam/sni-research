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
  ├─ Turso (libSQL)                Cloud database — 18 tables, schema v4, synced by scripts/sync-to-turso.js
  ├─ data/editorial/state.json     Analysis index, theme registry, post backlog, decisions
  ├─ data/verified/                Scored articles (JSON per article) — ingest path, synced to Turso
  ├─ data/podcasts/                Episode digests + manifest — synced to Turso
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

- **Runtime:** Bun 1.3.9 (ES modules, no CommonJS) + Python 3.13 (podcast pipeline) + Node v22.17.1 (available for subscription scripts)
- **API keys in `.env`** (all required for full pipeline; Fly only needs `TURSO_*` + `ANTHROPIC_API_KEY`):
  - `BRAVE_API_KEY` — article fetching via Brave Search
  - `OPENAI_API_KEY` — Whisper (podcast transcription) + GPT critique + evaluation
  - `GOOGLE_AI_API_KEY` — Gemini critique pair + DISCOVER Google Search grounding
  - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — pipeline alerts via `scripts/pipeline-alerts.js`
  - `AINEWSHUB_EMAIL` + `AINEWSHUB_PASSWORD` — AI NewsHub premium API access (ainewshub.ie)
  - `ANTHROPIC_API_KEY` — still live despite earlier intent to remove. Used by `scripts/lib/editorial-multi-model.js`, `scripts/editorial-draft.js`, and the Fly-hosted editorial chat (`web/api/lib/claude.js`). Cost protection relies on the "ask first" rule above and hook guards, not key absence.
  - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` — Turso (libSQL) cloud database connection
- **Optional env vars** (have defaults but worth knowing about):
  - `SNI_NOTIFY_RECIPIENT` — iMessage recipient for `scripts/notify.js`
  - `SNI_EDITORIAL_DIR` — overrides `data/editorial/` (tests + staging use this)
  - `SNI_ROOT` — overrides project root detection in a few scripts
  - `SNI_TEST_MODE=1` — mandatory when running `bun test`; stubs real API calls + Turso writes. `bunfig.toml` preloads `tests/guard.ts` which exits loudly if this is missing.
  - `SNI_SESSION_SECRET` — cookie signing for the web session (required when Fly has auth enabled)
  - `SNI_CREDENTIAL_FILE` + `SNI_CREDENTIAL_KEY` — encrypted credential store for subscription scripts (`scripts/lib/credential-store.js`). Hex key → PBKDF2 derivation, AES-256-GCM at rest.
  - `SNI_PIPELINE_ENABLED=false` — set on Fly to prevent the API trying to spawn pipeline children (it's a web-only host)
- **Database:** Turso (libSQL) — **26 tables, schema v4** in `web/api/lib/db.js`. Synced by `scripts/sync-to-turso.js` (launchd 07:40 / 13:00 / 22:00). Web API queries via `getDb()`. Tests use in-memory libSQL (`createTestDb()`).
- **Local data files** remain the primary ingest path — `data/verified/`, `data/podcasts/`, `data/editorial/`. Turso is the query layer for the web UI. Everything under `data/` is gitignored; the sync pushes it up.
- **Scheduling:** launchd for automated stages (fetch, podcast transcription, sync). Claude Code scheduled tasks for analysis, discovery, drafting, audit, and quality gates. See "Scheduled jobs" section below.

## Scheduled jobs

Two runners: **launchd** (macOS user agents at `~/Library/LaunchAgents/`) and **Claude Code scheduled tasks** (SKILL.md files at `~/.claude/scheduled-tasks/`). launchd jobs run Bun/Python scripts directly. Claude Code tasks drive a Claude Code session (subscription-backed, no metered API cost).

### launchd jobs

| Plist | Schedule | What |
|-------|----------|------|
| `com.sni.ainewshub.plist` | Daily 03:30 | Fetch curated AI articles from ainewshub.ie API (IE, GB, EU, US) |
| `com.sni.fetch.plist` | Daily 04:00 | Fetch articles (Brave + RSS), score (heuristic) |
| `com.sni.alerts-post-fetch.plist` | Daily 04:45 | Post-fetch health alerts (Telegram) |
| `com.sni.sync-to-cloud.plist` | 07:40, 13:00, 22:00 | Push `data/` + `output/` to Turso and Fly volume |
| `com.sni.alerts-post-satellite.plist` | Daily 08:00 | Post-satellite alerts (Telegram) |
| `com.sni.pipeline.plist` | Thursday 13:00 | Full pipeline (fetch → score → discover → report → draft). Uses GPT+Gemini for discover (separate from the Claude Code 09:00 discover); may produce duplicate articles. |
| `com.scott.podcast-pipeline.plist` | 22:00, 23:00, 00:00, 02:00, 04:00, 06:00 (6 runs nightly) | Monitor podcast RSS, transcribe new episodes via `~/Projects/Claude/HomeBrew/podcasts/` |
| ~~`com.sni.podcast-import.plist`~~ | ~~07:00~~ | **Disabled** — replaced by Claude Code `podcast-import-daily` |

### Claude Code scheduled tasks

Registered via the `scheduled-tasks` MCP (runtime state — not tracked in the repo). SKILL.md files are the task definitions; the scheduler itself holds the cron.

| Task | Schedule | What |
|------|----------|------|
| `podcast-import-daily` | Daily 07:00 | Import new podcast digests, update manifest |
| `editorial-analyse-daily` | Daily 07:30 | Process all unprocessed transcripts → state + stories file (Claude-Code-native, Opus 4.7) |
| `editorial-audit-upstream-daily` | Daily ~08:00 (NOT yet registered — SKILL.md exists, scheduler registration pending) | Apply editorial principles (evidence calibration, CEO empathy, "matters" ban) to yesterday's new analysis/theme-evidence/backlog via `/editorial-audit-upstream` slash command |
| `editorial-discover` | Daily 09:00 | Three-tier WebSearch for podcast story references + verification |
| `editorial-headlines` | Daily 10:30 | Broad AI news sweep (US + EU + UK + Ireland), fill corpus gaps |
| `editorial-geographic-sweep` | Daily 11:00 | Ireland/EU/UK gap-fill — ensure geographic balance |
| `editorial-wednesday-sweep` | Wednesday 20:00 | Final quality gate before Thursday newsletter |
| `editorial-quality-digest` | Weekly | State quality report — schema validation, coverage, drift |
| `vocabulary-fingerprint-refresh` | Weekly | Regenerate Scott's vocabulary fingerprint from `published_posts` table |
| `pipeline-weekly-newsletter` | Thursday 14:00 | Generate newsletter: draft (Opus 4.7) → CEO empathy → critique (Gemini + GPT) → revision |
| `editorial-critique-revise` | On-demand | Re-run external critique + revision against an existing draft |
| `bug-triage` | On-demand | Triage open bugs — security screen, validate, propose fixes on branches |

### Daily flow (Mon–Wed)
```
22:00–06:00  Podcast pipeline (launchd)    — 6 runs: detect episodes, transcribe, deliver .md
03:30        AI NewsHub fetch (launchd)    — curated articles from 7,000+ sources (IE/GB/EU/US)
04:00        Brave fetch (launchd)         — multi-layer queries, volume sweep
04:45        Alerts post-fetch (launchd)   — Telegram health alerts
07:00        Podcast import (Claude Code)  — digests + manifest
07:30        Editorial analyse             — transcript → state + stories-session-N.json
07:40        Sync to cloud (launchd)       — push to Turso + Fly volume (catches morning content)
08:00        Alerts post-satellite         — Telegram
08:00        Editorial audit upstream      — apply principles to yesterday's new editorial material
09:00        Editorial discover            — three-tier search for podcast stories + verification
10:30        Headlines                     — broad AI news sweep (US + EU + UK + Ireland)
11:00        Geographic sweep              — Ireland/EU/UK gap-fill
13:00        Sync to cloud (launchd)       — push post-headlines content
22:00        Sync to cloud (launchd)       — final catch-up before the night's podcast runs
```

### Thursday flow
```
03:30        AI NewsHub fetch (launchd)
04:00        Brave fetch (launchd)
13:00        Full pipeline (launchd)       — fetch → score → discover (GPT+Gemini) → report → draft
14:00        Newsletter pipeline           — draft (Opus 4.7) → CEO empathy → critique → revision
20:00        Wednesday-sweep equivalent runs Wednesday 20:00, preceding this
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
- **Tests:** `SNI_TEST_MODE=1 bun test` from project root (904 tests: ~885 pass, ~19 skip). From `cd web/api && bun test` just the web/api subset (386 tests, 19 skip when server + fixtures absent). `SNI_TEST_MODE=1` is mandatory — `bunfig.toml` preloads `tests/guard.ts` which refuses to run without it (cost-protection guard).
- **Build:** `cd web/app && bun run build` (check for 0 errors)
- **Launch configs:** `.claude/launch.json` has `web-api` and `ingest-server`

## Deploy

Fly deploys run **locally** via a git pre-push hook, not from CI.

- **Activate on a fresh clone (one-time):** `git config core.hooksPath scripts/git-hooks`
- **Normal flow:** `git push origin master` → hook runs `fly deploy --remote-only` → if deploy succeeds the push completes; if deploy fails the push aborts. GitHub and Fly cannot drift.
- **Skip deploy for one push:** `git push --no-verify` (e.g. docs-only change, or you've already deployed).
- **Manual deploy anytime:** `fly deploy --remote-only` from the repo root.
- **CI (`.github/workflows/deploy.yml`)** runs the web/api test job on every push and pull request. It does NOT deploy — the old `deploy` job was removed because it required `FLY_API_TOKEN` in GitHub Secrets, and we deliberately keep the Fly token local rather than proliferating it. See `scripts/git-hooks/pre-push` for the hook source.

## Known issues

- **`scripts/report.js` `getWeekNumber()`** uses naive day-of-year/7 math — produces wrong week numbers at year boundaries. Fix with date-fns when touched. (Web UI's `getCurrentWeekNumber()` in Config.jsx was fixed in Phase 4 with ISO 8601 algorithm.)
- **`web/api/routes/status.js:getLastFridayRunAt()`** walks `output/runs/pipeline-*.json` looking for `mode === 'friday'`. No run file has used that mode since 2026-02-27. Current Thursday runs emit `mode: 'full'`. Dashboard "this week" article counts therefore include the entire ~7-week backlog. Fix: update the helper to accept `'full'` (or both).
- **Bun >=1.3 `.env` bug:** `process.env` doesn't auto-load `.env`. Pipeline scripts use `loadEnvKey()` workaround. Web API uses same workaround in `web/api/lib/env.js`.
- **CORS:** API server only allows `localhost:5173`. If Vite port changes, update `server.js`.
- **`scripts/editorial-analyse.js` callOpus path retired (2026-04-19)**: running the script directly now prints "use /editorial-analyse (from Claude Code)" and exits. The deterministic helpers (state load/save, transcript enumeration, `applyAnalysisResponse`) remain in `scripts/lib/editorial-analyse-lib.js` and are driven by the slash command + scheduled task.
- **`editorial-audit-upstream-daily` scheduled task not yet registered**: `SKILL.md` exists at `~/.claude/scheduled-tasks/editorial-audit-upstream-daily/` but the scheduler hasn't been told about it via the MCP. Per the plan: register after two manual `/editorial-audit-upstream` runs look clean.
- **Podcast YouTube extraction hitting bot-blocks (2026-04-22)**: yt-dlp caption download is starting to require cookies on some videos. The YouTube path has a duration-aware length check (`scripts/git-hooks/pre-push` commit history in `~/Projects/Claude`) that falls through to Whisper on short results. Whisper fallback still works.

## Current phase status

- **Phase 1: Foundation** ✅ Complete (10 commits) — Dashboard, Articles, API server, design system
- **Phase 2: Draft Editor** ✅ Complete — side-by-side editor, react-markdown preview, link badges, review highlights
- **Phase 3: Co-pilot** ✅ Complete — streaming chat, thread/pin CRUD, article picker, model toggle, Draft panel
- **Phase 4: Polish** ✅ Complete (10 commits) — article CRUD, detail panel, manual ingest, config editor, real-time polling, UI polish
- **Phase 5: Turso migration** ✅ Complete — 26-table libSQL schema (v4), `scripts/sync-to-turso.js` launchd job, Web API query layer moved from file reads to `getDb()`, Fly deployment with embedded replica + volume mount
- **Phase 6: Editorial intelligence platform** ✅ Complete — full ANALYSE/DISCOVER/DRAFT/AUDIT pipeline covering five sectors. See `phase-status.md` for the build log.
- **Phase 7: Opus 4.7 drafting + CEO empathy** ✅ Complete — shared principles module (`scripts/lib/editorial-principles.js`), evidence calibration + "matters" ban across audit/draft/analyse prompts, CEO empathy pass (per-sector critique + revise) in `web/api/routes/editorial.js`, Claude-Code-native upstream audit (`/editorial-audit-upstream` + `scripts/editorial-audit-upstream.js`)
- **Phase 8: Ops** ✅ In progress — pre-push deploy hook (`scripts/git-hooks/pre-push`), test-only CI, cost-protection guards, podcast pipeline truncation fixes, production-migration docs (`.claude/context/production-migration.md`)

## When to read context files

Context files live in `.claude/context/`. Read them based on what you're doing:

| Situation | Read |
|-----------|------|
| **Starting a new phase** | `web-ui-spec.md` + `phase-status.md` + `coding-patterns.md` |
| **Bug fix or small change** | Codebase is source of truth. `coding-patterns.md` if unsure on conventions |
| **Status question** | `phase-status.md` |
| **Design system work** | `coding-patterns.md` (has all token values and CSS conventions) |
| **Migrating to a new machine** | `production-migration.md` (complete checklist) |
| **Adding or changing a scheduled job** | `production-migration.md` + the "Scheduled jobs" section above |
| **Writing editorial prompts** | `scripts/lib/editorial-principles.js` (code, single source) + `data/editorial/writing-preferences.md` (content rules) |

### Context file inventory

- **`.claude/context/web-ui-spec.md`** — Full design spec: architecture, pages, API surface, co-pilot design, component architecture, build order, visual design. Updated when reality diverges from plan.
- **`.claude/context/phase-status.md`** — What's built per phase, what files exist, what was deferred, deviations from spec and why.
- **`.claude/context/coding-patterns.md`** — Established patterns: API routing, React hooks, design tokens, CSS conventions, shared-principles imports, cost-protection guards, Claude-Code-native I/O scripts, pre-push deploy hook.
- **`.claude/context/production-migration.md`** — Move-to-production checklist: secrets, env vars, launchd plists, Claude Code scheduled-tasks, paths to rewrite, Fly credentials, initial sync, verification steps.

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
sni-research-v2/                          # Main project (the repo you're reading)
├── scripts/                              # Pipeline scripts (Bun) — 49 files
│   ├── ainewshub-fetch.js                # AI NewsHub API fetch (IE/GB/EU/US, launchd 03:30)
│   ├── fetch.js                          # Article fetching (Brave L1-L4 queries + RSS)
│   ├── score.js                          # Relevance scoring (heuristic fallback)
│   ├── categorise.js                     # Sector assignment
│   ├── discover.js                       # Multi-model story discovery (OpenAI + Gemini)
│   ├── draft.js                          # Newsletter generation
│   ├── review.js, revise.js              # Draft review/revision
│   ├── select.js                         # Multi-model story selection pipeline
│   ├── report.js                         # Research pack generator
│   ├── evaluate.js                       # Multi-model editorial evaluation
│   ├── verify.js, verify-links.js        # Date + link verification
│   ├── ingest.js, server.js              # Manual ingest CLI + local ingest server (port 3847)
│   ├── notify.js                         # iMessage notifications
│   ├── pipeline.js                       # End-to-end orchestrator (Thursday launchd job)
│   ├── pipeline-alerts.js                # Post-pipeline Telegram alerts
│   ├── subscription-fetch.js             # Subscription content fetcher (HBR, Economist, etc.)
│   ├── ev-link-extract.js                # EV Newsletter link extraction
│   ├── measure-override.js               # Draft vs published edit-distance measurement
│   │
│   ├── editorial-analyse.js              # ANALYSE stage — callOpus path RETIRED; Claude-Code-native via /editorial-analyse
│   ├── editorial-discover.js             # DISCOVER stage (Gemini + Google Search grounding)
│   ├── editorial-draft.js                # DRAFT stage (Anthropic + Gemini + GPT critique-only mode)
│   ├── editorial-track.js                # TRACK stage (post-publication tracking)
│   ├── editorial-verify-draft.js         # Deterministic hallucination gate
│   ├── editorial-audit-upstream.js       # Claude-Code-native upstream audit CLI (--list-targets / --print-principles / --apply-patches)
│   ├── editorial-convert-state.js        # One-shot schema migration for state.json
│   ├── refresh-vocabulary-fingerprint.js # Weekly canon vocabulary regeneration
│   ├── load-published-posts.js           # Load captured blog posts into Turso
│   ├── reconcile-digest-urls.js          # Merge DISCOVER-resolved URLs into podcast digests
│   ├── cleanup-podcast-urls.js           # One-off retroactive URL cleanup
│   ├── update-off-limits.js              # Parse published report → off-limits list
│   ├── fix-evidence-urls.js              # One-shot state.json URL fixup
│   ├── fix-audit-sessions-152-155.js     # One-shot audit-specific fixup
│   ├── update-state-sessions-152-155.js  # One-shot state update for sessions 152–155
│   ├── validate-editorial-state.js       # Schema & constraint validation for state.json
│   ├── podcast-import.js                 # Podcast digest creation (now wraps the /podcast-import skill)
│   ├── sync-to-turso.js                  # Push data/ + output/ to Turso (launchd 07:40/13:00/22:00)
│   ├── db-migrate.js                     # One-time bulk migration from JSON to Turso
│   ├── status.js                         # Pipeline status dashboard CLI
│   ├── benchmark.js                      # Comparative benchmark utility
│   ├── spike-coverage.js                 # Phase-0 Gemini + Google Search spike
│   ├── git-hooks/                        # Tracked git hooks; activate via `git config core.hooksPath scripts/git-hooks`
│   │   └── pre-push                      # Auto-deploys to Fly on push to master; aborts push on deploy failure
│   └── lib/                              # Shared libraries
│       ├── editorial-principles.js       # SINGLE SOURCE OF TRUTH — sectors, evidence calibration, must-catch patterns, CEO empathy, prompt builders
│       ├── editorial-audit-lib.js        # Pure functions for upstream audit (target collection, idempotency, patch application)
│       ├── editorial-analyse-lib.js      # Pure functions for /editorial-analyse (applyAnalysisResponse, etc.)
│       ├── editorial-context.js          # Editorial prompt context assembly
│       ├── editorial-discover-lib.js     # DISCOVER helpers (three-tier search, verification)
│       ├── editorial-draft-lib.js        # DRAFT helpers
│       ├── editorial-multi-model.js      # callOpus / callGPT / callGemini + cost tracking (OPUS_MODEL = claude-opus-4-7, contextWindow:'1m' opt-in)
│       ├── editorial-state.js            # loadState, saveState, activity logging
│       ├── editorial-tools.js            # Draft-mode tool definitions for editorial chat
│       ├── editorial-queries.js          # Turso query helpers
│       ├── draft-parser.js               # Newsletter markdown parser
│       ├── credential-store.js           # AES-256-GCM credential vault (SNI_CREDENTIAL_FILE + KEY)
│       ├── db.js                         # Turso client + test helper
│       ├── dedup.js                      # Article dedup helpers
│       ├── extract.js                    # Article extraction (found_by merge-on-save)
│       ├── queries.js                    # Brave search query resolver (L1-L4 templates)
│       ├── headlines.js                  # Headline source scraping + fallback
│       └── env.js                        # loadEnvKey() — works around Bun 1.3 .env bug
├── config/                               # Pipeline configuration (YAML)
│   ├── search-queries.yaml               # Brave Search query tiers (L1-L4) + headline sources
│   ├── sources.yaml                      # RSS feeds (~200 across 5 sectors)
│   ├── sectors.yaml                      # Sector keyword rules (required_any_group_1 and _2, boost)
│   ├── editorial-sources.yaml            # Podcast source metadata
│   ├── off-limits.yaml                   # Topics/companies not to cover
│   └── prompts/                          # LLM prompts (editorial-analyse.v1.txt with embedded principles, editorial-draft.v1.txt, etc.)
├── data/                                 # ALL gitignored — synced to Turso by sync-to-turso.js
│   ├── verified/                         # Scored articles (JSON per article, has url + found_by)
│   ├── review/                           # Flagged articles
│   ├── podcasts/                         # Episode digests + manifest.json
│   ├── deleted/                          # Soft-deleted articles (Phase 4)
│   ├── copilot/                          # Chat threads + pins
│   │   ├── chats/week-N/threads.json + thread-*.jsonl
│   │   └── pins/week-N/pins.json + pin-*.md
│   ├── subscriptions/                    # Subscription-source content
│   ├── source-health.json                # Per-source success/failure counters (headline scraping)
│   └── editorial/                        # Editorial state
│       ├── state.json                    # THE source of truth (analysisIndex, themeRegistry, postBacklog, counters, editorialAudits[], decisions)
│       ├── activity.json                 # Pipeline activity log (prepended, capped at 100)
│       ├── writing-preferences.md        # Scott's writing rules (read by audit + draft prompts)
│       ├── vocabulary-fingerprint.json   # Canon vocabulary signature (refreshed weekly)
│       ├── cost-log.json                 # Session/weekly cost tracking
│       ├── drafts/                       # Newsletter drafts + critiques
│       ├── chats/                        # Editorial co-pilot threads
│       └── stories-session-N.json        # Story references for DISCOVER
├── output/                               # Gitignored — drafts, reports, run summaries
│   ├── draft-week-N.md, review-week-N.json, evaluate-week-N.json, links-week-N.json
│   └── runs/pipeline-YYYY-MM-DD.json     # Per-run summaries
├── logs/                                 # Gitignored — pipeline + verification logs
├── web/                                  # Web UI (Fly-hosted)
│   ├── api/                              # Bun + Hono HTTP server (port 3900)
│   │   ├── server.js                     # Hono app with Bun.serve
│   │   ├── routes/                       # articles, status, draft, chat, editorial, config, subscriptions, auth, podcasts, bug-reports, cost, themes
│   │   ├── lib/                          # claude.js, context.js, db.js, draft-flow.js (incl. CEO empathy pass + sector detection), editorial-chat.js, editorial-queries.js, editorial-tools.js, env.js, pricing.js, style-scoring.js, thinking.js, walk.js, week.js
│   │   ├── tests/                        # 386 tests across 26 files (SNI_TEST_MODE=1 required)
│   │   ├── bunfig.toml                   # preload ./tests/guard.ts for cost protection
│   │   └── package.json                  # @anthropic-ai/sdk, @libsql/client, hono, jose, js-yaml
│   └── app/                              # Vite + React SPA
│       └── src/
│           ├── pages/                    # Dashboard, Articles, Database, Draft, Copilot, Editorial, Sources, Config, Themes, SourceViewer, ThemeViewer, Subscriptions
│           ├── components/, hooks/, lib/, styles/
├── .claude/
│   ├── commands/                         # Claude Code slash commands (11 total)
│   │   ├── editorial-analyse.md          # Process transcripts → state.json (Opus 4.7 1M)
│   │   ├── editorial-audit-upstream.md   # Apply editorial principles to upstream material
│   │   ├── editorial-discover.md, editorial-headlines.md, editorial-geographic-sweep.md, editorial-sector-search.md, editorial-sweep.md
│   │   ├── editorial-draft.md, editorial-critique-revise.md
│   │   ├── pipeline-weekly.md            # Thursday newsletter coordinator
│   │   └── podcast-import.md
│   ├── context/                          # Design specs, phase status, coding patterns, production-migration checklist
│   ├── worktrees/                        # Ad-hoc git worktrees (gitignored inside)
│   └── launch.json                       # Dev server configs
├── .github/workflows/deploy.yml          # CI: test job only (Fly deploy via local pre-push hook, not CI)
├── docs/                                 # Specs, plans
├── Dockerfile                            # Fly production image — copies web/api/, web/app/dist/, config/, scripts/lib/
├── fly.toml                              # Fly config (app: sni-research, region: lhr)
├── bunfig.toml                           # Root-level bun test preload
└── .env                                  # Gitignored — API keys

~/Projects/Claude/HomeBrew/podcasts/      # Sibling repo — Podcast transcription pipeline (Python)
├── scripts/
│   ├── run_pipeline.py                   # Main orchestrator (launchd 6 runs nightly)
│   ├── rss_parser.py                     # RSS feed parsing, episode detection
│   ├── transcript_whisper.py             # Whisper API transcription (MAX_DURATION=480s forces chunking)
│   ├── transcript_website.py             # Website transcript extraction
│   ├── transcript_youtube.py             # YouTube transcript extraction (duration-aware length check → falls through to Whisper)
│   ├── retranscribe.py                   # One-off recovery helper (Apr 2026 cap-truncation fix)
│   ├── common.py                         # Shared helpers (TMP_DIR, config, episodes-log I/O)
│   └── qa.py                             # Quality checks
├── feeds.json                            # Podcast feed URLs
├── config.json                           # openaiApiKey + other pipeline settings (NOT in main repo's .env)
├── episodes-log.json                     # All detected episodes (has episodeUrl + audioUrl + durationSeconds + status)
└── Delivers to: ~/Desktop/Podcast Transcripts/*.md (hard-coded path)

~/Library/LaunchAgents/                   # macOS user launchd agents
├── com.sni.ainewshub.plist               # 03:30 daily
├── com.sni.fetch.plist                   # 04:00 daily
├── com.sni.alerts-post-fetch.plist       # 04:45 daily
├── com.sni.sync-to-cloud.plist           # 07:40 / 13:00 / 22:00
├── com.sni.alerts-post-satellite.plist   # 08:00 daily
├── com.sni.pipeline.plist                # Thursday 13:00
├── com.scott.podcast-pipeline.plist      # 22:00 / 23:00 / 00:00 / 02:00 / 04:00 / 06:00
└── com.sni.podcast-import.plist.disabled # replaced by Claude Code /podcast-import

~/.claude/scheduled-tasks/                # Claude Code scheduled-task definitions
├── editorial-analyse-daily/SKILL.md
├── editorial-audit-upstream-daily/SKILL.md  (NOT yet registered with scheduler)
├── editorial-discover/SKILL.md
├── editorial-headlines/SKILL.md
├── editorial-geographic-sweep/SKILL.md
├── editorial-wednesday-sweep/SKILL.md
├── editorial-quality-digest/SKILL.md
├── editorial-critique-revise/SKILL.md
├── pipeline-weekly-newsletter/SKILL.md
├── podcast-import-daily/SKILL.md
├── vocabulary-fingerprint-refresh/SKILL.md
└── bug-triage/SKILL.md
```
