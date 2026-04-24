# Coding Patterns

Established conventions from Phases 1–4. Follow these in all new code.

---

## API Server (`web/api/`)

### Server routing pattern

`Bun.serve()` with manual regex matching on `url.pathname`. No framework.

```js
// server.js pattern
const server = Bun.serve({
  port: 3900,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    try {
      if (path === '/api/endpoint' && req.method === 'GET') {
        return json(await handler())
      }

      // Dynamic routes use regex with safe captures
      const match = path.match(/^\/api\/articles\/(\d{4}-\d{2}-\d{2})\/([\w-]+)\/([\w-]+)$/)
      if (match && req.method === 'GET') { ... }

      return json({ error: 'Not found' }, 404)
    } catch (err) {
      return json({ error: err.message }, 500)
    }
  }
})
```

### Route handler pattern

Async functions in `routes/*.js`, exported and imported by `server.js`.

```js
// routes/example.js — GET (read-only)
import { walkArticleDir, validateParam } from '../lib/walk.js'

export async function getThings(query) {
  // Use walkArticleDir for directory traversal
  // Use validateParam for user-supplied path segments
  // Return plain objects — server.js wraps in json()
}
```

### Mutating route patterns (Phase 4)

PATCH and DELETE for articles use the same regex capture + `validateParam` pattern:

```js
// PATCH /api/articles/:date/:sector/:slug
const body = await req.json()
// Validate each field explicitly — never spread raw body into fs writes
if (body.flagged !== undefined) meta.flagged = Boolean(body.flagged)
await writeFile(metaPath, JSON.stringify(meta, null, 2))
return json(meta)
```

### Config route pattern (Phase 4)

GET returns parsed JSON; PUT uses write-validate-swap:

```js
// routes/config.js
import { readFileSync, writeFileSync, renameSync, copyFileSync } from 'fs'

export async function getConfig(name) {
  return JSON.parse(readFileSync(configPath(name), 'utf-8'))
}

export async function putConfig(name, body) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(body, null, 2))
  JSON.parse(readFileSync(tmp, 'utf-8'))   // validate round-trip
  copyFileSync(path, path + '.bak')        // backup
  renameSync(tmp, path)                    // atomic swap
  return JSON.parse(readFileSync(path, 'utf-8'))
}
```

**Key:** Use static `import { readFileSync, ... } from 'fs'` — not dynamic `import('fs')`. Bun resolves static imports correctly in tests.

### Path resolution

Always use `import.meta.dir` and `resolve()`:
```js
const ROOT = resolve(import.meta.dir, '../../..')  // from routes/ to project root
```

### Security

- Route regex: `([\w-]+)` for path captures (no `([^/]+)`)
- `validateParam(value, name)` throws on non-alphanumeric input
- CORS restricted to `http://localhost:5173`

### Query parsing

```js
function parseQuery(url) {
  const params = new URL(url).searchParams
  const obj = {}
  for (const [k, v] of params) obj[k] = v
  return obj
}
```

### Pagination

Collect all results, then slice:
```js
const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500)
const off = Math.max(parseInt(offset) || 0, 0)
return { articles: all.slice(off, off + lim), total: all.length, limit: lim, offset: off }
```

---

## React App (`web/app/`)

### Hook pattern

All hooks return `{ data, loading, error }` shape. Use `useCallback` for reloadable fetches.

```js
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useThings(filters = {}) {
  const [things, setThings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/things')
      setThings(data.things)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [/* deps */])

  useEffect(() => { load() }, [load])
  return { things, loading, error, reload: load }
}
```

### useConfig hook pattern (Phase 4)

For config read/write with `saving` state and mounted guard:

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from '../lib/api'

export function useConfig(name) {
  const mountedRef = useRef(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { return () => { mountedRef.current = false } }, [])

  // load() and save() guard all post-await state updates with:
  //   if (!mountedRef.current) return
  // save() re-throws errors so callers can react — but hook sets error state too.

  return { data, loading, error, saving, save, reload: load }
}
```

**Caller pattern** — all save handlers wrap in try/catch:
```jsx
async function handleSave() {
  if (!draft) return
  try {
    await save(draft)
    setDraft(null)
  } catch {
    // error state surfaced by hook — no extra handling needed
  }
}
```

### Mounted guard pattern (Phase 4)

Any hook that does async work must guard post-await state updates:

```js
const mountedRef = useRef(true)
useEffect(() => { return () => { mountedRef.current = false } }, [])

// In async functions:
const result = await apiFetch(...)
if (!mountedRef.current) return
setState(result)
```

Match the existing pattern in `useStatus.js` and `useConfig.js`.

### Page pattern

Pages handle their own loading/error/empty states:

```jsx
export default function MyPage() {
  const { data, loading, error } = useMyHook()

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>
  if (!data) return <div className="empty">No data available</div>

  return ( /* render data */ )
}
```

### API fetch wrapper

```js
// lib/api.js — all API calls go through this
export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API ${res.status}`)
  }
  return res.json()
}
```

### SSE streaming helper (Phase 3)

`apiStream()` sits alongside `apiFetch()` in `lib/api.js`. It returns the raw `Response` so the caller can consume the `ReadableStream`:

```js
export async function apiStream(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API ${res.status}`)
  }
  return res // caller reads res.body (ReadableStream)
}
```

Consumer parses SSE lines:
```js
const reader = res.body.getReader()
const decoder = new TextDecoder()
// Read chunks, split on \n\n, parse "data: {...}" lines
```

### Vite proxy

`vite.config.js` proxies `/api` to `http://localhost:3900`. React code uses relative paths (`/api/status`), never absolute URLs.

### SSE streaming response (API side, Phase 3)

Server returns `text/event-stream` using Bun's `ReadableStream`. SDK stream events are forwarded as SSE:

```js
return new Response(
  new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (obj) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      try {
        const stream = client.messages.stream({ model, messages, system, max_tokens })
        stream.on('text', text => send({ type: 'delta', text }))
        const final = await stream.finalMessage()
        send({ type: 'done', id: msgId, usage: final.usage })
      } catch (err) {
        send({ type: 'error', message: err.message })
      }
      controller.close()
    }
  }),
  { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...corsHeaders } }
)
```

### SDK client singleton (Phase 3)

Lazy initialisation with `loadEnvKey()` workaround:

```js
// web/api/lib/claude.js
import Anthropic from '@anthropic-ai/sdk'
import { loadEnvKey } from './env.js'

let _client = null
export function getClient() {
  if (_client) return _client
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) throw new Error('ANTHROPIC_API_KEY not found')
  _client = new Anthropic({ apiKey: key })
  return _client
}
```

`loadEnvKey()` is copied from `scripts/lib/env.js` to `web/api/lib/env.js` (isolation constraint — no cross-boundary imports).

---

## CSS Conventions

### No inline styles

All styling via CSS classes. Shared utility classes in `Shell.css`:
- `.placeholder-text` — centred secondary text for empty states
- `.loading`, `.empty` — loading/empty states (in `Dashboard.css`)

### No hardcoded rgba

All colours use CSS custom properties from `tokens.css`. If you need a new opacity variant, add a token.

### Per-page CSS

Each page has its own `.css` file imported at the top. Class names are unscoped (no CSS modules) — keep names descriptive to avoid collisions.

### Design token reference

```css
/* Core */
--terra: #D4714E;           /* Primary accent */
--terra-light: #e08a6a;     /* Hover */
--terra-dark: #c15f3c;      /* Active/pressed */
--pampas: #1a1816;          /* Page background */
--card-bg: #242220;         /* Card backgrounds */
--surface: #2c2a27;         /* Elevated surfaces */
--surface-hover: #353330;   /* Surface hover */
--sidebar-bg: #1e1c1a;      /* Sidebar */
--text-primary: #e8e6dc;    /* Primary text */
--cloudy: #8a8778;          /* Secondary text */
--light-gray: rgba(255,255,255,0.08);   /* Borders */
--hover-subtle: rgba(255,255,255,0.04); /* Subtle hover */
--terra-bg: rgba(212,113,78,0.1);       /* Active nav bg */

/* Sector badge backgrounds (15% opacity) */
--terra-15, --sage-15, --blue-15, --brown-15, --purple-15

/* Component backgrounds (Phase 4) */
--code-bg: rgba(255,255,255,0.06);   /* Inline code */
--pre-bg: rgba(0,0,0,0.3);          /* Code blocks */
--terra-25: rgba(212,113,78,0.25);   /* Active toggle bg */

/* Utility */
--stage-bg: rgba(255,255,255,0.03);
--focus-ring: 0 0 0 2px rgba(212,113,78,0.2);
--shadow-subtle: 0 0.25rem 1.25rem rgba(0,0,0,0.2);
--radius: 8px;
--radius-lg: 12px;
```

### Sector colours in JS

```js
// lib/format.js
export const SECTOR_COLOURS = {
  general:       { color: 'var(--terra)',   bg: 'var(--terra-15)' },
  biopharma:     { color: 'var(--sage)',    bg: 'var(--sage-15)' },
  medtech:       { color: 'var(--blue)',    bg: 'var(--blue-15)' },
  manufacturing: { color: 'var(--brown)',   bg: 'var(--brown-15)' },
  insurance:     { color: 'var(--purple)',  bg: 'var(--purple-15)' },
}
```

---

## Testing

### API tests

`web/api/tests/` using Bun's built-in test runner. Run with `cd web/api && bun test`.

Currently: 68 tests, 279 assertions covering articles (CRUD + inline actions), status, draft, chat (threads, pins, usage), context assembly, week calculation, config (read/write/validate-swap), ingest proxy, and last-updated polling.

### Build verification

`cd web/app && bunx vite build` — must produce 0 errors.

### Pipeline isolation

`bun scripts/pipeline.js --mode daily --dry-run` — must succeed regardless of web/ state.

---

## Shared principles module (Phase 7)

`scripts/lib/editorial-principles.js` is the single source of truth for the editorial rules — sector detection, evidence calibration, must-catch patterns, CEO empathy, prompt builders. It's imported by BOTH sides of the API boundary.

```js
// Fly-hosted drafting pipeline imports the shared module:
// web/api/lib/draft-flow.js
import {
  SECTORS,
  SECTOR_CEO_LABELS,
  detectSectors,
  buildEvidenceCalibrationSection,
  buildMustCatchPatternsSection,
  buildCEOEmpathySection,
  buildCEOCritiquePrompt,
  buildCEORevisionInstruction,
} from '../../../scripts/lib/editorial-principles.js'

// Local upstream audit imports the same module:
// scripts/lib/editorial-audit-lib.js
import { buildEvidenceCalibrationSection, buildMustCatchPatternsSection, buildCEOEmpathySection } from './editorial-principles.js'
```

**Fly image requirement:** the Dockerfile explicitly copies `scripts/lib/` — only scripts/lib/, not the scripts/ root:
```dockerfile
# Dockerfile
COPY scripts/lib/ ./scripts/lib/
```
If you add a new runtime import from scripts/lib/ in web/api/, the Dockerfile is already covered. If you ever move the module or split it across multiple dirs, update the Dockerfile copy directive.

**Never duplicate the principles text.** If a prompt needs them, it imports from this module. `config/prompts/editorial-analyse.v1.txt` is the one exception — it's a text file Claude Code reads at skill-run-time, so the principles are quoted inline there.

---

## Cost-protection guards (Phase 8)

Two layers protect against accidental API spend:

### Layer 1 — mandatory SNI_TEST_MODE on tests

`bunfig.toml` at BOTH project root and `web/api/` preloads a guard file before every `bun test`:

```toml
# web/api/bunfig.toml
[test]
preload = ["./tests/guard.ts"]
```

```ts
// web/api/tests/guard.ts
if (!process.env.SNI_TEST_MODE) {
  console.error('❌ SNI_TEST_MODE is not set. Refusing to run tests — they may hit real APIs or Turso writes.')
  console.error('   Run: SNI_TEST_MODE=1 bun test')
  process.exit(1)
}
```

The preload path MUST start with `./` — bun silently skips it otherwise.

### Layer 2 — getDb() refuses under test mode without the flag

```js
// web/api/lib/db.js
function isRunningUnderBunTest() {
  const argv1 = process.argv[1] || ''
  return /\.test\.(js|ts|jsx|tsx)$/.test(argv1)
}

export function getDb() {
  if (isRunningUnderBunTest() && !process.env.SNI_TEST_MODE) {
    throw new Error('getDb() called from bun test without SNI_TEST_MODE=1')
  }
  // ...
}
```

### Layer 3 — SDK maxRetries=0

```js
// web/api/lib/claude.js
_client = new Anthropic({ apiKey: key, maxRetries: 0 })
```

The SDK default is 2. On transient failures this 3x-multiplies token spend silently.

### Layer 4 — subprocess stubs

Pipeline scripts that `Bun.spawn()` other scripts check `SNI_TEST_MODE` and skip spawning. Look for the `TEST MODE — skipping spawn` log line.

---

## Claude-Code-native I/O scripts (Phase 7)

Pattern for scripts that want Claude Code reasoning without an Anthropic API call.

**Split into three CLI modes:**
1. `--list-targets` — output JSON with everything Claude Code needs (material to reason over, the system prompt)
2. `--print-principles` — output the system prompt text for inspection
3. `--apply-patches FILE` — accept a JSON patches file and apply them deterministically

**Canonical example: `scripts/editorial-audit-upstream.js`**

```js
// Mode switching
switch (opts.mode) {
  case 'list-targets':     return modeListTargets(opts)
  case 'print-principles': return modePrintPrinciples()
  case 'apply-patches':    return modeApplyPatches(opts)
}
```

**Slash command (`.claude/commands/editorial-audit-upstream.md`) drives the loop:**
1. `bun scripts/editorial-audit-upstream.js --list-targets --since YESTERDAY` → parse JSON → iterate batches
2. Claude Code reads each batch's `rendered` text + the shared `systemPrompt`, reasons, produces patches
3. Write patches to `/tmp/patches.json`
4. `bun scripts/editorial-audit-upstream.js --apply-patches /tmp/patches.json`

**Idempotency via audit-version stamping:**
```js
// scripts/lib/editorial-audit-lib.js
export const AUDIT_VERSION = 1

export function collectAuditTargets(state, opts) {
  const alreadyAudited = (state.editorialAudits || [])
    .filter(a => a.auditVersion === (opts.auditVersion ?? AUDIT_VERSION))
    .map(a => `${a.kind}:${a.id}`)
  // ... return only targets NOT in alreadyAudited
}
```

**Whitelist-guarded patch application:**
```js
const ANALYSIS_WHITELISTED_FIELDS = ['summary', 'keyThemes', 'postPotentialReasoning']
// Patches to any other field are rejected and logged
```

**Stale-snapshot rejection:**
```js
// oldValue must match current field text (whitespace-tolerant)
if (normaliseWhitespace(currentValue) !== normaliseWhitespace(patch.oldValue)) {
  skipped++
  continue
}
```

Use this pattern whenever the "LLM reasoning" step is better served by a subscription Claude Code session than a metered API call. Reserve callOpus for the Fly-hosted surfaces (the web app) and scripts that must run without Claude Code available.

---

## Pre-push deploy hook (Phase 8)

`scripts/git-hooks/pre-push` deploys to Fly BEFORE every push to master. If deploy fails, the push aborts — GitHub and Fly can never drift.

```bash
#!/usr/bin/env bash
# scripts/git-hooks/pre-push
set -e

z40="0000000000000000000000000000000000000000"
deploy_needed=0

while read -r local_ref local_sha remote_ref remote_sha; do
    case "$local_ref" in
        refs/heads/master|refs/heads/main)
            [ "$local_sha" = "$z40" ] && continue      # delete
            [ "$local_sha" = "$remote_sha" ] && continue  # no-op
            deploy_needed=1
            ;;
    esac
done

[ "$deploy_needed" -eq 0 ] && exit 0

if ! fly deploy --remote-only; then
    echo "[pre-push] Fly deploy FAILED — aborting push to keep origin and Fly in sync."
    exit 1
fi
```

**Activation (one-time per clone):**
```bash
git config core.hooksPath scripts/git-hooks
```

**Escape hatch:** `git push --no-verify` skips the hook for one push (docs-only change, or you've already deployed manually).

**Why not CI deploy:** a CI-based `fly deploy` would need `FLY_API_TOKEN` in GitHub Secrets. Keeping the token local (in `~/.fly/`) is simpler and more secure.

**Writing git hooks in the repo:** standard git hooks live in `.git/hooks/` (not tracked). Using `core.hooksPath` lets us track them in `scripts/git-hooks/` and activate via one config command on any clone.
