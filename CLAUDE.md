# SNI Research v2 — Web UI

## What this is

SNI (Sector News Intelligence) is an automated weekly newsletter pipeline covering AI news across five sectors: general AI, biopharma, medtech, manufacturing and insurance. It runs on Scott's Mac via launchd (fetch, score, draft, review, publish stages).

The **web UI** is a browser-based editorial workbench for monitoring the pipeline, curating articles, editing drafts and AI-assisted writing. All UI code lives in `web/`.

## Success criteria

- Phase 2 (Draft Editor): side-by-side markdown editor + preview with review overlay, evaluation scores, and link verification badges
- Phase 3 (Co-pilot): streaming chat with context assembly (<30k tokens), pins, model toggle
- Phase 4 (Polish): article CRUD, detail panel, manual ingest, config viewer, real-time updates
- All phases: zero modification to pipeline scripts, all code in `web/`, tests pass, Vite builds clean

## Architecture constraints — non-negotiable

- All new code goes in `web/`. Pipeline scripts are **never** modified.
- Two servers: pipeline ingest (port 3847, unchanged), UI API (port 3900, new)
- API server reads `data/`, `output/`, `config/`, `logs/` — never imports pipeline modules
- Branch: `feature/web-ui` — pipeline runs from `master` via launchd
- Runtime: Bun, ES modules, sync file I/O. No `__dirname` — use `import.meta.dir`.
- Vite dev server on port 5173 proxies `/api` to 3900

## Environment

- **Runtime:** Bun 1.3.9 (ES modules, no CommonJS)
- **Node:** v22.17.1 (available but Bun is primary)
- **API key:** `ANTHROPIC_API_KEY` in `.env` (used by pipeline scripts via `loadEnvKey()` workaround for Bun >=1.3 .env bug)
- **No external services** — all data is local files. No database.
- **launchd:** Pipeline runs on schedule from `master` branch. Web UI runs from `feature/web-ui`.

## How to run

- **API server:** `bun --watch web/api/server.js` (port 3900)
- **Vite dev server:** `cd web/app && bun run dev` (port 5173, proxies `/api` to 3900)
- **Pipeline ingest server:** `bun scripts/server.js` (port 3847 — rarely needed for UI work)
- **Tests:** `cd web/api && bun test` (8 tests, 162 assertions)
- **Build:** `cd web/app && bun run build` (check for 0 errors)
- **Launch configs:** `.claude/launch.json` has `web-api` and `ingest-server`

## Known issues

- **`scripts/report.js` `getWeekNumber()`** uses naive day-of-year/7 math — produces wrong week numbers at year boundaries. Fix with date-fns when touched.
- **Bun >=1.3 `.env` bug:** `process.env` doesn't auto-load `.env`. Pipeline scripts use `loadEnvKey()` workaround. Web API doesn't need API keys yet (Phase 3 will).
- **CORS:** API server only allows `localhost:5173`. If Vite port changes, update `server.js`.

## Current phase status

- **Phase 1: Foundation** ✅ Complete (10 commits) — Dashboard, Articles, API server, design system
- **Phase 2: Draft Editor** 🔧 In progress (7/9 tasks — verification remaining)
- **Phase 3: Co-pilot** ⬜ Not started
- **Phase 4: Polish** ⬜ Not started

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
- **Hooks:** Return `{ data, loading, error }` shape. Always handle all three states.
- **Design system:** Dark mode. CSS custom properties in `web/app/src/styles/tokens.css`. Poppins (headings/UI) + Lora (body). See `coding-patterns.md` for full token list.
- **No inline styles** — use CSS classes. No hardcoded `rgba()` — use tokens.

## Domain terminology

- **Sector:** One of five news categories — general-ai, biopharma, medtech, manufacturing, insurance
- **Pipeline:** The automated fetch→score→draft→review→publish chain (scripts/, runs via launchd)
- **Ingest:** Manual article submission (separate from pipeline fetch)
- **Flagged:** Articles marked for editorial review (high relevance score or manual flag)
- **Week N:** Pipeline runs weekly; data directories named by week number (e.g., `data/verified/week-9/`)
- **Co-pilot:** AI chat assistant for editorial writing (Phase 3)

## Scott's preferences

- Detailed specs with exact code patterns, not prose descriptions
- Edge case and failure mode coverage for every component
- Build order with parallel identification for implementation efficiency
- UK English in newsletter output (single quotes, spaced en dashes, no Oxford commas)

## Project structure

```
sni-research-v2/
├── scripts/          # Pipeline — DO NOT MODIFY
├── config/           # Pipeline config — DO NOT MODIFY
├── data/             # Articles (verified/, review/) — API reads these
├── output/           # Drafts, reports, runs — API reads these
├── logs/             # Pipeline logs — API reads these
├── web/              # ALL UI CODE LIVES HERE
│   ├── api/          # Bun HTTP server (port 3900)
│   │   ├── server.js
│   │   ├── routes/   # articles.js, status.js (+ draft.js, chat.js in later phases)
│   │   └── lib/      # walk.js (shared dir traversal + validation)
│   └── app/          # Vite + React SPA
│       └── src/
│           ├── pages/       # Dashboard, Articles, Draft, Copilot
│           ├── components/  # layout/ (Shell, Sidebar)
│           ├── hooks/       # useStatus, useArticles, useFlaggedArticles, useDebouncedValue
│           ├── lib/         # api.js (fetch wrapper), format.js (dates, colours)
│           └── styles/      # tokens.css (design system)
├── docs/             # Specs, plans
└── .claude/          # Context files, launch.json
```
