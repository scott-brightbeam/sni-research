# Draft Editor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a side-by-side draft editor with live markdown preview, review flag highlights, link verification badges, and evaluation scores placeholder.

**Architecture:** API route handler reads `output/draft-week-N.md` plus companion JSON files, returns a bundled response. React page renders a textarea editor beside a react-markdown preview with custom renderers for link badges and prohibited term highlights.

**Tech Stack:** Bun API (existing server.js pattern), React 19, react-markdown, existing design system tokens.

---

### Task 1: Install react-markdown

**Files:**
- Modify: `web/app/package.json`

**Step 1: Install the dependency**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun add react-markdown
```

**Step 2: Verify it installed**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun run build
```
Expected: Build succeeds with 0 errors.

**Step 3: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/app/package.json web/app/bun.lockb
git commit -m "deps: add react-markdown for draft preview"
```

---

### Task 2: API route — getDraft

**Files:**
- Create: `web/api/routes/draft.js`
- Create: `web/api/draft.test.js`

**Step 1: Write the failing test**

Create `web/api/draft.test.js`:

```js
import { describe, it, expect } from 'bun:test'
import { getDraft } from './routes/draft.js'

describe('getDraft', () => {
  it('returns draft bundle for latest week when no week specified', async () => {
    const result = await getDraft({})
    expect(result).toHaveProperty('week')
    expect(typeof result.week).toBe('number')
    expect(typeof result.draft).toBe('string')
    expect(result.draft.length).toBeGreaterThan(0)
    expect(result).toHaveProperty('review')
    expect(result).toHaveProperty('links')
    expect(result).toHaveProperty('evaluate')
    expect(Array.isArray(result.availableWeeks)).toBe(true)
    expect(result.availableWeeks.length).toBeGreaterThan(0)
  })

  it('returns draft for specific week', async () => {
    const result = await getDraft({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.draft).toContain('#')
  })

  it('returns 404 error for non-existent week', async () => {
    try {
      await getDraft({ week: '999' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('not found')
    }
  })

  it('returns null for missing companion files', async () => {
    const result = await getDraft({ week: '9' })
    // evaluate-week-9.json doesn't exist, should be null
    expect(result.evaluate).toBeNull()
  })

  it('review contains prohibited_found array when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.review) {
      expect(result.review).toHaveProperty('overall_pass')
      expect(Array.isArray(result.review.prohibited_found)).toBe(true)
    }
  })

  it('links contains summary and results when present', async () => {
    const result = await getDraft({ week: '9' })
    if (result.links) {
      expect(result.links).toHaveProperty('summary')
      expect(Array.isArray(result.links.results)).toBe(true)
    }
  })

  it('availableWeeks is sorted ascending', async () => {
    const result = await getDraft({})
    const sorted = [...result.availableWeeks].sort((a, b) => a - b)
    expect(result.availableWeeks).toEqual(sorted)
  })

  it('rejects invalid week param', async () => {
    try {
      await getDraft({ week: '../etc/passwd' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})
```

**Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: FAIL — `routes/draft.js` doesn't exist yet.

**Step 3: Implement getDraft**

Create `web/api/routes/draft.js`:

```js
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const OUTPUT = join(ROOT, 'output')

function readJsonSafe(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function getAvailableWeeks() {
  if (!existsSync(OUTPUT)) return []
  const weeks = []
  for (const f of readdirSync(OUTPUT)) {
    const m = f.match(/^draft-week-(\d+)\.md$/)
    if (m) weeks.push(parseInt(m[1]))
  }
  return weeks.sort((a, b) => a - b)
}

export async function getDraft({ week } = {}) {
  const available = getAvailableWeeks()
  if (available.length === 0) {
    throw Object.assign(new Error('No drafts found'), { status: 404 })
  }

  let weekNum
  if (week) {
    if (!/^\d+$/.test(week)) throw new Error(`Invalid week: ${week}`)
    weekNum = parseInt(week)
  } else {
    weekNum = available[available.length - 1]
  }

  const draftPath = join(OUTPUT, `draft-week-${weekNum}.md`)
  if (!existsSync(draftPath)) {
    throw Object.assign(new Error(`Draft for week ${weekNum} not found`), { status: 404 })
  }

  const draft = readFileSync(draftPath, 'utf-8')
  const review = readJsonSafe(join(OUTPUT, `review-week-${weekNum}.json`))
  const links = readJsonSafe(join(OUTPUT, `links-week-${weekNum}.json`))
  const evaluate = readJsonSafe(join(OUTPUT, `evaluate-week-${weekNum}.json`))

  return {
    week: weekNum,
    draft,
    review,
    links,
    evaluate,
    availableWeeks: available,
  }
}
```

**Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/api/routes/draft.js web/api/draft.test.js
git commit -m "feat(api): add getDraft route handler with tests"
```

---

### Task 3: API route — saveDraft

**Files:**
- Modify: `web/api/routes/draft.js`
- Modify: `web/api/draft.test.js`

**Step 1: Add failing tests to draft.test.js**

Append to `web/api/draft.test.js`:

```js
import { saveDraft } from './routes/draft.js'
// Update the import line at the top to include saveDraft

describe('saveDraft', () => {
  it('saves draft and returns full bundle', async () => {
    // Read original first so we can restore it
    const original = await getDraft({ week: '9' })
    const testContent = original.draft + '\n<!-- test edit -->'

    const result = await saveDraft({ week: '9' }, { draft: testContent })
    expect(result.week).toBe(9)
    expect(result.draft).toContain('<!-- test edit -->')
    expect(result).toHaveProperty('review')
    expect(result).toHaveProperty('links')
    expect(result).toHaveProperty('availableWeeks')

    // Restore original
    await saveDraft({ week: '9' }, { draft: original.draft })
  })

  it('rejects save to non-existent week', async () => {
    try {
      await saveDraft({ week: '999' }, { draft: 'test' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('not found')
    }
  })

  it('rejects empty draft content', async () => {
    try {
      await saveDraft({ week: '9' }, { draft: '' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('empty')
    }
  })

  it('rejects missing draft field', async () => {
    try {
      await saveDraft({ week: '9' }, {})
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('draft')
    }
  })
})
```

**Step 2: Run tests to verify new ones fail**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: New saveDraft tests FAIL, existing getDraft tests still PASS.

**Step 3: Implement saveDraft**

Add to `web/api/routes/draft.js`:

```js
import { writeFileSync } from 'fs'
// Add writeFileSync to the existing import from 'fs'

export async function saveDraft({ week } = {}, body = {}) {
  if (!week || !/^\d+$/.test(week)) throw new Error('Invalid week')

  const weekNum = parseInt(week)
  const draftPath = join(OUTPUT, `draft-week-${weekNum}.md`)
  if (!existsSync(draftPath)) {
    throw Object.assign(new Error(`Draft for week ${weekNum} not found`), { status: 404 })
  }

  if (!body.draft || typeof body.draft !== 'string') {
    throw new Error('Missing or invalid draft content')
  }
  if (body.draft.trim().length === 0) {
    throw new Error('Draft content cannot be empty')
  }

  writeFileSync(draftPath, body.draft, 'utf-8')

  // Return the full bundle (re-read everything)
  return getDraft({ week: String(weekNum) })
}
```

**Step 4: Run tests to verify all pass**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: All tests PASS (getDraft + saveDraft).

**Step 5: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/api/routes/draft.js web/api/draft.test.js
git commit -m "feat(api): add saveDraft with full-bundle response"
```

---

### Task 4: API route — getDraftHistory

**Files:**
- Modify: `web/api/routes/draft.js`
- Modify: `web/api/draft.test.js`

**Step 1: Add failing tests**

Append to `web/api/draft.test.js`:

```js
import { getDraftHistory } from './routes/draft.js'
// Update the import line at the top to include getDraftHistory

describe('getDraftHistory', () => {
  it('returns artifact existence map', async () => {
    const result = await getDraftHistory({ week: '9' })
    expect(result.week).toBe(9)
    expect(result.artifacts.draft).toBe(true)
    expect(result.artifacts.review).toBe(true)
    expect(result.artifacts.links).toBe(true)
    expect(result.artifacts.evaluate).toBe(false)
  })

  it('rejects invalid week', async () => {
    try {
      await getDraftHistory({ week: 'abc' })
      throw new Error('Should have thrown')
    } catch (err) {
      expect(err.message).toContain('Invalid')
    }
  })
})
```

**Step 2: Run tests to verify new ones fail**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: getDraftHistory tests FAIL.

**Step 3: Implement getDraftHistory**

Add to `web/api/routes/draft.js`:

```js
export async function getDraftHistory({ week } = {}) {
  if (!week || !/^\d+$/.test(week)) throw new Error('Invalid week')
  const weekNum = parseInt(week)

  return {
    week: weekNum,
    artifacts: {
      draft: existsSync(join(OUTPUT, `draft-week-${weekNum}.md`)),
      review: existsSync(join(OUTPUT, `review-week-${weekNum}.json`)),
      links: existsSync(join(OUTPUT, `links-week-${weekNum}.json`)),
      evaluate: existsSync(join(OUTPUT, `evaluate-week-${weekNum}.json`)),
    },
  }
}
```

**Step 4: Run tests**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test draft.test.js
```
Expected: All tests PASS.

**Step 5: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/api/routes/draft.js web/api/draft.test.js
git commit -m "feat(api): add getDraftHistory endpoint"
```

---

### Task 5: Wire draft routes into server.js

**Files:**
- Modify: `web/api/server.js:1-2` (add import)
- Modify: `web/api/server.js:61-67` (add routes before 404)

**Step 1: Add import**

At the top of `web/api/server.js`, add after line 2:

```js
import { getDraft, saveDraft, getDraftHistory } from './routes/draft.js'
```

**Step 2: Add route handlers**

In `web/api/server.js`, add before the `// --- Health ---` block (before line 62):

```js
      // --- Draft ---
      if (path === '/api/draft' && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getDraft(query))
      }

      if (path === '/api/draft' && req.method === 'PUT') {
        const query = parseQuery(req.url)
        const body = await req.json()
        return json(await saveDraft(query, body))
      }

      const historyMatch = path.match(/^\/api\/draft\/history$/)
      if (historyMatch && req.method === 'GET') {
        const query = parseQuery(req.url)
        return json(await getDraftHistory(query))
      }
```

**Step 3: Update error handling for status codes**

In the catch block of `server.js` (line 70-73), update to pass through status codes:

```js
    } catch (err) {
      console.error('API error:', err)
      return json({ error: err.message }, err.status || 500)
    }
```

**Step 4: Verify all existing tests still pass**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test
```
Expected: All tests PASS (articles + status + draft).

**Step 5: Manual smoke test**

Run:
```bash
curl -s http://localhost:3900/api/draft | head -c 200
```
Expected: JSON response with `week`, `draft`, `review`, etc.

```bash
curl -s http://localhost:3900/api/draft/history?week=9
```
Expected: `{"week":9,"artifacts":{"draft":true,"review":true,"links":true,"evaluate":false}}`

**Step 6: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/api/server.js
git commit -m "feat(api): wire draft routes into server"
```

---

### Task 6: useDraft hook

**Files:**
- Create: `web/app/src/hooks/useDraft.js`

**Step 1: Create the hook**

Create `web/app/src/hooks/useDraft.js`:

```js
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'

export function useDraft(initialWeek = null) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [editorContent, setEditorContent] = useState('')
  const [week, setWeek] = useState(initialWeek)

  const load = useCallback(async (w) => {
    setLoading(true)
    setError(null)
    try {
      const qs = w ? `?week=${w}` : ''
      const result = await apiFetch(`/api/draft${qs}`)
      setData(result)
      setEditorContent(result.draft)
      setWeek(result.week)
      setLoading(false)
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(week) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    if (!week) return
    setSaving(true)
    setSaveError(null)
    try {
      const result = await apiFetch(`/api/draft?week=${week}`, {
        method: 'PUT',
        body: JSON.stringify({ draft: editorContent }),
      })
      setData(result)
      setSavedAt(Date.now())
      setSaving(false)
    } catch (err) {
      setSaveError(err.message)
      setSaving(false)
    }
  }, [week, editorContent])

  const goToWeek = useCallback((w) => {
    setWeek(w)
    load(w)
  }, [load])

  const dirty = data ? editorContent !== data.draft : false

  return {
    // Data
    draft: editorContent,
    review: data?.review ?? null,
    links: data?.links ?? null,
    evaluate: data?.evaluate ?? null,
    week: data?.week ?? week,
    availableWeeks: data?.availableWeeks ?? [],
    // State
    loading,
    error,
    saving,
    saveError,
    savedAt,
    dirty,
    // Actions
    setDraft: setEditorContent,
    save,
    goToWeek,
    reload: () => load(week),
  }
}
```

**Step 2: Verify build**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun run build
```
Expected: Build succeeds.

**Step 3: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/app/src/hooks/useDraft.js
git commit -m "feat(app): add useDraft hook for draft editor state"
```

---

### Task 7: Draft page — basic layout and editor

**Files:**
- Rewrite: `web/app/src/pages/Draft.jsx`
- Create: `web/app/src/pages/Draft.css`

**Step 1: Write Draft.css**

Create `web/app/src/pages/Draft.css`:

```css
.draft-toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}

.draft-toolbar h2 {
  margin-right: auto;
}

.week-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Poppins', sans-serif;
  font-size: 14px;
  color: var(--cloudy);
}

.week-nav button {
  background: var(--surface);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  color: var(--text-primary);
  padding: 4px 10px;
  cursor: pointer;
  font-size: 14px;
}

.week-nav button:hover:not(:disabled) {
  background: var(--surface-hover);
}

.week-nav button:disabled {
  opacity: 0.3;
  cursor: default;
}

.btn-save {
  background: var(--terra);
  border: none;
  border-radius: var(--radius);
  color: white;
  padding: 6px 16px;
  font-family: 'Poppins', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn-save:hover:not(:disabled) {
  background: var(--terra-light);
}

.btn-save:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-save.saved {
  background: var(--sage);
}

.review-pill {
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 12px;
  border: none;
  cursor: pointer;
}

.review-pill.pass {
  background: rgba(111, 165, 132, 0.15);
  color: var(--sage);
}

.review-pill.fail {
  background: var(--terra-15);
  color: var(--terra);
}

.draft-panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: calc(100vh - 220px);
}

.draft-editor {
  display: flex;
  flex-direction: column;
}

.draft-editor textarea {
  flex: 1;
  background: var(--card-bg);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  color: var(--text-primary);
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 16px;
  resize: none;
  outline: none;
}

.draft-editor textarea:focus {
  border-color: var(--terra);
  box-shadow: var(--focus-ring);
}

.draft-preview {
  background: var(--card-bg);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius);
  padding: 24px;
  overflow-y: auto;
  font-family: 'Lora', Georgia, serif;
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-primary);
}

.draft-preview h1 { font-size: 24px; margin-bottom: 16px; font-family: 'Poppins', sans-serif; }
.draft-preview h2 { font-size: 18px; margin: 24px 0 12px; font-family: 'Poppins', sans-serif; color: var(--terra); }
.draft-preview h3 { font-size: 15px; margin: 16px 0 8px; font-family: 'Poppins', sans-serif; }
.draft-preview p { margin-bottom: 12px; }
.draft-preview ul, .draft-preview ol { margin-bottom: 12px; padding-left: 24px; }
.draft-preview li { margin-bottom: 4px; }
.draft-preview a { color: var(--blue); text-decoration: none; }
.draft-preview a:hover { text-decoration: underline; }
.draft-preview hr { border: none; border-top: 1px solid var(--light-gray); margin: 24px 0; }
.draft-preview blockquote {
  border-left: 3px solid var(--terra);
  padding-left: 16px;
  color: var(--cloudy);
  margin-bottom: 12px;
}

.link-badge {
  display: inline-block;
  font-size: 11px;
  margin-left: 4px;
  cursor: default;
}

.link-badge.ok { color: var(--sage); }
.link-badge.dead { color: var(--terra); }

.review-mark {
  background: rgba(212, 113, 78, 0.25);
  border-bottom: 2px solid var(--terra);
  cursor: help;
  position: relative;
}

.draft-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding: 8px 16px;
  background: var(--card-bg);
  border-radius: var(--radius);
  border: 1px solid var(--light-gray);
  font-family: 'Poppins', sans-serif;
  font-size: 12px;
  color: var(--cloudy);
}
```

**Step 2: Write Draft.jsx — basic layout without overlays**

Rewrite `web/app/src/pages/Draft.jsx`:

```jsx
import { useState, useMemo } from 'react'
import Markdown from 'react-markdown'
import { useDraft } from '../hooks/useDraft'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import './Draft.css'

export default function Draft() {
  const {
    draft, review, links, evaluate,
    week, availableWeeks,
    loading, error, saving, saveError, savedAt, dirty,
    setDraft, save, goToWeek,
  } = useDraft()

  const [showFlags, setShowFlags] = useState(true)
  const debouncedDraft = useDebouncedValue(draft, 300)

  const wordCount = useMemo(() => {
    if (!draft) return 0
    return draft.trim().split(/\s+/).filter(Boolean).length
  }, [draft])

  // Build link status map: url -> { status, httpStatus, responseTimeMs }
  const linkMap = useMemo(() => {
    if (!links?.results) return {}
    const map = {}
    for (const r of links.results) {
      map[r.url] = r
    }
    return map
  }, [links])

  // Build prohibited terms list
  const prohibitedTerms = useMemo(() => {
    if (!review?.prohibited_found) return []
    return review.prohibited_found.map(p => p.term)
  }, [review])

  const reviewIssueCount = review?.prohibited_found?.length ?? 0
  const reviewPass = review?.overall_pass ?? true

  // Unsaved changes guard for week nav
  const handleWeekNav = (w) => {
    if (dirty && !confirm('You have unsaved changes. Discard and navigate?')) return
    goToWeek(w)
  }

  const weekIdx = availableWeeks.indexOf(week)
  const hasPrev = weekIdx > 0
  const hasNext = weekIdx < availableWeeks.length - 1

  // Save button label
  const saveLabel = saving ? 'Saving...' : (savedAt && Date.now() - savedAt < 2000) ? 'Saved' : 'Save'
  const saveClass = `btn-save${(savedAt && Date.now() - savedAt < 2000) ? ' saved' : ''}`

  if (loading) return <div className="loading">Loading...</div>
  if (error) return <div className="empty">Failed to load: {error}</div>
  if (!draft && draft !== '') return <div className="empty">No draft found for this week</div>

  // Custom renderers for react-markdown
  const components = {
    a: ({ href, children }) => {
      const info = linkMap[href]
      return (
        <>
          <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
          {info && (
            <span
              className={`link-badge ${info.status === 'ok' ? 'ok' : 'dead'}`}
              title={`${info.httpStatus} — ${info.responseTimeMs}ms`}
            >
              {info.status === 'ok' ? '✓' : '✗'}
            </span>
          )}
        </>
      )
    },
    p: ({ children }) => {
      if (!showFlags || prohibitedTerms.length === 0) return <p>{children}</p>
      return <p>{highlightTerms(children, prohibitedTerms)}</p>
    },
    li: ({ children }) => {
      if (!showFlags || prohibitedTerms.length === 0) return <li>{children}</li>
      return <li>{highlightTerms(children, prohibitedTerms)}</li>
    },
  }

  return (
    <div>
      <div className="draft-toolbar">
        <h2>Draft</h2>
        <div className="week-nav">
          <button disabled={!hasPrev} onClick={() => handleWeekNav(availableWeeks[weekIdx - 1])}>◀</button>
          <span>Week {week}</span>
          <button disabled={!hasNext} onClick={() => handleWeekNav(availableWeeks[weekIdx + 1])}>▶</button>
        </div>
        <button className={saveClass} disabled={!dirty || saving} onClick={save}>
          {saveLabel}
        </button>
        {saveError && <span style={{ color: 'var(--terra)', fontSize: '12px' }}>{saveError}</span>}
        {review && (
          <button
            className={`review-pill ${reviewPass ? 'pass' : 'fail'}`}
            onClick={() => setShowFlags(f => !f)}
            title={showFlags ? 'Click to hide review flags' : 'Click to show review flags'}
          >
            {reviewPass ? 'Pass' : `${reviewIssueCount} issue${reviewIssueCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      <div className="draft-panes">
        <div className="draft-editor">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="draft-preview">
          <Markdown components={components}>{debouncedDraft}</Markdown>
        </div>
      </div>

      <div className="draft-footer">
        <span>
          {evaluate
            ? `Eval: ${JSON.stringify(evaluate).slice(0, 80)}`
            : 'Evaluation: No data available'
          }
        </span>
        <span>{wordCount.toLocaleString()} words</span>
      </div>
    </div>
  )
}

/**
 * Walk React children and highlight any text that contains prohibited terms.
 * Returns new children with <mark> wrappers around matched terms.
 */
function highlightTerms(children, terms) {
  if (!children) return children
  if (typeof children === 'string') {
    return highlightString(children, terms)
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => {
      if (typeof child === 'string') return <span key={i}>{highlightString(child, terms)}</span>
      return child
    })
  }
  return children
}

function highlightString(text, terms) {
  if (!terms.length) return text
  // Escape regex special chars and build pattern
  const escaped = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(pattern)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    pattern.test(part)
      ? <mark key={i} className="review-mark" title={`Prohibited: "${part}"`}>{part}</mark>
      : part
  )
}
```

**Step 3: Verify build**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun run build
```
Expected: Build succeeds with 0 errors.

**Step 4: Visual smoke test**

Open `http://localhost:5173/draft` in browser. Verify:
- Two-pane layout visible (editor left, preview right)
- Draft text appears in textarea and preview
- Week nav arrows visible
- Link badges appear after links in preview
- Review pill shows issue count

**Step 5: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add web/app/src/pages/Draft.jsx web/app/src/pages/Draft.css
git commit -m "feat(app): draft editor with side-by-side preview, link badges, review highlights"
```

---

### Task 8: Run full test suite and build verification

**Files:** None (verification only)

**Step 1: Run all API tests**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test
```
Expected: All tests PASS (articles + status + draft).

**Step 2: Run Vite build**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun run build
```
Expected: Build succeeds, 0 errors.

**Step 3: Run pipeline isolation check**

Run:
```bash
cd /Users/scott/Projects/sni-research-v2 && bun scripts/pipeline.js --mode daily --dry-run
```
Expected: Succeeds regardless of web/ changes.

**Step 4: Visual walkthrough**

Open `http://localhost:5173/draft`:
1. Verify draft loads with correct content
2. Type in editor → preview updates (300ms debounce)
3. Save button enables when content changes
4. Click Save → button shows "Saved" briefly, then disables
5. Week nav arrows work (if multiple weeks exist)
6. Link badges appear as green ✓ after links
7. Review pill shows issue count; click toggles highlight visibility
8. Bottom bar shows word count and eval placeholder

---

### Task 9: Update context files

**Files:**
- Modify: `/Users/scott/Projects/sni-research-v2/.claude/context/phase-status.md`

**Step 1: Update phase-status.md**

Update Phase 2 section from "Not started" to "Complete" with details of what was built, matching the format of the Phase 1 section.

**Step 2: Commit**

```bash
cd /Users/scott/Projects/sni-research-v2
git add .claude/context/phase-status.md
git commit -m "docs: update phase-status.md — Phase 2 complete"
```
