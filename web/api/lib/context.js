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

You have access to this week's article corpus, podcast episode digests, and any pinned editorial notes. When a full podcast transcript is injected, use it for detailed references and quotes.`

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

  for (const dir of ['data/verified', 'data/podcast-articles']) {
    const baseDir = join(ROOT, dir)
    if (!existsSync(baseDir)) continue
    const isPodcast = dir === 'data/podcast-articles'

    for (const dateDir of readdirSync(baseDir).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
      const d = new Date(dateDir)
      if (d < startDate || d > endDate) continue

      const datePath = join(baseDir, dateDir)
      if (!statSync(datePath).isDirectory()) continue

      for (const sector of readdirSync(datePath)) {
        const sectorPath = join(datePath, sector)
        if (!statSync(sectorPath).isDirectory()) continue

        for (const f of readdirSync(sectorPath).filter(f => f.endsWith('.json'))) {
          try {
            const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
            const article = {
              title: raw.title || basename(f, '.json'),
              source: raw.source || 'Unknown',
              sector,
              date_published: raw.date_published || dateDir,
              snippet: raw.snippet || '',
              score: raw.score || 0,
              slug: basename(f, '.json'),
              date: dateDir,
            }
            if (isPodcast || (raw.found_by && raw.found_by.includes('podcast-extract'))) {
              article.source_type = 'podcast-extract'
            }
            articles.push(article)
          } catch { /* skip malformed */ }
        }
      }
    }
  }

  return articles
}

export function buildPodcastContext(week, year) {
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
  if (!existsSync(manifestPath)) return { text: '', tokenCount: 0 }

  let manifest = {}
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) } catch { return { text: '', tokenCount: 0 } }

  const episodes = Object.values(manifest).filter(e => e.week === week)
  if (episodes.length === 0) return { text: '', tokenCount: 0 }

  const lines = [`\n## Podcast Digests (${episodes.length} episodes)\n`]

  for (const ep of episodes) {
    const digestPath = join(ROOT, ep.digestPath)
    let digest = null
    try { digest = JSON.parse(readFileSync(digestPath, 'utf-8')) } catch { continue }

    lines.push(`### ${ep.title} (${ep.source}, ${ep.date})`)
    if (digest.summary) lines.push(digest.summary)
    if (digest.key_stories?.length) {
      lines.push('Key stories:')
      for (const s of digest.key_stories) {
        lines.push(`- ${s.headline} [${s.sector}]`)
      }
    }
    if (digest.notable_quotes?.length) {
      lines.push('Quotes:')
      for (const q of digest.notable_quotes.slice(0, 2)) {
        lines.push(`- "${q.quote}" — ${q.speaker}`)
      }
    }
    lines.push('')
  }

  const text = lines.join('\n')
  return { text, tokenCount: estimateTokens(text) }
}

export function loadPodcastFullText(date, podcastSlug, titleSlug) {
  const path = join(ROOT, 'data/podcasts', date, podcastSlug, `${titleSlug}.md`)
  if (!existsSync(path)) return ''
  const text = readFileSync(path, 'utf-8')
  return text.slice(0, 16000)
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

export function assembleContext({ week, year, threadHistory, articleRef, podcastRef, ephemeral, draftContext, publishedExemplar }) {
  const TOKEN_BUDGET = 64000  // leave headroom for response
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

  // 3. Podcast digests
  let podcastBlock = ''
  if (!ephemeral) {
    const { text } = buildPodcastContext(week, year)
    podcastBlock = text
  }

  // 4. Article injection
  let injectedArticle = ''
  if (articleRef) {
    const fullText = loadArticleFullText(articleRef.date, articleRef.sector, articleRef.slug)
    if (fullText) {
      injectedArticle = `\n## Full Article: ${articleRef.slug}\n\n${fullText.slice(0, 8000)}\n`
    }
  }

  // 5. Podcast transcript injection
  let injectedPodcast = ''
  if (podcastRef) {
    const transcript = loadPodcastFullText(podcastRef.date, podcastRef.source, podcastRef.title)
    if (transcript) {
      injectedPodcast = `\n## Full Podcast Transcript: ${podcastRef.title}\n\n${transcript}\n`
    }
  }

  // 6. Pins
  const pins = loadPins(week)
  const pinBlock = buildPinContext(pins)

  // 7. Published exemplar (for /compare-draft command)
  let exemplarBlock = ''
  if (publishedExemplar) {
    exemplarBlock = `\n## Published Exemplar\n\n<published_exemplar>\n${publishedExemplar}\n</published_exemplar>\n\nCompare the current draft against this published exemplar. Analyse structure, tone, section balance and coverage gaps.\n`
  }

  // 8. Assemble with priority-based truncation
  // Priority (truncate first → last): thread history, podcast digests, article context
  const preambleParts = [contextBlock, podcastBlock, injectedArticle, injectedPodcast, pinBlock, exemplarBlock].filter(Boolean)
  let preamble = preambleParts.join('\n')
  used += estimateTokens(preamble)

  // If over budget, truncate podcast digests first, then trim preamble
  if (used > TOKEN_BUDGET * 0.85) {
    // Trim podcast block
    const podcastTokens = estimateTokens(podcastBlock)
    if (podcastTokens > 5000) {
      podcastBlock = podcastBlock.slice(0, 20000) // ~5000 tokens
      preamble = [contextBlock, podcastBlock, injectedArticle, injectedPodcast, pinBlock, exemplarBlock].filter(Boolean).join('\n')
      used = estimateTokens(systemPrompt) + estimateTokens(preamble)
    }
  }

  // 9. Trim thread history to fit remaining budget
  const historyBudget = TOKEN_BUDGET - used
  const trimmedHistory = trimHistory(threadHistory || [], Math.max(historyBudget, 2000))

  return { systemPrompt, preamble, trimmedHistory }
}
