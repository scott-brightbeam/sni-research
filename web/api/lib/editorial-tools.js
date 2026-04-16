/**
 * editorial-tools.js — Tool schemas and executors for editorial chat.
 *
 * Defines eight read-only tools that let the AI model fetch detailed editorial
 * data on demand: analysis entries (with transcripts), theme evidence chains,
 * backlog items, keyword search, articles, and podcasts.
 *
 * All data is sourced from the Turso DB via editorial-queries.js.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { estimateTokens } from './context.js'
import {
  safeReadFile, findTranscriptByMeta,
  formatAnalysisEntry, formatTheme, formatPost,
} from './editorial-chat.js'
import * as eq from './editorial-queries.js'
import { getDb } from './db.js'

const TRANSCRIPT_DIR = process.env.HOME
  ? join(process.env.HOME, 'Desktop/Podcast Transcripts')
  : null

// ── Tool schemas (Anthropic format) ─────────────────────

export const EDITORIAL_TOOLS = [
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
  {
    name: 'search_articles',
    description: 'Search the article corpus by keyword. Optional filters by sector, date range, and source type. Returns up to 20 articles with id, title, url, sector, date and snippet.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        sector: { type: 'string', description: 'Filter by sector (e.g. "general-ai", "biopharma")' },
        dateFrom: { type: 'string', description: 'Earliest date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'Latest date (YYYY-MM-DD)' },
        sourceType: { type: 'string', description: 'Filter by source type (e.g. "rss", "brave", "ainewshub")' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_article',
    description: 'Fetch full detail of an article by ID, including full text (capped at 8k tokens).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Article ID (numeric string)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_podcasts',
    description: 'Search podcast episodes by keyword, matching episode titles, summaries and story headlines. Returns up to 20 episodes with story counts.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keyword or phrase' },
        source: { type: 'string', description: 'Filter by podcast source name' },
        dateFrom: { type: 'string', description: 'Earliest date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'Latest date (YYYY-MM-DD)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_podcast_episode',
    description: 'Fetch full detail of a podcast episode by ID, including summary, stories and transcript (capped at 12k tokens).',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Episode ID (numeric string)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_published_posts',
    description: 'Search Scott\'s published articles and newsletters — the ground-truth reference for voice, style and argument structure. Use these as examples when drafting. Returns excerpts; call get_published_post for full text.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword to search in titles and body text' },
        category: { type: 'string', enum: ['article', 'newsletter', 'series', 'awards'], description: 'Filter by category' },
        format: { type: 'string', enum: ['concept-contrast', 'news-decoder', 'behavioural-paradox', 'honest-confession', 'quiet-observation', 'practitioners-take'], description: 'Filter by LinkedIn format. Use this to find reference posts in the same format as the one you are about to draft.' },
      },
    },
  },
  {
    name: 'get_published_post',
    description: 'Fetch the full text of one of Scott\'s published posts by ID. Use this to study voice, structure, argument flow and the in-the-end-at-the-end pattern before drafting.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Published post ID (numeric string)' },
      },
      required: ['id'],
    },
  },
]

// Backward compat
export { EDITORIAL_TOOLS as DRAFT_TOOLS }

// ── Tool executor ───────────────────────────────────────

/**
 * Execute a tool call against the editorial DB.
 * All tools are read-only — no state mutation.
 *
 * @param {string} name — tool name
 * @param {object} input — tool input from the model
 * @param {import('@libsql/client').Client} db — Turso DB client
 * @returns {Promise<string>} — text result for the model
 */
export async function executeTool(name, input, db) {
  try {
    switch (name) {
      case 'get_analysis_entry': return await execGetEntry(input, db)
      case 'get_theme_detail':   return await execGetTheme(input, db)
      case 'get_backlog_item':   return await execGetBacklog(input, db)
      case 'search_editorial':   return await execSearch(input, db)
      case 'search_articles':    return await execSearchArticles(input, db)
      case 'get_article':        return await execGetArticle(input, db)
      case 'search_podcasts':    return await execSearchPodcasts(input, db)
      case 'get_podcast_episode': return await execGetPodcastEpisode(input, db)
      case 'search_published_posts': return await execSearchPublishedPosts(input, db)
      case 'get_published_post':     return await execGetPublishedPost(input, db)
      default: return `Unknown tool: ${name}`
    }
  } catch (err) {
    return `Tool error: ${err.message}`
  }
}

// ── Individual executors ────────────────────────────────

async function execGetEntry(input, db) {
  const id = Number(input.id)
  const row = await eq.getAnalysisEntry(db, id)
  if (!row) return `No analysis entry found with ID #${input.id}.`

  const sections = [formatDbEntry(row)]

  // Attempt to load transcript — DB column first (entry #299 has 89k chars)
  if (row.transcript) {
    const capped = capTokens(row.transcript, 12_000)
    sections.push(`\n## Source Transcript (from DB)\n\n${capped}`)
  } else if (row.filename) {
    // Fallback: filesystem
    const content = safeReadFile(TRANSCRIPT_DIR, row.filename)
    if (content) {
      const capped = capTokens(content, 12_000)
      sections.push(`\n## Source Transcript: ${row.filename}\n\n${capped}`)
    } else {
      sections.push('\n\n⚠ TRANSCRIPT NOT AVAILABLE — not in DB and file not found on disk')
    }
  } else {
    // Last resort: scan by source + date
    const path = findTranscriptByMeta(row.source, row.date)
    if (path) {
      try {
        const content = readFileSync(path, 'utf-8')
        const capped = capTokens(content, 12_000)
        sections.push(`\n## Source Transcript (matched by source/date)\n\n${capped}`)
      } catch {
        sections.push('\n\n⚠ TRANSCRIPT NOT AVAILABLE — file read error')
      }
    } else {
      sections.push('\n\n⚠ TRANSCRIPT NOT AVAILABLE — no filename and no source/date match')
    }
  }

  return sections.join('\n')
}

async function execGetTheme(input, db) {
  const code = String(input.code).toUpperCase()
  const data = await eq.getThemeWithEvidence(db, code)
  if (!data) return `No theme found with code ${code}.`

  const { theme, evidence, connections } = data
  const lines = [`## ${code}: ${theme.name}`]
  lines.push(`Documents: ${theme.document_count} · Created: ${theme.created_session || 'N/A'} · Last updated: ${theme.last_updated_session || 'N/A'}`)

  // Full evidence chain
  if (evidence.length > 0) {
    lines.push(`\n### Evidence (${evidence.length} entries)\n`)
    for (const ev of evidence) {
      lines.push(`- **Session ${ev.session}** · ${ev.source || 'unknown'}`)
      if (ev.content) lines.push(`  ${ev.content}`)
      if (ev.url) lines.push(`  URL: ${ev.url}`)
    }
  }

  // Cross-connections
  if (connections.length > 0) {
    lines.push(`\n### Cross-Connections\n`)
    for (const c of connections) {
      const other = c.from_code === code ? c.to_code : c.from_code
      lines.push(`- **${other}**: ${c.reasoning || '(no reasoning)'}`)
    }
  }

  return capTokens(lines.join('\n'), 8_000)
}

async function execGetBacklog(input, db) {
  const id = Number(input.id)
  const row = await eq.getPost(db, id)
  if (!row) return `No backlog item found with ID #${input.id}.`
  return formatDbPost(row)
}

async function execSearch(input, db) {
  const query = (input.query || '').trim()
  if (!query) return 'Search query is required.'

  const results = await eq.searchEditorial(db, query)
  if (results.length === 0) return `No results found for "${query}".`

  const lines = results.map(r => {
    switch (r.type) {
      case 'analysis': return `[analysis #${r.id}] ${r.title} (${r.source || '?'}) — matched: ${r.match}`
      case 'theme':    return `[theme ${r.id}] ${r.title} — matched: ${r.match}`
      case 'post':     return `[backlog #${r.id}] ${r.title} — matched: ${r.match}`
      default:         return `[${r.type} ${r.id}] ${r.title}`
    }
  })

  return `Found ${results.length} result${results.length !== 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n')}`
}

async function execSearchArticles(input, db) {
  const { query, sector, dateFrom, dateTo, sourceType } = input
  if (!query) return 'Search query is required.'

  const rows = await eq.searchArticles(db, { query, sector, dateFrom, dateTo, sourceType })
  if (rows.length === 0) return `No articles found for "${query}".`

  const lines = rows.map(a =>
    `- **#${a.id}**: ${a.title}\n  Source: ${a.source || '?'} · Sector: ${a.sector} · Date: ${a.date_published}\n  URL: ${a.url || 'N/A'}\n  ${(a.snippet || '').slice(0, 200)}`
  )

  return `Found ${rows.length} article${rows.length !== 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n\n')}`
}

async function execGetArticle(input, db) {
  const id = Number(input.id)
  const row = await eq.getArticle(db, id)
  if (!row) return `No article found with ID #${input.id}.`

  const lines = [
    `## #${row.id}: ${row.title}`,
    `Source: ${row.source || '?'} · Sector: ${row.sector} · Date: ${row.date_published}`,
    `URL: ${row.url || 'N/A'}`,
    `Source type: ${row.source_type} · Score: ${row.score ?? 'N/A'} · Confidence: ${row.confidence || 'N/A'}`,
  ]

  if (row.snippet) lines.push(`\n### Snippet\n\n${row.snippet}`)

  if (row.full_text) {
    const capped = capTokens(row.full_text, 8_000)
    lines.push(`\n### Full Text\n\n${capped}`)
  } else {
    lines.push('\n\n⚠ FULL TEXT NOT AVAILABLE')
  }

  return lines.join('\n')
}

async function execSearchPodcasts(input, db) {
  const { query, source, dateFrom, dateTo } = input
  if (!query) return 'Search query is required.'

  const rows = await eq.searchPodcasts(db, { query, source, dateFrom, dateTo })
  if (rows.length === 0) return `No podcast episodes found for "${query}".`

  const lines = rows.map(ep =>
    `- **#${ep.id}**: ${ep.title}\n  Source: ${ep.source} · Date: ${ep.date} · Stories: ${ep.story_count}`
  )

  return `Found ${rows.length} episode${rows.length !== 1 ? 's' : ''} for "${query}":\n\n${lines.join('\n\n')}`
}

async function execGetPodcastEpisode(input, db) {
  const id = Number(input.id)
  const data = await eq.getPodcastEpisode(db, id)
  if (!data) return `No podcast episode found with ID #${input.id}.`

  const { episode, stories, transcript } = data
  const lines = [
    `## #${episode.id}: ${episode.title}`,
    `Source: ${episode.source} · Date: ${episode.date} · Duration: ${episode.duration ? `${episode.duration}m` : 'N/A'}`,
    `URL: ${episode.episode_url || 'N/A'} · Tier: ${episode.tier}`,
  ]

  if (episode.summary) {
    lines.push(`\n### Summary\n\n${episode.summary}`)
  }

  if (stories.length > 0) {
    lines.push(`\n### Stories (${stories.length})\n`)
    for (const s of stories) {
      lines.push(`- **${s.headline}** (${s.sector || 'general-ai'})`)
      if (s.detail) lines.push(`  ${s.detail}`)
      if (s.url) lines.push(`  URL: ${s.url}`)
    }
  }

  if (transcript) {
    const capped = capTokens(transcript, 12_000)
    lines.push(`\n### Transcript\n\n${capped}`)
  } else {
    // Fallback: try filesystem via episode filename
    let loaded = false
    if (episode.filename) {
      const content = safeReadFile(TRANSCRIPT_DIR, episode.filename)
      if (content) {
        const capped = capTokens(content, 12_000)
        lines.push(`\n### Transcript (from filesystem)\n\n${capped}`)
        loaded = true
      }
    }
    if (!loaded) {
      lines.push('\n\n⚠ TRANSCRIPT NOT AVAILABLE')
    }
  }

  return lines.join('\n')
}

// ── DB row formatters ─────────────────────────────────────

/**
 * Format a DB analysis_entries row for model consumption.
 * DB uses snake_case columns; output uses human-readable labels.
 */
function formatDbEntry(row) {
  const lines = [`### #${row.id}: ${row.title}`]
  lines.push(`Source: ${row.source || '?'} · Host: ${row.host || 'N/A'} · Tier: ${row.tier} · Session: ${row.session}`)
  if (row.date) lines.push(`Date: ${row.date}`)

  // themes is a JSON string column
  let themes = []
  if (row.themes) {
    try { themes = JSON.parse(row.themes) } catch { themes = [row.themes] }
  }
  if (themes.length) lines.push(`Themes: ${themes.join(', ')}`)

  if (row.post_potential) lines.push(`Post potential: ${row.post_potential}`)
  if (row.post_potential_reasoning) lines.push(`Reasoning: ${row.post_potential_reasoning}`)
  if (row.key_themes) lines.push(`Key themes: ${row.key_themes}`)
  if (row.summary) lines.push(`\n${row.summary}`)
  if (row.url) lines.push(`URL: ${row.url}`)
  if (row.filename) lines.push(`Filename: ${row.filename}`)
  lines.push('')
  return lines.join('\n')
}

/**
 * Format a DB posts row for model consumption.
 */
function formatDbPost(row) {
  const lines = [`### #${row.id}: ${row.title || row.working_title || '(untitled)'}`]
  lines.push(`Status: ${row.status} · Priority: ${row.priority || 'N/A'} · Format: ${row.format || 'N/A'}`)
  if (row.date_added) lines.push(`Date added: ${row.date_added}`)
  if (row.session) lines.push(`Session: ${row.session}`)
  if (row.core_argument) lines.push(`Core argument: ${row.core_argument}`)

  // source_documents is a JSON string column
  let docs = []
  if (row.source_documents) {
    try { docs = JSON.parse(row.source_documents) } catch { docs = [row.source_documents] }
  }
  if (docs.length) lines.push(`Sources: ${docs.join(', ')}`)

  // source_urls is a JSON string column
  let urls = []
  if (row.source_urls) {
    try { urls = JSON.parse(row.source_urls) } catch { urls = [row.source_urls] }
  }
  if (urls.length) lines.push(`Source URLs: ${urls.join(', ')}`)

  if (row.freshness) lines.push(`Freshness: ${row.freshness}`)
  if (row.notes) lines.push(`Notes: ${row.notes}`)
  lines.push('')
  return lines.join('\n')
}

// ── Helpers ─────────────────────────────────────────────

function capTokens(text, maxTokens) {
  const est = estimateTokens(text)
  if (est <= maxTokens) return text
  // Rough char-based truncation (4 chars ≈ 1 token)
  const maxChars = maxTokens * 4
  return text.slice(0, maxChars) + '\n\n[TRUNCATED — exceeds token budget]'
}

// ── Published Posts ──────────────────────────────────────

async function execSearchPublishedPosts(input, db) {
  const rows = await eq.searchPublishedPosts(db, {
    query: input.query || undefined,
    category: input.category || undefined,
    format: input.format || undefined,
  })
  if (rows.length === 0) return 'No published posts found matching that query.'

  const lines = [`## Published Posts (${rows.length} matches)\n`]
  for (const r of rows) {
    lines.push(`### #${r.id}: ${r.title}`)
    lines.push(`Category: ${r.category} · Format: ${r.format || 'unclassified'} · Date: ${r.date_published || 'N/A'} · ${r.word_count || '?'} words`)
    lines.push(`${r.excerpt}…\n`)
  }
  lines.push('\n_Use get_published_post(id) to read the full text of any post above._')
  return lines.join('\n')
}

async function execGetPublishedPost(input, db) {
  const id = Number(input.id)
  const post = await eq.getPublishedPost(db, id)
  if (!post) return `No published post found with ID #${id}.`

  const meta = [
    `Category: ${post.category}`,
    post.format ? `Format: ${post.format}` : null,
    `Published: ${post.date_published || 'N/A'}`,
    `${post.word_count || '?'} words`,
  ].filter(Boolean).join(' · ')

  const sections = [`## ${post.title}\n\n${meta}\nURL: ${post.url || 'N/A'}`]

  if (post.argument_structure) {
    try {
      const structure = JSON.parse(post.argument_structure)
      sections.push(`\n### Argument Structure\n${structure.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)
    } catch { /* skip malformed */ }
  }

  sections.push(`\n---\n\n${post.body}`)

  if (post.iteate) {
    sections.push(`\n### In-the-end-at-the-end (extracted)\n${post.iteate}`)
  }

  return sections.join('\n')
}
