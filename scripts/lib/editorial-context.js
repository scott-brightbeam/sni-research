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
    systemPrompt: 10000,      // Editorial voice + draft instructions (expanded with structural template)
    stateOverview: 3000,      // Counters, corpus stats
    themeRegistry: 20000,     // Active themes with evidence — more evidence = better synthesis
    analysisIndex: 25000,     // This week's processed transcripts — full entries, not summaries
    sectorArticles: 40000,    // Sector articles with snippets — the raw material for the newsletter
    previousNewsletter: 15000, // Previous week's published newsletter — structural reference
    publishedTracking: 3000,  // Which posts are already published
    total: 150000,            // Use the full context window — richer context produces better drafts
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

    draft: `You are operating in DRAFT mode. Produce a complete newsletter draft for Sector News Intelligence (SNI).

STRUCTURE (mandatory — match exactly):
1. Welcome line (one sentence)
2. tl;dr (H2) — 5-6 paragraphs of editorial prose with causal reasoning. NOT bullet points. Each paragraph develops ONE argument with specific evidence.
3. Sector bullets embedded in flow — "In AI & tech:" then linked bullet headlines, "In Biopharma:" then linked bullets, "In Medtech:", "In Manufacturing:", "In Insurance:" — bold labels within normal text, not separate H2 sections. Each bullet: [linked headline](url) — one line of editorial context.
4. Expanded analysis per sector (H2 per sector) — each article gets a paragraph making one claim with evidence and consequence.
5. Podcast section (H2: "But what set podcast tongues a-wagging?") — 3-4 episodes with H3 titles, inline podcast links, and 1-2 paragraphs of editorial commentary. FRESH CONTENT ONLY — nothing duplicated from the sector sections above. Check every URL: if it appears in any sector bullet or expanded section, that story CANNOT appear in the podcast section.

If any sector has zero articles this week, omit that sector's heading entirely — do not include an empty section or fabricate content. Same for the podcast section: if no podcast episodes were analysed this week, omit it.

VOICE:
- The tl;dr should read as editorial — someone thinking on paper, connecting themes causally, drawing consequences. Not a briefing document listing things that happened.
- Every paragraph makes one move. Not five facts compressed into one paragraph.
- UK English throughout. Single quotes. Spaced en-dashes. No Oxford commas.
- No prohibited language (see editorial prompt for full list).

EDITORIAL STATE:
- The HIGH-PRIORITY POST IDEAS section contains the strongest editorial angles identified from podcast analysis this week. Use these as fuel for the tl;dr — they represent the analytical thinking already done.
- The THEME CROSS-CONNECTIONS section shows how themes relate. Use these to build narrative threads in the tl;dr rather than listing unrelated stories.
- The ACTIVE THEMES section shows the evolving analytical framework. The newsletter should reflect these patterns, not just this week's headlines.

GEOGRAPHIC BALANCE:
- Include Irish, EU and UK stories alongside US stories. The audience is global enterprise leaders.
- Do not default to US framing. Say 'American' when specifically American.
- European regulatory developments (EU AI Act, EIOPA, FCA, MHRA, Ireland's AI Bill) are first-class stories, not footnotes.

DATE VALIDATION:
- Every linked article MUST have a publication date within the newsletter window (Friday to Thursday).
- If you are unsure of a date, do not include the article.`,

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

  // 3. This week's analysis index entries (ranked by post potential, date-based window)
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
  const potentialRank = { 'very-high': 5, 'high': 4, 'medium-high': 3, 'medium': 2, 'low': 1, 'none': 0 }
  const weekEntries = Object.entries(state.analysisIndex || {})
    .filter(([, e]) => (e.dateProcessed || e.date || '') >= sevenDaysAgo && e.status === 'active')
    .sort(([, a], [, b]) => (potentialRank[(b.postPotential || '').toLowerCase()] || 0) - (potentialRank[(a.postPotential || '').toLowerCase()] || 0))
  const analysisMd = weekEntries.map(([id, e]) => renderAnalysisEntry(id, e)).join('\n\n')
  sections.push({ label: 'THIS WEEK\'S ANALYSIS (by editorial potential)', content: trimToTokenBudget(analysisMd, b.analysisIndex) })

  // 3b. High-priority post backlog items (editorial fuel for the tl;dr brief)
  const activePosts = Object.entries(state.postBacklog || {})
    .filter(([, p]) => p.status === 'suggested' || p.status === 'approved')
    .sort(([, a], [, b]) => {
      const pr = { 'immediate': 4, 'high': 3, 'medium-high': 2, 'medium': 1 }
      return (pr[(b.priority || '').toLowerCase()] || 0) - (pr[(a.priority || '').toLowerCase()] || 0)
    })
    .slice(0, 15)
  if (activePosts.length > 0) {
    const postMd = activePosts.map(([id, p]) =>
      `#${id} [${p.priority}] ${p.title}\n  Argument: ${p.coreArgument || ''}\n  Format: ${p.format || '?'} | Sources: ${(p.sourceDocuments || []).join(', ')}`
    ).join('\n\n')
    sections.push({ label: 'HIGH-PRIORITY POST IDEAS (editorial fuel)', content: trimToTokenBudget(postMd, 3000) })
  }

  // 3c. Theme cross-connections (narrative threads for the tl;dr)
  const connections = []
  for (const [code, theme] of Object.entries(state.themeRegistry || {})) {
    if (theme.archived) continue
    for (const cc of (theme.crossConnections || [])) {
      const target = cc.theme || cc.toTheme || cc.fromTheme || '?'
      connections.push(`${code} ↔ ${target}: ${cc.reasoning || ''}`)
    }
  }
  if (connections.length > 0) {
    sections.push({ label: 'THEME CROSS-CONNECTIONS (narrative threads)', content: trimToTokenBudget(connections.join('\n'), 2000) })
  }

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

  // Compose with total budget enforcement
  let userMessage = ''
  let totalTokens = 0
  const systemPrompt = buildSystemPrompt('draft')
  const systemTokens = estimateTokens(systemPrompt)

  for (const s of sections) {
    const sectionText = `## ${s.label}\n\n${s.content}\n\n---\n\n`
    const sectionTokens = estimateTokens(sectionText)
    if (totalTokens + sectionTokens + systemTokens > b.total) {
      // Budget would overflow — truncate this section to fit
      const remaining = b.total - totalTokens - systemTokens - 500 // 500 token buffer for the closing instruction
      if (remaining > 1000) {
        userMessage += `## ${s.label}\n\n${trimToTokenBudget(s.content, remaining)}\n\n---\n\n`
        totalTokens += remaining
      }
      break // No more sections — budget exhausted
    }
    userMessage += sectionText
    totalTokens += sectionTokens
  }

  const tokenEstimate = systemTokens + totalTokens

  return { system: systemPrompt, user: userMessage + `Produce the complete newsletter draft for Week ${week}.`, tokenEstimate }
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
  // Scan data/verified/{YYYY-MM-DD}/{sector}/*.json within the newsletter week window
  // The articlesDir is data/verified/, directories are date-based (not week-based)
  const sectors = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']
  const sectorLabels = { general: 'AI & Technology', biopharma: 'Biopharma', medtech: 'Medtech', manufacturing: 'Manufacturing', insurance: 'Insurance' }
  const lines = []

  // Compute the Friday-Thursday window for this week number
  // week param is an ISO week number — compute the date range
  const now = new Date()
  const daysSinceFriday = (now.getDay() + 2) % 7  // days since last Friday
  const windowStart = new Date(now)
  windowStart.setDate(windowStart.getDate() - daysSinceFriday)
  const startStr = windowStart.toISOString().split('T')[0]
  const endStr = now.toISOString().split('T')[0]

  // Collect date directories within the window
  let dateDirs = []
  try {
    dateDirs = readdirSync(articlesDir)
      .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= startStr && d <= endStr)
      .sort()
  } catch { return '(No sector articles available for this week.)' }

  for (const sector of sectors) {
    const sectorArticles = []

    for (const dateDir of dateDirs) {
      const sectorPath = join(articlesDir, dateDir, sector)
      if (!existsSync(sectorPath)) continue

      try {
        const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))
        for (const file of files) {
          try {
            const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
            if (raw.archived) continue
            sectorArticles.push({
              title: raw.title || file.replace('.json', ''),
              source: raw.source || 'Unknown',
              date: raw.date_published || dateDir,
              snippet: (raw.snippet || '').slice(0, 200),
              url: raw.url || null,
            })
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable dir */ }
    }

    if (sectorArticles.length === 0) continue

    // Sort by date descending, take top 15 per sector
    sectorArticles.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    lines.push(`### ${sectorLabels[sector] || sector} (${sectorArticles.length} articles)`)
    for (const a of sectorArticles.slice(0, 15)) {
      lines.push(`- **${a.title}** (${a.source}, ${a.date})${a.url ? ` [${a.url}]` : ''}`)
      if (a.snippet) lines.push(`  ${a.snippet}`)
    }
    lines.push('')
  }

  return lines.join('\n') || '(No sector articles available for this week.)'
}

// ── Exports ──────────────────────────────────────────────

export { BUDGETS }
