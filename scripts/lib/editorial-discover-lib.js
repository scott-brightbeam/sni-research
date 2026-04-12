/**
 * editorial-discover-lib.js — Pure business logic for the DISCOVER pipeline
 *
 * Testable functions for story reference loading, dedup checking,
 * search query building, article construction, and progress tracking.
 *
 * No side effects (network, LLM calls) — those live in editorial-discover.js.
 */

import { readFileSync, existsSync } from 'fs'
import { textSimilarity } from './dedup.js'

// ── Story reference loading ─────────────────────────────

/**
 * Load and validate story references from a JSON file.
 *
 * @param {string} filePath — absolute path to stories-session-N.json
 * @returns {Array<object>} — valid story references (non-null, has headline)
 */
export function loadStoryReferences(filePath) {
  if (!existsSync(filePath)) return []

  let raw
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch (e) {
    console.warn(`[editorial-discover] Failed to parse story references: ${e.message}`)
    return []
  }

  if (!Array.isArray(raw)) {
    console.warn(`[editorial-discover] Story references file is not an array`)
    return []
  }

  const filtered = raw.filter(item =>
    item != null &&
    typeof item === 'object' &&
    typeof item.headline === 'string' &&
    item.headline.trim().length > 0
  )

  if (filtered.length < raw.length) {
    console.warn(`[editorial-discover] Filtered ${raw.length - filtered.length} invalid entries from story references`)
  }

  return filtered
}

// ── Search query building ───────────────────────────────

/**
 * Build a search query for a story reference.
 * Uses the searchQuery field if present, otherwise constructs from headline + entities.
 *
 * @param {object} ref — story reference
 * @returns {string} — search query string
 */
export function buildSearchQuery(ref) {
  // Use explicit searchQuery if provided and non-empty
  if (ref.searchQuery && ref.searchQuery.trim()) {
    return ref.searchQuery.trim()
  }

  // Build from headline + entities + date
  const parts = [ref.headline]
  if (Array.isArray(ref.entities) && ref.entities.length > 0) {
    // Add entities not already in headline
    const headlineLower = ref.headline.toLowerCase()
    for (const entity of ref.entities) {
      if (!headlineLower.includes(entity.toLowerCase())) {
        parts.push(entity)
      }
    }
  }
  if (ref.approximateDate) {
    const year = ref.approximateDate.slice(0, 4)
    if (!parts.some(p => p.includes(year))) {
      parts.push(year)
    }
  }

  return parts.join(' ').trim()
}

// ── URL normalisation ───────────────────────────────────

/**
 * Normalise a URL for dedup comparison: strip www, trailing slash,
 * query parameters, fragment; lowercase hostname.
 *
 * @param {string|null|undefined} url
 * @returns {string} — normalised URL or empty string
 */
export function normaliseUrl(url) {
  if (!url || typeof url !== 'string' || !url.trim()) return ''

  try {
    const parsed = new URL(url.trim())
    // Lowercase hostname, strip www
    let hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    // Rebuild without query/fragment
    let path = parsed.pathname.replace(/\/+$/, '') // strip trailing slashes
    return `${parsed.protocol}//${hostname}${path}`
  } catch {
    return url.trim()
  }
}

// ── Search response parsing ─────────────────────────────

// URLs from search engines, social media, video sites — not article sources
const FILTERED_DOMAINS = new Set([
  'google.com', 'google.co.uk', 'bing.com', 'duckduckgo.com',
  'youtube.com', 'youtu.be', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'tiktok.com', 'reddit.com', 'linkedin.com',
  'wikipedia.org',
])

/**
 * Parse a Gemini search response to extract article URLs.
 *
 * Handles both structured JSON responses (parsed field) and raw text
 * containing URLs. Deduplicates and filters non-article domains.
 *
 * @param {object|null} response — { parsed, raw } from callGeminiWithSearch
 * @returns {Array<{ url: string, title: string|null }>}
 */
export function parseSearchResponse(response) {
  if (!response) return []

  const seen = new Set()
  const results = []

  function addResult(originalUrl, title = null) {
    const normalised = normaliseUrl(originalUrl)
    if (!normalised || seen.has(normalised)) return
    // Filter non-article domains (check subdomains too)
    try {
      const hostname = new URL(normalised).hostname.replace(/^www\./, '')
      const isFiltered = [...FILTERED_DOMAINS].some(d => hostname === d || hostname.endsWith('.' + d))
      if (isFiltered) return
    } catch {
      return
    }
    seen.add(normalised)
    // Store original URL for fetching (query params may be needed), normalised for dedup
    results.push({ url: originalUrl.replace(/[.,;:!?)]+$/, '').trim(), title })
  }

  // Try structured response first
  if (response.parsed) {
    const articles = response.parsed.articles || response.parsed.results || []
    if (Array.isArray(articles)) {
      for (const item of articles) {
        if (item && item.url) {
          addResult(item.url, item.title || null)
        }
      }
    }
  }

  // Fall back to / supplement with URL extraction from raw text
  if (response.raw && typeof response.raw === 'string') {
    const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g
    const matches = response.raw.match(urlPattern) || []
    for (const url of matches) {
      // Clean trailing punctuation that might be captured
      const cleaned = url.replace(/[.,;:!?)]+$/, '')
      addResult(cleaned)
    }
  }

  return results
}

// ── Dedup checking ──────────────────────────────────────

const TITLE_SIMILARITY_THRESHOLD = 0.5  // Jaccard threshold for title match
const DATE_WINDOW_DAYS = 3              // ±3 days for title-based dedup

/**
 * Check if a story reference already exists in the corpus.
 *
 * Two-tier check:
 * 1. Exact URL match (normalised)
 * 2. Title similarity (Jaccard) above threshold, within date window
 *
 * @param {object} ref — story reference with headline, urlMentioned, approximateDate
 * @param {Array<object>} corpus — existing articles with url, title, date_published
 * @returns {{ matched: boolean, reason: 'url'|'title'|null, article: object|null }}
 */
export function isStoryAlreadyDiscovered(ref, corpus) {
  if (!corpus || corpus.length === 0) {
    return { matched: false, reason: null, article: null }
  }

  // Tier 1: URL match
  if (ref.urlMentioned) {
    const normRef = normaliseUrl(ref.urlMentioned)
    for (const article of corpus) {
      if (normaliseUrl(article.url) === normRef) {
        return { matched: true, reason: 'url', article }
      }
    }
  }

  // Tier 2: Title similarity with date window
  for (const article of corpus) {
    const sim = textSimilarity(ref.headline, article.title || '')
    if (sim >= TITLE_SIMILARITY_THRESHOLD) {
      // Check date window if both dates available
      if (ref.approximateDate && article.date_published) {
        const refDate = new Date(ref.approximateDate)
        const artDate = new Date(article.date_published)
        const diffDays = Math.abs(refDate - artDate) / (1000 * 60 * 60 * 24)
        if (diffDays > DATE_WINDOW_DAYS) continue
      }
      return { matched: true, reason: 'title', article }
    }
  }

  return { matched: false, reason: null, article: null }
}

// ── Article construction ────────────────────────────────

/**
 * Build a verified article JSON from a story reference and fetch result.
 *
 * @param {object} ref — story reference from ANALYSE
 * @param {object} fetchResult — { url, title, fullText, datePublished, dateMethod, dateConfidence, rawHtml }
 * @returns {object} — article JSON matching data/verified/ schema
 */
export function buildArticleFromStoryRef(ref, fetchResult) {
  // Extract hostname without www
  let source = ''
  try {
    source = new URL(fetchResult.url).hostname.replace(/^www\./, '')
  } catch {
    source = 'unknown'
  }

  const title = fetchResult.title || ref.headline
  const fullText = fetchResult.fullText || ''
  const datePublished = fetchResult.datePublished || ref.approximateDate || new Date().toISOString().slice(0, 10)
  const dateConfidence = fetchResult.datePublished
    ? (fetchResult.dateConfidence || 'medium')
    : (ref.approximateDate ? 'low' : 'none')
  const dateMethod = fetchResult.datePublished
    ? (fetchResult.dateMethod || 'none')
    : 'podcast-reference'

  return {
    title,
    url: fetchResult.url,
    source,
    source_type: 'editorial-discover',
    date_published: datePublished,
    date_verified_method: dateMethod,
    date_confidence: dateConfidence,
    sector: 'general',
    keywords_matched: [],
    snippet: fullText.slice(0, 300),
    full_text: fullText,
    scraped_at: new Date().toISOString(),
    found_by: ['Editorial DISCOVER'],
    discoverySource: 'podcast-referenced',
    confidence: 'high',
    sourceEpisode: ref.sourceEpisode || '',
    _raw_html: fetchResult.rawHtml || '',
  }
}

// ── Fetch result classification ─────────────────────────

const MIN_CONTENT_LENGTH = 300
const PAYWALL_ERROR_CODES = ['HTTP 401', 'HTTP 403']

/**
 * Classify a fetch result as success, paywall, or error.
 *
 * @param {{ html: string|null, error: string|null }} fetchResult
 * @returns {{ status: 'success'|'paywall'|'error', error: string|null }}
 */
export function classifyFetchResult(fetchResult) {
  if (fetchResult.error) {
    if (PAYWALL_ERROR_CODES.some(code => fetchResult.error.includes(code))) {
      return { status: 'paywall', error: fetchResult.error }
    }
    return { status: 'error', error: fetchResult.error }
  }

  if (!fetchResult.html) {
    return { status: 'error', error: 'No HTML content' }
  }

  // Check content length (rough — will be refined after Cheerio extraction)
  const textContent = fetchResult.html.replace(/<[^>]*>/g, '').trim()
  if (textContent.length < MIN_CONTENT_LENGTH) {
    return { status: 'paywall', error: 'Content too short — likely paywalled' }
  }

  return { status: 'success', error: null }
}

// ── Progress tracking ───────────────────────────────────

const VALID_STATUSES = new Set(['found', 'duplicate', 'paywall', 'no-url', 'error'])

/**
 * Create a progress tracker for DISCOVER session.
 * Tracks which stories have been processed and their outcomes.
 *
 * @param {object} [existing] — previously serialised tracker (for crash recovery)
 * @returns {object} — tracker with record, isProcessed, getStats, toJSON methods
 */
export function createProgressTracker(existing = null) {
  // Safely restore from previous run — filter out corrupt entries
  const processed = (existing?.processed ?? [])
    .filter(p => p != null && typeof p === 'object' && typeof p.headline === 'string')
    .map(p => ({ ...p })) // shallow copy to avoid mutation

  const headlineSet = new Set(
    processed.map(p => p.headline.toLowerCase())
  )

  return {
    record(headline, status, meta = {}) {
      if (!VALID_STATUSES.has(status)) {
        console.warn(`[progress-tracker] Unknown status "${status}" for "${headline}" — recording as "error"`)
        status = 'error'
      }
      // Apply meta first, then core fields — core fields always win
      const entry = {
        ...meta,
        headline,
        status,
        timestamp: new Date().toISOString(),
      }
      processed.push(entry)
      headlineSet.add(headline.toLowerCase())
    },

    isProcessed(headline) {
      return headlineSet.has(headline.toLowerCase())
    },

    getProcessed() {
      return [...processed]
    },

    getStats() {
      const stats = { total: 0, found: 0, duplicate: 0, paywall: 0, noUrl: 0, error: 0 }
      for (const p of processed) {
        stats.total++
        switch (p.status) {
          case 'found': stats.found++; break
          case 'duplicate': stats.duplicate++; break
          case 'paywall': stats.paywall++; break
          case 'no-url': stats.noUrl++; break
          case 'error': stats.error++; break
        }
      }
      return stats
    },

    toJSON() {
      return {
        processed: [...processed],
        stats: this.getStats(),
      }
    },
  }
}
