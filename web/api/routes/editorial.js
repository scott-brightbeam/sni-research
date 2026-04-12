import { readFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { getDb } from '../lib/db.js'
import * as eq from '../lib/editorial-queries.js'
import { getISOWeek } from '../lib/week.js'
import { getClient } from '../lib/claude.js'
import { buildEditorialContext, trimEditorialHistory, getEditorialSystemPrompt } from '../lib/editorial-chat.js'
import { DRAFT_TOOLS, executeTool } from '../lib/editorial-tools.js'
import config from '../lib/config.js'

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

const STALE_LOCK_MS = 30 * 60 * 1000 // 30 minutes

function checkLock(stage) {
  const lockPath = join(editorialDir(), `.${stage}.lock`)
  if (!existsSync(lockPath)) return null
  const lockData = readJSON(lockPath)
  if (!lockData) return null

  const age = Date.now() - new Date(lockData.timestamp).getTime()
  if (age > STALE_LOCK_MS) {
    try {
      unlinkSync(lockPath)
    } catch (err) {
      console.error(`[editorial] Failed to clean up stale lock ${lockPath}: ${err.message}`)
      return lockData
    }
    return null
  }

  return lockData
}

function spawnStage(script) {
  const config = { PIPELINE_ENABLED: process.env.PIPELINE_ENABLED !== 'false', ROOT }
  if (!config.PIPELINE_ENABLED) {
    throw Object.assign(new Error('Pipeline execution disabled on this server'), { status: 403 })
  }
  const scriptPath = join(ROOT, script)
  if (!existsSync(scriptPath)) {
    throw Object.assign(new Error(`Script not found: ${script}`), { status: 500 })
  }
  if (process.env.SNI_TEST_MODE || process.env.NODE_ENV === 'test') {
    console.log(`[editorial] TEST MODE — skipping spawn of ${script}`)
    return { pid: -1, exited: Promise.resolve(0) }
  }
  const safeEnv = Object.fromEntries(
    ['PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'NODE_ENV', 'SNI_TEST_MODE']
      .filter(k => process.env[k])
      .map(k => [k, process.env[k]])
  )
  const proc = Bun.spawn(['bun', scriptPath], {
    cwd: ROOT,
    env: safeEnv,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  proc.exited.then(code => {
    if (code !== 0) console.error(`[editorial] ${script} exited with code ${code}`)
  })
  return proc
}

// ── snake_case → camelCase conversion ────────────────────
//
// The DB uses snake_case column names; the UI expects camelCase
// to match the original state.json format.

const COLUMN_MAP = {
  date_processed: 'dateProcessed',
  key_themes: 'keyThemes',
  post_potential: 'postPotential',
  post_potential_reasoning: 'postPotentialReasoning',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  created_session: 'createdSession',
  last_updated_session: 'lastUpdatedSession',
  document_count: 'documentCount',
  evidence_count: 'evidenceCount',
  latest_evidence_session: 'latestEvidenceSession',
  working_title: 'workingTitle',
  core_argument: 'coreArgument',
  date_added: 'dateAdded',
  source_documents: 'sourceDocuments',
  source_urls: 'sourceUrls',
  date_published: 'datePublished',
  theme_code: 'themeCode',
  from_code: 'fromCode',
  to_code: 'toCode',
  post_id: 'postId',
  total_documents: 'totalDocuments',
  active_tier1: 'activeTier1',
  active_tier2: 'activeTier2',
  reference_documents: 'referenceDocuments',
  active_themes: 'activeThemes',
  total_posts: 'totalPosts',
  posts_published: 'postsPublished',
  posts_approved: 'postsApproved',
  session_id: 'sessionId',
  source_type: 'sourceType',
}

// Columns stored as JSON strings that need parsing
const JSON_COLUMNS = new Set([
  'themes', 'key_themes', 'keyThemes',
  'source_documents', 'sourceDocuments',
  'source_urls', 'sourceUrls',
  'participants',
  'costs',
])

/**
 * Convert a single DB row from snake_case to camelCase,
 * parsing JSON string columns as needed.
 */
function toCamelCase(row) {
  if (!row) return row
  const out = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = COLUMN_MAP[key] || key
    if (JSON_COLUMNS.has(key) && typeof value === 'string') {
      try {
        out[camelKey] = JSON.parse(value)
      } catch {
        out[camelKey] = value
      }
    } else {
      out[camelKey] = value
    }
  }
  return out
}

/**
 * Convert an array of DB rows.
 */
function rowsToCamelCase(rows) {
  return (rows || []).map(toCamelCase)
}

// ── GET /api/editorial/state ─────────────────────────────

export async function getEditorialState({ section, week, showArchived } = {}) {
  const db = getDb()

  if (!section) {
    const [counters, corpusStats] = await Promise.all([
      eq.getCounters(db),
      eq.getCorpusStats(db),
    ])

    // Counts for summary view
    const [entriesResult, themesResult, postsResult] = await Promise.all([
      db.execute('SELECT COUNT(*) AS cnt FROM analysis_entries WHERE archived = 0'),
      db.execute('SELECT COUNT(*) AS cnt FROM themes WHERE archived = 0'),
      db.execute('SELECT COUNT(*) AS cnt FROM posts'),
    ])

    // Rotation candidates from the table
    const rotResult = await db.execute('SELECT content FROM rotation_candidates')
    const rotationCandidates = rotResult.rows.map(r => r.content)

    return {
      counters,
      corpusStats: toCamelCase(corpusStats),
      rotationCandidates,
      entryCount: Number(entriesResult.rows[0].cnt),
      themeCount: Number(themesResult.rows[0].cnt),
      postCount: Number(postsResult.rows[0].cnt),
    }
  }

  const includeArchived = showArchived === 'true'

  switch (section) {
    case 'analysisIndex': {
      const rows = await eq.getAnalysisEntries(db, { showArchived: includeArchived })
      return { entries: rowsToCamelCase(rows) }
    }
    case 'themeRegistry': {
      const rows = await eq.getThemes(db, { showArchived: includeArchived })
      // Enrich each theme with evidence and connections for full API compatibility
      const themes = await Promise.all(rows.map(async (row) => {
        const detail = await eq.getThemeWithEvidence(db, row.code)
        const theme = toCamelCase(row)
        if (detail) {
          theme.evidence = rowsToCamelCase(detail.evidence)
          theme.crossConnections = detail.connections.map(c => ({
            theme: c.from_code === row.code ? c.to_code : c.from_code,
            reasoning: c.reasoning,
          }))
        } else {
          theme.evidence = []
          theme.crossConnections = []
        }
        // Map DB field names to legacy API names
        theme.created = theme.createdSession || theme.createdAt
        theme.lastUpdated = theme.lastUpdatedSession || theme.updatedAt
        return theme
      }))
      return { themes }
    }
    case 'postBacklog': {
      const rows = await eq.getPosts(db, {})
      return { posts: rowsToCamelCase(rows) }
    }
    case 'decisionLog': {
      const rows = await eq.getDecisions(db, { showArchived: includeArchived })
      return { decisions: rowsToCamelCase(rows) }
    }
    case 'corpusStats': {
      const stats = await eq.getCorpusStats(db)
      return { corpusStats: toCamelCase(stats) }
    }
    default:
      return { error: `Unknown section: ${section}`, data: null }
  }
}

// ── GET /api/editorial/search ────────────────────────────

export async function searchEditorial({ q } = {}) {
  if (!q) return { results: [] }
  const db = getDb()
  const results = await eq.searchEditorial(db, q)
  // searchEditorial already returns camelCase-friendly shape
  // (type, id, title, source, match) — no snake_case conversion needed
  return { results, query: q }
}

// ── GET /api/editorial/backlog ───────────────────────────

export async function getEditorialBacklog({ priority, status, format } = {}) {
  const db = getDb()
  const rows = await eq.getPosts(db, { priority, status, format })
  return { posts: rowsToCamelCase(rows) }
}

// ── GET /api/editorial/themes ────────────────────────────

export async function getEditorialThemes({ active, stale, showArchived } = {}) {
  const db = getDb()
  const counters = await eq.getCounters(db)
  const currentSession = (counters.nextSession || 1) - 1

  const rows = await eq.getThemes(db, {
    active: active === 'true',
    stale: stale === 'true',
    showArchived: showArchived === 'true',
    currentSession,
  })

  // Enrich with evidence and connections
  const themes = await Promise.all(rows.map(async (row) => {
    const detail = await eq.getThemeWithEvidence(db, row.code)
    const theme = toCamelCase(row)
    if (detail) {
      theme.evidence = rowsToCamelCase(detail.evidence)
      theme.crossConnections = detail.connections.map(c => ({
        theme: c.from_code === row.code ? c.to_code : c.from_code,
        reasoning: c.reasoning,
      }))
    } else {
      theme.evidence = []
      theme.crossConnections = []
    }
    theme.created = theme.createdSession || theme.createdAt
    theme.lastUpdated = theme.lastUpdatedSession || theme.updatedAt
    return theme
  }))

  return { themes }
}

// ── GET /api/editorial/notifications ─────────────────────

export async function getEditorialNotifications() {
  const db = getDb()
  const rows = await eq.getNotifications(db, { showDismissed: false })
  return { notifications: rowsToCamelCase(rows) }
}

// ── PUT /api/editorial/notifications/:id/dismiss ─────────

export async function dismissNotification(id) {
  const db = getDb()
  await eq.dismissNotification(db, id)
  return { ok: true, id }
}

// ── GET /api/editorial/status ────────────────────────────
// Stays on filesystem — reads lock files

export async function getEditorialStatus() {
  const stages = ['analyse', 'discover', 'draft']
  const locks = {}
  const progress = {}

  for (const stage of stages) {
    const lockData = checkLock(stage)
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
  const db = getDb()

  // Read from cost_log table
  const result = await db.execute('SELECT * FROM cost_log ORDER BY timestamp DESC')
  if (result.rows.length === 0) {
    return {
      weeklyTotal: 0,
      budget: 50,
      breakdown: { analyse: 0, discover: 0, draft: 0, critique: 0 },
    }
  }

  // Group by week using the timestamp field
  const weeks = {}
  for (const row of result.rows) {
    const ts = row.timestamp
    if (!ts) continue
    const d = new Date(ts)
    const weekKey = `${d.getFullYear()}-W${String(getISOWeek(d)).padStart(2, '0')}`

    if (!weeks[weekKey]) {
      weeks[weekKey] = { weeklyTotal: 0, budget: 50, breakdown: {} }
    }
    const stage = row.stage || 'unknown'
    weeks[weekKey].breakdown[stage] = (weeks[weekKey].breakdown[stage] || 0) + (row.total || 0)
    weeks[weekKey].weeklyTotal += row.total || 0
  }

  if (week) {
    return weeks[week] || { weeklyTotal: 0, budget: 50, breakdown: {} }
  }

  // Return most recent week
  const weekKeys = Object.keys(weeks).sort()
  const latest = weekKeys[weekKeys.length - 1]
  return weeks[latest] || { weeklyTotal: 0, budget: 50, breakdown: {} }
}

// ── GET /api/editorial/activity ──────────────────────────

export async function getEditorialActivity({ limit = 20 } = {}) {
  const db = getDb()
  const lim = Math.min(Math.max(parseInt(limit) || 20, 1), 100)
  const rows = await eq.getActivity(db, lim)
  return { activities: rowsToCamelCase(rows) }
}

// ── GET /api/editorial/render ────────────────────────────

export async function renderEditorialSection({ section, id } = {}) {
  const db = getDb()

  switch (section) {
    case 'analysisIndex': {
      if (id) {
        const entry = await eq.getAnalysisEntry(db, Number(id))
        if (!entry) return { markdown: `*Entry #${id} not found*` }
        const e = toCamelCase(entry)
        return {
          markdown: [
            `## #${e.id}: ${e.title}`,
            `**Source:** ${e.source} · **Host:** ${e.host || 'N/A'} · **Date:** ${e.date}`,
            `**Tier:** ${e.tier} · **Session:** ${e.session} · **Post potential:** ${e.postPotential || 'N/A'}`,
            `**Themes:** ${Array.isArray(e.themes) ? e.themes.join(', ') : (e.themes || '')}`,
            '',
            e.summary || '*No summary*',
          ].join('\n'),
        }
      }
      // Render full index
      const rows = await eq.getAnalysisEntries(db, { showArchived: false })
      const lines = ['# Analysis Index\n']
      for (const row of rows) {
        lines.push(`### #${row.id}: ${row.title}`)
        lines.push(`${row.source} · Tier ${row.tier} · Session ${row.session}\n`)
      }
      return { markdown: lines.join('\n') }
    }
    case 'themeRegistry': {
      if (id) {
        const detail = await eq.getThemeWithEvidence(db, id)
        if (!detail) return { markdown: `*Theme ${id} not found*` }
        const t = toCamelCase(detail.theme)
        const lines = [
          `## ${id}: ${t.name}`,
          `**Documents:** ${t.documentCount} · **Last updated:** ${t.lastUpdatedSession || t.updatedAt}`,
          '',
          '### Evidence',
        ]
        for (const ev of (detail.evidence || []).slice(-3)) {
          lines.push(`> **Session ${ev.session} · ${ev.source}**`)
          lines.push(`> ${ev.content}\n`)
        }
        if (detail.connections?.length) {
          lines.push('### Cross-connections')
          for (const cc of detail.connections) {
            const otherCode = cc.from_code === id ? cc.to_code : cc.from_code
            lines.push(`- **${otherCode}** — ${cc.reasoning}`)
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
// Stays on filesystem — reads discover-progress-session-N.json

export async function getDiscoverProgress({ session } = {}) {
  let sessionNum = session ? parseInt(session, 10) : null

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
// Stays on filesystem — reads draft/critique/metrics files

export async function getEditorialDraft({ session } = {}) {
  const draftsDir = join(editorialDir(), 'drafts')
  if (!existsSync(draftsDir)) return { session: null, draft: null, critique: null, metrics: null }

  let sessionNum = session ? parseInt(session, 10) : null

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
// Stays on filesystem — spawns pipeline scripts

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

  const db = getDb()
  const updated = await eq.updatePostStatus(db, Number(id), body.status)
  if (!updated) {
    throw Object.assign(new Error(`Post ${id} not found in backlog`), { status: 404 })
  }
  return { ok: true, id, status: body.status }
}

// ── PUT /api/editorial/analysis/:id/archive ─────────────────

export async function putAnalysisArchive(id, body) {
  if (!/^\d+$/.test(id)) {
    throw Object.assign(new Error('id must be numeric'), { status: 400 })
  }

  const db = getDb()

  // Check entry exists
  const entry = await eq.getAnalysisEntry(db, Number(id))
  if (!entry) {
    throw Object.assign(new Error(`Analysis entry ${id} not found`), { status: 404 })
  }

  const archived = body?.archived !== false ? 1 : 0
  await eq.setAnalysisArchived(db, Number(id), archived)
  return { ok: true, id, archived: !!archived }
}

// ── PUT /api/editorial/themes/:code/archive ─────────────────

export async function putThemeArchive(code, body) {
  if (!/^T\d+$/.test(code)) {
    throw Object.assign(new Error('code must match T{number} (e.g. T01)'), { status: 400 })
  }

  const db = getDb()

  // Check theme exists
  const detail = await eq.getThemeWithEvidence(db, code)
  if (!detail) {
    throw Object.assign(new Error(`Theme ${code} not found`), { status: 404 })
  }

  const archived = body?.archived !== false ? 1 : 0
  await eq.setThemeArchived(db, code, archived)
  return { ok: true, code, archived: !!archived }
}

// ── POST /api/editorial/decisions ───────────────────────────

export async function postDecision(body) {
  if (!body?.title || typeof body.title !== 'string' || !body.title.trim()) {
    throw Object.assign(new Error('title is required'), { status: 400 })
  }
  if (!body?.decision || typeof body.decision !== 'string' || !body.decision.trim()) {
    throw Object.assign(new Error('decision is required'), { status: 400 })
  }

  const db = getDb()
  const counters = await eq.getCounters(db)
  const session = Math.max(1, (counters.nextSession || 1) - 1)

  const result = await eq.addDecision(db, {
    session,
    title: body.title.trim(),
    decision: body.decision.trim(),
    reasoning: (body.reasoning || '').trim() || undefined,
  })

  return { ok: true, id: result.id, session }
}

// ── PUT /api/editorial/decisions/:id/archive ────────────────

export async function putDecisionArchive(id, body) {
  const db = getDb()

  // Check decision exists
  const decisions = await eq.getDecisions(db, { showArchived: true })
  const decision = decisions.find(d => d.id === id)
  if (!decision) {
    throw Object.assign(new Error(`Decision ${id} not found`), { status: 404 })
  }

  const archived = body?.archived !== false ? 1 : 0
  await eq.setDecisionArchived(db, id, archived)
  return { ok: true, id, archived: !!archived }
}

// ── Editorial Chat (streaming SSE) ─────────────────────

export async function postEditorialChat(body, req) {
  const { message, tab, history, injectContext, model, sourceRefs } = body

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(new Error('message is required'), { status: 400 })
  }

  const activeTab = tab || 'state'

  // Only build context on first message per tab (lazy injection)
  let context = null
  let tokenEstimate = 0
  if (injectContext !== false) {
    const ctx = buildEditorialContext(activeTab, null, Array.isArray(sourceRefs) ? sourceRefs : null)
    context = ctx.context
    tokenEstimate = ctx.tokenEstimate
  }

  const trimmedHistory = trimEditorialHistory(history || [])

  // Build messages array
  const sdkMessages = []
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

  const abort = new AbortController()
  if (req.signal?.aborted) {
    abort.abort()
  } else if (req.signal) {
    req.signal.addEventListener('abort', () => abort.abort(), { once: true })
  }

  const client = getClient()
  if (!client) {
    return new Response(JSON.stringify({
      type: 'error', code: 'ANTHROPIC_DISABLED',
      message: 'Editorial chat has moved to Claude Code.'
    }), { status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': config.CORS_ORIGIN } })
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': config.CORS_ORIGIN,
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

        const isDraftMode = activeTab === 'draft'
        const MAX_TOOL_ROUNDS = 5

        // Load editorial state for tool execution (draft mode reads from DB)
        let editorialState = null
        if (isDraftMode) {
          const statePath = join(ROOT, 'data/editorial/state.json')
          try {
            editorialState = JSON.parse(readFileSync(statePath, 'utf-8'))
          } catch { editorialState = {} }
        }

        let roundMessages = [...sdkMessages]
        let toolRound = 0

        while (true) {
          if (abort.signal.aborted) break

          const response = await client.messages.create({
            model: modelId,
            max_tokens: model === 'opus' ? 4096 : 2048,
            system: getEditorialSystemPrompt(),
            messages: roundMessages,
            stream: true,
            ...(isDraftMode && toolRound < MAX_TOOL_ROUNDS ? { tools: DRAFT_TOOLS } : {}),
          })

          const contentBlocks = []
          let currentToolBlock = null
          let toolInputJson = ''
          let stopReason = null

          for await (const event of response) {
            if (abort.signal.aborted) break

            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              fullText += event.delta.text
              send({ type: 'delta', text: event.delta.text })
            }

            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              currentToolBlock = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: {} }
              toolInputJson = ''
            }

            if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
              toolInputJson += event.delta.partial_json
            }

            if (event.type === 'content_block_stop') {
              if (currentToolBlock) {
                try { currentToolBlock.input = JSON.parse(toolInputJson || '{}') } catch { currentToolBlock.input = {} }
                contentBlocks.push(currentToolBlock)
                currentToolBlock = null
                toolInputJson = ''
              }
            }

            if (event.type === 'message_delta') {
              stopReason = event.delta?.stop_reason
            }
          }

          if (stopReason !== 'tool_use' || abort.signal.aborted) {
            send({ type: 'done', text: fullText, contextTokens: tokenEstimate, tab: activeTab })
            break
          }

          toolRound++

          const assistantContent = []
          if (fullText) {
            assistantContent.push({ type: 'text', text: fullText })
          }
          for (const block of contentBlocks) {
            assistantContent.push(block)
          }

          const toolResults = []
          for (const block of contentBlocks.filter(b => b.type === 'tool_use')) {
            send({ type: 'tool_call', name: block.name, input: block.input })
            const result = executeTool(block.name, block.input, editorialState)
            send({ type: 'tool_result', name: block.name, preview: (result || '').slice(0, 200) })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            })
          }

          roundMessages = [
            ...roundMessages,
            { role: 'assistant', content: assistantContent },
            { role: 'user', content: toolResults },
          ]

          fullText = ''
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
