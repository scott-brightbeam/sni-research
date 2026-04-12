import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { getWeekDateRange } from './week.js'
import { getDb } from './db.js'
import { getArticles, getArticle as getArticleByKey } from './article-queries.js'
// Available for buildPodcastContext / buildEditorialContext when those functions are added:
// import { getEpisodes } from './podcast-queries.js'
// import * as eq from './editorial-queries.js'

const ROOT = resolve(import.meta.dir, '../../..')

const COPILOT_SYSTEM = `You are an editorial analyst for Sector News Intelligence (SNI), a weekly newsletter covering AI news across five sectors: general AI, biopharma, medtech, manufacturing, and insurance.

Your role is to help the editor identify themes, compare stories, spot cross-sector connections, and draft paragraphs for the newsletter.

Style guidelines:
- UK English (single quotes, spaced en dashes, no Oxford commas)
- Analytical but accessible tone
- Always cite specific articles from the context when making claims
- Flag when you are speculating vs summarising reported facts

You have access to this week's article corpus and any pinned editorial notes.`

const DRAFT_SYSTEM = `You are an editorial assistant helping refine a newsletter draft for Sector News Intelligence (SNI).

You can see the current draft markdown. Help with:
- Rewriting paragraphs for clarity or tone
- Checking factual consistency with the source articles
- Suggesting structural improvements
- UK English conventions (single quotes, spaced en dashes, no Oxford commas)

Be concise. Return edited text that can be copied directly into the draft.`

export function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

export function buildArticleContext(articles, topN = 30) {
  if (!articles || articles.length === 0) return '(No articles available this week.)'

  // Sort by score descending
  const sorted = [...articles].sort((a, b) => (b.score || 0) - (a.score || 0))

  const lines = [`## This Week's Articles (${articles.length} total)\n`]

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    if (i < topN) {
      // Full detail
      lines.push(`### ${a.title}`)
      lines.push(`- Source: ${a.source} | Sector: ${a.sector} | Date: ${a.date_published}`)
      if (a.snippet) lines.push(`- ${a.snippet.slice(0, 500)}`)
      lines.push('')
    } else {
      // Title only
      lines.push(`- ${a.title} (${a.sector}, ${a.source})`)
    }
  }

  return lines.join('\n')
}

export function trimHistory(messages, tokenBudget) {
  if (!messages || messages.length === 0) return []

  // Always keep at least the last message
  let total = 0
  const kept = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i].content)
    if (kept.length > 0 && total + tokens > tokenBudget) break
    kept.unshift(messages[i])
    total += tokens
  }

  return kept
}

export async function loadArticlesForWeek(week, year) {
  const { start, end } = getWeekDateRange(week, year)
  const { articles } = await getArticles(getDb(), { dateFrom: start, dateTo: end, limit: 200 })
  return articles
}

export async function loadArticleFullText(date, sector, slug) {
  const article = await getArticleByKey(getDb(), date, sector, slug)
  return article?.full_text ?? article?.snippet ?? ''
}

export function loadPins(week) {
  const pinsFile = join(ROOT, `data/copilot/pins/week-${week}/pins.json`)
  if (!existsSync(pinsFile)) return []
  try {
    return JSON.parse(readFileSync(pinsFile, 'utf-8'))
  } catch { return [] }
}

export function buildPinContext(pins) {
  if (!pins || pins.length === 0) return ''
  const lines = ['\n## Pinned Editorial Notes\n']
  for (const pin of pins) {
    lines.push(`- ${pin.preview}`)
  }
  return lines.join('\n')
}

export async function assembleContext({ week, year, threadHistory, articleRef, ephemeral, draftContext }) {
  const TOKEN_BUDGET = 28000  // leave 2k for response
  let used = 0

  // 1. System prompt
  const systemPrompt = ephemeral ? DRAFT_SYSTEM : COPILOT_SYSTEM
  used += estimateTokens(systemPrompt)

  // 2. Draft context (ephemeral only) or article context
  let contextBlock = ''
  if (ephemeral && draftContext) {
    contextBlock = `## Current Draft\n\n${draftContext}`
  } else {
    const articles = await loadArticlesForWeek(week, year)
    contextBlock = buildArticleContext(articles, 30)
  }

  // 3. Article injection
  let injectedArticle = ''
  if (articleRef) {
    const fullText = await loadArticleFullText(articleRef.date, articleRef.sector, articleRef.slug)
    if (fullText) {
      injectedArticle = `\n## Full Article: ${articleRef.slug}\n\n${fullText.slice(0, 8000)}\n`
    }
  }

  // 4. Pins
  const pins = loadPins(week)
  const pinBlock = buildPinContext(pins)

  // 5. Assemble the user-context preamble
  const preamble = [contextBlock, injectedArticle, pinBlock].filter(Boolean).join('\n')
  used += estimateTokens(preamble)

  // 6. Trim thread history to fit remaining budget
  const historyBudget = TOKEN_BUDGET - used
  const trimmedHistory = trimHistory(threadHistory || [], Math.max(historyBudget, 2000))

  return { systemPrompt, preamble, trimmedHistory }
}
