import { readFileSync, existsSync, readdirSync, unlinkSync, writeFileSync, appendFileSync, mkdirSync, renameSync } from 'fs'
import { join, resolve } from 'path'
import { getDb } from '../lib/db.js'
import * as eq from '../lib/editorial-queries.js'
import { getISOWeek } from '../lib/week.js'
import { getClient } from '../lib/claude.js'
import { buildEditorialContext, trimEditorialHistory, getEditorialSystemPrompt } from '../lib/editorial-chat.js'
import { DRAFT_TOOLS, executeTool } from '../lib/editorial-tools.js'
import { scoreDraft } from '../lib/style-scoring.js'
import {
  buildDraftAddendum,
  detectDraftOutput,
  extractDraftContent,
  buildAuditSystemPrompt,
  buildRevisionInstruction,
  detectSectors,
  buildCEOCritiquePrompt,
  buildCEORevisionInstruction,
  SECTOR_CEO_LABELS,
} from '../lib/draft-flow.js'
// thinking.js is intentionally not imported here. Opus 4.6 adaptive
// thinking combined with the editorial workflow's large context
// payloads (big prompts + tool results + reference posts) reliably
// ECONNRESETs the connection. We tried every combination — on
// initial/audit/revision, individually and together — and every Opus
// call with thinking enabled failed. Leaving the helper in place
// (lib/thinking.js) so we can re-enable later when Anthropic fixes
// the underlying issue, but the editorial route runs without it.
import config from '../lib/config.js'

const ROOT = resolve(import.meta.dir, '../../..')

function editorialDir() {
  return process.env.SNI_EDITORIAL_DIR || join(ROOT, 'data/editorial')
}

// ── Helpers ──────────────────────────────────────────────

// Walk backwards through an SDK messages array to find the most recent
// user-role message. Used by the audit-and-CEO revision passes, which
// need to anchor their re-conversation on the original user prompt.
// The construction in postEditorialChat always pushes a user message
// last; this helper guards against future drift in that invariant.
function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') return messages[i]
  }
  return null
}

function readJSON(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.error(`[editorial] Failed to read/parse ${path}: ${err.message}`)
    return null
  }
}

// ── Editorial chat persistence ──────────────────────────

const EDITORIAL_CHAT_DIR = join(ROOT, 'data/editorial/chats')

// threadIds must be full UUIDv4 to block path-traversal attempts.
// Reject anything else at every entry point that builds a file path from the ID.
const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertValidThreadId(id) {
  if (typeof id !== 'string' || !THREAD_ID_RE.test(id)) {
    throw Object.assign(new Error('Invalid threadId'), { status: 400 })
  }
}

function ensureChatDir() {
  if (!existsSync(EDITORIAL_CHAT_DIR)) mkdirSync(EDITORIAL_CHAT_DIR, { recursive: true })
}

function readEditorialThreads() {
  const file = join(EDITORIAL_CHAT_DIR, 'threads.json')
  if (!existsSync(file)) return []
  try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return [] }
}

/**
 * Atomically overwrite threads.json using the write-validate-swap pattern
 * mandated by project convention (CLAUDE.md → "Config writes"). A direct
 * writeFileSync could corrupt the file on crash and silently wipe every
 * thread from the sidebar. Temp file → parse-back → .bak → rename.
 */
function writeEditorialThreads(threads) {
  ensureChatDir()
  const finalPath = join(EDITORIAL_CHAT_DIR, 'threads.json')
  const tmpPath = finalPath + '.tmp'
  const bakPath = finalPath + '.bak'
  const payload = JSON.stringify(threads, null, 2)

  writeFileSync(tmpPath, payload)
  // Validate by parsing back — if this throws, we've written garbage.
  JSON.parse(readFileSync(tmpPath, 'utf-8'))
  if (existsSync(finalPath)) {
    try { renameSync(finalPath, bakPath) } catch { /* first write */ }
  }
  renameSync(tmpPath, finalPath)
}

function appendEditorialMessage(threadId, message) {
  assertValidThreadId(threadId)
  ensureChatDir()
  appendFileSync(join(EDITORIAL_CHAT_DIR, `thread-${threadId}.jsonl`), JSON.stringify(message) + '\n')
}

function readEditorialHistory(threadId) {
  assertValidThreadId(threadId)
  const file = join(EDITORIAL_CHAT_DIR, `thread-${threadId}.jsonl`)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
}

export function getEditorialThreads() {
  return readEditorialThreads()
    .sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
    .slice(0, 30)
}

export function getEditorialChatHistory(threadId) {
  return readEditorialHistory(threadId)
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
    throw Object.assign(
      new Error('Pipeline scripts run locally via Claude Code scheduled tasks, not on the cloud server.'),
      { status: 503 }
    )
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

// ── Chat safety limits ────────────────────────────────────
// In-process rate limiter. CORS restricts the chat endpoint to
// localhost:5173 but any local script can still spam it. Cap concurrent
// streams and requests/minute so a runaway client or double-click storm
// can't torch Scott's Claude Max credits. CLAUDE.md cites a $231
// accidental-API-call incident; these are the guardrails for the chat
// equivalent.
const MAX_CONCURRENT_STREAMS = 3
const MAX_REQUESTS_PER_MINUTE = 60
let activeStreams = 0
const requestTimestamps = []

function acquireChatSlot() {
  const now = Date.now()
  while (requestTimestamps.length && now - requestTimestamps[0] > 60_000) requestTimestamps.shift()
  if (requestTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    throw Object.assign(
      new Error(`Rate limited: max ${MAX_REQUESTS_PER_MINUTE} chat requests/min. Try again shortly.`),
      { status: 429 }
    )
  }
  if (activeStreams >= MAX_CONCURRENT_STREAMS) {
    throw Object.assign(
      new Error(`Too many in-flight streams (limit ${MAX_CONCURRENT_STREAMS}). Wait for the current draft to finish.`),
      { status: 429 }
    )
  }
  activeStreams++
  requestTimestamps.push(now)
}

function releaseChatSlot() {
  if (activeStreams > 0) activeStreams--
}

export async function postEditorialChat(body, req) {
  const { message, tab, history, injectContext, model, sourceRefs, threadId: inputThreadId } = body

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw Object.assign(new Error('message is required'), { status: 400 })
  }
  if (inputThreadId !== undefined && inputThreadId !== null) {
    assertValidThreadId(inputThreadId)
  }

  acquireChatSlot()

  // Slot leak guard. Anything between here and the ReadableStream's
  // start() try/finally that throws would otherwise increment
  // activeStreams without ever decrementing it. Three such failures and
  // every subsequent request returns 429 "Too many in-flight streams"
  // until the server restarts. Track whether release ownership has been
  // handed off to the stream; if not (because we hit a setup-time error
  // or take an early-return path), release here.
  let slotOwnedByStream = false
  let activeTab, db, context, tokenEstimate, trimmedHistory
  try {
  activeTab = tab || 'state'
  db = getDb()

  // Only build context on first message per tab (lazy injection)
  context = null
  tokenEstimate = 0
  if (injectContext !== false) {
    const ctx = await buildEditorialContext(activeTab, db, Array.isArray(sourceRefs) ? sourceRefs : null)
    context = ctx.context
    tokenEstimate = ctx.tokenEstimate
  }

  trimmedHistory = trimEditorialHistory(history || [])

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
    releaseChatSlot() // no stream will start, so release early
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
          ? 'claude-opus-4-7'
          : 'claude-sonnet-4-20250514'

        const isDraftMode = activeTab === 'draft'
        // Tools are available in EVERY tab (15 April 2026) — restricting
        // them to the draft tab meant the chat couldn't fetch backlog/
        // theme/entry details when users clicked 'Draft in chat' from
        // other tabs, and fell back to general knowledge instead.
        // 6 tool rounds for draft mode (matches the addendum's STEP 1
        // budget). Extra buffer above the 5 we used before keeps the
        // model from silently stalling when it's mid-gather on round 5.
        const MAX_TOOL_ROUNDS = isDraftMode ? 6 : 5

        let roundMessages = [...sdkMessages]
        let toolRound = 0
        let completeText = '' // accumulates across tool rounds for persistence

        // When auditDraft is on, suppress streaming of the initial draft
        // so the user only sees the polished revision. Tool-call indicators
        // still stream normally for progress feedback.
        const willAudit = body.auditDraft === true
        const suppressTextDeltas = willAudit // suppress from the start; revision will stream

        const draftAddendum = buildDraftAddendum(isDraftMode)

        // Draft mode needs more output room than general chat. Three
        // LinkedIn posts in different formats plus an audit-revision pass
        // easily exceeds the 8192 default. 16384 fits comfortably within
        // both Sonnet 4 (64k max) and Opus 4.6 (32k max) output budgets.
        const DRAFT_OUTPUT_TOKENS = 16384
        const CHAT_OUTPUT_TOKENS = 8192
        const baseOutput = isDraftMode ? DRAFT_OUTPUT_TOKENS : CHAT_OUTPUT_TOKENS

        while (true) {
          if (abort.signal.aborted) break

          // Extended thinking is NOT enabled on the initial tool-
          // calling generation. Opus with adaptive thinking plus
          // multi-round tool use empirically runs long enough (4+ min)
          // that the streaming connection times out. Tool calls are
          // themselves a form of reasoning — consulting real data —
          // so adding extended thinking on top is both slow AND
          // redundant. Thinking is kept for the audit + revision
          // passes below, where the model has no tools and benefits
          // most from dedicated reasoning.
          const response = await client.messages.create({
            model: modelId,
            max_tokens: baseOutput,
            system: getEditorialSystemPrompt() + draftAddendum,
            messages: roundMessages,
            stream: true,
            ...(toolRound < MAX_TOOL_ROUNDS ? { tools: DRAFT_TOOLS } : {}),
          })

          // contentBlocks accumulates every block the model emits in
          // its original order — text, tool_use, thinking, redacted_thinking.
          // The full array is replayed verbatim as the next turn's
          // assistant message. Extended thinking with tool use REQUIRES
          // thinking blocks to be preserved across turns (with their
          // signatures intact), otherwise the API rejects the follow-up.
          const contentBlocks = []
          let currentBlock = null
          let toolInputJson = ''
          let stopReason = null

          for await (const event of response) {
            if (abort.signal.aborted) break

            if (event.type === 'content_block_start') {
              const ct = event.content_block?.type
              if (ct === 'text') {
                currentBlock = { type: 'text', text: '' }
              } else if (ct === 'tool_use') {
                currentBlock = { type: 'tool_use', id: event.content_block.id, name: event.content_block.name, input: {} }
                toolInputJson = ''
              } else if (ct === 'thinking') {
                currentBlock = { type: 'thinking', thinking: '', signature: '' }
              } else if (ct === 'redacted_thinking') {
                currentBlock = { type: 'redacted_thinking', data: event.content_block.data }
              }
            }

            if (event.type === 'content_block_delta') {
              const dt = event.delta?.type
              if (dt === 'text_delta') {
                if (currentBlock?.type === 'text') currentBlock.text += event.delta.text
                fullText += event.delta.text
                if (!suppressTextDeltas) send({ type: 'delta', text: event.delta.text })
              } else if (dt === 'input_json_delta') {
                toolInputJson += event.delta.partial_json
              } else if (dt === 'thinking_delta') {
                if (currentBlock?.type === 'thinking') currentBlock.thinking += event.delta.thinking
              } else if (dt === 'signature_delta') {
                if (currentBlock?.type === 'thinking') currentBlock.signature = event.delta.signature
              }
            }

            if (event.type === 'content_block_stop') {
              if (currentBlock) {
                if (currentBlock.type === 'tool_use') {
                  try { currentBlock.input = JSON.parse(toolInputJson || '{}') } catch { currentBlock.input = {} }
                }
                contentBlocks.push(currentBlock)
                currentBlock = null
                toolInputJson = ''
              }
            }

            if (event.type === 'message_delta') {
              stopReason = event.delta?.stop_reason
            }
          }

          if (stopReason !== 'tool_use' || abort.signal.aborted) {
            completeText += fullText

            // Warn the client if generation hit the token ceiling. The
            // UI can show "draft truncated" so Scott knows to re-prompt
            // with "continue" rather than assume the draft is complete.
            if (stopReason === 'max_tokens' && !abort.signal.aborted) {
              send({
                type: 'warning',
                message: 'Draft hit the output token limit. The last draft may be incomplete — ask to continue or shorten the request.',
              })
            }

            // If we suppressed text deltas (willAudit mode), the user
            // hasn't seen the draft yet. The audit+revision below will
            // stream the polished version instead.

            // Multi-draft-aware detection: triggers on ITEATE presence
            // OR multi-draft headers (DRAFT N, FORMAT N, format-named).
            const looksLikeDraft = detectDraftOutput(completeText, { willAudit })

            // If audit mode was on but the output doesn't look like a
            // draft (short, no markers), strip the inter-tool narrative
            // and stream whatever content we have so the user sees
            // something useful rather than the model's thinking.
            if (willAudit && !looksLikeDraft && completeText.length > 0 && !abort.signal.aborted) {
              const cleaned = extractDraftContent(completeText)
              send({ type: 'delta', text: cleaned })
            }

            // Substantive output threshold — anything shorter than this
            // is treated as a failed/stub revision and we fall back to
            // the previous polished text rather than overwriting it.
            const MIN_REVISION_LENGTH = 200

            // CEO empathy pass — one critique per sector mentioned.
            // Brightbeam wants these CEOs as clients; the pass catches
            // anything that would alienate them (blame for things
            // outside their control, systemic-as-specific framing,
            // smug or naive notes). Always runs after style work,
            // including when the audit found nothing to correct.
            // Streams its own progress events; streams the final text
            // (CEO-revised, or the input text if nothing to apply).
            // Returns the final polished text.
            const runCEOEmpathyPass = async (inputText, originalUserMessage) => {
              let finalText = inputText
              try {
                const sectors = detectSectors(inputText)
                send({ type: 'tool_call', name: 'ceo_empathy_check', input: { sectors } })

                const critiqueResults = await Promise.all(sectors.map(async (sector) => {
                  try {
                    const res = await client.messages.create({
                      model: modelId,
                      max_tokens: 2048,
                      system: buildCEOCritiquePrompt(sector),
                      messages: [{ role: 'user', content: `## DRAFT(S)\n\n${inputText}` }],
                    })
                    return { sector, text: (res.content?.[0]?.text || '').trim() }
                  } catch (err) {
                    console.error(`[editorial-chat] CEO critique failed for ${sector}:`, err.message)
                    return { sector, text: '' }
                  }
                }))

                // "Clean" critique signals — be forgiving about how the
                // model phrases the all-clear so we don't re-revise on
                // a stub. The prompt asks for the literal "NO CHANGES",
                // but Opus often appends a period, a brief sign-off, or
                // a couple of complimentary sentences. Treat very short
                // responses as clean too — under ~50 chars it's never a
                // real numbered correction list.
                const isCleanResponse = (text) => {
                  if (!text) return true
                  if (/^\s*NO\s+CHANGES\b/i.test(text)) return true
                  if (text.trim().length < 50) return true
                  return false
                }
                const substantive = critiqueResults.filter(r => !isCleanResponse(r.text))
                const sectorsLabel = sectors.join(', ')
                const substantiveLabel = substantive.length
                  ? `${substantive.length} of ${sectors.length} CEO read(s) had notes (${sectorsLabel})`
                  : `${sectors.length} CEO read(s), all clean (${sectorsLabel})`
                send({ type: 'tool_result', name: 'ceo_empathy_check', preview: substantiveLabel })

                if (substantive.length > 0 && !abort.signal.aborted) {
                  const consolidated = substantive
                    .map(r => `### As ${SECTOR_CEO_LABELS[r.sector] || r.sector}:\n\n${r.text}`)
                    .join('\n\n---\n\n')

                  send({ type: 'tool_call', name: 'applying_ceo_notes', input: {} })

                  const ceoRevisionResponse = await client.messages.create({
                    model: modelId,
                    max_tokens: DRAFT_OUTPUT_TOKENS,
                    system: getEditorialSystemPrompt(),
                    messages: [
                      originalUserMessage,
                      { role: 'assistant', content: inputText },
                      { role: 'user', content: buildCEORevisionInstruction(consolidated) },
                    ],
                    stream: true,
                  })

                  send({ type: 'tool_result', name: 'applying_ceo_notes', preview: 'Streaming CEO-aware revision' })

                  let ceoRevisedText = ''
                  let ceoStopReason = null
                  for await (const event of ceoRevisionResponse) {
                    if (abort.signal.aborted) break
                    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                      ceoRevisedText += event.delta.text
                      send({ type: 'delta', text: event.delta.text })
                    }
                    if (event.type === 'message_delta') {
                      ceoStopReason = event.delta?.stop_reason
                    }
                  }

                  if (ceoStopReason === 'max_tokens' && !abort.signal.aborted) {
                    send({
                      type: 'warning',
                      message: 'CEO revision hit the output token limit. The polished drafts may be incomplete.',
                    })
                  }

                  if (ceoRevisedText.length > MIN_REVISION_LENGTH) {
                    finalText = extractDraftContent(ceoRevisedText)
                  } else {
                    // CEO revision came back too short — fall back to inputText.
                    send({ type: 'delta', text: inputText })
                  }
                } else {
                  // No CEO notes — stream the input text (the user
                  // hasn't seen anything yet because draft mode
                  // suppresses initial-generation deltas).
                  send({ type: 'delta', text: inputText })
                }
              } catch (ceoErr) {
                console.error('[editorial-chat] CEO empathy pass failed (non-fatal):', ceoErr.message)
                if (ceoErr.stack) console.error(ceoErr.stack.split('\n').slice(0, 5).join('\n'))
                send({ type: 'delta', text: inputText })
              }
              return finalText
            }

            if (looksLikeDraft && !abort.signal.aborted) {
              try {
                send({ type: 'tool_call', name: 'style_review', input: {} })

                // Fetch reference posts + writing rules for audit
                const refPosts = await eq.searchPublishedPosts(db, { category: 'article', limit: 3 })
                const refTexts = []
                for (const ref of refPosts) {
                  const full = await eq.getPublishedPost(db, ref.id)
                  if (full) refTexts.push(`### ${full.title}\n\n${full.body}`)
                }
                const prefsPath = join(ROOT, 'data/editorial/writing-preferences.md')
                let writingPrefs = ''
                try { writingPrefs = readFileSync(prefsPath, 'utf-8') } catch { /* skip */ }

                const vocabPath = join(ROOT, 'data/editorial/vocabulary-fingerprint.json')
                let vocabSection = ''
                try {
                  const vocab = JSON.parse(readFileSync(vocabPath, 'utf-8'))
                  if (vocab.signature_terms?.length) {
                    vocabSection = '\n\nScott prefers: ' +
                      vocab.signature_terms.slice(0, 15).map(t => `"${t.term}" (over "${t.alternative || '—'}")`).join(', ')
                  }
                } catch { /* skip */ }

                // Run audit (non-streaming). Extended thinking is NOT
                // enabled here — on Opus 4.6, adaptive thinking
                // combined with a large audit payload (draft + writing
                // rules + 3 reference posts) reliably ECONNRESETs the
                // connection. The audit prompt enumerates every rule
                // explicitly so the model can produce corrections in a
                // single pass without needing reasoning tokens.
                const AUDIT_OUTPUT_TOKENS = 2048
                const auditRes = await client.messages.create({
                  model: modelId,
                  max_tokens: AUDIT_OUTPUT_TOKENS,
                  system: buildAuditSystemPrompt({ vocabSection }),
                  messages: [{
                    role: 'user',
                    content: `## DRAFT(S)\n\n${completeText}\n\n## RULES\n\n${writingPrefs}\n\n## REFERENCE POSTS\n\n${refTexts.join('\n\n---\n\n')}`
                  }],
                })
                const auditText = auditRes.content?.[0]?.text || ''

                send({ type: 'tool_result', name: 'style_review', preview: `${auditText.split('\n').length} corrections identified` })

                if (auditText.trim()) {
                  // Revision pass: apply corrections and output final version only
                  send({ type: 'tool_call', name: 'applying_corrections', input: {} })

                  // Pass the CLEANED draft content (without inter-tool
                  // narrative) to the revision so the model doesn't
                  // echo "Let me fetch..." back as part of the output.
                  const cleanedForRevision = extractDraftContent(completeText)

                  // Revision gets a CLEAN conversation — just the
                  // original user request, the cleaned draft as the
                  // assistant turn, and the correction instruction.
                  // We deliberately drop roundMessages here because
                  // those carry thinking blocks + tool_use/tool_result
                  // exchanges. Extended-thinking API requires thinking
                  // blocks to round-trip verbatim; anything approximate
                  // or modified upstream causes signature-validation
                  // failures ("Connection error" end-of-stream). Since
                  // the revision only needs "here's the draft, fix it",
                  // we don't need any of that history.
                  const originalUserMessage = lastUserMessage(sdkMessages)
                  // Revision call does NOT use extended thinking. The
                  // audit has already reasoned through every violation
                  // and produced an exact correction list; the revision
                  // just applies it mechanically. Thinking here was
                  // reliably ECONNRESETing the stream, and doesn't add
                  // quality for the substitution task.
                  const revisionResponse = await client.messages.create({
                    model: modelId,
                    max_tokens: DRAFT_OUTPUT_TOKENS,
                    system: getEditorialSystemPrompt(),
                    messages: [
                      originalUserMessage,
                      { role: 'assistant', content: cleanedForRevision },
                      { role: 'user', content: buildRevisionInstruction(auditText) },
                    ],
                    stream: true,
                  })

                  send({ type: 'tool_result', name: 'applying_corrections', preview: 'Buffering revised draft for CEO empathy check' })

                  // BUFFER the revision (do not stream yet). The CEO
                  // empathy pass below may rewrite parts of it, and we
                  // want the user to see only one polished version.
                  // If the CEO pass returns NO CHANGES across all
                  // sectors, this buffered text is what gets streamed.
                  let revisedText = ''
                  let revisionStopReason = null
                  for await (const event of revisionResponse) {
                    if (abort.signal.aborted) break
                    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                      revisedText += event.delta.text
                    }
                    if (event.type === 'message_delta') {
                      revisionStopReason = event.delta?.stop_reason
                    }
                  }

                  if (revisionStopReason === 'max_tokens' && !abort.signal.aborted) {
                    send({
                      type: 'warning',
                      message: 'Revision hit the output token limit. The polished drafts may be incomplete.',
                    })
                  }

                  const styleRevisedClean = revisedText.length > MIN_REVISION_LENGTH
                    ? extractDraftContent(revisedText)
                    : extractDraftContent(completeText)

                  const ceoFinalText = await runCEOEmpathyPass(styleRevisedClean, originalUserMessage)
                  if (ceoFinalText.length > MIN_REVISION_LENGTH) {
                    completeText = ceoFinalText
                    fullText = completeText
                  }
                } else {
                  // Audit produced no corrections — pristine drafts are
                  // not pristine without the CEO read. Run the empathy
                  // pass on the original (cleaned) draft directly.
                  const cleanedOriginal = extractDraftContent(completeText)
                  const originalUserMessage = lastUserMessage(sdkMessages)
                  const ceoFinalText = await runCEOEmpathyPass(cleanedOriginal, originalUserMessage)
                  if (ceoFinalText.length > MIN_REVISION_LENGTH) {
                    completeText = ceoFinalText
                    fullText = completeText
                  }
                }
              } catch (auditErr) {
                console.error('[editorial-chat] Internal audit/revision failed (non-fatal):', auditErr.message)
                if (auditErr.stack) console.error(auditErr.stack.split('\n').slice(0, 5).join('\n'))
                if (auditErr.cause) {
                  console.error('  cause:', auditErr.cause?.message || auditErr.cause)
                  if (auditErr.cause?.code) console.error('  code:', auditErr.cause.code)
                  if (auditErr.cause?.cause) console.error('  cause.cause:', auditErr.cause.cause?.message || auditErr.cause.cause)
                }
                if (auditErr.status) console.error('  status:', auditErr.status)
                // Fall through — the original draft (already in completeText) will be used
                // If we suppressed deltas, stream the cleaned original now
                if (suppressTextDeltas) {
                  send({ type: 'delta', text: extractDraftContent(completeText) })
                }
              }
            }

            const actualThreadId = inputThreadId || crypto.randomUUID()

            send({ type: 'done', text: completeText, contextTokens: tokenEstimate, tab: activeTab, threadId: actualThreadId })

            // Persist messages after streaming completes
            try {
              const now = new Date().toISOString()

              // Auto-create thread if new
              if (!inputThreadId) {
                // Generate a concise topic title via a fast Haiku call
                // instead of truncating the first message to 40 chars.
                let threadName = message.trim().slice(0, 40) // fallback
                try {
                  const titleRes = await client.messages.create({
                    model: 'claude-haiku-4-20250414',
                    max_tokens: 30,
                    messages: [{
                      role: 'user',
                      content: `Generate a 3-5 word topic title for this editorial chat message. Return ONLY the title, no quotes, no explanation.\n\nMessage: ${message.trim().slice(0, 200)}`
                    }],
                  })
                  const generated = titleRes.content?.[0]?.text?.trim()
                  if (generated && generated.length > 2 && generated.length < 60) {
                    threadName = generated
                  }
                } catch { /* fall back to truncated message */ }

                const newThreads = readEditorialThreads()
                newThreads.unshift({
                  id: actualThreadId,
                  name: threadName,
                  tab: activeTab,
                  created: now,
                  updated: now,
                  messageCount: 0,
                })
                writeEditorialThreads(newThreads)
              }

              // Append user message
              appendEditorialMessage(actualThreadId, {
                id: 'msg_' + crypto.randomUUID().slice(0, 8),
                role: 'user',
                content: message.trim(),
                timestamp: now,
              })

              // Compute scorecard (fast, deterministic) and emit it.
              // Store on the assistant message so restored threads show it.
              let computedScorecard = null
              if (completeText.length > 200 && /in-the-end-at-the-end|\n#|\*\*/.test(completeText)) {
                try {
                  computedScorecard = scoreDraft(completeText)
                  send({ type: 'scorecard', scorecard: computedScorecard })
                } catch (scErr) {
                  console.error('[editorial-chat] Scoring failed (non-fatal):', scErr.message)
                }
              }

              // Append assistant message
              appendEditorialMessage(actualThreadId, {
                id: 'msg_' + crypto.randomUUID().slice(0, 8),
                role: 'assistant',
                content: completeText,
                scorecard: computedScorecard,
                timestamp: new Date().toISOString(),
              })

              // Update thread metadata
              const updatedThreads = readEditorialThreads()
              const thread = updatedThreads.find(t => t.id === actualThreadId)
              if (thread) {
                thread.updated = new Date().toISOString()
                thread.messageCount = (thread.messageCount || 0) + 2
                writeEditorialThreads(updatedThreads)
              }
            } catch (persistErr) {
              console.error('[editorial-chat] Failed to persist messages:', persistErr.message)
            }

            break
          }

          toolRound++

          // Replay the model's content blocks verbatim for the next turn.
          // contentBlocks now includes text/thinking/tool_use in the
          // order the model emitted them — the Anthropic API requires
          // this exact structure when extended thinking is enabled with
          // tool use (thinking signatures must round-trip unmodified).
          const assistantContent = contentBlocks

          const toolResults = []
          for (const block of contentBlocks.filter(b => b.type === 'tool_use')) {
            send({ type: 'tool_call', name: block.name, input: block.input })
            const result = await executeTool(block.name, block.input, db)
            send({ type: 'tool_result', name: block.name, preview: (result || '').slice(0, 200) })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result,
            })
          }

          // Anti-stall nudge: if the NEXT round will have no tools and
          // we're in draft mode, append an explicit text block to the
          // user message AFTER the tool_results so Sonnet can't
          // silently end_turn. Sonnet 4 reliably stalled on the first
          // no-tools round (stop_reason=end_turn, 0 text) without this.
          //
          // The loop checks `toolRound < MAX_TOOL_ROUNDS` at the top of
          // the NEXT iteration to decide whether to include the `tools`
          // field. toolRound has been incremented above. So the next
          // round has tools iff `toolRound < MAX_TOOL_ROUNDS` holds now.
          const nextRoundHasTools = toolRound < MAX_TOOL_ROUNDS
          const userContent = [...toolResults]
          if (isDraftMode && !nextRoundHasTools) {
            userContent.push({
              type: 'text',
              text: 'You have enough source material now. In your next response, write the three draft LinkedIn posts directly — each in a different format, each with a bold title, body (200-400 words in Scott\'s voice), and in-the-end-at-the-end closer. Start your response with `## Draft 1:` and skip any preamble.',
            })
          }

          roundMessages = [
            ...roundMessages,
            { role: 'assistant', content: assistantContent },
            { role: 'user', content: userContent },
          ]

          completeText += fullText
          fullText = ''
        }
      } catch (err) {
        send({ type: 'error', error: err.message })
      } finally {
        // Always release the concurrency slot, even on abort or error.
        releaseChatSlot()
      }

      try { controller.close() } catch { /* already closed */ }
    }
  })

  // Slot release ownership now belongs to the ReadableStream's start()
  // try/finally — see slotOwnedByStream guard at top of function.
  slotOwnedByStream = true
  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    }
  })
  } catch (err) {
    // Setup-time failure between acquireChatSlot() and the stream
    // taking ownership. Without this release, every such failure leaks
    // a slot — three failures and the endpoint returns 429 forever.
    if (!slotOwnedByStream) releaseChatSlot()
    throw err
  }
}
