import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { getClient } from '../lib/claude.js'
import { buildEditorialContext, trimEditorialHistory, getEditorialSystemPrompt } from '../lib/editorial-chat.js'

const ROOT = resolve(import.meta.dir, '../../..')
function editorialDir() {
  return process.env.SNI_EDITORIAL_DIR || join(ROOT, 'data/editorial')
}

// ── Helpers ──────────────────────────────────────────────

function readJSON(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.error(`[editorial] Failed to read/parse ${path}: ${err.message}`)
    return null
  }
}

function getState() {
  return readJSON(join(editorialDir(), 'state.json'))
}

function getPublished() {
  return readJSON(join(editorialDir(), 'published.json'))
}

function getNotifications() {
  return readJSON(join(editorialDir(), 'notifications.json')) || []
}

function writeState(state) {
  const statePath = join(editorialDir(), 'state.json')
  const tmpPath = statePath + '.tmp'
  const bakPath = statePath + '.bak'

  // Phase 1: Write and validate tmp file
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2))
    JSON.parse(readFileSync(tmpPath, 'utf-8'))
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { /* cleanup best-effort */ }
    throw new Error(`Failed to write editorial state: ${err.message}`)
  }

  // Phase 2: Atomic swap — recover if mid-swap failure
  try {
    if (existsSync(statePath)) renameSync(statePath, bakPath)
    renameSync(tmpPath, statePath)
  } catch (err) {
    // If state.json was moved to .bak but .tmp rename failed, restore from .bak
    if (!existsSync(statePath) && existsSync(bakPath)) {
      try { renameSync(bakPath, statePath) } catch { /* last-resort recovery failed */ }
    }
    try { unlinkSync(tmpPath) } catch { /* cleanup best-effort */ }
    throw new Error(`Failed to swap editorial state file: ${err.message}`)
  }
}

const STALE_LOCK_MS = 30 * 60 * 1000 // 30 minutes

function checkLock(stage) {
  const lockPath = join(editorialDir(), `.${stage}.lock`)
  if (!existsSync(lockPath)) return null
  const lockData = readJSON(lockPath)
  if (!lockData) return null

  const age = Date.now() - new Date(lockData.timestamp).getTime()
  if (age > STALE_LOCK_MS) {
    // Stale lock — clean it up
    try {
      unlinkSync(lockPath)
    } catch (err) {
      console.error(`[editorial] Failed to clean up stale lock ${lockPath}: ${err.message}`)
      return lockData // Lock file still exists on disk
    }
    return null
  }

  return lockData
}

function spawnStage(script) {
  const scriptPath = join(ROOT, script)
  if (!existsSync(scriptPath)) {
    throw Object.assign(new Error(`Script not found: ${script}`), { status: 500 })
  }
  const proc = Bun.spawn(['bun', scriptPath], {
    cwd: ROOT,
    env: { ...process.env },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  proc.exited.then(code => {
    if (code !== 0) console.error(`[editorial] ${script} exited with code ${code}`)
  })
  return proc
}

function matchesSearch(entry, query) {
  if (!query) return true
  const q = query.toLowerCase()
  const hay = [
    entry.title,
    entry.source,
    entry.host,
    entry.keyThemes,
    entry.summary,
    ...(entry.themes || []),
  ].filter(Boolean).join(' ').toLowerCase()
  return hay.includes(q)
}

// ── GET /api/editorial/state ─────────────────────────────

export async function getEditorialState({ section, week } = {}) {
  const state = getState()
  if (!state) return { error: 'No editorial state found', data: null }

  if (!section) {
    return {
      counters: state.counters,
      corpusStats: state.corpusStats,
      rotationCandidates: state.rotationCandidates || [],
    }
  }

  switch (section) {
    case 'analysisIndex': {
      const entries = Object.entries(state.analysisIndex || {}).map(([id, entry]) => ({
        id: Number(id),
        ...entry,
      }))
      // Optionally filter by week (match entries whose dateProcessed falls in the week)
      // For now return all sorted by id descending (newest first)
      entries.sort((a, b) => b.id - a.id)
      return { entries }
    }
    case 'themeRegistry': {
      const themes = Object.entries(state.themeRegistry || {}).map(([code, theme]) => ({
        code,
        ...theme,
      }))
      themes.sort((a, b) => {
        const numA = parseInt(a.code.replace('T', ''))
        const numB = parseInt(b.code.replace('T', ''))
        return numA - numB
      })
      return { themes }
    }
    case 'postBacklog': {
      const posts = Object.entries(state.postBacklog || {}).map(([id, post]) => ({
        id: Number(id),
        ...post,
      }))
      posts.sort((a, b) => b.id - a.id)
      return { posts }
    }
    case 'decisionLog': {
      const decisions = state.decisionLog || []
      // Reverse so newest first
      return { decisions: [...decisions].reverse() }
    }
    case 'corpusStats': {
      return { corpusStats: state.corpusStats || {} }
    }
    default:
      return { error: `Unknown section: ${section}`, data: null }
  }
}

// ── GET /api/editorial/search ────────────────────────────

export async function searchEditorial({ q } = {}) {
  const state = getState()
  if (!state || !q) return { results: [] }

  const results = []

  // Search Analysis Index
  for (const [id, entry] of Object.entries(state.analysisIndex || {})) {
    if (matchesSearch(entry, q)) {
      results.push({ type: 'analysisIndex', id: Number(id), title: entry.title, source: entry.source, tier: entry.tier })
    }
  }

  // Search Theme Registry
  for (const [code, theme] of Object.entries(state.themeRegistry || {})) {
    const hay = [theme.name, ...(theme.evidence || []).map(e => e.content)].join(' ').toLowerCase()
    if (hay.includes(q.toLowerCase())) {
      results.push({ type: 'theme', code, name: theme.name, documentCount: theme.documentCount })
    }
  }

  // Search Post Backlog
  for (const [id, post] of Object.entries(state.postBacklog || {})) {
    const hay = [post.title, post.workingTitle, post.coreArgument, post.notes].filter(Boolean).join(' ').toLowerCase()
    if (hay.includes(q.toLowerCase())) {
      results.push({ type: 'post', id: Number(id), title: post.title, status: post.status, priority: post.priority })
    }
  }

  return { results, query: q }
}

// ── GET /api/editorial/backlog ───────────────────────────

export async function getEditorialBacklog({ priority, status, format } = {}) {
  const state = getState()
  if (!state) return { posts: [] }

  let posts = Object.entries(state.postBacklog || {}).map(([id, post]) => ({
    id: Number(id),
    ...post,
  }))

  if (priority) posts = posts.filter(p => p.priority === priority)
  if (status) posts = posts.filter(p => p.status === status)
  if (format) posts = posts.filter(p => p.format === format)

  posts.sort((a, b) => b.id - a.id)
  return { posts }
}

// ── GET /api/editorial/themes ────────────────────────────

export async function getEditorialThemes({ active, stale } = {}) {
  const state = getState()
  if (!state) return { themes: [] }

  let themes = Object.entries(state.themeRegistry || {}).map(([code, theme]) => ({
    code,
    ...theme,
  }))

  // 'active' = has evidence in last 3 sessions
  if (active === 'true' && state.counters) {
    const recentSession = state.counters.nextSession - 1
    themes = themes.filter(t =>
      (t.evidence || []).some(e => e.session >= recentSession - 2)
    )
  }

  // 'stale' = no evidence in last 3 sessions
  if (stale === 'true' && state.counters) {
    const recentSession = state.counters.nextSession - 1
    themes = themes.filter(t =>
      !(t.evidence || []).some(e => e.session >= recentSession - 2)
    )
  }

  themes.sort((a, b) => {
    const numA = parseInt(a.code.replace('T', ''))
    const numB = parseInt(b.code.replace('T', ''))
    return numA - numB
  })

  return { themes }
}

// ── GET /api/editorial/notifications ─────────────────────

export async function getEditorialNotifications() {
  const notifications = getNotifications()
  return { notifications }
}

// ── PUT /api/editorial/notifications/:id/dismiss ─────────

export async function dismissNotification(id) {
  // For now, notifications are append-only from the pipeline.
  // Dismissal is tracked client-side (localStorage) until Phase E4 adds write endpoints.
  return { ok: true, id }
}

// ── GET /api/editorial/status ────────────────────────────

export async function getEditorialStatus() {
  const stages = ['analyse', 'discover', 'draft']
  const locks = {}
  const progress = {}

  for (const stage of stages) {
    const lockData = checkLock(stage) // handles stale lock cleanup
    locks[stage] = !!lockData
    if (lockData) {
      progress[stage] = {
        pid: lockData.pid,
        startedAt: lockData.timestamp,
        current: lockData.current,
        total: lockData.total,
      }
    }
  }

  return { locks, progress }
}

// ── GET /api/editorial/cost ──────────────────────────────

export async function getEditorialCost({ week } = {}) {
  // Cost data will be written by pipeline scripts as they run.
  // Read from cost-log files when they exist.
  const costFile = join(editorialDir(), 'cost-log.json')
  const costData = readJSON(costFile)
  if (!costData) {
    return {
      weeklyTotal: 0,
      budget: 50,
      breakdown: { analyse: 0, discover: 0, draft: 0, critique: 0 },
    }
  }

  if (week) {
    const weekData = costData.weeks?.[week]
    return weekData || { weeklyTotal: 0, budget: 50, breakdown: {} }
  }

  // Return most recent week
  const weeks = Object.keys(costData.weeks || {}).sort()
  const latest = weeks[weeks.length - 1]
  return costData.weeks?.[latest] || { weeklyTotal: 0, budget: 50, breakdown: {} }
}

// ── GET /api/editorial/activity ──────────────────────────

export async function getEditorialActivity({ limit = 20 } = {}) {
  const activityFile = join(editorialDir(), 'activity.json')
  const activities = readJSON(activityFile) || []

  // Return most recent N entries
  const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100)
  return { activities: activities.slice(-lim).reverse() }
}

// ── GET /api/editorial/render ────────────────────────────

export async function renderEditorialSection({ section, id } = {}) {
  const state = getState()
  if (!state) return { markdown: '' }

  switch (section) {
    case 'analysisIndex': {
      if (id) {
        const entry = state.analysisIndex?.[id]
        if (!entry) return { markdown: `*Entry #${id} not found*` }
        return {
          markdown: [
            `## #${id}: ${entry.title}`,
            `**Source:** ${entry.source} · **Host:** ${entry.host || 'N/A'} · **Date:** ${entry.date}`,
            `**Tier:** ${entry.tier} · **Session:** ${entry.session} · **Post potential:** ${entry.postPotential || 'N/A'}`,
            `**Themes:** ${(entry.themes || []).join(', ')}`,
            '',
            entry.summary || '*No summary*',
          ].join('\n')
        }
      }
      // Render full index
      const lines = ['# Analysis Index\n']
      for (const [docId, entry] of Object.entries(state.analysisIndex || {})) {
        lines.push(`### #${docId}: ${entry.title}`)
        lines.push(`${entry.source} · Tier ${entry.tier} · Session ${entry.session}\n`)
      }
      return { markdown: lines.join('\n') }
    }
    case 'themeRegistry': {
      if (id) {
        const theme = state.themeRegistry?.[id]
        if (!theme) return { markdown: `*Theme ${id} not found*` }
        const lines = [
          `## ${id}: ${theme.name}`,
          `**Documents:** ${theme.documentCount} · **Last updated:** ${theme.lastUpdated}`,
          '',
          '### Evidence',
        ]
        for (const ev of (theme.evidence || []).slice(-3)) {
          lines.push(`> **Session ${ev.session} · ${ev.source}**`)
          lines.push(`> ${ev.content}\n`)
        }
        if (theme.crossConnections?.length) {
          lines.push('### Cross-connections')
          for (const cc of theme.crossConnections) {
            lines.push(`- **${cc.theme}** — ${cc.reasoning}`)
          }
        }
        return { markdown: lines.join('\n') }
      }
      return { markdown: '# Theme Registry\n\n*Use ?id=T01 to render a specific theme*' }
    }
    default:
      return { markdown: `*Unknown section: ${section}*` }
  }
}

// ── GET /api/editorial/discover ─────────────────────────

export async function getDiscoverProgress({ session } = {}) {
  let sessionNum = session ? parseInt(session, 10) : null

  // Find latest session if not specified
  if (sessionNum == null) {
    const files = existsSync(editorialDir())
      ? readdirSync(editorialDir())
          .filter(f => /^discover-progress-session-\d+\.json$/.test(f))
          .sort((a, b) => {
            const numA = parseInt(a.match(/\d+/)[0], 10)
            const numB = parseInt(b.match(/\d+/)[0], 10)
            return numA - numB
          })
      : []
    if (files.length === 0) return { session: null, progress: null }
    const latest = files[files.length - 1]
    sessionNum = parseInt(latest.match(/\d+/)[0], 10)
  }

  const progressFile = join(editorialDir(), `discover-progress-session-${sessionNum}.json`)
  const progress = readJSON(progressFile)
  return { session: sessionNum, progress }
}

// ── GET /api/editorial/draft ────────────────────────────

export async function getEditorialDraft({ session } = {}) {
  const draftsDir = join(editorialDir(), 'drafts')
  if (!existsSync(draftsDir)) return { session: null, draft: null, critique: null, metrics: null }

  let sessionNum = session ? parseInt(session, 10) : null

  // Find latest session if not specified
  if (sessionNum == null) {
    const files = readdirSync(draftsDir)
      .filter(f => /^draft-session-\d+-final\.md$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10)
        const numB = parseInt(b.match(/\d+/)[0], 10)
        return numA - numB
      })
    if (files.length === 0) return { session: null, draft: null, critique: null, metrics: null }
    const latest = files[files.length - 1]
    sessionNum = parseInt(latest.match(/\d+/)[0], 10)
  }

  const draftPath = join(draftsDir, `draft-session-${sessionNum}-final.md`)
  const critiquePath = join(draftsDir, `critique-session-${sessionNum}.json`)
  const metricsPath = join(draftsDir, `metrics-session-${sessionNum}.json`)

  let draft = null
  if (existsSync(draftPath)) {
    try { draft = readFileSync(draftPath, 'utf-8') } catch (err) { console.error(`[editorial] Failed to read draft: ${err.message}`) }
  }
  const critique = readJSON(critiquePath)
  const metrics = readJSON(metricsPath)

  return { session: sessionNum, draft, critique, metrics }
}

// ── POST /api/editorial/trigger/:stage ────────────────────

export async function postTriggerAnalyse() {
  const lock = checkLock('analyse')
  if (lock) {
    return { _conflict: true, error: 'Stage already running', stage: 'analyse', progress: lock }
  }
  const proc = spawnStage('scripts/editorial-analyse.js')
  return { ok: true, stage: 'analyse', pid: proc.pid }
}

export async function postTriggerDiscover() {
  const lock = checkLock('discover')
  if (lock) {
    return { _conflict: true, error: 'Stage already running', stage: 'discover', progress: lock }
  }
  const proc = spawnStage('scripts/editorial-discover.js')
  return { ok: true, stage: 'discover', pid: proc.pid }
}

export async function postTriggerDraft() {
  const lock = checkLock('draft')
  if (lock) {
    return { _conflict: true, error: 'Stage already running', stage: 'draft', progress: lock }
  }
  const proc = spawnStage('scripts/editorial-draft.js')
  return { ok: true, stage: 'draft', pid: proc.pid }
}

export async function postTriggerTrack() {
  const proc = spawnStage('scripts/editorial-track.js')
  return { ok: true, stage: 'track', pid: proc.pid }
}

// ── PUT /api/editorial/backlog/:id/status ─────────────────

const VALID_STATUSES = ['suggested', 'approved', 'in-progress', 'published', 'rejected', 'archived']

export async function putBacklogStatus(id, body) {
  if (!body || !body.status) {
    throw Object.assign(new Error('status is required'), { status: 400 })
  }
  if (!VALID_STATUSES.includes(body.status)) {
    throw Object.assign(new Error(`Invalid status: ${body.status}. Must be one of: ${VALID_STATUSES.join(', ')}`), { status: 400 })
  }

  const state = getState()
  if (!state) {
    throw Object.assign(new Error('No editorial state found'), { status: 404 })
  }

  const post = state.postBacklog?.[id]
  if (!post) {
    throw Object.assign(new Error(`Post ${id} not found in backlog`), { status: 404 })
  }

  post.status = body.status
  if (body.status === 'published') {
    post.publishedDate = new Date().toISOString().split('T')[0]
  }

  try {
    writeState(state)
  } catch (err) {
    throw Object.assign(
      new Error(`Failed to save status change for post ${id}: ${err.message}`),
      { status: 500 }
    )
  }
  return { ok: true, id, status: body.status }
}

// ── POST /api/editorial/chat ──────────────────────────────

/**
 * Stream an editorial chat response via SSE.
 *
 * @param {{ message: string, tab: string, history: Array, model?: string }} body
 * @param {Request} req — for abort signal
 * @returns {Response} — SSE stream
 */
export async function postEditorialChat(body, req) {
  const { message, tab, history, injectContext, model } = body

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(new Error('message is required'), { status: 400 })
  }

  const activeTab = tab || 'state'

  // Only build context on first message per tab (lazy injection)
  let context = null
  let tokenEstimate = 0
  if (injectContext !== false) {
    const ctx = buildEditorialContext(activeTab)
    context = ctx.context
    tokenEstimate = ctx.tokenEstimate
  }

  // Trim history to budget
  const trimmedHistory = trimEditorialHistory(history || [])

  // Build messages array
  const sdkMessages = []

  // First message: context preamble
  if (context && trimmedHistory.length === 0) {
    sdkMessages.push({
      role: 'user',
      content: `Here is the current editorial state for context:\n\n${context}\n\n---\n\n${message.trim()}`
    })
  } else if (context) {
    sdkMessages.push({
      role: 'user',
      content: `Here is the current editorial state for context:\n\n${context}`
    })
    sdkMessages.push({
      role: 'assistant',
      content: 'I\'ve reviewed the editorial state. What would you like to discuss?'
    })
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: message.trim() })
  } else {
    for (const msg of trimmedHistory) {
      sdkMessages.push({ role: msg.role, content: msg.content })
    }
    sdkMessages.push({ role: 'user', content: message.trim() })
  }

  // Create abort controller — check if client already disconnected
  const abort = new AbortController()
  if (req.signal?.aborted) {
    abort.abort()
  } else if (req.signal) {
    req.signal.addEventListener('abort', () => abort.abort(), { once: true })
  }

  const client = getClient()

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
        } catch (err) {
          if (err.message?.includes('close') || err.message?.includes('enqueue')) return
          console.error('[editorial-chat] SSE send failed:', err.message, data?.type)
        }
      }

      let fullText = ''

      try {
        const modelId = model === 'opus'
          ? 'claude-opus-4-6'
          : 'claude-sonnet-4-20250514'

        const response = await client.messages.create({
          model: modelId,
          max_tokens: model === 'opus' ? 4096 : 2048,
          system: getEditorialSystemPrompt(),
          messages: sdkMessages,
          stream: true,
        })

        for await (const event of response) {
          if (abort.signal.aborted) break

          if (event.type === 'content_block_delta' && event.delta?.text) {
            fullText += event.delta.text
            send({ type: 'delta', text: event.delta.text })
          }

          if (event.type === 'message_stop') {
            send({
              type: 'done',
              text: fullText,
              contextTokens: tokenEstimate,
              tab: activeTab,
            })
          }
        }
      } catch (err) {
        send({ type: 'error', error: err.message })
      }

      try { controller.close() } catch { /* already closed */ }
    }
  })

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
}
