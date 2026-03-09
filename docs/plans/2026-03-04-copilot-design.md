# Phase 3: Co-pilot — Design Document

Date: 2026-03-04
Status: Approved
Depends on: Phase 2 (Draft Editor) ✅

---

## 1. Vision

The co-pilot is an AI editorial assistant embedded in the SNI workbench. It lets the editor talk through the week's news with Claude — spot themes, compare stories, draft paragraphs, and pin insights that feed back into the automated Friday draft.

Two surfaces:
- **`/copilot` page** — full chat interface with named threads, article injection, pins
- **Draft chat panel** — lightweight slide-out from the Draft page for quick editing questions

Both share the same streaming infrastructure and model toggle.

---

## 2. Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Shared `POST /api/chat` endpoint with `ephemeral` flag | DRY — streaming, SDK, model toggle are identical |
| Context assembly | Tiered: all titles + full snippets for top ~30 by score | Broad awareness + depth on what matters, fits 30k budget |
| Threads | Multiple named per week | Editorial flexibility — separate threads for separate angles |
| Draft panel | Ephemeral, draft markdown as context | Keeps Draft page focused; `/copilot` for deep conversations |
| Model toggle | Per-message, everywhere | User preference — always offer the choice |
| Models | `claude-sonnet-4-20250514` (default), `claude-opus-4-6` | Sonnet for speed, Opus for depth |
| Token/cost counting | Per-message usage tracking, daily ceiling | Budget visibility and guardrails |
| Article injection | Article picker in chat UI | Explicit, user-controlled, no magic detection |
| Thread naming | Auto-name from first message, renamable | Low friction thread creation |
| Pin format | Markdown + YAML frontmatter | Pipeline-ready for future `draft.js` integration |
| Ad hoc materials | Defer to Phase 4 | Co-pilot + copy is sufficient for now |

---

## 3. Data Layer

```
data/copilot/
├── chats/
│   └── week-9/
│       ├── threads.json            # Thread index
│       ├── thread-abc123.jsonl     # Messages
│       └── thread-def456.jsonl
└── pins/
    └── week-9/
        ├── pins.json               # Pin index
        ├── pin-001.md              # Individual pin (pipeline-readable)
        └── pin-002.md
```

### Thread index (`threads.json`)

```json
[
  {
    "id": "abc123",
    "name": "Biopharma themes",
    "created": "2026-03-04T10:30:00Z",
    "updated": "2026-03-04T11:45:00Z",
    "messageCount": 12,
    "totalInputTokens": 45000,
    "totalOutputTokens": 8500,
    "estimatedCost": 0.26
  }
]
```

### Message format (JSONL, one per line)

```json
{
  "id": "msg_001",
  "role": "user",
  "content": "What themes are emerging in biopharma this week?",
  "model": "claude-sonnet-4-20250514",
  "timestamp": "2026-03-04T10:30:00Z",
  "usage": null,
  "articleRef": null
}
{
  "id": "msg_002",
  "role": "assistant",
  "content": "Three main themes stand out...",
  "model": "claude-sonnet-4-20250514",
  "timestamp": "2026-03-04T10:30:15Z",
  "usage": { "input_tokens": 12500, "output_tokens": 850 },
  "articleRef": null
}
```

When `articleRef` is present on a user message: `{"date":"2026-03-03","sector":"biopharma","slug":"merck-acquisition"}` — the server loaded and injected that article's full text into the context.

### Pin format (`pin-001.md`)

```markdown
---
id: pin-001
threadId: abc123
messageId: msg_002
week: 9
created: 2026-03-04T10:31:00Z
---

Three main themes stand out in biopharma this week...
```

YAML frontmatter makes pins machine-readable. The markdown body is what `draft.js` will eventually consume as supplementary editorial direction.

### Pin index (`pins.json`)

```json
[
  {
    "id": "pin-001",
    "threadId": "abc123",
    "messageId": "msg_002",
    "week": 9,
    "preview": "Three main themes stand out...",
    "created": "2026-03-04T10:31:00Z"
  }
]
```

---

## 4. API Endpoints

All in `web/api/routes/chat.js`.

### Streaming chat

```
POST /api/chat
Content-Type: application/json

{
  "message": "What themes are emerging?",
  "model": "claude-sonnet-4-20250514",
  "threadId": "abc123",          // omit for ephemeral
  "ephemeral": false,            // true for draft panel
  "draftContext": null,           // markdown string for draft panel
  "articleRef": null              // {date, sector, slug} to inject full article
}

Response: text/event-stream
  data: {"type":"delta","text":"Three "}
  data: {"type":"delta","text":"main themes..."}
  data: {"type":"done","id":"msg_002","usage":{"input_tokens":12500,"output_tokens":850}}
  data: {"type":"error","message":"Rate limit exceeded"}  // if applicable
```

### Thread management

```
GET  /api/chat/threads?week=N           → [{id, name, created, updated, messageCount, totalInputTokens, totalOutputTokens, estimatedCost}]
POST /api/chat/threads                  → {id, name}  // Body: {name?, week}  — name auto-generated if omitted
PUT  /api/chat/threads?id=X             → {id, name}  // Body: {name}  — rename
GET  /api/chat/history?week=N&thread=X  → [{id, role, content, model, timestamp, usage, articleRef}]
```

### Pins

```
POST   /api/chat/pin     → {id, preview}     // Body: {week, threadId, messageId, text}
GET    /api/chat/pins?week=N  → [{id, threadId, messageId, preview, created}]
DELETE /api/chat/pin?id=X → {ok: true}
```

### Token budget

```
GET /api/chat/usage?period=today  → {inputTokens, outputTokens, estimatedCost, ceiling, remaining}
GET /api/chat/usage?period=week&week=N  → same shape, aggregated across week
```

---

## 5. Context Assembly (`web/api/lib/context.js`)

### For `/copilot` threads

1. Load all verified articles for the current week from `data/verified/`
2. Score-sort descending
3. **Top 30:** title, source, sector, date, full snippet
4. **Remaining:** title, sector, source only (one line each)
5. Append all pins for the week (from `pins.json`)
6. Append thread history (all messages, trimmed from oldest if over budget)
7. If `articleRef` present, load full article JSON and inject full text
8. **Token budget:** estimate at ~4 chars/token. Trim thread history from oldest to stay under 28k tokens (leaving 2k for the response)

### For ephemeral draft panel

1. Inject `draftContext` (the current draft markdown, passed from client)
2. Append all pins for the week
3. No thread history (ephemeral)
4. If `articleRef` present, inject full article
5. **Token budget:** same 28k ceiling

### System prompts

**Co-pilot (editorial analyst):**
```
You are an editorial analyst for Sector News Intelligence (SNI), a weekly newsletter covering AI news across five sectors: general AI, biopharma, medtech, manufacturing, and insurance.

Your role is to help the editor identify themes, compare stories, spot cross-sector connections, and draft paragraphs for the newsletter.

Style guidelines:
- UK English (single quotes, spaced en dashes, no Oxford commas)
- Analytical but accessible tone
- Always cite specific articles from the context when making claims
- Flag when you're speculating vs summarising reported facts

You have access to this week's article corpus and any pinned editorial notes.
```

**Draft assistant (editor):**
```
You are an editorial assistant helping refine a newsletter draft for Sector News Intelligence (SNI).

You can see the current draft markdown. Help with:
- Rewriting paragraphs for clarity or tone
- Checking factual consistency with the source articles
- Suggesting structural improvements
- UK English conventions (single quotes, spaced en dashes, no Oxford commas)

Be concise. Return edited text that can be copied directly into the draft.
```

---

## 6. SDK Integration

### Client initialisation (`web/api/lib/claude.js`)

```js
import Anthropic from '@anthropic-ai/sdk'
import { loadEnvKey } from './env.js'

let _client = null

export function getClient() {
  if (_client) return _client
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) throw new Error('ANTHROPIC_API_KEY not found in environment or .env')
  _client = new Anthropic({ apiKey: key })
  return _client
}
```

`loadEnvKey` is copied from `scripts/lib/env.js` into `web/api/lib/env.js` (isolation constraint — no cross-boundary imports).

### Dependency

The Anthropic SDK (`@anthropic-ai/sdk` ^0.78.0) is already in the root `package.json`. Bun resolves it from the project root, so `web/api/` doesn't need its own copy. No new install needed.

---

## 7. SSE Streaming Flow

```
Client                          Server                          Anthropic
  |                               |                               |
  |  POST /api/chat {message}     |                               |
  |------------------------------>|                               |
  |                               |  Assemble context             |
  |                               |  Check daily token ceiling    |
  |                               |                               |
  |                               |  SDK.messages.stream({...})   |
  |                               |------------------------------>|
  |                               |                               |
  |  SSE: {type:delta, text:...}  |  on('text')                   |
  |<------------------------------|<------------------------------|
  |  SSE: {type:delta, text:...}  |  on('text')                   |
  |<------------------------------|<------------------------------|
  |                               |                               |
  |                               |  on('finalMessage')           |
  |                               |<------------------------------|
  |                               |                               |
  |                               |  If !ephemeral:               |
  |                               |    append user msg to JSONL   |
  |                               |    append assistant msg+usage |
  |                               |    update threads.json        |
  |                               |    update daily token counter |
  |                               |                               |
  |  SSE: {type:done, id, usage}  |                               |
  |<------------------------------|                               |
```

### Error handling

- SDK error mid-stream → `data: {"type":"error","message":"..."}\n\n` then close
- Daily ceiling exceeded → return `429` before streaming starts
- Connection closed by client → server aborts SDK stream via `AbortController`

### Cancellation

Server detects client disconnect via the request signal. The SDK call is wrapped with an `AbortController` whose signal is linked to the request:

```js
const abort = new AbortController()
req.signal.addEventListener('abort', () => abort.abort())
// Pass abort.signal to SDK stream options
```

---

## 8. Token & Cost Counting

### Per-message

The SDK `finalMessage` event includes `usage: {input_tokens, output_tokens}`. This is stored in the JSONL message and returned in the SSE `done` event.

### Per-thread

`threads.json` maintains running totals: `totalInputTokens`, `totalOutputTokens`, `estimatedCost`. Updated after each non-ephemeral message.

### Pricing (`web/api/lib/pricing.js`)

```js
export const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-6':           { inputPerMTok: 5, outputPerMTok: 25 },
}

export function estimateCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok
}
```

### Daily ceiling

In-memory counter in `chat.js`. Default ceiling: 500,000 tokens/day (configurable). Warning at 80%. Hard stop at 100% (returns 429). Resets on server restart. The `GET /api/chat/usage` endpoint exposes current state.

### UI display

- Message footer: `Sonnet · 850 tokens · $0.01`
- Thread sidebar: `45.5k tokens · $0.26`
- Header bar: `Today: 125k / 500k tokens`

---

## 9. Frontend Components

### `/copilot` page (`Copilot.jsx` + `Copilot.css`)

Layout:
```
┌─────────────────────────────────────────────────┐
│ Co-pilot                    Week ◀ 9 ▶  [usage] │
├──────────┬──────────────────────────────────────┤
│ Threads  │ Messages                              │
│          │                                       │
│ + New    │  [user] What themes are emerging?      │
│          │                                       │
│ ● Bio... │  [assistant] Three main themes...      │
│   Gen... │                          [📌 Pin]     │
│          │                  Sonnet · 850t · $0.01 │
│          │                                       │
│          ├───────────────────────────────────────│
│          │ [📎 Article] [textarea    ] [S|O] [➤] │
└──────────┴───────────────────────────────────────┘
```

- **Thread sidebar:** list for current week, "+ New" button, click to switch, auto-named
- **Message list:** scrollable, auto-scroll on new content, user/assistant bubbles
- **Pin button:** on each assistant message, calls `POST /api/chat/pin`
- **Article picker (📎):** opens searchable dropdown of this week's articles, selecting one sets `articleRef` for the next message
- **Input bar:** textarea + model toggle pill (S/O) + send button
- **Model toggle:** two-state pill, Sonnet (default) / Opus, per-message
- **Stop button:** replaces send button during streaming, triggers abort
- **Usage display:** daily token counter in toolbar, per-message in footer

### Draft chat panel (`DraftChatPanel.jsx` + `DraftChatPanel.css`)

- Slide-out panel from right edge of Draft page (320px wide)
- Toggle button in Draft toolbar
- Same message list + input bar + model toggle + article picker
- No thread sidebar
- Ephemeral — messages held in React state, survive panel close/open, clear on page nav
- "Clear" button to reset conversation
- Current draft markdown sent as `draftContext` with every message
- Pin button works (pins persist to `data/copilot/pins/`)

### `useChat.js` hook

```js
export function useChat(week) {
  // State
  // - threads: [{id, name, ...}]
  // - activeThread: string | null
  // - messages: [{id, role, content, model, usage, ...}]
  // - sending: boolean
  // - error: string | null
  // - model: string (current selection)
  // - articleRef: {date, sector, slug} | null
  // - dailyUsage: {inputTokens, outputTokens, ceiling, remaining}

  // Actions
  // - sendMessage(text) — POST /api/chat with SSE, accumulate response
  // - createThread(name?) — POST /api/chat/threads
  // - selectThread(id) — load history, set active
  // - renameThread(id, name) — PUT /api/chat/threads
  // - pinMessage(messageId) — POST /api/chat/pin
  // - setModel(model) — toggle
  // - setArticleRef(ref) — set for next message
  // - cancelStream() — abort current SSE connection
  // - loadUsage() — GET /api/chat/usage
}
```

### `useChatPanel.js` hook

Lighter version for the draft panel:

```js
export function useChatPanel() {
  // State
  // - messages: [] (ephemeral, React state only)
  // - sending, error, model, articleRef (same as useChat)

  // Actions
  // - sendMessage(text, draftContent) — POST /api/chat with ephemeral:true
  // - pinMessage(messageId) — POST /api/chat/pin (pins DO persist)
  // - setModel / setArticleRef / cancelStream (same)
  // - clearMessages() — reset conversation
}
```

### `apiStream()` helper (`lib/api.js`)

New addition alongside existing `apiFetch`:

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

---

## 10. New Files Summary

### API (`web/api/`)

| File | Purpose |
|------|---------|
| `routes/chat.js` | All chat endpoints (streaming, threads, pins, usage) |
| `lib/claude.js` | Anthropic SDK client singleton |
| `lib/env.js` | `loadEnvKey()` (copied from pipeline, isolation) |
| `lib/context.js` | Context assembly (tiered articles, pins, history) |
| `lib/pricing.js` | Model pricing table + cost estimator |
| `lib/week.js` | ISO 8601 week number calculation |

### React app (`web/app/src/`)

| File | Purpose |
|------|---------|
| `pages/Copilot.jsx` | Full co-pilot page (rewrite from placeholder) |
| `pages/Copilot.css` | Co-pilot styles |
| `components/DraftChatPanel.jsx` | Slide-out chat panel for Draft page |
| `components/DraftChatPanel.css` | Panel styles |
| `hooks/useChat.js` | Full chat hook (threads, SSE, pins, usage) |
| `hooks/useChatPanel.js` | Lightweight ephemeral chat hook |
| `lib/api.js` | Add `apiStream()` (existing file, new export) |

### Modified files

| File | Change |
|------|--------|
| `web/api/server.js` | Import chat routes, add 7 route handlers |
| `web/app/src/pages/Draft.jsx` | Add panel toggle button + DraftChatPanel |
| `web/app/src/pages/Draft.css` | Panel toggle button styles |

---

## 11. What This Design Does NOT Include

- **No RAG / vector search** — simple file-based article loading
- **No message editing or deletion** — append-only JSONL
- **No real-time collaboration** — single user
- **No pipeline modification** — pins are written in a format `draft.js` can read, but `draft.js` itself is not modified (isolation constraint). Pipeline pin integration is deferred.
- **No ad hoc document creation** — deferred to Phase 4. Co-pilot + copy is sufficient.
- **No image generation** — text-only chat

---

## 12. Pipeline Pin Integration (Future)

When `draft.js` is ready to consume pins, it should:

1. Check `data/copilot/pins/week-N/` for `pins.json`
2. Read each `pin-*.md` file
3. Inject pin content as supplementary editorial direction in the draft context
4. The YAML frontmatter provides metadata; the markdown body is the content

No changes to `scripts/` are made in Phase 3. This section documents the contract.
