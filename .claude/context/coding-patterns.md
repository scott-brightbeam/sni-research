# Coding Patterns

Established conventions from Phase 1. Follow these in all new code.

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
// routes/example.js
import { walkArticleDir, validateParam } from '../lib/walk.js'

export async function getThings(query) {
  // Use walkArticleDir for directory traversal
  // Use validateParam for user-supplied path segments
  // Return plain objects — server.js wraps in json()
}
```

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

### Vite proxy

`vite.config.js` proxies `/api` to `http://localhost:3900`. React code uses relative paths (`/api/status`), never absolute URLs.

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

Currently: 8 tests, 162 assertions covering articles and status endpoints.

### Build verification

`cd web/app && bunx vite build` — must produce 0 errors.

### Pipeline isolation

`bun scripts/pipeline.js --mode daily --dry-run` — must succeed regardless of web/ state.
