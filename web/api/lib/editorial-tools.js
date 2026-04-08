/**
 * editorial-tools.js — Tool schemas and executors for editorial draft mode.
 *
 * Defines four read-only tools that let the AI model fetch detailed editorial
 * data on demand: analysis entries (with transcripts), theme evidence chains,
 * backlog items, and keyword search across the editorial state.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { estimateTokens } from './context.js'
import {
  safeReadFile, findTranscriptByMeta,
  formatAnalysisEntry, formatTheme, formatPost,
} from './editorial-chat.js'

const TRANSCRIPT_DIR = process.env.HOME
  ? join(process.env.HOME, 'Desktop/Podcast Transcripts')
  : null

// ── Tool schemas (Anthropic format) ─────────────────────

export const DRAFT_TOOLS = [
  {
    name: 'get_analysis_entry',
    description: 'Fetch full detail of an analysis entry by ID, including the source transcript if available. Use this to get the complete summary, themes, evidence and post potential for a specific entry.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Analysis entry ID (numeric string, e.g. "42")' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_theme_detail',
    description: 'Fetch full theme detail by code (e.g. "T01"), including the complete evidence chain and cross-connections to other themes.',
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Theme code (e.g. "T01", "T23")' },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_backlog_item',
    description: 'Fetch full detail of a post backlog candidate by ID, including core argument, format, themes, source documents and editorial notes.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Backlog item ID (numeric string)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_editorial',
    description: 'Search across the editorial state by keyword. Returns matching items with IDs for follow-up get_ calls. Use this when you need to find entries related to a topic but do not know the exact IDs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        section: {
          type: 'string',
          enum: ['analysis', 'themes', 'backlog', 'all'],
          description: 'Section to search. Default: all',
        },
      },
      required: ['query'],
    },
  },
]

// ── Tool executor ───────────────────────────────────────

/**
 * Execute a tool call against the editorial state.
 * All tools are read-only — no state mutation.
 *
 * @param {string} name — tool name
 * @param {object} input — tool input from the model
 * @param {object} state — editorial state (analysisIndex, themeRegistry, postBacklog)
 * @returns {string} — text result for the model
 */
export function executeTool(name, input, state) {
  try {
    switch (name) {
      case 'get_analysis_entry': return execGetEntry(input, state)
      case 'get_theme_detail':   return execGetTheme(input, state)
      case 'get_backlog_item':   return execGetBacklog(input, state)
      case 'search_editorial':   return execSearch(input, state)
      default: return `Unknown tool: ${name}`
    }
  } catch (err) {
    return `Tool error: ${err.message}`
  }
}

// ── Individual executors ────────────────────────────────

function execGetEntry(input, state) {
  const id = String(input.id)
  const entry = (state.analysisIndex || {})[id]
  if (!entry) return `No analysis entry found with ID #${id}.`

  const sections = [formatAnalysisEntry(id, entry)]

  // Attempt to load source transcript
  if (entry.filename) {
    const content = safeReadFile(TRANSCRIPT_DIR, entry.filename)
    if (content) {
      const capped = capTokens(content, 12_000)
      sections.push(`\n## Source Transcript: ${entry.filename}\n\n${capped}`)
    }
  } else {
    // Fallback: scan by source + date
    const path = findTranscriptByMeta(entry.source, entry.date)
    if (path) {
      try {
        const content = readFileSync(path, 'utf-8')
        const capped = capTokens(content, 12_000)
        sections.push(`\n## Source Transcript (matched by source/date)\n\n${capped}`)
      } catch { /* skip */ }
    }
  }

  return sections.join('\n')
}

function execGetTheme(input, state) {
  const code = String(input.code).toUpperCase()
  const theme = (state.themeRegistry || {})[code]
  if (!theme) return `No theme found with code ${code}.`

  const lines = [`## ${code}: ${theme.name}`]
  lines.push(`Documents: ${theme.documentCount} · Created: ${theme.created || 'N/A'} · Last updated: ${theme.lastUpdated || 'N/A'}`)

  // Full evidence chain (not truncated to 2 like the summary formatter)
  const evidence = theme.evidence || []
  if (evidence.length > 0) {
    lines.push(`\n### Evidence (${evidence.length} entries)\n`)
    for (const ev of evidence) {
      lines.push(`- **Session ${ev.session}** · ${ev.source}`)
      if (ev.content) lines.push(`  ${ev.content}`)
      if (ev.url) lines.push(`  URL: ${ev.url}`)
    }
  }

  // Cross-connections
  if (theme.crossConnections?.length) {
    lines.push(`\n### Cross-Connections\n`)
    for (const c of theme.crossConnections) {
      lines.push(`- **${c.theme}**: ${c.reasoning || '(no reasoning)'}`)
    }
  }

  return capTokens(lines.join('\n'), 8_000)
}

function execGetBacklog(input, state) {
  const id = String(input.id)
  const post = (state.postBacklog || {})[id]
  if (!post) return `No backlog item found with ID #${id}.`
  return formatPost(id, post)
}

function execSearch(input, state) {
  const query = (input.query || '').toLowerCase().trim()
  if (!query) return 'Search query is required.'
  const section = input.section || 'all'
  const results = []
  const MAX = 20

  // Search analysis
  if ((section === 'all' || section === 'analysis') && results.length < MAX) {
    for (const [id, entry] of Object.entries(state.analysisIndex || {})) {
      if (results.length >= MAX) break
      const haystack = [entry.title, entry.source, entry.host, entry.summary, entry.keyThemes, ...(entry.themes || [])]
        .filter(Boolean).join(' ').toLowerCase()
      if (haystack.includes(query)) {
        results.push(`[analysis #${id}] ${entry.title} (${entry.source}, T${entry.tier}) — ${entry.postPotential || '?'} potential`)
      }
    }
  }

  // Search themes
  if ((section === 'all' || section === 'themes') && results.length < MAX) {
    for (const [code, theme] of Object.entries(state.themeRegistry || {})) {
      if (results.length >= MAX) break
      const haystack = [theme.name, ...(theme.evidence || []).map(e => e.content || '')]
        .join(' ').toLowerCase()
      if (haystack.includes(query)) {
        results.push(`[theme ${code}] ${theme.name} (${theme.documentCount} docs)`)
      }
    }
  }

  // Search backlog
  if ((section === 'all' || section === 'backlog') && results.length < MAX) {
    for (const [id, post] of Object.entries(state.postBacklog || {})) {
      if (results.length >= MAX) break
      const haystack = [post.title, post.workingTitle, post.coreArgument, post.notes, ...(post.themes || [])]
        .filter(Boolean).join(' ').toLowerCase()
      if (haystack.includes(query)) {
        results.push(`[backlog #${id}] ${post.title} [${post.status}] (${post.format || '?'})`)
      }
    }
  }

  if (results.length === 0) return `No results found for "${input.query}" in ${section}.`
  return `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${input.query}":\n\n${results.join('\n')}`
}

// ── Helpers ─────────────────────────────────────────────

function capTokens(text, maxTokens) {
  const est = estimateTokens(text)
  if (est <= maxTokens) return text
  // Rough char-based truncation (4 chars ≈ 1 token)
  const maxChars = maxTokens * 4
  return text.slice(0, maxChars) + '\n\n[TRUNCATED — exceeds token budget]'
}
