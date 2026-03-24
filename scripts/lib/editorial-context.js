/**
 * editorial-context.js — Context assembly for editorial Opus calls
 *
 * Builds the context payloads for ANALYSE, DRAFT and CHAT modes.
 * Reads from state.json + prompt templates + source transcripts.
 *
 * Token budget management: each context section has a budget cap.
 * The total context must fit within Opus 4.6's 200k window, leaving
 * room for the response. We target ~80k context max to keep costs
 * manageable and leave room for long responses.
 *
 * Does NOT import from any existing pipeline module in scripts/
 * or web/api/ — assembles context independently.
 */

import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import {
  loadState,
  loadPublished,
  loadActivity,
  renderSection,
  renderAnalysisEntry,
  renderTheme,
  renderPostBacklogEntry,
  getCounters,
  getPermanentPreferences,
} from './editorial-state.js'
import { loadAndRenderPrompt } from './prompt-loader.js'

const ROOT = resolve(import.meta.dir, '../..')

// ── Token estimation ─────────────────────────────────────

/**
 * Estimate token count from text (4 chars ≈ 1 token).
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Trim text to fit within a token budget.
 * @param {string} text
 * @param {number} budget — max tokens
 * @returns {string}
 */
export function trimToTokenBudget(text, budget) {
  if (!text) return ''
  const maxChars = budget * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '\n\n[...truncated to fit context budget]'
}

// ── Token budgets ────────────────────────────────────────

const BUDGETS = {
  // ANALYSE context
  analyse: {
    systemPrompt: 8000,       // Editorial voice + instructions
    stateOverview: 2000,      // Counters, corpus stats, permanent preferences
    themeRegistry: 6000,      // Theme summaries with latest evidence (was 15k — full evidence too expensive)
    recentAnalysis: 4000,     // Last 2 sessions of Analysis Index entries (was 8k)
    activeBacklog: 3000,      // Active post backlog titles only (was 5k)
    transcript: 40000,        // The transcript being processed
    total: 65000,             // ~35% reduction from 80k
  },
  // DRAFT context
  draft: {
    systemPrompt: 8000,       // Editorial voice + draft instructions
    stateOverview: 2000,      // Counters, corpus stats
    themeRegistry: 10000,     // Active themes for synthesis
    analysisIndex: 12000,     // This week's processed transcripts
    sectorArticles: 15000,    // Sector article bullets from pipeline
    previousNewsletter: 8000, // Previous week's published newsletter
    publishedTracking: 2000,  // Which posts are already published
    total: 60000,
  },
  // CHAT context (per-tab)
  chat: {
    state: 8000,
    themes: 12000,
    backlog: 6000,
    decisions: 2000,
    activity: 1000,
  },
}

// ── System prompt assembly ───────────────────────────────

/**
 * Load the Brightbeam editorial prompt and compose it with mode-specific instructions.
 *
 * @param {'analyse'|'draft'|'chat'} mode
 * @returns {string}
 */
export function buildSystemPrompt(mode) {
  const editorialPrompt = readFileSync(
    join(ROOT, 'config/prompts/editorial-context.v1.txt'),
    'utf-8'
  )

  // Load the detailed ANALYSE JSON schema for structured output
  const analyseSchema = mode === 'analyse'
    ? readFileSync(join(ROOT, 'config/prompts/editorial-analyse.v1.txt'), 'utf-8')
    : ''

  const modeInstructions = {
    analyse: `You are operating in ANALYSE mode. Process the provided transcript and produce structured JSON output.

${analyseSchema}

Follow the state document format exactly. Reference existing themes by code (T01-T26+).
Number new themes sequentially from the highest existing code.
Number new posts sequentially from the provided nextPost counter.

Maintain the analytical lens described in the editorial prompt. Filter everything through:
what does this mean for organisations adopting AI in regulated industries?`,

    draft: `You are operating in DRAFT mode. Produce a complete newsletter draft.

The newsletter is Second Nature Intelligence (SNI), published weekly on LinkedIn.
Structure: tl;dr introduction → AI & tech → Biopharma → Medtech → Manufacturing → Insurance → Podcast analysis section.

The introduction identifies the week's through-line by synthesising across all sections.
The podcast section reads as analytical synthesis with cross-episode themes — not episode recaps.

Apply all writing style rules from the editorial prompt. UK English throughout.
Evidence before labels. Descriptive not prescriptive. No prohibited structures.`,

    chat: `You are the contextual editorial assistant for the SNI editorial workbench.
You have access to the editorial state documents and can help with:
- Analysing themes and cross-connections
- Suggesting post ideas
- Refining arguments
- Identifying patterns across sources

Be concise and specific. Reference document IDs, theme codes and post numbers directly.
When suggesting draft-worthy content, include an "Open in Draft" marker.`,
  }

  return `${editorialPrompt}\n\n---\n\nMODE: ${mode.toUpperCase()}\n\n${modeInstructions[mode] || ''}`
}

// ── ANALYSE context assembly ─────────────────────────────

/**
 * Build the full context for an ANALYSE call.
 *
 * @param {string} transcript — the transcript text to analyse
 * @param {object} [opts]
 * @param {string} [opts.source] — podcast source name
 * @param {string} [opts.episode] — episode title
 * @param {string} [opts.date] — episode date
 * @returns {{ system: string, user: string, tokenEstimate: number }}
 */
export function buildAnalyseContext(transcript, opts = {}) {
  const state = loadState()
  if (!state) throw new Error('Cannot build ANALYSE context: state.json not found')

  const b = BUDGETS.analyse
  const sections = []

  // 1. State overview
  const counters = getCounters(state)
  const prefs = getPermanentPreferences(state)
  const overview = [
    `Session: ${counters.nextSession}`,
    `Next document ID: ${counters.nextDocument}`,
    `Next post ID: ${counters.nextPost}`,
    `Active themes: ${Object.keys(state.themeRegistry || {}).length}`,
    `Active posts: ${Object.values(state.postBacklog || {}).filter(p => !['published', 'rejected', 'archived'].includes(p.status)).length}`,
    '',
    'Permanent editorial preferences:',
    ...prefs.map((p, i) => `${i + 1}. ${p.title}: ${p.content}`),
  ].join('\n')
  sections.push({ label: 'STATE OVERVIEW', content: trimToTokenBudget(overview, b.stateOverview) })

  // 2. Theme registry (summary with latest evidence only — full registry is too expensive)
  const themeSummary = Object.entries(state.themeRegistry || {})
    .filter(([, t]) => !t.archived)
    .map(([code, theme]) => {
      const evCount = (theme.evidence || []).length
      const latestEv = (theme.evidence || []).slice(-2).map(e => `  - ${e.source}: ${(e.content || '').slice(0, 150)}`).join('\n')
      const connections = (theme.crossConnections || []).map(c => c.toTheme || c.fromTheme).filter(Boolean).join(', ')
      return `### ${code}: ${theme.name}\nStrength: ${evCount} evidence items | Documents: ${theme.documentCount || 0}${connections ? `\nConnections: ${connections}` : ''}\nLatest evidence:\n${latestEv}`
    })
    .join('\n\n')
  sections.push({ label: 'THEME REGISTRY', content: trimToTokenBudget(themeSummary, b.themeRegistry) })

  // 3. Recent analysis (last 2 sessions — avoid re-analysing known content)
  const currentSession = counters.nextSession
  const recentEntries = Object.entries(state.analysisIndex || {})
    .filter(([, e]) => e.session >= currentSession - 2)
    .map(([id, e]) => renderAnalysisEntry(id, e))
    .join('\n\n')
  sections.push({ label: 'RECENT ANALYSIS (last 2 sessions)', content: trimToTokenBudget(recentEntries, b.recentAnalysis) })

  // 4. Active backlog (so Opus can avoid proposing duplicates)
  const backlogMd = renderSection(state, 'postBacklog')
  sections.push({ label: 'ACTIVE POST BACKLOG', content: trimToTokenBudget(backlogMd, b.activeBacklog) })

  // 5. The transcript itself
  const transcriptHeader = [
    opts.source ? `Source: ${opts.source}` : '',
    opts.episode ? `Episode: ${opts.episode}` : '',
    opts.date ? `Date: ${opts.date}` : '',
  ].filter(Boolean).join(' | ')

  const transcriptSection = transcriptHeader
    ? `${transcriptHeader}\n\n${transcript}`
    : transcript
  sections.push({ label: 'TRANSCRIPT TO ANALYSE', content: trimToTokenBudget(transcriptSection, b.transcript) })

  // Compose user message
  const userMessage = sections
    .map(s => `## ${s.label}\n\n${s.content}`)
    .join('\n\n---\n\n')

  const system = buildSystemPrompt('analyse')
  const tokenEstimate = estimateTokens(system) + estimateTokens(userMessage)

  return { system, user: userMessage, tokenEstimate }
}

// ── DRAFT context assembly ───────────────────────────────

/**
 * Build the full context for a DRAFT call.
 *
 * @param {number} week — the editorial week number
 * @param {object} [opts]
 * @param {string} [opts.sectorArticlesDir] — path to sector articles
 * @param {string} [opts.previousNewsletterPath] — path to previous newsletter
 * @returns {{ system: string, user: string, tokenEstimate: number }}
 */
export function buildDraftContext(week, opts = {}) {
  const state = loadState()
  if (!state) throw new Error('Cannot build DRAFT context: state.json not found')

  const b = BUDGETS.draft
  const sections = []

  // 1. State overview
  const counters = getCounters(state)
  sections.push({
    label: 'STATE OVERVIEW',
    content: trimToTokenBudget(
      `Week: ${week}\nSession: ${counters.nextSession}\nThemes: ${Object.keys(state.themeRegistry || {}).length}\nActive posts: ${Object.values(state.postBacklog || {}).filter(p => p.status === 'approved' || p.status === 'in-progress').length}`,
      b.stateOverview
    ),
  })

  // 2. Theme registry (active themes with evidence)
  const themeMd = renderSection(state, 'themeRegistry', { active: true })
  sections.push({ label: 'ACTIVE THEMES', content: trimToTokenBudget(themeMd, b.themeRegistry) })

  // 3. This week's analysis index entries
  const currentSession = counters.nextSession - 1
  const analysisMd = Object.entries(state.analysisIndex || {})
    .filter(([, e]) => e.session >= currentSession - 1 && e.status === 'active')
    .map(([id, e]) => renderAnalysisEntry(id, e))
    .join('\n\n')
  sections.push({ label: 'THIS WEEK\'S ANALYSIS', content: trimToTokenBudget(analysisMd, b.analysisIndex) })

  // 4. Sector articles (if available)
  if (opts.sectorArticlesDir && existsSync(opts.sectorArticlesDir)) {
    const sectorLines = loadSectorArticleSummaries(opts.sectorArticlesDir, week)
    sections.push({ label: 'SECTOR ARTICLES', content: trimToTokenBudget(sectorLines, b.sectorArticles) })
  }

  // 5. Previous newsletter (for continuity)
  if (opts.previousNewsletterPath && existsSync(opts.previousNewsletterPath)) {
    const prev = readFileSync(opts.previousNewsletterPath, 'utf-8')
    sections.push({ label: 'PREVIOUS NEWSLETTER', content: trimToTokenBudget(prev, b.previousNewsletter) })
  }

  // 6. Published tracking
  const published = loadPublished()
  const pubMd = [
    `Published newsletters: ${published.newsletters.length}`,
    `Published LinkedIn posts: ${published.linkedin.map(p => `#${p.postId} (${p.title})`).join(', ') || 'none'}`,
    '',
    'Do not re-use published post material in the newsletter draft.',
  ].join('\n')
  sections.push({ label: 'PUBLISHED ITEMS', content: trimToTokenBudget(pubMd, b.publishedTracking) })

  // Compose
  const userMessage = sections
    .map(s => `## ${s.label}\n\n${s.content}`)
    .join('\n\n---\n\n')

  const system = buildSystemPrompt('draft')
  const tokenEstimate = estimateTokens(system) + estimateTokens(userMessage)

  return { system, user: userMessage + `\n\n---\n\nProduce the complete newsletter draft for Week ${week}.`, tokenEstimate }
}

// ── CHAT context assembly ────────────────────────────────

/**
 * Build context for an editorial chat message based on the active tab.
 *
 * @param {string} tab — 'state' | 'themes' | 'backlog' | 'decisions' | 'activity'
 * @param {object} [opts]
 * @param {string} [opts.selectedItemId] — specific item ID if user has selected one
 * @param {object} [opts.filters] — any active filters
 * @returns {{ system: string, context: string, tokenEstimate: number }}
 */
export function buildChatContext(tab, opts = {}) {
  const state = loadState()
  if (!state) throw new Error('Cannot build chat context: state.json not found')

  const budgets = BUDGETS.chat
  let context = ''

  switch (tab) {
    case 'state': {
      if (opts.selectedItemId) {
        const entry = state.analysisIndex?.[opts.selectedItemId]
        if (entry) {
          context = renderAnalysisEntry(opts.selectedItemId, entry)
        }
      }
      if (!context) {
        // Recent entries
        const currentSession = (state.counters?.nextSession || 1) - 1
        context = Object.entries(state.analysisIndex || {})
          .filter(([, e]) => e.session >= currentSession - 1)
          .map(([id, e]) => renderAnalysisEntry(id, e))
          .join('\n\n')
      }
      context = trimToTokenBudget(context, budgets.state)
      break
    }
    case 'themes': {
      if (opts.selectedItemId) {
        const theme = state.themeRegistry?.[opts.selectedItemId]
        if (theme) {
          context = renderTheme(opts.selectedItemId, theme)
        }
      }
      if (!context) {
        context = renderSection(state, 'themeRegistry')
      }
      context = trimToTokenBudget(context, budgets.themes)
      break
    }
    case 'backlog': {
      if (opts.selectedItemId) {
        const post = state.postBacklog?.[opts.selectedItemId]
        if (post) {
          context = renderPostBacklogEntry(opts.selectedItemId, post)
        }
      }
      if (!context) {
        context = renderSection(state, 'postBacklog')
      }
      context = trimToTokenBudget(context, budgets.backlog)
      break
    }
    case 'decisions': {
      context = renderSection(state, 'decisionLog', { session: (state.counters?.nextSession || 1) - 1 })
      context = trimToTokenBudget(context, budgets.decisions)
      break
    }
    case 'activity': {
      const activity = loadActivity().slice(0, 20)
      context = activity.map(a => `[${a.timestamp}] ${a.type}: ${a.title}${a.detail ? ' — ' + a.detail : ''}`).join('\n')
      context = trimToTokenBudget(context, budgets.activity)
      break
    }
    default:
      context = ''
  }

  const system = buildSystemPrompt('chat')
  const tokenEstimate = estimateTokens(system) + estimateTokens(context)

  return { system, context, tokenEstimate }
}

// ── Sector article loading ───────────────────────────────

/**
 * Load sector article summaries for a given week from data/verified/.
 * Returns markdown-formatted article bullets grouped by sector.
 *
 * @param {string} articlesDir — path to data/verified/
 * @param {number} week — week number
 * @returns {string}
 */
function loadSectorArticleSummaries(articlesDir, week) {
  const sectors = ['general-ai', 'biopharma', 'medtech', 'manufacturing', 'insurance']
  const lines = []

  for (const sector of sectors) {
    // Look for week directories matching the week number
    const weekDirs = readdirSync(articlesDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name.includes(`week-${week}`))

    for (const weekDir of weekDirs) {
      const sectorDir = join(articlesDir, weekDir.name, sector)
      if (!existsSync(sectorDir)) continue

      const articles = readdirSync(sectorDir, { withFileTypes: true })
        .filter(d => d.isDirectory())

      if (articles.length === 0) continue

      lines.push(`### ${sector.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)

      for (const article of articles.slice(0, 10)) {
        const metaPath = join(sectorDir, article.name, 'meta.json')
        if (!existsSync(metaPath)) continue

        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          lines.push(`- **${meta.title || article.name}** (${meta.source || 'Unknown'})`)
          if (meta.snippet) lines.push(`  ${meta.snippet.slice(0, 200)}`)
        } catch {
          // Skip corrupt meta files
        }
      }
      lines.push('')
    }
  }

  return lines.join('\n') || '(No sector articles available for this week.)'
}

// ── Exports ──────────────────────────────────────────────

export { BUDGETS }
