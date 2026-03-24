/**
 * editorial-chat.js — Context assembly and streaming for editorial AI chat
 *
 * Assembles tab-specific editorial state into a prompt context,
 * then streams Opus responses back via SSE. Keeps context under 30k tokens.
 */

import { readFileSync, existsSync, statSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { estimateTokens } from './context.js'

const ROOT = resolve(import.meta.dir, '../../..')
const EDITORIAL_DIR = process.env.SNI_EDITORIAL_DIR || join(ROOT, 'data/editorial')

const CONTEXT_BUDGET = 30_000 // tokens
const HISTORY_BUDGET = 8_000  // tokens for conversation history

const EDITORIAL_SYSTEM_BASE = `You are an editorial intelligence assistant for Sector News Intelligence (SNI), a weekly AI newsletter covering five sectors: general AI, biopharma, medtech, manufacturing and insurance.

You have access to the editorial state document — an evolving knowledge base of analysis entries, themes, post candidates and editorial decisions built by the pipeline.

Your role:
- Help the editor understand patterns, connections and gaps in the analysis
- Suggest post angles and identify underexplored themes
- Answer questions about specific entries, themes or backlog items
- Provide concise, actionable editorial guidance

Style: UK English, analytical but accessible, cite specific entries/themes by ID when referencing them. Be concise — the editor values density over length.`

// ── Writing preferences (cached) ─────────────────────────

let _writingPrefsCache = { content: null, mtime: 0 }

function getWritingPreferences() {
  const prefsPath = join(EDITORIAL_DIR, 'writing-preferences.md')
  if (!existsSync(prefsPath)) return ''
  try {
    const stat = statSync(prefsPath)
    if (stat.mtimeMs !== _writingPrefsCache.mtime) {
      _writingPrefsCache = {
        content: readFileSync(prefsPath, 'utf-8'),
        mtime: stat.mtimeMs,
      }
    }
    return _writingPrefsCache.content
  } catch {
    return ''
  }
}

export function getEditorialSystemPrompt() {
  const prefs = getWritingPreferences()
  if (!prefs) return EDITORIAL_SYSTEM_BASE
  return `${EDITORIAL_SYSTEM_BASE}\n\n## Writing Preferences\n\nWhen drafting or editing content, follow these rules:\n\n${prefs}`
}

// ── JSON reader ──────────────────────────────────────────

function readJSON(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf-8')) } catch { return null }
}

/**
 * Build context string for a given editorial tab.
 * Each tab gets different state sections to stay within budget.
 *
 * @param {string} tab — one of: state, themes, backlog, decisions, activity, newsletter
 * @param {object} [state] — pre-loaded state.json (or null to load fresh)
 * @returns {{ context: string, tokenEstimate: number }}
 */
export function buildEditorialContext(tab, state = null) {
  if (!state) {
    const statePath = join(EDITORIAL_DIR, 'state.json')
    if (!existsSync(statePath)) return { context: '(No editorial state available yet.)', tokenEstimate: 10 }
    try {
      state = JSON.parse(readFileSync(statePath, 'utf-8'))
    } catch (e) {
      return { context: '(Failed to load editorial state.)', tokenEstimate: 10 }
    }
  }

  const sections = []
  let budget = CONTEXT_BUDGET - HISTORY_BUDGET // leave room for conversation

  // Always include summary counters
  if (state.counters) {
    sections.push(`## Editorial Pipeline Status
- Next session: ${state.counters.nextSession}
- Analysis entries: ${Object.keys(state.analysisIndex || {}).length}
- Themes tracked: ${Object.keys(state.themeRegistry || {}).length}
- Post candidates: ${Object.keys(state.postBacklog || {}).length}
- Decisions logged: ${(state.decisionLog || []).length}`)
  }

  switch (tab) {
    case 'state':
    case 'analysis': {
      // Full analysis index (newest first, truncated to budget)
      const entries = Object.entries(state.analysisIndex || {})
        .sort(([a], [b]) => Number(b) - Number(a))
      sections.push(`\n## Analysis Index (${entries.length} entries)\n`)
      for (const [id, entry] of entries) {
        const line = formatAnalysisEntry(id, entry)
        if (estimateTokens(sections.join('\n') + line) > budget) break
        sections.push(line)
      }
      break
    }

    case 'themes': {
      // Full theme registry
      const themes = Object.entries(state.themeRegistry || {})
      sections.push(`\n## Theme Registry (${themes.length} themes)\n`)
      for (const [code, theme] of themes) {
        const line = formatTheme(code, theme)
        if (estimateTokens(sections.join('\n') + line) > budget) break
        sections.push(line)
      }
      break
    }

    case 'backlog': {
      // Post backlog + relevant themes
      const posts = Object.entries(state.postBacklog || {})
        .sort(([a], [b]) => Number(b) - Number(a))
      sections.push(`\n## Post Backlog (${posts.length} candidates)\n`)
      for (const [id, post] of posts) {
        const line = formatPost(id, post)
        if (estimateTokens(sections.join('\n') + line) > budget * 0.7) break
        sections.push(line)
      }
      // Add theme summaries for context
      const themes = Object.entries(state.themeRegistry || {})
      if (themes.length > 0) {
        sections.push(`\n## Theme Registry (summary)\n`)
        for (const [code, theme] of themes) {
          sections.push(`- **${code}**: ${theme.name} (${theme.documentCount} docs)`)
        }
      }
      break
    }

    case 'decisions': {
      // Decision log + recent analysis for context
      const decisions = [...(state.decisionLog || [])].reverse()
      sections.push(`\n## Decision Log (${decisions.length} entries)\n`)
      for (const d of decisions) {
        const line = formatDecision(d)
        if (estimateTokens(sections.join('\n') + line) > budget * 0.6) break
        sections.push(line)
      }
      // Add recent analysis entries for reference
      const entries = Object.entries(state.analysisIndex || {})
        .sort(([a], [b]) => Number(b) - Number(a))
        .slice(0, 10)
      if (entries.length > 0) {
        sections.push(`\n## Recent Analysis (last 10)\n`)
        for (const [id, entry] of entries) {
          sections.push(`- #${id}: ${entry.title} (${entry.source}, T${entry.tier})`)
        }
      }
      break
    }

    case 'activity': {
      // Activity log + cost data
      const activityPath = join(EDITORIAL_DIR, 'activity.json')
      let activities = []
      if (existsSync(activityPath)) {
        try {
          activities = JSON.parse(readFileSync(activityPath, 'utf-8'))
        } catch (err) {
          console.error('[editorial-chat] Failed to parse activity.json:', err.message)
        }
      }
      const recent = activities.slice(-30).reverse()
      sections.push(`\n## Recent Activity (${recent.length} entries)\n`)
      for (const a of recent) {
        sections.push(`- [${a.stage || a.type}] ${a.message}${a.detail ? ` — ${a.detail}` : ''} (${a.timestamp})`)
      }

      // Cost data
      const costPath = join(EDITORIAL_DIR, 'cost-log.json')
      if (existsSync(costPath)) {
        try {
          const costData = JSON.parse(readFileSync(costPath, 'utf-8'))
          const weeks = Object.keys(costData.weeks || {}).sort()
          if (weeks.length > 0) {
            const latest = costData.weeks[weeks[weeks.length - 1]]
            sections.push(`\n## Cost (${weeks[weeks.length - 1]})`)
            sections.push(`Weekly total: $${latest.weeklyTotal?.toFixed(2) || '0.00'} / $${latest.budget || 50}`)
          }
        } catch (err) {
          console.error('[editorial-chat] Failed to parse cost-log.json:', err.message)
        }
      }
      break
    }

    case 'newsletter': {
      // Published state + in-progress posts for newsletter editing context
      const publishedMeta = readJSON(join(EDITORIAL_DIR, 'published.json')) || {}
      sections.push('\n## Newsletter Context\n')
      const nlCount = (publishedMeta.newsletters || []).length
      const liCount = (publishedMeta.linkedin || []).length
      sections.push(`Published: ${nlCount} newsletter${nlCount !== 1 ? 's' : ''}, ${liCount} LinkedIn post${liCount !== 1 ? 's' : ''}`)
      if (liCount > 0) {
        const latest = publishedMeta.linkedin[liCount - 1]
        sections.push(`Latest LinkedIn: '${latest.title}' (${latest.date})`)
      }
      const inProgress = Object.entries(state.postBacklog || {})
        .filter(([, p]) => p.status === 'in-progress' || p.status === 'approved')
      if (inProgress.length > 0) {
        sections.push('\n### Active Posts\n')
        for (const [id, post] of inProgress) {
          sections.push(formatPost(id, post))
        }
      }
      break
    }

    case 'articles': {
      const verifiedDir = join(ROOT, 'data/verified')
      if (existsSync(verifiedDir)) {
        const now = new Date()
        const cutoff = new Date(now)
        cutoff.setDate(cutoff.getDate() - 7)
        const cutoffStr = cutoff.toISOString().split('T')[0]

        const articles = []
        for (const dateDir of readdirSync(verifiedDir).sort().reverse()) {
          if (dateDir < cutoffStr) break
          const datePath = join(verifiedDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sectorDir of readdirSync(datePath)) {
            const sectorPath = join(datePath, sectorDir)
            if (!statSync(sectorPath).isDirectory()) continue
            for (const file of readdirSync(sectorPath)) {
              if (!file.endsWith('.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
                if (raw.archived) continue
                articles.push({ title: raw.title, source: raw.source, sector: raw.sector || sectorDir, date: raw.date_published || dateDir })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Article Corpus (last 7 days, ${articles.length} articles)\n`)
        for (const a of articles) {
          const line = `- **${a.title}** (${a.source || 'unknown'}, ${a.sector}, ${a.date})`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }

        const bySector = {}
        for (const a of articles) {
          bySector[a.sector] = (bySector[a.sector] || 0) + 1
        }
        sections.push(`\n**Stats:** ${articles.length} total — ${Object.entries(bySector).map(([k, v]) => `${k}: ${v}`).join(', ')}`)
      }
      break
    }

    case 'podcasts': {
      const podcastDir = join(ROOT, 'data/podcasts')
      if (existsSync(podcastDir)) {
        const digests = []
        for (const dateDir of readdirSync(podcastDir).sort().reverse().slice(0, 14)) {
          const datePath = join(podcastDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sourceDir of readdirSync(datePath)) {
            const sourcePath = join(datePath, sourceDir)
            if (!statSync(sourcePath).isDirectory()) continue
            for (const file of readdirSync(sourcePath)) {
              if (!file.endsWith('.digest.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
                if (raw.archived) continue
                digests.push({
                  title: raw.title || file, source: raw.source || sourceDir,
                  date: raw.date || dateDir, summary: raw.summary || '',
                  stories: (raw.key_stories || raw.stories || []).map(s => typeof s === 'string' ? s : s.headline || s.title || '').filter(Boolean),
                })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Podcast Digests (${digests.length} episodes)\n`)
        for (const d of digests) {
          const stories = d.stories.length > 0 ? `\n  Stories: ${d.stories.join('; ')}` : ''
          const line = `### ${d.title} (${d.source}, ${d.date})\n${d.summary.slice(0, 300)}${stories}\n`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }
      }
      break
    }

    case 'ideate': {
      // MODE 3: IDEATE — load themes + backlog + recent high-potential analysis
      sections.push('\n## IDEATE MODE\n')
      sections.push(`Generate 5–10 LinkedIn post ideas based on the themes, recent analysis and existing backlog below.

For each idea provide:
- A working title (argumentative, states a position — not descriptive)
- The core argument in one to two sentences
- Recommended format: quiet-observation, concept-contrast, news-decoder, behavioural-paradox, honest-confession, or practitioners-take
- Which source documents provide the evidence base
- Freshness: very-timely, timely-evergreen, or evergreen
- Priority: immediate, high, medium-high, or medium

Rank by timeliness × audience relevance × originality. Check the existing backlog to avoid duplicates. Focus on angles that would resonate with Scott's audience of senior leaders, transformation professionals and AI-curious executives in regulated industries.\n`)

      // Themes
      const ideateThemes = Object.entries(state.themeRegistry || {})
        .filter(([, t]) => !t.archived)
      sections.push(`\n### Active Themes (${ideateThemes.length})\n`)
      for (const [code, theme] of ideateThemes) {
        const recentEv = (theme.evidence || []).slice(-3).map(e => e.source).join('; ')
        sections.push(`- **${code}**: ${theme.name} (${theme.documentCount || 0} docs, strength: ${theme.evidence?.length || 0})${recentEv ? `\n  Recent evidence: ${recentEv}` : ''}`)
      }

      // Existing backlog (to avoid duplicates)
      const ideateBacklog = Object.entries(state.postBacklog || {})
        .filter(([, p]) => p.status !== 'archived' && p.status !== 'rejected')
        .sort(([a], [b]) => Number(b) - Number(a))
      sections.push(`\n### Existing Backlog (${ideateBacklog.length} active)\n`)
      for (const [id, post] of ideateBacklog.slice(0, 20)) {
        sections.push(`- #${id}: ${post.title} [${post.status}] (${post.format || '?'}, ${post.priority || '?'})`)
      }

      // Recent high-potential analysis
      const highPotential = Object.entries(state.analysisIndex || {})
        .filter(([, e]) => e.postPotential === 'high' || e.postPotential === 'very-high' || e.postPotential === 'medium-high')
        .sort(([a], [b]) => Number(b) - Number(a))
        .slice(0, 15)
      if (highPotential.length > 0) {
        sections.push(`\n### High Post-Potential Entries\n`)
        for (const [id, entry] of highPotential) {
          sections.push(`- #${id}: ${entry.title} (${entry.source}) — ${entry.postPotential}${entry.postPotentialReasoning ? `: ${entry.postPotentialReasoning}` : ''}`)
        }
      }
      break
    }

    case 'draft': {
      // MODE 4: DRAFT — load source documents, format guidance, theme context
      sections.push('\n## DRAFT MODE\n')
      sections.push(`You are drafting a LinkedIn post for Scott Wilkinson (CMO and Head of Culture and Coaching at Brightbeam, an AI-native consultancy).

When the user selects a post idea, generate THREE complete drafts, each using a DIFFERENT format from:
1. concept-contrast — Before/after comparison illuminating a shift
2. news-decoder — Current event → deeper signal extraction
3. behavioural-paradox — Surprising human contradiction → psychology → framework
4. honest-confession — Genuine mistake or evolution in thinking
5. quiet-observation — Smaller, sharper insight with precision
6. practitioners-take — How you actually do something, with specificity

MANDATORY: Every draft MUST end with 'So what's today's in-the-end-at-the-end?' followed by one to three sentences that reframe everything — crystallise the insight, don't repeat it. Often inverts expectations or elevates the stakes. Never a generic call to action.

Writing rules: UK English, spaced en-dashes (not em-dashes), single quotes, active voice, contractions, concrete specifics over abstract claims. See the prohibited language list — avoid all listed patterns.

Label each draft clearly with its format name. Present all three for selection.\n`)

      // Load FULL SOURCE DOCUMENTS for drafting — transcripts and articles
      const transcriptDir = join(process.env.HOME || '/Users/scott', 'Desktop/Podcast Transcripts')
      const sourceDocsLoaded = []
      let sourceTokensUsed = 0
      const SOURCE_BUDGET = 15_000 // tokens reserved for source documents

      // Build a lookup: sourceDocument string → analysis entry with filename
      const entryBySource = {}
      for (const [id, entry] of Object.entries(state.analysisIndex || {})) {
        const key = `${entry.source}${entry.date ? ` (${entry.date})` : ''}`
        entryBySource[key] = entry
        // Also index by partial match patterns
        if (entry.source) entryBySource[entry.source] = entry
        const shortKey = `${entry.source} - ${(entry.title || '').split(' ').slice(0, 4).join(' ')}`
        entryBySource[shortKey] = entry
      }

      // Find backlog items that reference source documents — check all active posts
      const activePosts = Object.entries(state.postBacklog || {})
        .filter(([, p]) => p.status !== 'archived' && p.status !== 'rejected')
      for (const [, post] of activePosts) {
        for (const srcDoc of post.sourceDocuments || []) {
          // Try to find the matching analysis entry
          const entry = entryBySource[srcDoc] || Object.values(state.analysisIndex || {}).find(e =>
            srcDoc.toLowerCase().includes((e.source || '').toLowerCase()) &&
            srcDoc.toLowerCase().includes((e.date || '').slice(5))
          )
          if (!entry?.filename) continue

          // Read the transcript file
          const transcriptPath = join(transcriptDir, entry.filename)
          if (existsSync(transcriptPath)) {
            try {
              const content = readFileSync(transcriptPath, 'utf-8')
              const tokens = estimateTokens(content)
              if (sourceTokensUsed + tokens <= SOURCE_BUDGET) {
                sourceDocsLoaded.push({ source: srcDoc, filename: entry.filename, content })
                sourceTokensUsed += tokens
              } else {
                // Truncate to fit budget
                const remaining = SOURCE_BUDGET - sourceTokensUsed
                if (remaining > 1000) {
                  const truncated = content.slice(0, remaining * 4) // rough char-to-token ratio
                  sourceDocsLoaded.push({ source: srcDoc, filename: entry.filename, content: truncated + '\n\n[TRUNCATED — source too long for context budget]' })
                  sourceTokensUsed = SOURCE_BUDGET
                }
              }
            } catch { /* skip unreadable */ }
          }

          // Also try article full_text from data/verified/
          if (!entry.filename && entry.url) {
            // Search verified articles by URL
            const verifiedDir = join(ROOT, 'data/verified')
            if (existsSync(verifiedDir)) {
              for (const dateDir of readdirSync(verifiedDir).sort().reverse().slice(0, 14)) {
                const datePath = join(verifiedDir, dateDir)
                if (!statSync(datePath).isDirectory()) continue
                for (const sectorDir of readdirSync(datePath)) {
                  const sectorPath = join(datePath, sectorDir)
                  if (!statSync(sectorPath).isDirectory()) continue
                  for (const file of readdirSync(sectorPath)) {
                    if (!file.endsWith('.json')) continue
                    try {
                      const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
                      if (raw.url === entry.url && raw.full_text) {
                        const tokens = estimateTokens(raw.full_text)
                        if (sourceTokensUsed + tokens <= SOURCE_BUDGET) {
                          sourceDocsLoaded.push({ source: srcDoc, filename: file, content: `# ${raw.title}\n\n${raw.full_text}` })
                          sourceTokensUsed += tokens
                        }
                      }
                    } catch { /* skip */ }
                  }
                }
              }
            }
          }
        }
      }

      if (sourceDocsLoaded.length > 0) {
        sections.push(`\n### Source Documents (${sourceDocsLoaded.length} loaded, ~${sourceTokensUsed.toLocaleString()} tokens)\n`)
        for (const doc of sourceDocsLoaded) {
          sections.push(`#### ${doc.source}\n_File: ${doc.filename}_\n\n${doc.content}\n`)
        }
      } else {
        sections.push('\n### Source Documents\n_No source documents pre-loaded. When you select a post to draft, the relevant transcripts and articles will be loaded from the knowledge base._\n')
      }

      // Theme summaries for context (not full evidence — source docs carry the detail)
      const draftThemes = Object.entries(state.themeRegistry || {}).filter(([, t]) => !t.archived)
      sections.push(`\n### Theme Registry (${draftThemes.length} active)\n`)
      for (const [code, theme] of draftThemes) {
        const connections = (theme.crossConnections || []).map(c => c.theme).join(', ')
        sections.push(`- **${code}**: ${theme.name} (${theme.documentCount || 0} docs)${connections ? ` — connects: ${connections}` : ''}`)
      }

      // Active backlog for cross-reference
      const draftBacklog = Object.entries(state.postBacklog || {})
        .filter(([, p]) => p.status !== 'archived' && p.status !== 'rejected')
        .sort(([a], [b]) => Number(b) - Number(a))
        .slice(0, 10)
      if (draftBacklog.length > 0) {
        sections.push(`\n### Active Backlog\n`)
        for (const [id, post] of draftBacklog) {
          sections.push(`- #${id}: **${post.title}** [${post.format || '?'}]\n  ${post.coreArgument || ''}`)
        }
      }
      break
    }

    case 'flagged': {
      const reviewDir = join(ROOT, 'data/review')
      if (existsSync(reviewDir)) {
        const articles = []
        for (const dateDir of readdirSync(reviewDir).sort().reverse()) {
          const datePath = join(reviewDir, dateDir)
          if (!statSync(datePath).isDirectory()) continue
          for (const sectorDir of readdirSync(datePath)) {
            const sectorPath = join(datePath, sectorDir)
            if (!statSync(sectorPath).isDirectory()) continue
            for (const file of readdirSync(sectorPath)) {
              if (!file.endsWith('.json')) continue
              try {
                const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
                articles.push({ title: raw.title, source: raw.source, sector: raw.sector || sectorDir, date: raw.date_published || dateDir, snippet: (raw.snippet || '').slice(0, 200) })
              } catch { /* skip */ }
            }
          }
        }

        sections.push(`\n## Flagged Articles (${articles.length})\n`)
        for (const a of articles) {
          const line = `- **${a.title}** (${a.source || 'unknown'}, ${a.sector}, ${a.date})\n  ${a.snippet}`
          if (estimateTokens(sections.join('\n') + line) > budget) break
          sections.push(line)
        }
      }
      break
    }

    default:
      sections.push('(Unknown tab context)')
  }

  const context = sections.join('\n')
  return { context, tokenEstimate: estimateTokens(context) }
}

/**
 * Trim conversation history to fit within token budget.
 * Keeps most recent messages, drops oldest first.
 */
export function trimEditorialHistory(messages, budget = HISTORY_BUDGET) {
  if (!messages || messages.length === 0) return []
  let total = 0
  const kept = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i].content)
    if (kept.length > 0 && total + tokens > budget) break
    kept.unshift(messages[i])
    total += tokens
  }
  return kept
}

// ── Formatters ───────────────────────────────────────────

function formatAnalysisEntry(id, entry) {
  const lines = [`### #${id}: ${entry.title}`]
  lines.push(`Source: ${entry.source} · Host: ${entry.host || 'N/A'} · Tier: ${entry.tier} · Session: ${entry.session}`)
  if (entry.themes?.length) lines.push(`Themes: ${entry.themes.join(', ')}`)
  if (entry.postPotential) lines.push(`Post potential: ${entry.postPotential}`)
  if (entry.summary) lines.push(entry.summary)
  lines.push('')
  return lines.join('\n')
}

function formatTheme(code, theme) {
  const lines = [`### ${code}: ${theme.name}`]
  lines.push(`Documents: ${theme.documentCount} · Last updated: ${theme.lastUpdated || 'N/A'}`)
  const recentEvidence = (theme.evidence || []).slice(-2)
  for (const ev of recentEvidence) {
    lines.push(`> Session ${ev.session} · ${ev.source}: ${ev.content}`)
  }
  if (theme.crossConnections?.length) {
    lines.push(`Cross-connections: ${theme.crossConnections.map(c => c.theme).join(', ')}`)
  }
  lines.push('')
  return lines.join('\n')
}

function formatPost(id, post) {
  const lines = [`### #${id}: ${post.title || post.workingTitle || '(untitled)'}`]
  lines.push(`Status: ${post.status} · Priority: ${post.priority || 'N/A'} · Format: ${post.format || 'N/A'}`)
  if (post.coreArgument) lines.push(`Core argument: ${post.coreArgument}`)
  if (post.themes?.length) lines.push(`Themes: ${post.themes.join(', ')}`)
  if (post.sourceDocuments?.length) lines.push(`Sources: ${post.sourceDocuments.join(', ')}`)
  if (post.notes) lines.push(`Notes: ${post.notes}`)
  lines.push('')
  return lines.join('\n')
}

function formatDecision(d) {
  const lines = [`**[${d.type || 'decision'}]** ${d.date || d.timestamp || ''}`]
  lines.push(d.decision || d.content || d.summary || '')
  if (d.reasoning) lines.push(`_Reasoning: ${d.reasoning}_`)
  lines.push('')
  return lines.join('\n')
}
