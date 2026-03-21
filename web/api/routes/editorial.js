import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const EDITORIAL_DIR = process.env.SNI_EDITORIAL_DIR || join(ROOT, 'data/editorial')

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
  return readJSON(join(EDITORIAL_DIR, 'state.json'))
}

function getPublished() {
  return readJSON(join(EDITORIAL_DIR, 'published.json'))
}

function getNotifications() {
  return readJSON(join(EDITORIAL_DIR, 'notifications.json')) || []
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
  const locks = {
    analyse: existsSync(join(EDITORIAL_DIR, '.analyse.lock')),
    discover: existsSync(join(EDITORIAL_DIR, '.discover.lock')),
    draft: existsSync(join(EDITORIAL_DIR, '.draft.lock')),
  }

  // Read lock files for progress info
  const progress = {}
  for (const [stage, locked] of Object.entries(locks)) {
    if (locked) {
      const lockData = readJSON(join(EDITORIAL_DIR, `.${stage}.lock`))
      if (lockData) {
        progress[stage] = {
          pid: lockData.pid,
          startedAt: lockData.timestamp,
          current: lockData.current,
          total: lockData.total,
        }
      }
    }
  }

  return { locks, progress }
}

// ── GET /api/editorial/cost ──────────────────────────────

export async function getEditorialCost({ week } = {}) {
  // Cost data will be written by pipeline scripts as they run.
  // Read from cost-log files when they exist.
  const costFile = join(EDITORIAL_DIR, 'cost-log.json')
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
  const activityFile = join(EDITORIAL_DIR, 'activity.json')
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
    const files = existsSync(EDITORIAL_DIR)
      ? readdirSync(EDITORIAL_DIR)
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

  const progressFile = join(EDITORIAL_DIR, `discover-progress-session-${sessionNum}.json`)
  const progress = readJSON(progressFile)
  return { session: sessionNum, progress }
}

// ── GET /api/editorial/draft ────────────────────────────

export async function getEditorialDraft({ session } = {}) {
  const draftsDir = join(EDITORIAL_DIR, 'drafts')
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
