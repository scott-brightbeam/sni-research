# Co-pilot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI editorial co-pilot (streaming chat with Claude) to the SNI Research web UI — both as a standalone `/copilot` page and a lightweight panel on the Draft page.

**Architecture:** Single `POST /api/chat` endpoint serves both surfaces. SSE streaming via Anthropic SDK. File-based persistence (JSONL for messages, JSON indexes for threads/pins, markdown for pipeline-readable pins). Context assembly loads tiered article corpus + pins + thread history, capped at ~28k tokens.

**Tech Stack:** Bun, `@anthropic-ai/sdk` (already in root package.json), React 19, SSE via ReadableStream, Bun test runner.

**Design doc:** `docs/plans/2026-03-04-copilot-design.md` — read sections 3-9 for complete data schemas, API contracts, and component specs.

---

## Dependency Graph

```
Task 1  (lib/env.js)         ─┐
Task 2  (lib/week.js + test) ─┤
Task 3  (lib/pricing.js)     ─┼─► Task 5 (context.js + test) ─► Task 7 (SSE streaming)
Task 4  (lib/claude.js)      ─┘                                       │
                                                                       ▼
Task 6  (thread + pin CRUD + tests) ──────────────────────► Task 8 (wire server.js)
                                                                       │
                                                                       ▼
Task 9  (apiStream helper) ──► Task 10 (useChat hook) ──► Task 12 (Copilot.jsx)
                               Task 11 (useChatPanel)  ──► Task 13 (DraftChatPanel)
                                                           Task 14 (Draft.jsx integration)
                                                                       │
                                                                       ▼
                                                            Task 15 (verification)
                                                            Task 16 (context files)
```

**Parallel groups:**
- Tasks 1-4 are independent (all lib files)
- Tasks 5-6 depend on 1-4 but are independent of each other
- Tasks 10-11 are independent of each other
- Tasks 12-14 are independent of each other

---

## Task 1: Create `web/api/lib/env.js`

**Files:**
- Create: `web/api/lib/env.js`

**Step 1: Write `loadEnvKey`**

Copy from `scripts/lib/env.js` with path adjusted for `web/api/lib/` depth:

```js
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export function loadEnvKey(key) {
  if (process.env[key]) return process.env[key]
  try {
    const envPath = join(ROOT, '.env')
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(new RegExp(`^${key}=(.+)$`))
      if (match) return match[1].trim()
    }
  } catch { /* .env missing is fine */ }
  return undefined
}
```

**Step 2: Verify it loads**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun -e "import { loadEnvKey } from './web/api/lib/env.js'; console.log('Key found:', !!loadEnvKey('ANTHROPIC_API_KEY'))"`

Expected: `Key found: true`

**Step 3: Commit**

```bash
git add web/api/lib/env.js
git commit -m "feat(api): add loadEnvKey for Anthropic SDK auth"
```

---

## Task 2: Create `web/api/lib/week.js` + test

**Files:**
- Create: `web/api/lib/week.js`
- Create: `web/api/week.test.js`

**Step 1: Write test**

```js
import { describe, it, expect } from 'bun:test'
import { getISOWeek, getWeekDateRange } from './lib/week.js'

describe('getISOWeek', () => {
  it('returns week 1 for Jan 1 2026 (Thursday)', () => {
    expect(getISOWeek(new Date('2026-01-01'))).toBe(1)
  })

  it('returns week 9 for Feb 23 2026 (Monday)', () => {
    expect(getISOWeek(new Date('2026-02-23'))).toBe(9)
  })

  it('returns week 10 for Mar 4 2026 (Wednesday)', () => {
    expect(getISOWeek(new Date('2026-03-04'))).toBe(10)
  })

  it('handles year boundary — Dec 31 2025 (Wednesday) is week 1 of 2026', () => {
    expect(getISOWeek(new Date('2025-12-31'))).toBe(1)
  })

  it('handles year boundary — Dec 29 2025 (Monday) is week 1 of 2026', () => {
    expect(getISOWeek(new Date('2025-12-29'))).toBe(1)
  })

  it('returns current week when called with no args', () => {
    const result = getISOWeek()
    expect(typeof result).toBe('number')
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(53)
  })
})

describe('getWeekDateRange', () => {
  it('returns Monday-Sunday for week 9 2026', () => {
    const { start, end } = getWeekDateRange(9, 2026)
    expect(start).toBe('2026-02-23')
    expect(end).toBe('2026-03-01')
  })

  it('returns Monday-Sunday for week 10 2026', () => {
    const { start, end } = getWeekDateRange(10, 2026)
    expect(start).toBe('2026-03-02')
    expect(end).toBe('2026-03-08')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test week.test.js`

Expected: FAIL — module not found

**Step 3: Write implementation**

```js
/**
 * week.js — ISO 8601 week number calculation
 *
 * Proper implementation: week 1 is the week containing the first Thursday of the year.
 * This avoids the naive day-of-year/7 bug in scripts/report.js.
 */

export function getISOWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  // Calculate week number
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

export function getWeekDateRange(week, year = new Date().getFullYear()) {
  // Find Jan 4 (always in week 1) then work backwards to Monday of week 1
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dayOfWeek = jan4.getUTCDay() || 7
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1)

  // Monday of target week
  const monday = new Date(mondayWeek1)
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7)

  // Sunday of target week
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  const fmt = d => d.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(sunday) }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test week.test.js`

Expected: All 8 tests PASS

**Step 5: Commit**

```bash
git add web/api/lib/week.js web/api/week.test.js
git commit -m "feat(api): add ISO 8601 week calculation"
```

---

## Task 3: Create `web/api/lib/pricing.js`

**Files:**
- Create: `web/api/lib/pricing.js`

**Step 1: Write pricing module**

```js
export const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-6':           { inputPerMTok: 5, outputPerMTok: 25 },
}

export const MODELS = Object.keys(MODEL_PRICING)
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

export function estimateCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok
}

export function formatCost(cost) {
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}
```

**Step 2: Quick verification**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun -e "import { estimateCost, formatCost } from './web/api/lib/pricing.js'; console.log(formatCost(estimateCost('claude-sonnet-4-20250514', 12500, 850)))"`

Expected: `$0.05` (or similar small amount)

**Step 3: Commit**

```bash
git add web/api/lib/pricing.js
git commit -m "feat(api): add model pricing and token formatting"
```

---

## Task 4: Create `web/api/lib/claude.js`

**Files:**
- Create: `web/api/lib/claude.js`

**Step 1: Write SDK client singleton**

```js
import Anthropic from '@anthropic-ai/sdk'
import { loadEnvKey } from './env.js'

let _client = null

export function getClient() {
  if (_client) return _client
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) {
    const err = new Error('ANTHROPIC_API_KEY not found in environment or .env')
    err.status = 500
    throw err
  }
  _client = new Anthropic({ apiKey: key })
  return _client
}
```

**Step 2: Verify import resolves**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun -e "import { getClient } from './web/api/lib/claude.js'; const c = getClient(); console.log('Client created:', !!c)"`

Expected: `Client created: true`

**Step 3: Commit**

```bash
git add web/api/lib/claude.js
git commit -m "feat(api): add Anthropic SDK client singleton"
```

---

## Task 5: Create `web/api/lib/context.js` + test

**Files:**
- Create: `web/api/lib/context.js`
- Create: `web/api/context.test.js`

This is the context assembly module. It loads articles, pins, and thread history, then builds a messages array for the SDK call.

**Step 1: Write test**

```js
import { describe, it, expect } from 'bun:test'
import { buildArticleContext, estimateTokens, trimHistory } from './lib/context.js'

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('buildArticleContext', () => {
  it('returns a string with article summaries', () => {
    const articles = [
      { title: 'Test Article', source: 'Test Source', sector: 'general', date_published: '2026-03-03', snippet: 'A short snippet about AI.', score: 90 },
      { title: 'Another One', source: 'Source 2', sector: 'biopharma', date_published: '2026-03-02', snippet: 'Biopharma news snippet.', score: 50 },
    ]
    const result = buildArticleContext(articles, 30)
    expect(result).toContain('Test Article')
    expect(result).toContain('Another One')
  })

  it('includes full snippets for top N articles', () => {
    const articles = Array.from({ length: 5 }, (_, i) => ({
      title: `Article ${i}`, source: `Src ${i}`, sector: 'general',
      date_published: '2026-03-03', snippet: `Full snippet for article ${i}.`, score: 100 - i * 10,
    }))
    const result = buildArticleContext(articles, 2)
    // Top 2 should have full snippet
    expect(result).toContain('Full snippet for article 0')
    expect(result).toContain('Full snippet for article 1')
    // Rest should NOT have full snippet
    expect(result).not.toContain('Full snippet for article 2')
  })
})

describe('trimHistory', () => {
  it('returns all messages when under budget', () => {
    const msgs = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const result = trimHistory(msgs, 10000)
    expect(result).toHaveLength(2)
  })

  it('trims oldest messages when over budget', () => {
    const msgs = [
      { role: 'user', content: 'a'.repeat(4000) },    // ~1000 tokens
      { role: 'assistant', content: 'b'.repeat(4000) }, // ~1000 tokens
      { role: 'user', content: 'c'.repeat(4000) },      // ~1000 tokens
      { role: 'assistant', content: 'd'.repeat(4000) },  // ~1000 tokens
    ]
    const result = trimHistory(msgs, 2500)
    // Should keep the most recent messages that fit
    expect(result.length).toBeLessThan(4)
    expect(result[result.length - 1].content).toBe('d'.repeat(4000))
  })

  it('always keeps at least the last message', () => {
    const msgs = [{ role: 'user', content: 'a'.repeat(40000) }]
    const result = trimHistory(msgs, 100)
    expect(result).toHaveLength(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test context.test.js`

Expected: FAIL — module not found

**Step 3: Write implementation**

```js
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'
import { getWeekDateRange } from './week.js'

const ROOT = resolve(import.meta.dir, '../../..')

const COPILOT_SYSTEM = `You are an editorial analyst for Sector News Intelligence (SNI), a weekly newsletter covering AI news across five sectors: general AI, biopharma, medtech, manufacturing, and insurance.

Your role is to help the editor identify themes, compare stories, spot cross-sector connections, and draft paragraphs for the newsletter.

Style guidelines:
- UK English (single quotes, spaced en dashes, no Oxford commas)
- Analytical but accessible tone
- Always cite specific articles from the context when making claims
- Flag when you are speculating vs summarising reported facts

You have access to this week's article corpus and any pinned editorial notes.`

const DRAFT_SYSTEM = `You are an editorial assistant helping refine a newsletter draft for Sector News Intelligence (SNI).

You can see the current draft markdown. Help with:
- Rewriting paragraphs for clarity or tone
- Checking factual consistency with the source articles
- Suggesting structural improvements
- UK English conventions (single quotes, spaced en dashes, no Oxford commas)

Be concise. Return edited text that can be copied directly into the draft.`

export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function buildArticleContext(articles, topN = 30) {
  if (!articles || articles.length === 0) return '(No articles available this week.)'

  // Sort by score descending
  const sorted = [...articles].sort((a, b) => (b.score || 0) - (a.score || 0))

  const lines = [`## This Week's Articles (${articles.length} total)\n`]

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (i < topN) {
      // Full detail
      lines.push(`### ${a.title}`)
      lines.push(`- Source: ${a.source} | Sector: ${a.sector} | Date: ${a.date_published}`)
      if (a.snippet) lines.push(`- ${a.snippet.slice(0, 500)}`)
      lines.push('')
    } else {
      // Title only
      lines.push(`- ${a.title} (${a.sector}, ${a.source})`)
    }
  }

  return lines.join('\n')
}

export function trimHistory(messages, tokenBudget) {
  if (!messages || messages.length === 0) return []

  // Always keep at least the last message
  let total = 0
  const kept = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i].content)
    if (kept.length > 0 && total + tokens > tokenBudget) break
    kept.unshift(messages[i])
    total += tokens
  }

  return kept
}

export function loadArticlesForWeek(week, year) {
  const { start, end } = getWeekDateRange(week, year)
  const startDate = new Date(start)
  const endDate = new Date(end)
  const articles = []
  const verifiedDir = join(ROOT, 'data/verified')

  if (!existsSync(verifiedDir)) return articles

  for (const dateDir of readdirSync(verifiedDir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
    const d = new Date(dateDir)
    if (d < startDate || d > endDate) continue

    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue

    for (const sector of readdirSync(datePath)) {
      const sectorPath = join(datePath, sector)
      if (!statSync(sectorPath).isDirectory()) continue

      for (const f of readdirSync(sectorPath).filter(f => f.endsWith('.json'))) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          articles.push({
            title: raw.title || basename(f, '.json'),
            source: raw.source || 'Unknown',
            sector,
            date_published: raw.date_published || dateDir,
            snippet: raw.snippet || '',
            score: raw.score || 0,
            slug: basename(f, '.json'),
            date: dateDir,
          })
        } catch { /* skip malformed */ }
      }
    }
  }

  return articles
}

export function loadArticleFullText(date, sector, slug) {
  const mdPath = join(ROOT, 'data/verified', date, sector, `${slug}.md`)
  const jsonPath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)

  let text = ''
  if (existsSync(mdPath)) {
    text = readFileSync(mdPath, 'utf-8')
  } else if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
      text = raw.full_text || raw.snippet || ''
    } catch { /* skip */ }
  }
  return text
}

export function loadPins(week) {
  const pinsFile = join(ROOT, `data/copilot/pins/week-${week}/pins.json`)
  if (!existsSync(pinsFile)) return []
  try {
    return JSON.parse(readFileSync(pinsFile, 'utf-8'))
  } catch { return [] }
}

export function buildPinContext(pins) {
  if (!pins || pins.length === 0) return ''
  const lines = ['\n## Pinned Editorial Notes\n']
  for (const pin of pins) {
    lines.push(`- ${pin.preview}`)
  }
  return lines.join('\n')
}

export function assembleContext({ week, year, threadHistory, articleRef, ephemeral, draftContext }) {
  const TOKEN_BUDGET = 28000  // leave 2k for response
  let used = 0

  // 1. System prompt
  const systemPrompt = ephemeral ? DRAFT_SYSTEM : COPILOT_SYSTEM
  used += estimateTokens(systemPrompt)

  // 2. Draft context (ephemeral only) or article context
  let contextBlock = ''
  if (ephemeral && draftContext) {
    contextBlock = `## Current Draft\n\n${draftContext}`
  } else {
    const articles = loadArticlesForWeek(week, year)
    contextBlock = buildArticleContext(articles, 30)
  }

  // 3. Article injection
  let injectedArticle = ''
  if (articleRef) {
    const fullText = loadArticleFullText(articleRef.date, articleRef.sector, articleRef.slug)
    if (fullText) {
      injectedArticle = `\n## Full Article: ${articleRef.slug}\n\n${fullText.slice(0, 8000)}\n`
    }
  }

  // 4. Pins
  const pins = loadPins(week)
  const pinBlock = buildPinContext(pins)

  // 5. Assemble the user-context preamble
  const preamble = [contextBlock, injectedArticle, pinBlock].filter(Boolean).join('\n')
  used += estimateTokens(preamble)

  // 6. Trim thread history to fit remaining budget
  const historyBudget = TOKEN_BUDGET - used
  const trimmedHistory = trimHistory(threadHistory || [], Math.max(historyBudget, 2000))

  return { systemPrompt, preamble, trimmedHistory }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test context.test.js`

Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add web/api/lib/context.js web/api/context.test.js
git commit -m "feat(api): add context assembly with tiered articles and token budgeting"
```

---

## Task 6: Create thread + pin CRUD in `web/api/routes/chat.js` + test

**Files:**
- Create: `web/api/routes/chat.js`
- Create: `web/api/chat.test.js`

This task builds the non-streaming endpoints: thread CRUD, pin CRUD, usage. Streaming comes in Task 7.

**Step 1: Write tests**

```js
import { describe, it, expect, beforeAll } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  listThreads, createThread, renameThread, getHistory,
  createPin, listPins, deletePin, getUsage
} from './routes/chat.js'

const ROOT = resolve(import.meta.dir, '..')
const TEST_WEEK = 99

// Clean up test data before running
beforeAll(() => {
  const chatDir = join(ROOT, `data/copilot/chats/week-${TEST_WEEK}`)
  const pinDir = join(ROOT, `data/copilot/pins/week-${TEST_WEEK}`)
  if (existsSync(chatDir)) rmSync(chatDir, { recursive: true })
  if (existsSync(pinDir)) rmSync(pinDir, { recursive: true })
})

describe('Thread CRUD', () => {
  let threadId

  it('createThread returns id and auto-generated name', async () => {
    const result = await createThread({ week: TEST_WEEK })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('name')
    expect(typeof result.id).toBe('string')
    threadId = result.id
  })

  it('createThread with explicit name', async () => {
    const result = await createThread({ week: TEST_WEEK, name: 'Biopharma deep dive' })
    expect(result.name).toBe('Biopharma deep dive')
  })

  it('listThreads returns all threads for a week', async () => {
    const result = await listThreads({ week: TEST_WEEK })
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('name')
    expect(result[0]).toHaveProperty('created')
  })

  it('renameThread updates the name', async () => {
    const result = await renameThread({ id: threadId, name: 'Renamed thread' })
    expect(result.name).toBe('Renamed thread')

    const threads = await listThreads({ week: TEST_WEEK })
    const found = threads.find(t => t.id === threadId)
    expect(found.name).toBe('Renamed thread')
  })

  it('getHistory returns empty array for new thread', async () => {
    const result = await getHistory({ week: TEST_WEEK, thread: threadId })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0)
  })

  it('listThreads for non-existent week returns empty', async () => {
    const result = await listThreads({ week: 999 })
    expect(result).toEqual([])
  })
})

describe('Pin CRUD', () => {
  let pinId

  it('createPin returns id and preview', async () => {
    const result = await createPin({
      week: TEST_WEEK,
      threadId: 'abc',
      messageId: 'msg_001',
      text: 'Three main themes emerged in biopharma this week: M&A activity, AI drug discovery, and regulatory shifts.',
    })
    expect(result).toHaveProperty('id')
    expect(result).toHaveProperty('preview')
    pinId = result.id
  })

  it('listPins returns pins for the week', async () => {
    const result = await listPins({ week: TEST_WEEK })
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0]).toHaveProperty('id')
    expect(result[0]).toHaveProperty('threadId')
  })

  it('pin markdown file exists with frontmatter', async () => {
    const pinDir = join(ROOT, `data/copilot/pins/week-${TEST_WEEK}`)
    const pinFile = join(pinDir, `${pinId}.md`)
    expect(existsSync(pinFile)).toBe(true)
  })

  it('deletePin removes the pin', async () => {
    const result = await deletePin({ id: pinId, week: TEST_WEEK })
    expect(result.ok).toBe(true)

    const pins = await listPins({ week: TEST_WEEK })
    expect(pins).toHaveLength(0)
  })
})

describe('Usage', () => {
  it('getUsage returns token counts', async () => {
    const result = await getUsage({ period: 'today' })
    expect(result).toHaveProperty('inputTokens')
    expect(result).toHaveProperty('outputTokens')
    expect(result).toHaveProperty('estimatedCost')
    expect(result).toHaveProperty('ceiling')
    expect(result).toHaveProperty('remaining')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test chat.test.js`

Expected: FAIL — module not found

**Step 3: Write implementation**

This is a large file. The route handler exports are: `listThreads`, `createThread`, `renameThread`, `getHistory`, `createPin`, `listPins`, `deletePin`, `getUsage`, and `handleChat` (Task 7).

```js
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, appendFileSync } from 'fs'
import { join, resolve } from 'path'
import { getClient } from '../lib/claude.js'
import { assembleContext, estimateTokens } from '../lib/context.js'
import { estimateCost, formatCost, DEFAULT_MODEL, MODELS } from '../lib/pricing.js'
import { getISOWeek } from '../lib/week.js'

const ROOT = resolve(import.meta.dir, '../../..')
const COPILOT_DIR = join(ROOT, 'data/copilot')
const DAILY_TOKEN_CEILING = 500_000

// In-memory daily usage counter (resets on server restart)
let _dailyUsage = { date: '', inputTokens: 0, outputTokens: 0 }

function today() { return new Date().toISOString().slice(0, 10) }

function resetDailyIfNeeded() {
  if (_dailyUsage.date !== today()) {
    _dailyUsage = { date: today(), inputTokens: 0, outputTokens: 0 }
  }
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

// ─── Thread CRUD ────────────────────────────────────────────────────────────

function chatDir(week) { return join(COPILOT_DIR, `chats/week-${week}`) }
function pinDir(week) { return join(COPILOT_DIR, `pins/week-${week}`) }

function readThreadIndex(week) {
  const file = join(chatDir(week), 'threads.json')
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return [] }
}

function writeThreadIndex(week, threads) {
  const dir = chatDir(week)
  ensureDir(dir)
  writeFileSync(join(dir, 'threads.json'), JSON.stringify(threads, null, 2))
}

export async function listThreads({ week }) {
  if (!week) week = getISOWeek()
  return readThreadIndex(week)
}

export async function createThread({ week, name }) {
  if (!week) week = getISOWeek()
  const id = generateId()
  const now = new Date().toISOString()
  const thread = {
    id,
    name: name || `New thread`,
    created: now,
    updated: now,
    messageCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    estimatedCost: 0,
  }

  const threads = readThreadIndex(week)
  threads.push(thread)
  writeThreadIndex(week, threads)

  return { id: thread.id, name: thread.name }
}

export async function renameThread({ id, name, week }) {
  if (!week) {
    // Find which week has this thread
    const copilotChats = join(COPILOT_DIR, 'chats')
    if (existsSync(copilotChats)) {
      for (const dir of readdirSync(copilotChats)) {
        const m = dir.match(/^week-(\d+)$/)
        if (!m) continue
        const threads = readThreadIndex(parseInt(m[1]))
        if (threads.some(t => t.id === id)) { week = parseInt(m[1]); break }
      }
    }
  }
  if (!week) throw Object.assign(new Error('Thread not found'), { status: 404 })

  const threads = readThreadIndex(week)
  const thread = threads.find(t => t.id === id)
  if (!thread) throw Object.assign(new Error('Thread not found'), { status: 404 })

  thread.name = name
  thread.updated = new Date().toISOString()
  writeThreadIndex(week, threads)

  return { id: thread.id, name: thread.name }
}

export async function getHistory({ week, thread }) {
  if (!week || !thread) throw Object.assign(new Error('week and thread required'), { status: 400 })
  const file = join(chatDir(week), `thread-${thread}.jsonl`)
  if (!existsSync(file)) return []

  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
}

// ─── Pin CRUD ───────────────────────────────────────────────────────────────

function readPinIndex(week) {
  const file = join(pinDir(week), 'pins.json')
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return [] }
}

function writePinIndex(week, pins) {
  const dir = pinDir(week)
  ensureDir(dir)
  writeFileSync(join(dir, 'pins.json'), JSON.stringify(pins, null, 2))
}

export async function createPin({ week, threadId, messageId, text }) {
  if (!week || !text) throw Object.assign(new Error('week and text required'), { status: 400 })

  const id = `pin-${generateId()}`
  const now = new Date().toISOString()
  const preview = text.slice(0, 200)

  // Write markdown file with YAML frontmatter (pipeline-readable)
  const dir = pinDir(week)
  ensureDir(dir)
  const md = `---\nid: ${id}\nthreadId: ${threadId || 'ephemeral'}\nmessageId: ${messageId || 'unknown'}\nweek: ${week}\ncreated: ${now}\n---\n\n${text}\n`
  writeFileSync(join(dir, `${id}.md`), md)

  // Update index
  const pins = readPinIndex(week)
  pins.push({ id, threadId, messageId, week: parseInt(week), preview, created: now })
  writePinIndex(week, pins)

  return { id, preview }
}

export async function listPins({ week }) {
  if (!week) week = getISOWeek()
  return readPinIndex(week)
}

export async function deletePin({ id, week }) {
  if (!id) throw Object.assign(new Error('id required'), { status: 400 })

  if (!week) {
    // Find which week has this pin
    const pinsBase = join(COPILOT_DIR, 'pins')
    if (existsSync(pinsBase)) {
      for (const dir of readdirSync(pinsBase)) {
        const m = dir.match(/^week-(\d+)$/)
        if (!m) continue
        const pins = readPinIndex(parseInt(m[1]))
        if (pins.some(p => p.id === id)) { week = parseInt(m[1]); break }
      }
    }
  }
  if (!week) throw Object.assign(new Error('Pin not found'), { status: 404 })

  // Remove markdown file
  const mdFile = join(pinDir(week), `${id}.md`)
  if (existsSync(mdFile)) rmSync(mdFile)

  // Update index
  const pins = readPinIndex(week).filter(p => p.id !== id)
  writePinIndex(week, pins)

  return { ok: true }
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export async function getUsage({ period }) {
  resetDailyIfNeeded()
  const cost = estimateCost(DEFAULT_MODEL, _dailyUsage.inputTokens, _dailyUsage.outputTokens)
  return {
    inputTokens: _dailyUsage.inputTokens,
    outputTokens: _dailyUsage.outputTokens,
    estimatedCost: cost,
    ceiling: DAILY_TOKEN_CEILING,
    remaining: Math.max(0, DAILY_TOKEN_CEILING - _dailyUsage.inputTokens - _dailyUsage.outputTokens),
  }
}

// ─── Streaming Chat (Task 7) ────────────────────────────────────────────────

// Placeholder — implemented in Task 7
export async function handleChat(req) {
  throw Object.assign(new Error('Not implemented yet'), { status: 501 })
}

// ─── Internal helpers (exported for Task 7) ─────────────────────────────────

export function _appendMessage(week, threadId, message) {
  const dir = chatDir(week)
  ensureDir(dir)
  const file = join(dir, `thread-${threadId}.jsonl`)
  appendFileSync(file, JSON.stringify(message) + '\n')
}

export function _updateThreadStats(week, threadId, inputTokens, outputTokens, model) {
  const threads = readThreadIndex(week)
  const thread = threads.find(t => t.id === threadId)
  if (!thread) return
  thread.messageCount += 2 // user + assistant
  thread.totalInputTokens += inputTokens
  thread.totalOutputTokens += outputTokens
  thread.estimatedCost = estimateCost(model, thread.totalInputTokens, thread.totalOutputTokens)
  thread.updated = new Date().toISOString()
  writeThreadIndex(week, threads)
}

export function _recordDailyUsage(inputTokens, outputTokens) {
  resetDailyIfNeeded()
  _dailyUsage.inputTokens += inputTokens
  _dailyUsage.outputTokens += outputTokens
}

export function _checkDailyCeiling() {
  resetDailyIfNeeded()
  const total = _dailyUsage.inputTokens + _dailyUsage.outputTokens
  if (total >= DAILY_TOKEN_CEILING) {
    const err = new Error(`Daily token ceiling reached (${total}/${DAILY_TOKEN_CEILING}). Try again tomorrow or restart the server.`)
    err.status = 429
    throw err
  }
  return { total, ceiling: DAILY_TOKEN_CEILING, warningAt80: total >= DAILY_TOKEN_CEILING * 0.8 }
}

export function _autoNameThread(week, threadId, firstMessage) {
  const threads = readThreadIndex(week)
  const thread = threads.find(t => t.id === threadId)
  if (!thread || thread.name !== 'New thread') return
  thread.name = firstMessage.slice(0, 50).replace(/\n/g, ' ').trim() || 'New thread'
  writeThreadIndex(week, threads)
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test chat.test.js`

Expected: All 11 tests PASS

**Step 5: Verify existing tests still pass**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`

Expected: All tests pass (existing 22 + new chat + context + week)

**Step 6: Commit**

```bash
git add web/api/routes/chat.js web/api/chat.test.js
git commit -m "feat(api): add thread CRUD, pin CRUD, and usage tracking"
```

---

## Task 7: Implement SSE streaming in `handleChat`

**Files:**
- Modify: `web/api/routes/chat.js` — replace `handleChat` placeholder

**Step 1: Replace the handleChat placeholder**

Replace the placeholder function with the full SSE streaming implementation:

```js
export async function handleChat(req) {
  const body = await req.json()
  const { message, model, threadId, ephemeral, draftContext, articleRef } = body

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(new Error('message is required'), { status: 400 })
  }

  const selectedModel = MODELS.includes(model) ? model : DEFAULT_MODEL
  const week = body.week || getISOWeek()

  // Check daily ceiling
  _checkDailyCeiling()

  // If non-ephemeral and threadId provided, load history
  let threadHistory = []
  if (!ephemeral && threadId) {
    threadHistory = await getHistory({ week, thread: threadId })
  }

  // Assemble context
  const { systemPrompt, preamble, trimmedHistory } = assembleContext({
    week,
    threadHistory,
    articleRef,
    ephemeral: !!ephemeral,
    draftContext,
  })

  // Build SDK messages array
  const sdkMessages = []

  // First message includes the preamble as a user message
  if (preamble && trimmedHistory.length === 0) {
    sdkMessages.push({ role: 'user', content: `${preamble}\n\n---\n\n${message}` })
  } else if (preamble) {
    sdkMessages.push({ role: 'user', content: preamble })
    sdkMessages.push({ role: 'assistant', content: 'I\'ve reviewed the context. What would you like to discuss?' })
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: message })
  } else {
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: message })
  }

  // Create abort controller linked to request signal
  const abort = new AbortController()
  if (req.signal) {
    req.signal.addEventListener('abort', () => abort.abort())
  }

  const client = getClient()
  const msgId = `msg_${generateId()}`
  const userMsgId = `msg_${generateId()}`
  const now = new Date().toISOString()

  // Return SSE stream
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'http://localhost:5173',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (data) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch { /* stream closed */ }
      }

      let fullText = ''
      let usage = null

      try {
        const response = await client.messages.create({
          model: selectedModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: sdkMessages,
          stream: true,
        })

        for await (const event of response) {
          if (abort.signal.aborted) break

          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text
            send({ type: 'delta', text: event.delta.text })
          }

          if (event.type === 'message_delta' && event.usage) {
            usage = {
              input_tokens: (response.usage?.input_tokens || 0) + (event.usage?.input_tokens || 0),
              output_tokens: event.usage?.output_tokens || 0,
            }
          }

          if (event.type === 'message_start' && event.message?.usage) {
            usage = { ...usage, input_tokens: event.message.usage.input_tokens }
          }
        }

        // Finalise usage from response
        if (!usage) usage = { input_tokens: 0, output_tokens: 0 }

        // Persist if not ephemeral
        if (!ephemeral && threadId) {
          const userMsg = { id: userMsgId, role: 'user', content: message, model: selectedModel, timestamp: now, usage: null, articleRef: articleRef || null }
          const assistantMsg = { id: msgId, role: 'assistant', content: fullText, model: selectedModel, timestamp: new Date().toISOString(), usage, articleRef: null }

          _appendMessage(week, threadId, userMsg)
          _appendMessage(week, threadId, assistantMsg)
          _updateThreadStats(week, threadId, usage.input_tokens, usage.output_tokens, selectedModel)
          _autoNameThread(week, threadId, message)
        }

        // Record daily usage
        _recordDailyUsage(usage.input_tokens, usage.output_tokens)

        send({ type: 'done', id: msgId, usage })
      } catch (err) {
        if (!abort.signal.aborted) {
          send({ type: 'error', message: err.message || 'Stream error' })
        }
      } finally {
        try { controller.close() } catch { /* already closed */ }
      }
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      ...corsHeaders,
    },
  })
}
```

**Step 2: Manual verification (requires running API server)**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun --watch web/api/server.js` (after Task 8 wires routes)

Then in another terminal:
```bash
curl -N -X POST http://localhost:3900/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello in 10 words","model":"claude-sonnet-4-20250514","ephemeral":true}'
```

Expected: SSE stream of `data: {"type":"delta","text":"..."}` events followed by `data: {"type":"done",...}`

**Step 3: Commit**

```bash
git add web/api/routes/chat.js
git commit -m "feat(api): implement SSE streaming chat with Anthropic SDK"
```

---

## Task 8: Wire chat routes into `server.js`

**Files:**
- Modify: `web/api/server.js`

**Step 1: Add import**

Add after the existing draft import:

```js
import { handleChat, listThreads, createThread, renameThread, getHistory, createPin, listPins, deletePin, getUsage } from './routes/chat.js'
```

**Step 2: Add route handlers**

Add before the `// --- Health ---` comment block:

```js
    // --- Chat ---
    if (path === '/api/chat' && req.method === 'POST') {
      return handleChat(req)
    }

    if (path === '/api/chat/threads' && req.method === 'GET') {
      const query = parseQuery(req.url)
      return json(await listThreads(query))
    }

    if (path === '/api/chat/threads' && req.method === 'POST') {
      const body = await req.json()
      return json(await createThread(body))
    }

    if (path === '/api/chat/threads' && req.method === 'PUT') {
      const query = parseQuery(req.url)
      const body = await req.json()
      return json(await renameThread({ ...query, ...body }))
    }

    if (path === '/api/chat/history' && req.method === 'GET') {
      const query = parseQuery(req.url)
      return json(await getHistory(query))
    }

    if (path === '/api/chat/pin' && req.method === 'POST') {
      const body = await req.json()
      return json(await createPin(body))
    }

    if (path === '/api/chat/pins' && req.method === 'GET') {
      const query = parseQuery(req.url)
      return json(await listPins(query))
    }

    if (path === '/api/chat/pin' && req.method === 'DELETE') {
      const query = parseQuery(req.url)
      return json(await deletePin(query))
    }

    if (path === '/api/chat/usage' && req.method === 'GET') {
      const query = parseQuery(req.url)
      return json(await getUsage(query))
    }
```

**Step 3: Run all API tests**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`

Expected: All tests pass (existing + new chat/context/week tests)

**Step 4: Commit**

```bash
git add web/api/server.js
git commit -m "feat(api): wire chat routes into server"
```

---

## Task 9: Add `apiStream` to `web/app/src/lib/api.js`

**Files:**
- Modify: `web/app/src/lib/api.js`

**Step 1: Add apiStream export**

Append to the existing file:

```js
export async function apiStream(path, body, signal) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `API ${res.status}`)
  }
  return res
}
```

**Step 2: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 3: Commit**

```bash
git add web/app/src/lib/api.js
git commit -m "feat(app): add apiStream helper for SSE endpoints"
```

---

## Task 10: Create `useChat.js` hook

**Files:**
- Create: `web/app/src/hooks/useChat.js`

**Step 1: Write the hook**

```js
import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch, apiStream } from '../lib/api'

export function useChat(week) {
  const [threads, setThreads] = useState([])
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [articleRef, setArticleRef] = useState(null)
  const [dailyUsage, setDailyUsage] = useState(null)
  const abortRef = useRef(null)

  // Load threads for the week
  const loadThreads = useCallback(async () => {
    try {
      const data = await apiFetch(`/api/chat/threads?week=${week}`)
      setThreads(data)
    } catch (err) {
      setError(err.message)
    }
  }, [week])

  // Load usage
  const loadUsage = useCallback(async () => {
    try {
      const data = await apiFetch('/api/chat/usage?period=today')
      setDailyUsage(data)
    } catch { /* non-critical */ }
  }, [])

  useEffect(() => { loadThreads() }, [loadThreads])
  useEffect(() => { loadUsage() }, [loadUsage])

  // Create a new thread
  const createThread = useCallback(async (name) => {
    try {
      const data = await apiFetch('/api/chat/threads', {
        method: 'POST',
        body: JSON.stringify({ week, name }),
      })
      await loadThreads()
      setActiveThread(data.id)
      setMessages([])
      return data
    } catch (err) {
      setError(err.message)
    }
  }, [week, loadThreads])

  // Select a thread and load its history
  const selectThread = useCallback(async (threadId) => {
    setActiveThread(threadId)
    setMessages([])
    try {
      const data = await apiFetch(`/api/chat/history?week=${week}&thread=${threadId}`)
      setMessages(data)
    } catch (err) {
      setError(err.message)
    }
  }, [week])

  // Rename a thread
  const renameThread = useCallback(async (threadId, name) => {
    try {
      await apiFetch(`/api/chat/threads?id=${threadId}`, {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      await loadThreads()
    } catch (err) {
      setError(err.message)
    }
  }, [loadThreads])

  // Send a message (SSE streaming)
  const sendMessage = useCallback(async (text) => {
    if (sending || !text.trim()) return
    setSending(true)
    setError(null)

    // Add user message to UI immediately
    const userMsg = { id: `local_${Date.now()}`, role: 'user', content: text, model, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    // Prepare streaming assistant message
    const assistantId = `local_${Date.now() + 1}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', model, timestamp: new Date().toISOString(), usage: null }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await apiStream('/api/chat', {
        message: text,
        model,
        threadId: activeThread,
        ephemeral: false,
        week,
        articleRef,
      }, controller.signal)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'delta') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + data.text } : m
              ))
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, id: data.id, usage: data.usage } : m
              ))
            } else if (data.type === 'error') {
              setError(data.message)
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      // Clear article ref after sending
      setArticleRef(null)
      // Reload threads (to get updated stats) and usage
      await loadThreads()
      await loadUsage()
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }, [sending, model, activeThread, week, articleRef, loadThreads, loadUsage])

  // Cancel streaming
  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      setSending(false)
    }
  }, [])

  // Pin a message
  const pinMessage = useCallback(async (messageId) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      await apiFetch('/api/chat/pin', {
        method: 'POST',
        body: JSON.stringify({
          week,
          threadId: activeThread,
          messageId,
          text: msg.content,
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [messages, week, activeThread])

  return {
    threads, activeThread, messages, sending, error, model, articleRef, dailyUsage,
    setModel, setArticleRef, sendMessage, cancelStream, createThread, selectThread,
    renameThread, pinMessage, loadUsage,
  }
}
```

**Step 2: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors (unused import is fine — component will consume it in Task 12)

**Step 3: Commit**

```bash
git add web/app/src/hooks/useChat.js
git commit -m "feat(app): add useChat hook with SSE streaming and thread management"
```

---

## Task 11: Create `useChatPanel.js` hook

**Files:**
- Create: `web/app/src/hooks/useChatPanel.js`

**Step 1: Write the hook**

```js
import { useState, useCallback, useRef } from 'react'
import { apiFetch, apiStream } from '../lib/api'
import { getISOWeek } from '../../../api/lib/week.js'

export function useChatPanel() {
  const [messages, setMessages] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [model, setModel] = useState('claude-sonnet-4-20250514')
  const [articleRef, setArticleRef] = useState(null)
  const abortRef = useRef(null)

  const sendMessage = useCallback(async (text, draftContent) => {
    if (sending || !text.trim()) return
    setSending(true)
    setError(null)

    const userMsg = { id: `local_${Date.now()}`, role: 'user', content: text, model, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    const assistantId = `local_${Date.now() + 1}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', model, timestamp: new Date().toISOString(), usage: null }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await apiStream('/api/chat', {
        message: text,
        model,
        ephemeral: true,
        draftContext: draftContent || '',
        articleRef,
      }, controller.signal)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'delta') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + data.text } : m
              ))
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, id: data.id, usage: data.usage } : m
              ))
            } else if (data.type === 'error') {
              setError(data.message)
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      setArticleRef(null)
    } catch (err) {
      if (err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setSending(false)
      abortRef.current = null
    }
  }, [sending, model, articleRef])

  const cancelStream = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      setSending(false)
    }
  }, [])

  const pinMessage = useCallback(async (messageId) => {
    const msg = messages.find(m => m.id === messageId)
    if (!msg) return
    try {
      await apiFetch('/api/chat/pin', {
        method: 'POST',
        body: JSON.stringify({
          week: new Date().toISOString().slice(0, 10), // approximate
          threadId: 'ephemeral',
          messageId,
          text: msg.content,
        }),
      })
    } catch (err) {
      setError(err.message)
    }
  }, [messages])

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages, sending, error, model, articleRef,
    setModel, setArticleRef, sendMessage, cancelStream, pinMessage, clearMessages,
  }
}
```

> **Note for implementer:** The `useChatPanel` hook should NOT import from `../../../api/lib/week.js` — that crosses the API/app boundary. Instead, the week number for pins should be passed from the Draft page (which already knows the current week from `useDraft`). The `pinMessage` function should accept a `week` parameter or the hook should accept `week` as a constructor argument. Fix this during implementation — either pass `week` as a hook param or use a simpler week calculation inline.

**Step 2: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 3: Commit**

```bash
git add web/app/src/hooks/useChatPanel.js
git commit -m "feat(app): add useChatPanel hook for ephemeral draft assistant"
```

---

## Task 12: Rewrite `Copilot.jsx` + create `Copilot.css`

**Files:**
- Modify: `web/app/src/pages/Copilot.jsx`
- Create: `web/app/src/pages/Copilot.css`

This is a large UI task. The implementer should reference:
- Design doc section 9 for layout diagram
- `Draft.jsx` for week-nav and toolbar patterns
- `tokens.css` for design system values
- `coding-patterns.md` for CSS conventions

**Step 1: Create `Copilot.css`**

Full CSS for the co-pilot page layout. Key elements:
- `.copilot-page` — full-height flex layout
- `.copilot-toolbar` — top bar with week nav and usage display
- `.copilot-body` — two-column flex: sidebar + chat
- `.thread-sidebar` — 220px fixed width, thread list, new button
- `.chat-area` — flex column: messages + input bar
- `.message-list` — scrollable, flex-grow
- `.message` — user/assistant bubbles with model badge and usage footer
- `.message-actions` — pin button, shown on hover
- `.chat-input-bar` — textarea + article picker + model toggle + send/stop button
- `.model-toggle` — two-state pill (S / O)

All colours from `tokens.css`. Follow Draft.css patterns for toolbar, week-nav, buttons.

**Step 2: Rewrite `Copilot.jsx`**

Replace the placeholder with the full chat interface. Key features:
- `useChat(week)` hook drives all state
- Thread sidebar with list + "New thread" button
- Message list with auto-scroll (`useRef` + `scrollIntoView`)
- Pin button on assistant messages
- Article picker (dropdown that lists articles from `/api/articles`)
- Model toggle pill (Sonnet/Opus)
- Send button (disabled when `sending`), replaced by Stop button during streaming
- Usage display in toolbar
- Week navigation (same pattern as Draft page)
- Loading/error/empty states per coding patterns

**Step 3: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 4: Commit**

```bash
git add web/app/src/pages/Copilot.jsx web/app/src/pages/Copilot.css
git commit -m "feat(app): rewrite Copilot page with full chat interface"
```

---

## Task 13: Create `DraftChatPanel.jsx` + `DraftChatPanel.css`

**Files:**
- Create: `web/app/src/components/DraftChatPanel.jsx`
- Create: `web/app/src/components/DraftChatPanel.css`

**Step 1: Create `DraftChatPanel.css`**

Slide-out panel: 320px wide, positioned right, dark surface background, same message styling as Copilot but compact. Toggle animation with CSS transition.

**Step 2: Create `DraftChatPanel.jsx`**

Props: `{ open, onClose, draftContent, week }`

Uses `useChatPanel()` hook. Renders:
- Panel header with "Draft Assistant" title + close button + clear button
- Message list (same pattern as Copilot but narrower)
- Pin button on assistant messages
- Input bar with model toggle + send/stop
- No thread sidebar, no week nav

Passes `draftContent` to `sendMessage(text, draftContent)` on each send.

**Step 3: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 4: Commit**

```bash
git add web/app/src/components/DraftChatPanel.jsx web/app/src/components/DraftChatPanel.css
git commit -m "feat(app): add DraftChatPanel slide-out component"
```

---

## Task 14: Integrate panel into `Draft.jsx`

**Files:**
- Modify: `web/app/src/pages/Draft.jsx`
- Modify: `web/app/src/pages/Draft.css`

**Step 1: Add panel toggle**

In `Draft.jsx`:
- Import `DraftChatPanel`
- Add `panelOpen` state (`useState(false)`)
- Add toggle button in the toolbar (chat bubble icon)
- Render `<DraftChatPanel open={panelOpen} onClose={() => setPanelOpen(false)} draftContent={draft} week={week} />`

In `Draft.css`:
- Add `.draft-chat-toggle` button styles
- Adjust `.draft-page` to accommodate panel (when open, main content shrinks or panel overlays)

**Step 2: Verify build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 3: Commit**

```bash
git add web/app/src/pages/Draft.jsx web/app/src/pages/Draft.css
git commit -m "feat(app): add chat panel toggle to Draft page"
```

---

## Task 15: Full verification

**Step 1: Run all API tests**

Run: `cd /Users/scott/Projects/sni-research-v2/web/api && bun test`

Expected: All tests pass

**Step 2: Run Vite build**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bunx vite build`

Expected: 0 errors

**Step 3: Pipeline isolation**

Run: `cd /Users/scott/Projects/sni-research-v2 && bun scripts/pipeline.js --mode daily --dry-run`

Expected: Pipeline succeeds regardless of web/ changes

**Step 4: Manual SSE test**

Start server: `bun web/api/server.js`

```bash
curl -N -X POST http://localhost:3900/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Say hello","model":"claude-sonnet-4-20250514","ephemeral":true}'
```

Expected: SSE stream with delta events and done event

---

## Task 16: Update context files

**Files:**
- Modify: `.claude/context/phase-status.md` — mark Phase 3 complete, list all files, record key decisions
- Modify: `CLAUDE.md` — update Phase 3 line to ✅ Complete
- Modify: `.claude/context/coding-patterns.md` — add SSE streaming pattern, `apiStream` convention
- Modify: `.claude/context/web-ui-spec.md` — update Section 4 (Co-pilot Detail) with actual implementation details

**Step 1: Update all four files**

**Step 2: Commit**

```bash
git add .claude/context/phase-status.md CLAUDE.md .claude/context/coding-patterns.md .claude/context/web-ui-spec.md
git commit -m "docs: update context files for Phase 3 completion"
```
