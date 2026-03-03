# SNI Research v2 — Web UI

## What this is

SNI (Sector News Intelligence) is an automated weekly newsletter pipeline covering AI news across five sectors: general AI, biopharma, medtech, manufacturing and insurance. It runs on Scott's Mac via launchd (fetch, score, draft, review, publish stages).

The **web UI** is a browser-based editorial workbench for monitoring the pipeline, curating articles, editing drafts and AI-assisted writing. All UI code lives in `web/`.

## Architecture constraints — non-negotiable

- All new code goes in `web/`. Pipeline scripts are **never** modified.
- Two servers: pipeline ingest (port 3847, unchanged), UI API (port 3900, new)
- API server reads `data/`, `output/`, `config/`, `logs/` — never imports pipeline modules
- Branch: `feature/web-ui` — pipeline runs from `master` via launchd
- Runtime: Bun, ES modules, sync file I/O. No `__dirname` — use `import.meta.dir`.
- Vite dev server on port 5173 proxies `/api` to 3900

## Current phase status

- **Phase 1: Foundation** ✅ Complete (10 commits) — Dashboard, Articles, API server, design system
- **Phase 2: Draft Editor** ⬜ Not started
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

## Key conventions

- **API routing:** `Bun.serve()` with regex matching on `url.pathname`. Route handlers in `web/api/routes/`.
- **Path safety:** Route regex uses `([\w-]+)` captures. Handlers call `validateParam()` from `web/api/lib/walk.js`.
- **React pages:** Self-contained in `web/app/src/pages/`. Hooks for data, CSS modules per page.
- **Hooks:** Return `{ data, loading, error }` shape. Always handle all three states.
- **Design system:** Dark mode. CSS custom properties in `web/app/src/styles/tokens.css`. Poppins (headings/UI) + Lora (body). See `coding-patterns.md` for full token list.
- **No inline styles** — use CSS classes. No hardcoded `rgba()` — use tokens.

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
