import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'
import { getWeekDateRange } from './week.js'

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

export function loadArticlesForWeek(week, year) {
  const { start, end } = getWeekDateRange(week, year)
  const startDate = new Date(start)
  const endDate = new Date(end)
  const articles = []
  const verifiedDir = join(ROOT, 'data/verified')

  if (!existsSync(verifiedDir)) return articles

  for (const dateDir of readdirSync(verifiedDir).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
    const d = new Date(dateDir)
    if (d < startDate || d > endDate) continue

    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue

    for (const sector of readdirSync(datePath)) {
      const sectorPath = join(datePath, sector)
      if (!statSync(sectorPath).isDirectory()) continue

      for (const f of readdirSync(sectorPath).filter(f => f.endsWith('.json'))) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          articles.push({
            title: raw.title || basename(f, '.json'),
            source: raw.source || 'Unknown',
            sector,
            date_published: raw.date_published || dateDir,
            snippet: raw.snippet || '',
            score: raw.score || 0,
            slug: basename(f, '.json'),
            date: dateDir,
          })
        } catch { /* skip malformed */ }
      }
    }
  }

  return articles
}

export function loadArticleFullText(date, sector, slug) {
  const mdPath = join(ROOT, 'data/verified', date, sector, `${slug}.md`)
  const jsonPath = join(ROOT, 'data/verified', date, sector, `${slug}.json`)

  let text = ''
  if (existsSync(mdPath)) {
    text = readFileSync(mdPath, 'utf-8')
  } else if (existsSync(jsonPath)) {
    try {
      const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'))
      text = raw.full_text || raw.snippet || ''
    } catch { /* skip */ }
  }
  return text
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

export function assembleContext({ week, year, threadHistory, articleRef, ephemeral, draftContext, publishedExemplar }) {
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
    const articles = loadArticlesForWeek(week, year)
    contextBlock = buildArticleContext(articles, 30)
  }

  // 3. Article injection
  let injectedArticle = ''
  if (articleRef) {
    const fullText = loadArticleFullText(articleRef.date, articleRef.sector, articleRef.slug)
    if (fullText) {
      injectedArticle = `\n## Full Article: ${articleRef.slug}\n\n${fullText.slice(0, 8000)}\n`
    }
  }

  // 4. Pins
  const pins = loadPins(week)
  const pinBlock = buildPinContext(pins)

  // 5. Published exemplar (for /compare-draft command)
  let exemplarBlock = ''
  if (publishedExemplar) {
    exemplarBlock = `\n## Published Exemplar\n\n<published_exemplar>\n${publishedExemplar}\n</published_exemplar>\n\nCompare the current draft against this published exemplar. Analyse structure, tone, section balance and coverage gaps.\n`
  }

  // 6. Assemble the user-context preamble
  const preamble = [contextBlock, injectedArticle, pinBlock, exemplarBlock].filter(Boolean).join('\n')
  used += estimateTokens(preamble)

  // 7. Trim thread history to fit remaining budget
  const historyBudget = TOKEN_BUDGET - used
  const trimmedHistory = trimHistory(threadHistory || [], Math.max(historyBudget, 2000))

  return { systemPrompt, preamble, trimmedHistory }
}
