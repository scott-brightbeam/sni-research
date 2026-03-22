#!/usr/bin/env bun
/**
 * editorial-discover.js — DISCOVER stage of the editorial intelligence pipeline
 *
 * Reads story references from a previous ANALYSE session, searches for original
 * articles via Gemini with Google Search grounding, fetches and extracts content,
 * deduplicates against the existing corpus, and saves discovered articles to
 * data/verified/{date}/general/ as Tier 1 editorial content.
 *
 * Usage:
 *   bun scripts/editorial-discover.js --session 16       # Process stories from session 16
 *   bun scripts/editorial-discover.js --latest            # Process most recent session
 *   bun scripts/editorial-discover.js --dry-run           # Show what would be processed
 *   bun scripts/editorial-discover.js --limit N           # Process at most N stories
 *
 * Reads:  data/editorial/stories-session-N.json, data/verified/
 * Writes: data/verified/{date}/general/, data/editorial/discover-progress-session-N.json,
 *         data/editorial/cost-log.json, data/editorial/activity.json
 *
 * Does NOT import from any existing pipeline module in scripts/ except
 * shared utilities (retry.js, env.js, multi-model.js, extract.js, dedup.js).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, resolve, basename } from 'path'
import * as cheerio from 'cheerio'
import yaml from 'js-yaml'
import { callGeminiWithSearch } from './lib/multi-model.js'
import { fetchPage, extractArticleText, saveArticle, isPaywalled } from './lib/extract.js'
import { logActivity } from './lib/editorial-state.js'
import { getSessionCosts, resetSessionCosts, validateProviders } from './lib/editorial-multi-model.js'
import {
  loadStoryReferences,
  buildSearchQuery,
  buildArticleFromStoryRef,
  parseSearchResponse,
  isStoryAlreadyDiscovered,
  createProgressTracker,
  classifyFetchResult,
  normaliseUrl,
} from './lib/editorial-discover-lib.js'

const ROOT = resolve(import.meta.dir, '..')

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [discover]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [discover] \u26a0`, ...a)
const err  = (...a) => console.error(`[${ts()}] [discover] \u2717`, ...a)

// ── CLI argument parsing ────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    session: null,
    latest: false,
    dryRun: false,
    limit: null,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--session': {
        if (i + 1 >= args.length) { err('--session requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 0) { err(`Invalid --session value: ${args[i]}`); process.exit(1) }
        opts.session = n
        break
      }
      case '--latest':
        opts.latest = true
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--limit': {
        if (i + 1 >= args.length) { err('--limit requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 1) { err(`Invalid --limit value: ${args[i]}`); process.exit(1) }
        opts.limit = n
        break
      }
      default:
        warn(`Unknown argument: ${args[i]}`)
    }
  }

  if (!opts.session && !opts.latest) {
    err('Specify --session N or --latest')
    process.exit(1)
  }

  return opts
}

// ── Find session file ───────────────────────────────────

function findSessionFile(opts) {
  const editorialDir = join(ROOT, 'data/editorial')

  if (opts.session != null) {
    const path = join(editorialDir, `stories-session-${opts.session}.json`)
    if (!existsSync(path)) {
      err(`Session file not found: stories-session-${opts.session}.json`)
      process.exit(1)
    }
    return { path, sessionNum: opts.session }
  }

  // Find latest session file
  if (!existsSync(editorialDir)) {
    err('No editorial data directory found')
    process.exit(1)
  }

  const files = readdirSync(editorialDir)
    .filter(f => /^stories-session-\d+\.json$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)[0], 10)
      const numB = parseInt(b.match(/\d+/)[0], 10)
      return numA - numB
    })

  if (files.length === 0) {
    err('No story reference files found. Run editorial-analyse.js first.')
    process.exit(1)
  }

  const latest = files[files.length - 1]
  const sessionNum = parseInt(latest.match(/\d+/)[0], 10)
  return { path: join(editorialDir, latest), sessionNum }
}

// ── Load existing corpus for dedup ──────────────────────

function loadCorpusArticles(dateRange = null) {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return []

  const articles = []
  let skippedFiles = 0
  const dateDirs = readdirSync(verifiedDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))

  // Filter to recent dates if range specified, otherwise last 30 days
  const cutoff = dateRange?.start ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const dateDir of dateDirs) {
    if (dateDir < cutoff) continue

    const datePath = join(verifiedDir, dateDir)
    const sectorDirs = readdirSync(datePath, { withFileTypes: true })
      .filter(d => d.isDirectory())

    for (const sectorDir of sectorDirs) {
      const sectorPath = join(datePath, sectorDir.name)
      const jsonFiles = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const file of jsonFiles) {
        try {
          const article = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          articles.push(article)
        } catch (e) {
          skippedFiles++
          warn(`Failed to read corpus file ${dateDir}/${sectorDir.name}/${file}: ${e.message}`)
        }
      }
    }
  }

  if (skippedFiles > 0) {
    warn(`Skipped ${skippedFiles} unreadable corpus files — dedup may be incomplete`)
  }

  return articles
}

// ── Config loading ──────────────────────────────────────

const DISCOVERY_DEFAULTS = {
  maxStoriesPerEpisode: 15,
  searchTimeoutMs: 30000,
  scrapeTimeoutMs: 30000,
  maxConcurrentFetches: 3,
  skipPaywalled: true,
  fallbackToSnippet: true,
  fetchDelayMs: 2000,
  searchDelayMs: 1000,
  budget: { weekly_cap_usd: 50 },
}

function loadDiscoveryConfig() {
  const configPath = join(ROOT, 'config/editorial-sources.yaml')
  if (!existsSync(configPath)) {
    warn(`Config not found: ${configPath} — using built-in defaults`)
    return { ...DISCOVERY_DEFAULTS }
  }

  try {
    const config = yaml.load(readFileSync(configPath, 'utf-8'))
    log(`Config loaded from ${basename(configPath)}`)
    return {
      maxStoriesPerEpisode: config.discovery?.max_stories_per_episode ?? DISCOVERY_DEFAULTS.maxStoriesPerEpisode,
      searchTimeoutMs: config.discovery?.search_timeout_ms ?? DISCOVERY_DEFAULTS.searchTimeoutMs,
      scrapeTimeoutMs: config.discovery?.scrape_timeout_ms ?? DISCOVERY_DEFAULTS.scrapeTimeoutMs,
      maxConcurrentFetches: config.discovery?.max_concurrent_fetches ?? DISCOVERY_DEFAULTS.maxConcurrentFetches,
      skipPaywalled: config.discovery?.skip_paywalled ?? DISCOVERY_DEFAULTS.skipPaywalled,
      fallbackToSnippet: config.discovery?.fallback_to_snippet ?? DISCOVERY_DEFAULTS.fallbackToSnippet,
      fetchDelayMs: DISCOVERY_DEFAULTS.fetchDelayMs,
      searchDelayMs: DISCOVERY_DEFAULTS.searchDelayMs,
      budget: config.budget || DISCOVERY_DEFAULTS.budget,
    }
  } catch (e) {
    warn(`Failed to load discovery config: ${e.message} — using defaults`)
    return { ...DISCOVERY_DEFAULTS }
  }
}

// ── Search for a story ──────────────────────────────────

const SEARCH_PROMPT_TEMPLATE = `You are a research assistant finding the original news article for a story referenced in a podcast.

Find the original article URL for this story:

**Headline:** {headline}
**Context:** {context}
**Approximate date:** {date}
**Entities mentioned:** {entities}

Search the web and return JSON with the most relevant article URLs:

\`\`\`json
{
  "articles": [
    { "url": "https://...", "title": "Article title", "relevance": "high|medium|low" }
  ]
}
\`\`\`

Return the top 3-5 most relevant results. Prefer credible news sources (Reuters, Bloomberg, TechCrunch, Ars Technica, The Verge, FT, WSJ) over blogs or aggregators. The article should be the PRIMARY source, not a recap.`

async function searchForStory(ref, config) {
  const query = buildSearchQuery(ref)
  const prompt = SEARCH_PROMPT_TEMPLATE
    .replace('{headline}', ref.headline)
    .replace('{context}', ref.context || 'No additional context')
    .replace('{date}', ref.approximateDate || 'Unknown')
    .replace('{entities}', (ref.entities || []).join(', ') || 'None')

  log(`  Searching: "${query.slice(0, 80)}${query.length > 80 ? '...' : ''}"`)

  const response = await callGeminiWithSearch(prompt, {
    system: 'You are a research assistant. Find the original news article. Return structured JSON with URLs.',
    maxTokens: 2000,
  })

  return parseSearchResponse(response)
}

// ── Fetch and extract article ───────────────────────────

async function fetchAndExtract(url, config) {
  // Check paywall domain list
  if (isPaywalled(url)) {
    return { status: 'paywall', error: 'Domain is on paywall list', article: null }
  }

  const fetchResult = await fetchPage(url, config.scrapeTimeoutMs)
  const classification = classifyFetchResult(fetchResult)

  if (classification.status !== 'success') {
    return { status: classification.status, error: classification.error, article: null }
  }

  // Extract article text using Cheerio
  const $ = cheerio.load(fetchResult.html)
  const fullText = extractArticleText($)

  if (fullText.length < 300) {
    return { status: 'paywall', error: 'Extracted text too short — likely paywalled', article: null }
  }

  // Extract title from page
  const title = $('meta[property="og:title"]').attr('content')
    || $('title').text()
    || null

  // Extract date from page
  const datePublished = $('meta[property="article:published_time"]').attr('content')?.slice(0, 10)
    || $('meta[name="date"]').attr('content')?.slice(0, 10)
    || $('meta[property="og:published_time"]').attr('content')?.slice(0, 10)
    || null

  const dateMethod = datePublished ? 'meta-og' : 'none'

  return {
    status: 'success',
    error: null,
    article: {
      url,
      title,
      fullText,
      datePublished,
      dateMethod,
      dateConfidence: datePublished ? 'high' : 'none',
      rawHtml: fetchResult.html.slice(0, 500000), // Cap raw HTML at 500KB
    },
  }
}

// ── Process a single story reference ────────────────────

async function processStory(ref, corpus, tracker, config) {
  const headline = ref.headline
  log(`  Story: "${headline.slice(0, 70)}${headline.length > 70 ? '...' : ''}"`)

  // Skip if already processed (crash recovery)
  if (tracker.isProcessed(headline)) {
    log(`    Already processed — skipping`)
    return
  }

  // Step 1: Check if story already in corpus (dedup)
  const dedup = isStoryAlreadyDiscovered(ref, corpus)
  if (dedup.matched) {
    log(`    Duplicate (${dedup.reason}): ${dedup.article?.title?.slice(0, 60) || 'unknown'}`)
    tracker.record(headline, 'duplicate', { reason: dedup.reason })
    return
  }

  // Step 2: If URL mentioned in podcast, try direct fetch first
  if (ref.urlMentioned) {
    log(`    URL mentioned: ${ref.urlMentioned.slice(0, 80)}`)
    const result = await fetchAndExtract(ref.urlMentioned, config)

    if (result.status === 'success') {
      const article = buildArticleFromStoryRef(ref, result.article)
      const savedPath = saveArticle(article, 'general', { saved: 0 })
      if (savedPath) {
        log(`    Saved: ${article.title.slice(0, 60)}`)
        tracker.record(headline, 'found', { url: ref.urlMentioned, method: 'direct-url' })
        corpus.push(article) // Add to corpus for subsequent dedup
        return
      }
    }

    if (result.status === 'paywall') {
      log(`    Paywall on direct URL — falling back to search`)
    } else {
      log(`    Fetch failed (${result.error}) — falling back to search`)
    }
  }

  // Step 3: Search via Gemini with Google Search grounding
  let searchResults
  try {
    searchResults = await searchForStory(ref, config)
  } catch (searchErr) {
    warn(`    Search failed: ${searchErr.message}`)
    tracker.record(headline, 'error', { error: `Search: ${searchErr.message}` })
    return
  }

  if (searchResults.length === 0) {
    if (!ref.urlMentioned) {
      log(`    No search results and no URL — marking as no-url`)
      tracker.record(headline, 'no-url', {})
    } else {
      log(`    No search results found`)
      tracker.record(headline, 'error', { error: 'No search results' })
    }
    return
  }

  // Step 4: Try fetching top search results (up to 3)
  const maxAttempts = Math.min(searchResults.length, 3)
  for (let i = 0; i < maxAttempts; i++) {
    const candidate = searchResults[i]
    log(`    Trying [${i + 1}/${maxAttempts}]: ${candidate.url.slice(0, 80)}`)

    // Check dedup against the search result URL
    const urlInCorpus = corpus.some(a => normaliseUrl(a.url) === normaliseUrl(candidate.url))
    if (urlInCorpus) {
      log(`      URL already in corpus — skipping`)
      if (i === maxAttempts - 1) {
        tracker.record(headline, 'duplicate', { reason: 'url', url: candidate.url })
      }
      continue
    }

    const result = await fetchAndExtract(candidate.url, config)

    if (result.status === 'success') {
      const article = buildArticleFromStoryRef(ref, result.article)
      const savedPath = saveArticle(article, 'general', { saved: 0 })
      if (savedPath) {
        log(`    Saved: ${article.title.slice(0, 60)}`)
        tracker.record(headline, 'found', { url: candidate.url, method: 'search' })
        corpus.push(article)
        return
      }
    }

    if (result.status === 'paywall') {
      log(`      Paywall — trying next candidate`)
    } else {
      log(`      Fetch failed: ${result.error}`)
    }

    // Rate limit between fetches
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, config.fetchDelayMs))
    }
  }

  // All candidates failed
  if (config.fallbackToSnippet && ref.context) {
    log(`    All candidates failed — recording with podcast context as fallback`)
    tracker.record(headline, 'paywall', { fallbackContext: ref.context })
  } else {
    tracker.record(headline, 'error', { error: 'All fetch candidates failed' })
  }
}

// ── Lock file ───────────────────────────────────────────

const LOCK_FILE = join(ROOT, 'data/editorial/.discover.lock')
const LOCK_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

function acquireLock(sessionNum, totalStories) {
  if (existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime()
      if (lockAge < LOCK_MAX_AGE_MS) {
        err(`DISCOVER already running (PID ${lockData.pid}, started ${lockData.timestamp})`)
        err('If stale, delete data/editorial/.discover.lock')
        process.exit(1)
      }
      warn('Stale lock detected (>30 min) — overriding')
    } catch (e) {
      warn(`Unreadable lock file (${e.message}) — overriding`)
    }
  }

  writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    session: sessionNum,
    current: 0,
    total: totalStories,
  }, null, 2))
}

function updateLock(current) {
  if (!existsSync(LOCK_FILE)) return
  try {
    const lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
    lockData.current = current
    writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2))
  } catch (e) {
    warn(`Failed to update lock progress: ${e.message}`)
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE)
  } catch (e) {
    warn(`Failed to release lock: ${e.message}`)
  }
}

// ── Progress persistence ────────────────────────────────

function loadProgress(sessionNum) {
  const path = join(ROOT, 'data/editorial', `discover-progress-session-${sessionNum}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (e) {
    warn(`Corrupt progress file for session ${sessionNum}: ${e.message} — starting fresh`)
    return null
  }
}

function saveProgress(sessionNum, tracker) {
  const dir = join(ROOT, 'data/editorial')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `discover-progress-session-${sessionNum}.json`)
  writeFileSync(path, JSON.stringify(tracker.toJSON(), null, 2))
}

// ── Cost logging ────────────────────────────────────────

function saveCostLog(sessionNum, costs, elapsed, config) {
  const costLogPath = join(ROOT, 'data/editorial/cost-log.json')
  let costLog = {}
  if (existsSync(costLogPath)) {
    try {
      costLog = JSON.parse(readFileSync(costLogPath, 'utf-8'))
    } catch (e) {
      warn(`cost-log.json is corrupt (${e.message}) — starting fresh`)
      try { writeFileSync(costLogPath + `.bak-${Date.now()}`, readFileSync(costLogPath)) } catch { /* best-effort backup */ }
      costLog = {}
    }
  }

  if (!costLog.sessions) costLog.sessions = {}
  if (!costLog.weeks) costLog.weeks = {}

  // Record session cost
  costLog.sessions[`discover-${sessionNum}`] = {
    timestamp: new Date().toISOString(),
    elapsed,
    stage: 'discover',
    costs: {
      gemini: { calls: costs.gemini.calls, cost: costs.gemini.cost },
    },
    total: costs.total,
  }

  // Aggregate weekly cost (ISO 8601 week number)
  const now = new Date()
  const tmp = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
  const isoYear = tmp.getFullYear()
  const jan4 = new Date(isoYear, 0, 4)
  const weekNum = 1 + Math.round(((tmp - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7)
  const weekKey = `${isoYear}-W${String(weekNum).padStart(2, '0')}`

  if (!costLog.weeks[weekKey]) {
    costLog.weeks[weekKey] = {
      weeklyTotal: 0,
      budget: config.budget?.weekly_cap_usd ?? 50,
      breakdown: { analyse: 0, discover: 0, draft: 0, critique: 0 },
    }
  }

  costLog.weeks[weekKey].weeklyTotal += costs.total
  costLog.weeks[weekKey].breakdown.discover += costs.total

  writeFileSync(costLogPath, JSON.stringify(costLog, null, 2))
  log(`  Cost logged to cost-log.json (week ${weekKey})`)
}

// ── Main pipeline ───────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const opts = parseArgs()
  const startTime = Date.now()

  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550')
  log('  EDITORIAL DISCOVER PIPELINE')
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550')

  // 1. Validate providers (Gemini required for search)
  const providers = validateProviders()
  if (!providers.ready) {
    // DISCOVER only needs Gemini, not full editorial stack
    // Check Gemini specifically
    const { availableEditorialProviders } = await import('./lib/editorial-multi-model.js')
    const available = availableEditorialProviders()
    if (!available.gemini) {
      err('GOOGLE_AI_API_KEY required for DISCOVER (Gemini Search)')
      process.exit(1)
    }
  }

  // 2. Load config
  const config = loadDiscoveryConfig()

  // 3. Find session file
  const { path: sessionPath, sessionNum } = findSessionFile(opts)
  log(`Session ${sessionNum}: ${basename(sessionPath)}`)

  // 4. Load story references
  const stories = loadStoryReferences(sessionPath)
  if (stories.length === 0) {
    log('No story references found in session file.')
    return
  }

  log(`Found ${stories.length} story reference${stories.length === 1 ? '' : 's'}`)

  // Apply limit
  const limit = opts.limit ?? stories.length
  const toProcess = stories.slice(0, limit)

  if (opts.dryRun) {
    log('\n\u2500\u2500 DRY RUN \u2014 would process: \u2500\u2500')
    for (const ref of toProcess) {
      const query = buildSearchQuery(ref)
      log(`  \u2022 "${ref.headline.slice(0, 70)}"`)
      log(`    Query: "${query.slice(0, 80)}"`)
      if (ref.urlMentioned) log(`    URL: ${ref.urlMentioned}`)
    }
    log(`\nEstimated cost: ~$${(toProcess.length * 0.02).toFixed(2)} (rough avg $0.02/story search)`)
    return
  }

  // 5. Acquire lock and load corpus
  acquireLock(sessionNum, toProcess.length)

  log('Loading existing corpus for dedup...')
  const corpus = loadCorpusArticles()
  log(`Corpus: ${corpus.length} articles loaded`)

  // 6. Load or create progress tracker
  resetSessionCosts()
  const existingProgress = loadProgress(sessionNum)
  const tracker = createProgressTracker(existingProgress)
  if (existingProgress) {
    log(`Resuming from previous run: ${tracker.getStats().total} already processed`)
  }

  // 7. Process each story reference
  for (let i = 0; i < toProcess.length; i++) {
    const ref = toProcess[i]
    log(`\n[${i + 1}/${toProcess.length}] Processing story reference`)

    try {
      await processStory(ref, corpus, tracker, config)
    } catch (storyErr) {
      err(`  Unexpected error: ${storyErr.message}`)
      tracker.record(ref.headline, 'error', { error: storyErr.message })
    }

    // Save progress after each story (crash recovery)
    try {
      saveProgress(sessionNum, tracker)
    } catch (saveErr) {
      err(`  CRITICAL: Failed to save progress: ${saveErr.message}`)
    }
    updateLock(i + 1)

    // Rate limit between search calls
    if (i < toProcess.length - 1) {
      await sleep(config.searchDelayMs)
    }
  }

  // 8. Final report
  const stats = tracker.getStats()
  const costs = getSessionCosts()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  log('')
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550')
  log('  DISCOVER COMPLETE')
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550')
  log(`  Session:     ${sessionNum}`)
  log(`  Duration:    ${elapsed}s`)
  log(`  Stories:     ${stats.total} processed`)
  log(`    Found:     ${stats.found}`)
  log(`    Duplicate: ${stats.duplicate}`)
  log(`    Paywall:   ${stats.paywall}`)
  log(`    No URL:    ${stats.noUrl}`)
  log(`    Error:     ${stats.error}`)
  log(`  Cost:        $${costs.total.toFixed(4)}`)
  log(`    Gemini:    ${costs.gemini.calls} search calls, $${costs.gemini.cost.toFixed(4)}`)

  // Success rate
  const successRate = stats.total > 0
    ? ((stats.found + stats.duplicate) / stats.total * 100).toFixed(1)
    : 0
  log(`  Hit rate:    ${successRate}% (found + duplicate)`)

  // Zero-result and high-error warnings
  if (stats.found === 0 && stats.total > 0) {
    warn(`No articles found from ${stats.total} stories — check search results and paywall settings`)
  }
  if (stats.error > stats.total * 0.5 && stats.total > 0) {
    warn(`High error rate: ${stats.error}/${stats.total} stories failed — investigate network/API issues`)
  }

  // 9. Persist cost data
  try {
    saveCostLog(sessionNum, costs, elapsed, config)
  } catch (e) {
    err(`Failed to save cost log: ${e.message}`)
  }

  // 10. Log to activity feed
  try {
    logActivity(
      'discover',
      `Session ${sessionNum} DISCOVER: ${stats.found} articles found, ${stats.duplicate} duplicates`,
      `${stats.total} stories processed in ${elapsed}s, $${costs.total.toFixed(4)} cost`
    )
  } catch (e) {
    warn(`Failed to log activity: ${e.message}`)
  }

  // 11. Save final progress and release lock
  try {
    saveProgress(sessionNum, tracker)
  } catch (e) {
    err(`CRITICAL: Failed to save final progress: ${e.message}`)
  }
  releaseLock()

  // Budget warning
  const weeklyBudget = config.budget?.weekly_cap_usd ?? 50
  if (costs.total > weeklyBudget * 0.1) {
    warn(`DISCOVER cost $${costs.total.toFixed(2)} — monitor weekly budget ($${weeklyBudget})`)
  }
}

main().catch(e => {
  err(`Fatal error: ${e.message}`)
  console.error(e.stack)
  releaseLock()
  process.exit(1)
})
