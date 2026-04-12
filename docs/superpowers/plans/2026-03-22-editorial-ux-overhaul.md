# Editorial UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Editorial page to be the primary editorial workspace — with per-tab AI chat, inline post drafting, Newsletter as a tab, writing preferences in system prompts, and working podcast display.

**Architecture:** The Editorial page gains a persistent right-hand chat panel (per-tab threads instead of ephemeral), a Newsletter tab wrapping the existing Draft page content, and writing-preferences-aware system prompts. The `/draft` route redirects to `/editorial?tab=newsletter`. DraftLink components are replaced with inline chat drafting. Podcast API gets a digest-file scanner fallback (already done).

**Tech Stack:** React, Bun HTTP server, Anthropic Claude SDK, SSE streaming, CSS modules, react-router-dom

---

## File Structure

### New files
- `web/app/src/pages/NewsletterTab.jsx` — Newsletter tab extracted from Draft.jsx (the markdown editor + preview + publish flow)
- `web/app/src/pages/NewsletterTab.css` — Styles for the newsletter tab (extracted from Draft.css)

### Modified files
- `web/app/src/pages/Editorial.jsx` — Add Newsletter tab, replace overlay chat with integrated side panel, wire per-tab threads
- `web/app/src/pages/Editorial.css` — Two-column layout (content left, chat right), tab updates
- `web/app/src/components/EditorialChat.jsx` — Per-tab thread persistence, model toggle, writing-aware prompts, "draft this post" inline
- `web/app/src/components/EditorialChat.css` — Updated styles for persistent panel
- `web/app/src/hooks/useEditorialChat.js` — Thread-per-tab state, lazy context injection (on first message only)
- `web/app/src/components/shared/DraftLink.jsx` — Replace navigation with "draft in chat" action
- `web/app/src/components/layout/Sidebar.jsx` — Remove Draft nav item, update keyboard shortcuts
- `web/app/src/components/layout/Shell.jsx` — Update NAV_ROUTES (remove /draft)
- `web/app/src/App.jsx` — /draft redirects to /editorial?tab=newsletter
- `web/api/lib/editorial-chat.js` — Load writing-preferences.md into system prompt, support newsletter tab context
- `web/api/routes/editorial.js` — Add model parameter support (Sonnet/Opus), pass writing prefs

---

## Task 1: Navigation restructure — remove Draft from sidebar, add Newsletter tab

**Files:**
- Modify: `web/app/src/components/layout/Sidebar.jsx`
- Modify: `web/app/src/components/layout/Shell.jsx`
- Modify: `web/app/src/App.jsx`
- Modify: `web/app/src/pages/Editorial.jsx`

- [ ] **Step 1: Update Sidebar.jsx — remove Draft nav item**

Remove the Draft entry from NAV_ITEMS. Update the keyboard shortcut indices so Cmd+3 → Editorial, Cmd+4 → Co-pilot, etc.

```jsx
// Sidebar.jsx — NAV_ITEMS becomes:
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'grid' },
  { to: '/database', label: 'Database', icon: 'database' },
  { to: '/editorial', label: 'Editorial', icon: 'book', badge: true },
  { to: '/copilot', label: 'Co-pilot', icon: 'chat' },
  { to: '/sources', label: 'Sources', icon: 'layers' },
  { to: '/config', label: 'Config', icon: 'settings' },
]
```

- [ ] **Step 2: Update Shell.jsx — remove /draft from NAV_ROUTES**

```jsx
const NAV_ROUTES = [
  '/',           // 1 = Dashboard
  '/database',   // 2 = Database
  '/editorial',  // 3 = Editorial
  '/copilot',    // 4 = Co-pilot
  '/sources',    // 5 = Sources
  '/config',     // 6 = Config
]
```

- [ ] **Step 3: Update App.jsx — redirect /draft to /editorial**

```jsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
// ... existing imports ...

<Route path="/draft" element={<Navigate to="/editorial?tab=newsletter" replace />} />
```

- [ ] **Step 4: Add Newsletter tab to Editorial.jsx TABS array (placeholder until Task 2)**

```jsx
const TABS = [
  { key: 'state', label: 'Analysis' },
  { key: 'themes', label: 'Themes' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'decisions', label: 'Decisions' },
  { key: 'activity', label: 'Activity' },
  { key: 'newsletter', label: 'Newsletter' },
]
```

Add a placeholder until Task 2 creates the real component:
```jsx
{tab === 'newsletter' && <div className="tab-content"><p>Newsletter editor loading...</p></div>}
```

Also add `newsletter` entries to `EditorialChat.jsx` maps:
```jsx
// In TAB_LABELS:
newsletter: 'Newsletter',

// In SUGGESTIONS:
newsletter: [
  'Review the current draft for quality and consistency.',
  'Suggest improvements to the opening section.',
],
```

- [ ] **Step 5: Support `?tab=` query parameter in Editorial.jsx**

Read initial tab from URL search params so `/editorial?tab=newsletter` works:

```jsx
import { useSearchParams } from 'react-router-dom'

// Inside Editorial():
const [searchParams, setSearchParams] = useSearchParams()
const initialTab = searchParams.get('tab') || 'state'
const [tab, setTab] = useState(TABS.find(t => t.key === initialTab) ? initialTab : 'state')

// When tab changes, update URL:
function handleTabChange(key) {
  setTab(key)
  setSearchParams(key === 'state' ? {} : { tab: key })
}
```

- [ ] **Step 6: Verify navigation works**

Run: `cd /Users/scott/Projects/sni-research-v2/web/app && bun run build`
Expected: 0 errors. /draft redirects to /editorial?tab=newsletter. Sidebar shows 6 items.

- [ ] **Step 7: Commit**

```bash
git add web/app/src/components/layout/Sidebar.jsx web/app/src/components/layout/Shell.jsx web/app/src/App.jsx web/app/src/pages/Editorial.jsx
git commit -m "refactor: move Draft into Editorial as Newsletter tab, update navigation"
```

---

## Task 2: Extract NewsletterTab component from Draft.jsx

**Files:**
- Create: `web/app/src/pages/NewsletterTab.jsx`
- Create: `web/app/src/pages/NewsletterTab.css`
- Modify: `web/app/src/pages/Editorial.jsx` (import NewsletterTab)

The existing Draft.jsx is 28KB with a full markdown editor, preview, review overlay, link badges, overlap checker, and publish flow. Rather than moving all of it, create a NewsletterTab wrapper that imports and renders the Draft page content but without the page-level chrome (page header with week nav is still needed).

- [ ] **Step 1: Create NewsletterTab.jsx**

Extract the core Draft functionality into a component that can be embedded as a tab. The key difference: it doesn't render its own `<div className="draft-page">` wrapper with page header — it receives the week from the Editorial page context or manages its own.

```jsx
// NewsletterTab.jsx
import Draft from './Draft'
import './NewsletterTab.css'

/**
 * Newsletter tab — wraps the Draft editor for embedding within Editorial.
 * The Draft component already handles all its own state (week nav, save, publish, etc).
 */
export default function NewsletterTab() {
  return (
    <div className="newsletter-tab">
      <Draft embedded />
    </div>
  )
}
```

- [ ] **Step 2: Add `embedded` prop support to Draft.jsx**

When `embedded={true}`, suppress the outermost page wrapper class and any duplicate page-level chrome that conflicts with the Editorial page layout. The Draft component should render cleanly inside a tab:

```jsx
// In Draft.jsx, modify the top-level render:
export default function Draft({ embedded = false }) {
  // ... existing state/hooks ...

  return (
    <div className={embedded ? 'draft-embedded' : 'draft-page'}>
      {/* existing content */}
    </div>
  )
}
```

- [ ] **Step 3: Create NewsletterTab.css**

```css
.newsletter-tab {
  height: 100%;
  overflow-y: auto;
}

.newsletter-tab .draft-embedded {
  padding: 0;
}
```

- [ ] **Step 4: Import and wire in Editorial.jsx**

```jsx
import NewsletterTab from './NewsletterTab'

// In the tab content area:
{tab === 'newsletter' && <NewsletterTab />}
```

- [ ] **Step 5: Verify the Newsletter tab renders the draft editor**

Open http://localhost:5173/editorial?tab=newsletter. Should see the full draft editor with week navigation, markdown textarea, preview panel, and publish button.

- [ ] **Step 6: Commit**

```bash
git add web/app/src/pages/NewsletterTab.jsx web/app/src/pages/NewsletterTab.css web/app/src/pages/Draft.jsx web/app/src/pages/Editorial.jsx
git commit -m "feat: embed Draft editor as Newsletter tab within Editorial page"
```

---

## Task 3: Two-column layout — content left, chat right

**Files:**
- Modify: `web/app/src/pages/Editorial.jsx`
- Modify: `web/app/src/pages/Editorial.css`
- Modify: `web/app/src/components/EditorialChat.jsx`
- Modify: `web/app/src/components/EditorialChat.css`

Currently the chat is a sliding overlay panel. Change to a persistent two-column layout: tab content on the left (~60%), chat on the right (~40%). The "Ask AI" toggle becomes the default — chat is always visible (with a collapse option).

- [ ] **Step 1: Update Editorial.jsx layout**

Replace the overlay chat pattern with a two-column flex layout:

```jsx
return (
  <div className="editorial-page">
    <div className="page-header">
      {/* existing header — h2, search, export, but remove chat toggle button */}
    </div>

    <div className="tabs">
      {/* existing tabs */}
    </div>

    <div className="editorial-columns">
      <div className="editorial-content">
        {/* existing tab content rendering */}
      </div>
      <EditorialChat tab={tab} />
    </div>
  </div>
)
```

Remove the `chatOpen` state and toggle button. The chat panel is always rendered.

- [ ] **Step 2: Update Editorial.css — two-column layout**

```css
.editorial-columns {
  display: flex;
  gap: var(--sp-4);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.editorial-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

- [ ] **Step 3: Update EditorialChat.jsx — remove overlay behaviour**

Remove `isOpen`/`onClose` props. The component is always visible. Add a collapse/expand toggle for when the user wants full-width content.

```jsx
export default function EditorialChat({ tab }) {
  const [collapsed, setCollapsed] = useState(false)
  // ... rest of component

  if (collapsed) {
    return (
      <div className="editorial-chat collapsed">
        <button className="chat-expand-btn" onClick={() => setCollapsed(false)} title="Open AI chat">
          AI
        </button>
      </div>
    )
  }

  return (
    <div className="editorial-chat">
      {/* existing chat UI but with collapse button instead of close */}
    </div>
  )
}
```

- [ ] **Step 4: Update EditorialChat.css — persistent panel styles**

```css
.editorial-chat {
  width: 380px;
  min-width: 380px;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--card-bg);
  border-radius: var(--radius);
  overflow: hidden;
}

.editorial-chat.collapsed {
  width: 48px;
  min-width: 48px;
  align-items: center;
  justify-content: flex-start;
  padding-top: var(--sp-3);
}
```

- [ ] **Step 5: Clean up dead CSS**

Remove `.chat-toggle` styles from `Editorial.css` (the toggle button no longer exists). Remove any overlay/slide-in animation styles from `EditorialChat.css` that are no longer used.

- [ ] **Step 6: Verify layout renders correctly**

Open http://localhost:5173/editorial. Should see tab content on left, chat panel on right. Chat panel should collapse to a narrow "AI" button when collapsed. Check that the Newsletter tab's Draft editor fits within the content column width.

- [ ] **Step 7: Commit**

```bash
git add web/app/src/pages/Editorial.jsx web/app/src/pages/Editorial.css web/app/src/components/EditorialChat.jsx web/app/src/components/EditorialChat.css
git commit -m "feat: two-column Editorial layout with persistent chat panel"
```

---

## Task 4: Per-tab chat threads with lazy context injection

**Files:**
- Modify: `web/app/src/hooks/useEditorialChat.js`
- Modify: `web/app/src/components/EditorialChat.jsx`
- Modify: `web/api/routes/editorial.js`
- Modify: `web/api/lib/editorial-chat.js`

Currently the editorial chat is ephemeral — messages clear on tab switch. Change to maintain a separate thread per tab so the user can switch tabs and resume conversations. Context is injected only when the first message is sent (not before), to save tokens.

- [ ] **Step 1: Refactor useEditorialChat to maintain per-tab threads**

Replace single message array with a map keyed by tab name:

```jsx
export function useEditorialChat(tab = 'state') {
  // Map of tab -> messages[]
  const [threads, setThreads] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // ...

  const messages = threads[tab] || []

  const send = useCallback(async (text) => {
    // When sending, check if this is the first message for this tab
    // If so, include injectContext: true in the API call
    const isFirstMessage = !threads[tab] || threads[tab].length === 0

    // ... build user/assistant messages ...
    setThreads(prev => ({
      ...prev,
      [tab]: [...(prev[tab] || []), userMsg, assistantMsg]
    }))

    // Pass injectContext flag to API
    const res = await apiStream('/api/editorial/chat', {
      message: trimmed,
      tab,
      injectContext: isFirstMessage,
      history: (threads[tab] || []).filter(m => m.content).map(m => ({ role: m.role, content: m.content })),
    }, controller.signal)

    // ... streaming logic unchanged ...
  }, [tab, threads])

  const clear = useCallback(() => {
    // Clear only the current tab's thread
    if (abortRef.current) abortRef.current.abort()
    setThreads(prev => ({ ...prev, [tab]: [] }))
    setError(null)
    setLoading(false)
  }, [tab])

  return { messages, loading, error, send, clear }
}
```

- [ ] **Step 2: Update API route to respect `injectContext` flag**

In `postEditorialChat` in `editorial.js`, only build editorial context when `injectContext` is true:

```js
const { message, tab, history, injectContext } = body
const activeTab = tab || 'state'

let context = null
let tokenEstimate = 0
if (injectContext) {
  const ctx = buildEditorialContext(activeTab)
  context = ctx.context
  tokenEstimate = ctx.tokenEstimate
}
```

When `injectContext` is false and history exists, the history already contains the context from the first exchange — no need to re-inject it.

- [ ] **Step 3: Remove the `useEffect` that clears on tab change**

In EditorialChat.jsx, remove:
```jsx
useEffect(() => { clear() }, [tab, clear])
```

The per-tab thread map handles this naturally.

**Important:** Preserve all existing `mountedRef` guards in the hook. The code snippets in this task show only structural changes — the `mountedRef` checks in `send()`, `catch`, and `finally` blocks must remain.

- [ ] **Step 4: Verify tab switching preserves threads**

1. Open Analysis tab, send a message, get response
2. Switch to Themes tab, send a different message
3. Switch back to Analysis — previous conversation should still be there

- [ ] **Step 5: Commit**

```bash
git add web/app/src/hooks/useEditorialChat.js web/app/src/components/EditorialChat.jsx web/api/routes/editorial.js
git commit -m "feat: per-tab chat threads with lazy context injection"
```

---

## Task 5: Writing preferences in editorial chat system prompt

**Files:**
- Modify: `web/api/lib/editorial-chat.js`
- Modify: `web/api/routes/editorial.js`
- Data: `data/editorial/writing-preferences.md` (already created)

- [ ] **Step 1: Consolidate system prompt in editorial-chat.js**

There are duplicate `EDITORIAL_SYSTEM` constants in both `editorial-chat.js` (line 18) and `editorial.js` (line 534). Consolidate by creating `getEditorialSystemPrompt()` in `editorial-chat.js` that reads writing preferences, and export it. Remove the duplicate constant from `editorial.js`.

```js
// In editorial-chat.js:

let _writingPrefs = null

function getWritingPreferences() {
  if (_writingPrefs !== null) return _writingPrefs
  const prefsPath = join(EDITORIAL_DIR, 'writing-preferences.md')
  if (!existsSync(prefsPath)) {
    _writingPrefs = ''
    return _writingPrefs
  }
  try {
    _writingPrefs = readFileSync(prefsPath, 'utf-8')
  } catch {
    _writingPrefs = ''
  }
  return _writingPrefs
}

const EDITORIAL_SYSTEM_BASE = `You are an editorial intelligence assistant for Sector News Intelligence (SNI), a weekly AI newsletter covering five sectors: general AI, biopharma, medtech, manufacturing and insurance.

You have access to the editorial state document — an evolving knowledge base of analysis entries, themes, post candidates and editorial decisions built by the pipeline.

Your role:
- Help the editor understand patterns, connections and gaps in the analysis
- Suggest post angles and identify underexplored themes
- Answer questions about specific entries, themes or backlog items
- Provide concise, actionable editorial guidance

Style: UK English, analytical but accessible, cite specific entries/themes by ID when referencing them. Be concise — the editor values density over length.`

export function getEditorialSystemPrompt() {
  const prefs = getWritingPreferences()
  if (!prefs) return EDITORIAL_SYSTEM_BASE
  return `${EDITORIAL_SYSTEM_BASE}\n\n## Writing Preferences\n\nWhen drafting or editing content, follow these rules:\n\n${prefs}`
}
```

- [ ] **Step 2: Update editorial.js to import the consolidated prompt**

In `editorial.js`, remove the local `EDITORIAL_SYSTEM` constant (line 534-544) and import:

```js
import { buildEditorialContext, trimEditorialHistory, getEditorialSystemPrompt } from '../lib/editorial-chat.js'
```

In `postEditorialChat`, replace `system: EDITORIAL_SYSTEM` with `system: getEditorialSystemPrompt()`.

- [ ] **Step 3: Add `newsletter` case to buildEditorialContext()**

In `editorial-chat.js`, add a case to the switch so the Newsletter tab gets meaningful context:

```js
case 'newsletter': {
  // Published state + in-progress posts for newsletter editing context
  const publishedMeta = readJSON(join(EDITORIAL_DIR, 'published.json')) || {}
  sections.push(`\n## Newsletter Context\n`)
  sections.push(`Published edition: ${publishedMeta.week ? 'Week ' + publishedMeta.week : 'None'}`)
  if (publishedMeta.publishedAt) sections.push(`Last published: ${publishedMeta.publishedAt}`)
  const inProgress = Object.entries(state.postBacklog || {})
    .filter(([, p]) => p.status === 'in-progress' || p.status === 'approved')
  if (inProgress.length > 0) {
    sections.push(`\n### Active Posts\n`)
    for (const [id, post] of inProgress) {
      sections.push(formatPost(id, post))
    }
  }
  break
}
```

Add a local `readJSON` helper to `editorial-chat.js` (mirrors the one in `editorial.js`):
```js
function readJSON(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}
```

- [ ] **Step 4: Verify by asking the chat to draft something**

Ask the editorial chat: "Draft a short LinkedIn post about the NVIDIA GTC announcements."
Expected: Output follows UK English, single quotes, spaced en-dashes, includes in-the-end-at-the-end, avoids prohibited language.

- [ ] **Step 5: Commit**

```bash
git add web/api/lib/editorial-chat.js web/api/routes/editorial.js
git commit -m "feat: inject writing preferences into editorial chat system prompt"
```

---

## Task 6: Model toggle in editorial chat (Sonnet/Opus)

**Files:**
- Modify: `web/app/src/components/EditorialChat.jsx`
- Modify: `web/app/src/hooks/useEditorialChat.js`
- Modify: `web/api/routes/editorial.js`

- [ ] **Step 1: Add model state to useEditorialChat**

```jsx
const [model, setModel] = useState('sonnet')

// In send(), pass model to API:
const res = await apiStream('/api/editorial/chat', {
  message: trimmed,
  tab,
  model,
  injectContext: isFirstMessage,
  history: /* ... */,
}, controller.signal)

return { messages, loading, error, send, clear, model, setModel }
```

- [ ] **Step 2: Add model toggle UI to EditorialChat.jsx**

Add a toggle button in the chat header:

```jsx
<div className="chat-header-actions">
  <button
    className={`model-toggle ${model === 'opus' ? 'opus' : 'sonnet'}`}
    onClick={() => setModel(m => m === 'sonnet' ? 'opus' : 'sonnet')}
    title={model === 'sonnet' ? 'Switch to Opus' : 'Switch to Sonnet'}
  >
    {model === 'sonnet' ? 'S' : 'O'}
  </button>
  {/* existing clear and collapse buttons */}
</div>
```

- [ ] **Step 3: Accept model parameter in API route**

In `postEditorialChat`:

```js
const { message, tab, history, injectContext, model } = body

const modelId = model === 'opus'
  ? 'claude-opus-4-0725'
  : 'claude-sonnet-4-20250514'

// Use modelId in client.messages.create()
const response = await client.messages.create({
  model: modelId,
  max_tokens: model === 'opus' ? 4096 : 2048,
  system: getEditorialSystemPrompt(),
  messages: sdkMessages,
  stream: true,
})
```

- [ ] **Step 4: Verify model toggle works**

Toggle to Opus, send a message. Check API server logs to confirm the request uses `claude-opus-4-0725`.

- [ ] **Step 5: Commit**

```bash
git add web/app/src/components/EditorialChat.jsx web/app/src/hooks/useEditorialChat.js web/api/routes/editorial.js
git commit -m "feat: add Sonnet/Opus model toggle to editorial chat"
```

---

## Task 7: Replace DraftLink with inline chat drafting

**Files:**
- Modify: `web/app/src/components/shared/DraftLink.jsx`
- Modify: `web/app/src/pages/Editorial.jsx`

The current DraftLink component navigates to `/draft` when clicked. Replace with a component that sends a drafting prompt to the editorial chat panel.

- [ ] **Step 1: Create a DraftInChat callback pattern**

In Editorial.jsx, create a ref or context that the chat panel can receive draft requests:

```jsx
const [draftRequest, setDraftRequest] = useState(null)

// Pass to EditorialChat:
<EditorialChat tab={tab} draftRequest={draftRequest} onDraftConsumed={() => setDraftRequest(null)} />
```

- [ ] **Step 2: Replace DraftLink with DraftInChatButton in Editorial.jsx**

```jsx
function DraftInChatButton({ label = 'Draft this post', source, content }) {
  // Get the setDraftRequest from Editorial's context
  // This needs to be passed down or via React context
  return (
    <button
      className="draft-link"
      onClick={(e) => {
        e.stopPropagation()
        // Build a prompt from the source/content
        const prompt = buildDraftPrompt(source, content)
        // Trigger the chat to send this prompt
        setDraftRequest(prompt)
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </svg>
      {label}
    </button>
  )
}

function buildDraftPrompt(source, content) {
  if (source?.type === 'post') {
    return `Draft post #${source.id}: "${source.title}"\n\nCore argument: ${content?.coreArgument || 'Not specified'}\nFormat: ${content?.format || 'Not specified'}\nSource documents: ${content?.sources?.join(', ') || 'None'}\nNotes: ${content?.notes || 'None'}\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options as specified in the LinkedIn post guidelines.`
  }
  if (source?.type === 'theme') {
    return `Draft an analysis post for theme ${source.code}: "${source.name}"\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options.`
  }
  if (source?.type === 'analysis') {
    return `Draft a post based on analysis entry #${source.id}: "${source.title}"\n\nSummary: ${content?.summary || ''}\nThemes: ${content?.themes?.join(', ') || 'None'}\n\nPlease draft this as a LinkedIn post following my writing preferences. Produce three format options.`
  }
  return `Draft a post about: ${source?.title || 'untitled'}`
}
```

- [ ] **Step 3: Wire DraftInChatButton through Editorial.jsx**

Pass the draft request function down to tab components via props or React context. The simplest approach is to pass a callback through props:

```jsx
// In Editorial.jsx, pass onDraftRequest to each tab:
{tab === 'backlog' && <BacklogTab filter={backlogFilter} setFilter={setBacklogFilter} onDraftRequest={setDraftRequest} />}
{tab === 'state' && <AnalysisTab onDraftRequest={setDraftRequest} />}
{tab === 'themes' && <ThemesTab onDraftRequest={setDraftRequest} />}
```

- [ ] **Step 4: Handle draftRequest in EditorialChat**

When `draftRequest` changes and is non-null, auto-send it as a message, switch model to Opus, and clear the request:

```jsx
useEffect(() => {
  if (draftRequest) {
    setModel('opus')
    send(draftRequest)
    onDraftConsumed()
  }
}, [draftRequest])
```

- [ ] **Step 5: Verify inline drafting**

1. Open Backlog tab
2. Expand a post, click "Draft this post"
3. Chat panel should receive the drafting prompt and stream a response with three LinkedIn post format options

- [ ] **Step 6: Commit**

```bash
git add web/app/src/pages/Editorial.jsx web/app/src/components/EditorialChat.jsx web/app/src/components/shared/DraftLink.jsx
git commit -m "feat: replace DraftLink navigation with inline chat drafting"
```

---

## Task 8: Podcast display fix (already done — commit only)

**Files:**
- Modified: `web/api/routes/podcasts.js`

The podcast route already has the digest-file scanner fallback. Just needs a commit.

- [ ] **Step 1: Verify podcasts display in browser**

Open http://localhost:5173/database, click Podcasts tab. Should show 30 episodes.

- [ ] **Step 2: Commit**

```bash
git add web/api/routes/podcasts.js data/editorial/writing-preferences.md
git commit -m "feat: podcast API scans digest files when manifest missing, add writing preferences"
```

---

## Task 9: Build verification and final polish

- [ ] **Step 1: Run full build**

```bash
cd /Users/scott/Projects/sni-research-v2/web/app && bun run build
```
Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Run API tests**

```bash
cd /Users/scott/Projects/sni-research-v2/web/api && bun test
```
Expected: All 190 tests pass.

- [ ] **Step 3: Manual verification checklist**

- [ ] Sidebar shows 6 items (no Draft)
- [ ] /draft redirects to /editorial?tab=newsletter
- [ ] Newsletter tab renders the full draft editor
- [ ] Editorial chat is visible as right-hand panel
- [ ] Chat persists per tab (switch Analysis → Themes → back, messages preserved)
- [ ] Context is only injected on first message per tab
- [ ] Model toggle (S/O) works and affects API model choice
- [ ] "Draft this post" from Backlog triggers inline drafting in chat
- [ ] "Draft analysis" from Themes triggers inline drafting in chat
- [ ] Writing preferences are reflected in drafted output (UK English, single quotes, etc.)
- [ ] Podcasts tab shows 30 episodes in Database page
- [ ] Cmd+3 navigates to Editorial (not Draft)

- [ ] **Step 4: Commit any final polish**

```bash
git commit -m "chore: final polish for editorial UX overhaul"
```
