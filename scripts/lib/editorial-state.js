/**
 * editorial-state.js — State document read/write/validate/render utilities
 *
 * Foundation library for the editorial intelligence pipeline.
 * Provides atomic read/write to data/editorial/state.json with backup,
 * section-level accessors, mutation helpers, markdown rendering,
 * activity logging and notification management.
 *
 * Used by: editorial-analyse.js, editorial-discover.js, editorial-draft.js,
 *          editorial-track.js
 *
 * Does NOT import from any existing pipeline module in scripts/.
 * Web API routes (web/api/routes/editorial.js) have their own read-only
 * helpers — this module is for pipeline scripts that read AND write.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import { enqueue as enqueueUrl } from './url-resolution-queue.js'

const ROOT = resolve(import.meta.dir, '../..')
const EDITORIAL_DIR = join(ROOT, 'data/editorial')
const STATE_PATH = join(EDITORIAL_DIR, 'state.json')
const PUBLISHED_PATH = join(EDITORIAL_DIR, 'published.json')
const NOTIFICATIONS_PATH = join(EDITORIAL_DIR, 'notifications.json')
const ACTIVITY_PATH = join(EDITORIAL_DIR, 'activity.json')
const BACKUPS_DIR = join(EDITORIAL_DIR, 'backups')

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [editorial-state]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [editorial-state] ⚠`, ...a)

// ── Read operations ──────────────────────────────────────

/**
 * Load and parse state.json. Returns null if missing or corrupt.
 * @returns {object|null}
 */
export function loadState() {
  if (!existsSync(STATE_PATH)) return null
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'))
  } catch (err) {
    warn(`Failed to parse state.json: ${err.message}`)
    return null
  }
}

/**
 * Load published.json. Returns empty structure if missing.
 * @returns {{ newsletters: Array, linkedin: Array }}
 */
export function loadPublished() {
  if (!existsSync(PUBLISHED_PATH)) return { newsletters: [], linkedin: [] }
  try {
    return JSON.parse(readFileSync(PUBLISHED_PATH, 'utf-8'))
  } catch (err) {
    warn(`Failed to parse published.json: ${err.message} — returning empty`)
    return { newsletters: [], linkedin: [] }
  }
}

/**
 * Load notifications.json. Returns empty array if missing.
 * @returns {Array}
 */
export function loadNotifications() {
  if (!existsSync(NOTIFICATIONS_PATH)) return []
  try {
    return JSON.parse(readFileSync(NOTIFICATIONS_PATH, 'utf-8'))
  } catch (err) {
    warn(`Failed to parse notifications.json: ${err.message} — returning empty`)
    return []
  }
}

/**
 * Load activity.json. Returns empty array if missing.
 * @returns {Array}
 */
export function loadActivity() {
  if (!existsSync(ACTIVITY_PATH)) return []
  try {
    return JSON.parse(readFileSync(ACTIVITY_PATH, 'utf-8'))
  } catch (err) {
    warn(`Failed to parse activity.json: ${err.message} — returning empty`)
    return []
  }
}

// ── Section getters ──────────────────────────────────────

export function getAnalysisIndex(state) {
  return state?.analysisIndex || {}
}

export function getThemeRegistry(state) {
  return state?.themeRegistry || {}
}

export function getPostBacklog(state) {
  return state?.postBacklog || {}
}

export function getDecisionLog(state) {
  return state?.decisionLog || []
}

export function getPermanentPreferences(state) {
  return state?.permanentPreferences || []
}

export function getCounters(state) {
  return state?.counters || { nextSession: 1, nextDocument: 1, nextPost: 1 }
}

export function getCorpusStats(state) {
  return state?.corpusStats || {}
}

// ── Validation ───────────────────────────────────────────

const REQUIRED_SECTIONS = ['counters', 'analysisIndex', 'themeRegistry', 'postBacklog', 'decisionLog']
const VALID_STATUSES = ['suggested', 'approved', 'in-progress', 'published', 'rejected', 'archived', 'unknown']
const VALID_TIERS = [-1, 0, 1, 2]  // -1 = reference documents
const VALID_PRIORITIES = ['immediate', 'high', 'medium-high', 'medium', 'low', 'unknown']

/**
 * Validate state document structure.
 * @param {object} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateState(state) {
  const errors = []

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: ['State is null or not an object'] }
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!(section in state)) {
      errors.push(`Missing required section: ${section}`)
    }
  }

  // Validate counters
  if (state.counters) {
    for (const key of ['nextSession', 'nextDocument', 'nextPost']) {
      if (!Number.isInteger(state.counters[key]) || state.counters[key] < 1) {
        errors.push(`Invalid counter ${key}: must be positive integer, got ${state.counters[key]}`)
      }
    }
  }

  // Validate analysis index entries (spot-check first 5)
  if (state.analysisIndex && typeof state.analysisIndex === 'object') {
    const entries = Object.entries(state.analysisIndex)
    for (const [id, entry] of entries.slice(0, 5)) {
      if (!entry.title) errors.push(`Analysis entry ${id}: missing title`)
      if (!entry.source) errors.push(`Analysis entry ${id}: missing source`)
      if (entry.tier !== undefined && !VALID_TIERS.includes(entry.tier)) {
        errors.push(`Analysis entry ${id}: invalid tier ${entry.tier}`)
      }
    }
  }

  // Validate theme codes
  if (state.themeRegistry && typeof state.themeRegistry === 'object') {
    for (const code of Object.keys(state.themeRegistry)) {
      if (!/^T\d{2}$/.test(code)) {
        errors.push(`Invalid theme code: ${code}`)
      }
    }
  }

  // Validate post backlog entries (spot-check first 5)
  if (state.postBacklog && typeof state.postBacklog === 'object') {
    const posts = Object.entries(state.postBacklog)
    for (const [id, post] of posts.slice(0, 5)) {
      if (!post.title) errors.push(`Post ${id}: missing title`)
      if (post.status && !VALID_STATUSES.includes(post.status)) {
        errors.push(`Post ${id}: invalid status '${post.status}'`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ── Write operations (atomic) ────────────────────────────

/**
 * Save state.json using write-validate-swap pattern.
 * Creates timestamped backup of existing file before overwriting.
 *
 * @param {object} state — the full state document
 * @returns {object} the saved state (round-trip verified)
 * @throws {Error} if validation fails or write-validate-swap fails
 */
export function saveState(state) {
  const validation = validateState(state)
  if (!validation.valid) {
    throw new Error(`State validation failed: ${validation.errors.join('; ')}`)
  }

  mkdirSync(EDITORIAL_DIR, { recursive: true })
  mkdirSync(BACKUPS_DIR, { recursive: true })

  // Backup existing state
  if (existsSync(STATE_PATH)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `state-${timestamp}.json`
    copyFileSync(STATE_PATH, join(BACKUPS_DIR, backupName))
  }

  // Write-validate-swap
  const tmpPath = STATE_PATH + '.tmp'
  const json = JSON.stringify(state, null, 2)
  writeFileSync(tmpPath, json)

  // Validate round-trip
  const parsed = JSON.parse(readFileSync(tmpPath, 'utf-8'))
  const roundTripValid = validateState(parsed)
  if (!roundTripValid.valid) {
    try { writeFileSync(tmpPath + '.failed', json) } catch (saveErr) {
      warn(`Could not save failed state to ${tmpPath}.failed: ${saveErr.message}`)
    }
    try { unlinkSync(tmpPath) } catch { /* tmp cleanup is best-effort */ }
    throw new Error(`Write-validate-swap failed: ${roundTripValid.errors.join('; ')}`)
  }

  // Atomic rename
  renameSync(tmpPath, STATE_PATH)
  log(`Saved state.json (${(json.length / 1024).toFixed(1)}KB)`)
  return parsed
}

/**
 * Save published.json.
 * @param {{ newsletters: Array, linkedin: Array }} published
 */
export function savePublished(published) {
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  writeFileSync(PUBLISHED_PATH, JSON.stringify(published, null, 2))
}

/**
 * Save notifications.json.
 * @param {Array} notifications
 */
export function saveNotifications(notifications) {
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  writeFileSync(NOTIFICATIONS_PATH, JSON.stringify(notifications, null, 2))
}

/**
 * Save activity.json.
 * @param {Array} activity
 */
export function saveActivity(activity) {
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  writeFileSync(ACTIVITY_PATH, JSON.stringify(activity, null, 2))
}

// ── Mutation helpers ─────────────────────────────────────

/**
 * Add an entry to the Analysis Index. Increments nextDocument counter.
 *
 * @param {object} state — mutated in place
 * @param {object} entry — { title, source, host?, participants?, date?, tier?, themes?, summary?, keyThemes?, postPotential? }
 * @returns {{ id: string, entry: object }}
 */
export function addAnalysisEntry(state, entry) {
  const id = String(state.counters.nextDocument)
  state.analysisIndex[id] = {
    title: entry.title,
    source: entry.source,
    host: entry.host ?? null,
    ...(entry.participants ? { participants: entry.participants } : {}),
    ...(entry.filename ? { filename: entry.filename } : {}),
    url: entry.url ?? null,
    date: entry.date ?? null,
    dateProcessed: new Date().toISOString().slice(0, 10),
    session: entry.session ?? state.counters.nextSession,
    tier: entry.tier ?? 1,
    status: 'active',
    themes: entry.themes ?? [],
    summary: entry.summary ?? '',
    keyThemes: entry.keyThemes ?? '',
    postPotential: entry.postPotential ?? 'none',
    postPotentialReasoning: entry.postPotentialReasoning ?? '',
    _reconstructed: false,
  }
  state.counters.nextDocument++

  // Queue for URL resolution if missing
  if (!entry.url) {
    enqueueUrl('analysis', {
      id,
      title: entry.title,
      source: entry.source,
      date: entry.date,
      host: entry.host,
    })
  }

  return { id, entry: state.analysisIndex[id] }
}

/**
 * Add evidence to an existing theme. Trims evidence to last 12 entries.
 *
 * @param {object} state — mutated in place
 * @param {string} themeCode — e.g. 'T01'
 * @param {{ source: string, content: string }} evidence
 */
export function addThemeEvidence(state, themeCode, evidence) {
  const theme = state.themeRegistry[themeCode]
  if (!theme) throw new Error(`Theme ${themeCode} not found in registry`)
  if (!Array.isArray(theme.evidence)) theme.evidence = []

  const session = state.counters.nextSession
  const evidenceIndex = theme.evidence.length
  theme.evidence.push({
    session,
    source: evidence.source,
    content: evidence.content,
    url: evidence.url ?? null,
  })

  // Keep evidence manageable
  if (theme.evidence.length > 12) {
    theme.evidence = theme.evidence.slice(-12)
  }

  theme.lastUpdated = `Session ${session}`
  theme.documentCount = (theme.documentCount || 0) + 1

  // Queue for URL resolution if missing
  if (!evidence.url) {
    enqueueUrl('evidence', {
      id: `${themeCode}:${evidenceIndex}`,
      title: (evidence.content || '').slice(0, 100),
      source: evidence.source,
    })
  }
}

/**
 * Register a new theme in the registry.
 *
 * @param {object} state — mutated in place
 * @param {string} code — theme code e.g. 'T27'
 * @param {string} name — theme name
 * @param {{ source: string, content: string }|null} evidence — initial evidence
 */
export function addNewTheme(state, code, name, evidence) {
  if (!/^T\d{2}$/.test(code)) {
    throw new Error(`Invalid theme code: ${code}. Must be T followed by two digits.`)
  }

  if (state.themeRegistry[code]) {
    warn(`Theme ${code} already exists — skipping`)
    return
  }

  const session = state.counters.nextSession
  state.themeRegistry[code] = {
    name,
    created: `Session ${session}`,
    lastUpdated: `Session ${session}`,
    documentCount: evidence ? 1 : 0,
    evidence: evidence ? [{
      session,
      source: evidence.source,
      content: evidence.content,
      url: evidence.url ?? null,
    }] : [],
    crossConnections: [],
  }

  // Queue initial evidence for URL resolution if missing
  if (evidence && !evidence.url) {
    enqueueUrl('evidence', {
      id: `${code}:0`,
      title: (evidence.content || '').slice(0, 100),
      source: evidence.source,
    })
  }
}

/**
 * Add a cross-connection between themes.
 *
 * @param {object} state — mutated in place
 * @param {string} fromCode — source theme code
 * @param {string} toCode — target theme code
 * @param {string} reasoning — why these themes connect
 */
export function addCrossConnection(state, fromCode, toCode, reasoning) {
  const theme = state.themeRegistry[fromCode]
  if (!theme) throw new Error(`Theme ${fromCode} not found`)
  if (!state.themeRegistry[toCode]) throw new Error(`Theme ${toCode} not found`)
  if (!Array.isArray(theme.crossConnections)) theme.crossConnections = []

  // Don't duplicate
  if (theme.crossConnections.some(cc => cc.theme === toCode)) return

  theme.crossConnections.push({ theme: toCode, reasoning })
}

/**
 * Add a post to the backlog. Increments nextPost counter.
 *
 * @param {object} state — mutated in place
 * @param {object} entry — { title, workingTitle?, coreArgument?, format?, sourceDocuments?, freshness?, priority?, notes? }
 * @returns {{ id: string, entry: object }}
 */
export function addPostBacklogEntry(state, entry) {
  const id = String(state.counters.nextPost)
  state.postBacklog[id] = {
    title: entry.title,
    workingTitle: entry.workingTitle ?? null,
    status: 'suggested',
    dateAdded: new Date().toISOString().slice(0, 10),
    session: state.counters.nextSession,
    coreArgument: entry.coreArgument ?? '',
    format: entry.format ?? null,
    sourceDocuments: entry.sourceDocuments ?? [],
    sourceUrls: entry.sourceUrls ?? [],
    freshness: entry.freshness ?? 'evergreen',
    priority: entry.priority ?? 'medium',
    notes: entry.notes ?? '',
  }
  state.counters.nextPost++

  // Queue for URL resolution if no source URLs provided
  if (!entry.sourceUrls || entry.sourceUrls.length === 0) {
    enqueueUrl('post', {
      id,
      title: entry.title,
      source: (entry.sourceDocuments || []).join(', '),
    })
  }

  return { id, entry: state.postBacklog[id] }
}

/**
 * Add a decision to the decision log.
 *
 * @param {object} state — mutated in place
 * @param {{ title: string, decision: string, reasoning?: string }} entry
 * @returns {{ id: string }}
 */
export function addDecisionLogEntry(state, entry) {
  const session = state.counters.nextSession
  const sessionDecisions = state.decisionLog.filter(d => d.session === session)
  const decNum = sessionDecisions.length + 1
  const id = `${session}.${decNum}`

  state.decisionLog.push({
    id,
    session,
    title: entry.title,
    decision: entry.decision,
    reasoning: entry.reasoning || '',
  })

  return { id }
}

/**
 * Update a post's status with transition validation.
 *
 * @param {object} state — mutated in place
 * @param {number|string} postId
 * @param {string} newStatus
 * @returns {object} the updated post
 * @throws {Error} if post not found or invalid transition
 */
export function updatePostStatus(state, postId, newStatus) {
  const post = state.postBacklog[String(postId)]
  if (!post) throw new Error(`Post ${postId} not found in backlog`)

  const validTransitions = {
    'suggested': ['approved', 'rejected', 'archived'],
    'approved': ['in-progress', 'published', 'archived'],
    'in-progress': ['published', 'archived'],
    'published': [],
    'rejected': ['suggested'],
    'archived': ['suggested'],
    'unknown': ['suggested', 'approved', 'in-progress', 'published', 'archived'],
  }

  const allowed = validTransitions[post.status] || []
  if (!allowed.includes(newStatus)) {
    throw new Error(`Invalid status transition: ${post.status} → ${newStatus} for post #${postId}`)
  }

  post.status = newStatus
  if (newStatus === 'published') {
    post.datePublished = new Date().toISOString().slice(0, 10)
  }

  return post
}

// ── Corpus stats recomputation ───────────────────────────

/**
 * Recompute corpus stats from current state data.
 * @param {object} state — mutated in place
 * @returns {object} the updated corpusStats
 */
export function recomputeCorpusStats(state) {
  const docs = Object.values(state.analysisIndex || {})
  const posts = Object.values(state.postBacklog || {})

  state.corpusStats = {
    totalDocuments: docs.length,
    activeTier1: docs.filter(d => d.status === 'active' && d.tier === 1).length,
    activeTier2: docs.filter(d => d.status === 'active' && d.tier === 2).length,
    retired: docs.filter(d => d.status === 'retired').length,
    stubs: docs.filter(d => d.status === 'stub' || d.tier === 0).length,
    referenceDocuments: docs.filter(d => d.tier === -1).length,
    activeThemes: Object.keys(state.themeRegistry || {}).length,
    totalPosts: posts.length,
    postsPublished: posts.filter(p => p.status === 'published').length,
    postsApproved: posts.filter(p => p.status === 'approved').length,
  }

  return state.corpusStats
}

// ── Render to markdown ───────────────────────────────────

/**
 * Render a single Analysis Index entry to markdown.
 */
export function renderAnalysisEntry(id, entry) {
  const lines = [`### #${id}: ${entry.title}`]
  if (entry.source) lines.push(`- Source: ${entry.source}`)
  if (entry.host) lines.push(`- Host: ${entry.host}`)
  if (entry.date) lines.push(`- Date: ${entry.date}`)
  if (entry.dateProcessed) lines.push(`- Processed: ${entry.dateProcessed}`)
  lines.push(`- Tier: ${entry.tier ?? 1}`)
  lines.push(`- Status: ${entry.status || 'active'}`)
  if (entry.themes?.length) lines.push(`- Themes: ${entry.themes.join(', ')}`)
  if (entry.keyThemes) lines.push(`- Key themes: ${entry.keyThemes}`)
  if (entry.summary) lines.push(`- Summary: ${entry.summary}`)
  if (entry.postPotential && entry.postPotential !== 'none') {
    lines.push(`- Post potential: ${entry.postPotential}`)
  }
  return lines.join('\n')
}

/**
 * Render a single theme to markdown.
 */
export function renderTheme(code, theme) {
  const lines = [`## ${code}: ${theme.name}`]
  lines.push(`Created: ${theme.created} | Last updated: ${theme.lastUpdated} | Documents: ${theme.documentCount}`)

  if (theme.evidence?.length) {
    lines.push('', 'Evidence:')
    for (const ev of theme.evidence) {
      lines.push(`- [Session ${ev.session}] ${ev.source}: ${ev.content}`)
    }
  }

  if (theme.crossConnections?.length) {
    lines.push('', 'Cross-connections:')
    for (const cc of theme.crossConnections) {
      lines.push(`- ${cc.theme} (${cc.reasoning})`)
    }
  }

  return lines.join('\n')
}

/**
 * Render a single Post Backlog entry to markdown.
 */
export function renderPostBacklogEntry(id, post) {
  const lines = [`### #${id}: ${post.title}`]
  lines.push(`- Status: ${post.status}`)
  if (post.format) lines.push(`- Format: ${post.format}`)
  if (post.priority) lines.push(`- Priority: ${post.priority}`)
  if (post.freshness) lines.push(`- Freshness: ${post.freshness}`)
  if (post.dateAdded) lines.push(`- Added: ${post.dateAdded}`)
  if (post.coreArgument) lines.push(`- Core argument: ${post.coreArgument}`)
  if (post.notes) lines.push(`- Notes: ${post.notes}`)
  return lines.join('\n')
}

/**
 * Render a single Decision Log entry to markdown.
 */
export function renderDecisionEntry(decision) {
  const lines = [`**Decision ${decision.id}:** ${decision.title}`]
  if (decision.decision) lines.push(decision.decision)
  if (decision.reasoning) lines.push(`Reasoning: ${decision.reasoning}`)
  return lines.join('\n')
}

// ── Full section rendering (for context assembly) ────────

/**
 * Render an entire state section to markdown.
 *
 * @param {object} state
 * @param {string} section — 'analysisIndex' | 'themeRegistry' | 'postBacklog' | 'decisionLog' | 'permanentPreferences'
 * @param {object} [opts] — { session?, tier?, status? }
 * @returns {string}
 */
export function renderSection(state, section, opts = {}) {
  switch (section) {
    case 'analysisIndex': {
      let entries = Object.entries(state.analysisIndex || {})
      if (opts.session) entries = entries.filter(([, e]) => e.session === opts.session)
      if (opts.tier !== undefined) entries = entries.filter(([, e]) => e.tier === opts.tier)
      if (opts.status) entries = entries.filter(([, e]) => e.status === opts.status)
      return entries.map(([id, entry]) => renderAnalysisEntry(id, entry)).join('\n\n')
    }
    case 'themeRegistry': {
      let themes = Object.entries(state.themeRegistry || {})
      if (opts.active) {
        const recentSession = (state.counters?.nextSession || 1) - 1
        themes = themes.filter(([, t]) => {
          const lastNum = parseInt((t.lastUpdated || '').match(/\d+/)?.[0] || '0')
          return lastNum >= recentSession - 2
        })
      }
      return themes.map(([code, theme]) => renderTheme(code, theme)).join('\n\n---\n\n')
    }
    case 'postBacklog': {
      let posts = Object.entries(state.postBacklog || {})
      if (opts.status) posts = posts.filter(([, p]) => p.status === opts.status)
      if (opts.priority) posts = posts.filter(([, p]) => p.priority === opts.priority)
      if (opts.format) posts = posts.filter(([, p]) => p.format === opts.format)
      if (!opts.status) {
        // Default: exclude rejected and archived
        posts = posts.filter(([, p]) => p.status !== 'rejected' && p.status !== 'archived')
      }
      return posts.map(([id, post]) => renderPostBacklogEntry(id, post)).join('\n\n')
    }
    case 'decisionLog': {
      let decisions = state.decisionLog || []
      if (opts.session) decisions = decisions.filter(d => d.session === opts.session)
      return decisions.map(d => renderDecisionEntry(d)).join('\n\n')
    }
    case 'permanentPreferences': {
      return (state.permanentPreferences || [])
        .map((p, i) => `${i + 1}. **${p.title}:** ${p.content}`)
        .join('\n')
    }
    default:
      throw new Error(`Unknown section: ${section}`)
  }
}

// ── Activity logging ─────────────────────────────────────

/**
 * Append an entry to activity.json. Keeps last 100 entries.
 *
 * @param {string} type — 'analyse' | 'discover' | 'draft' | 'track' | 'error'
 * @param {string} title — short description
 * @param {string} [detail] — optional longer description
 */
export function logActivity(type, title, detail = '') {
  const activity = loadActivity()
  activity.unshift({
    type,
    title,
    detail,
    timestamp: new Date().toISOString(),
  })
  // Keep last 100 entries
  if (activity.length > 100) activity.length = 100
  saveActivity(activity)
}

// ── Notification helpers ─────────────────────────────────

/**
 * Add a post candidate notification. Deduplicates by postId.
 *
 * @param {number|string} postId
 * @param {string} title
 * @param {string} priority — 'immediate' | 'high'
 * @param {string} [detail]
 */
export function addNotification(postId, title, priority, detail = '') {
  const notifications = loadNotifications()

  // Deduplicate by postId
  if (notifications.some(n => String(n.postId) === String(postId))) return

  notifications.unshift({
    id: `notif-${Date.now()}-${postId}`,
    postId: Number(postId),
    title,
    priority,
    detail,
    timestamp: new Date().toISOString(),
    dismissed: false,
  })
  saveNotifications(notifications)
}

/**
 * Dismiss a notification by ID.
 * @param {string} notifId
 */
export function dismissNotification(notifId) {
  const notifications = loadNotifications()
  const notif = notifications.find(n => n.id === notifId)
  if (notif) {
    notif.dismissed = true
    saveNotifications(notifications)
  }
}

// ── Session management ───────────────────────────────────

/**
 * Begin a new session. Increments nextSession counter and logs activity.
 * Call this at the start of editorial-analyse.js.
 *
 * @param {object} state — mutated in place
 * @returns {number} the new session number
 */
export function beginSession(state) {
  const session = state.counters.nextSession
  state.counters.nextSession++
  try {
    logActivity('analyse', `Session ${session} started`, `Beginning ANALYSE session ${session}`)
  } catch (err) {
    warn(`Failed to log activity for session ${session}: ${err.message}`)
  }
  log(`Session ${session} started (next will be ${state.counters.nextSession})`)
  return session
}

// ── Published item tracking ──────────────────────────────

/**
 * Record a published item (newsletter or LinkedIn post).
 *
 * @param {'newsletter'|'linkedin'} type
 * @param {{ week?: number, postId?: number, title?: string, date?: string, url?: string }} item
 */
export function trackPublished(type, item) {
  const published = loadPublished()
  const entry = {
    ...item,
    date: item.date || new Date().toISOString().slice(0, 10),
  }

  if (type === 'newsletter') {
    // Deduplicate by week
    if (!published.newsletters.some(n => n.week === entry.week)) {
      published.newsletters.push(entry)
    }
  } else if (type === 'linkedin') {
    // Deduplicate by postId
    if (!published.linkedin.some(p => p.postId === entry.postId)) {
      published.linkedin.push(entry)
    }
  }

  savePublished(published)
  logActivity('track', `Published ${type}`, `${type === 'newsletter' ? `Week ${entry.week}` : `Post #${entry.postId}: ${entry.title}`}`)
}

/**
 * Check if a post backlog ID has been published.
 * @param {number|string} postId
 * @returns {boolean}
 */
export function isPublished(postId) {
  const published = loadPublished()
  return published.linkedin.some(p => p.postId === Number(postId))
}

// ── Export paths for consumers ───────────────────────────

export const paths = {
  ROOT,
  EDITORIAL_DIR,
  STATE_PATH,
  PUBLISHED_PATH,
  NOTIFICATIONS_PATH,
  ACTIVITY_PATH,
  BACKUPS_DIR,
}
