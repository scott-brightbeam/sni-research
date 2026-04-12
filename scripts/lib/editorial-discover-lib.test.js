/**
 * editorial-discover-lib.test.js — Tests for DISCOVER pipeline business logic
 *
 * Pure function tests for story reference loading, dedup checking,
 * search query building, article construction, and progress tracking.
 */

import { describe, test, expect } from 'bun:test'
import { writeFileSync, unlinkSync } from 'fs'
import {
  loadStoryReferences,
  buildSearchQuery,
  buildArticleFromStoryRef,
  parseSearchResponse,
  isStoryAlreadyDiscovered,
  createProgressTracker,
  classifyFetchResult,
  normaliseUrl,
} from './editorial-discover-lib.js'

// ── Fixtures ────────────────────────────────────────────

function makeStoryRef(overrides = {}) {
  return {
    headline: 'Anthropic 81,000-person qualitative survey on AI attitudes',
    entities: ['Anthropic', 'Claude'],
    approximateDate: '2026-03-17',
    urlMentioned: null,
    searchQuery: 'Anthropic 81000 person AI survey Claude interviews 2026',
    sourceEpisode: 'AI Daily Brief — What People Really Want From AI',
    context: 'Survey interviewed 81,000 people across 159 countries',
    ...overrides,
  }
}

function makeExistingArticle(overrides = {}) {
  return {
    title: 'Anthropic Launches Massive AI Attitudes Survey',
    url: 'https://techcrunch.com/2026/03/17/anthropic-ai-survey',
    source: 'techcrunch.com',
    date_published: '2026-03-17',
    full_text: 'Anthropic has released results from its 81,000-person survey...',
    ...overrides,
  }
}

// ── loadStoryReferences ─────────────────────────────────

describe('loadStoryReferences', () => {
  test('returns empty array for non-existent file', () => {
    const refs = loadStoryReferences('/tmp/nonexistent-stories-999.json')
    expect(refs).toEqual([])
  })

  test('returns empty array for invalid JSON', () => {
    const tmpPath = '/tmp/test-bad-stories.json'
    writeFileSync(tmpPath, 'not json{{{')
    const refs = loadStoryReferences(tmpPath)
    expect(refs).toEqual([])
    unlinkSync(tmpPath)
  })

  test('returns parsed array from valid file', () => {
    const tmpPath = '/tmp/test-good-stories.json'
    const stories = [makeStoryRef(), makeStoryRef({ headline: 'Another Story' })]
    writeFileSync(tmpPath, JSON.stringify(stories))
    const refs = loadStoryReferences(tmpPath)
    expect(refs).toHaveLength(2)
    expect(refs[0].headline).toBe('Anthropic 81,000-person qualitative survey on AI attitudes')
    expect(refs[1].headline).toBe('Another Story')
    unlinkSync(tmpPath)
  })

  test('filters out null and non-object entries', () => {
    const tmpPath = '/tmp/test-mixed-stories.json'
    const stories = [makeStoryRef(), null, 'bad', 42, makeStoryRef({ headline: 'Valid' })]
    writeFileSync(tmpPath, JSON.stringify(stories))
    const refs = loadStoryReferences(tmpPath)
    expect(refs).toHaveLength(2)
    unlinkSync(tmpPath)
  })

  test('filters out entries without headline', () => {
    const tmpPath = '/tmp/test-no-headline.json'
    const stories = [makeStoryRef(), { entities: ['foo'] }]
    writeFileSync(tmpPath, JSON.stringify(stories))
    const refs = loadStoryReferences(tmpPath)
    expect(refs).toHaveLength(1)
    unlinkSync(tmpPath)
  })
})

// ── buildSearchQuery ────────────────────────────────────

describe('buildSearchQuery', () => {
  test('uses searchQuery field when present', () => {
    const ref = makeStoryRef({ searchQuery: 'custom search query' })
    const query = buildSearchQuery(ref)
    expect(query).toBe('custom search query')
  })

  test('builds query from headline and entities when searchQuery missing', () => {
    const ref = makeStoryRef({ searchQuery: null })
    const query = buildSearchQuery(ref)
    expect(query).toContain('Anthropic')
    expect(query).toContain('survey')
    expect(query.length).toBeGreaterThan(10)
  })

  test('builds query from headline alone when no entities', () => {
    const ref = makeStoryRef({ searchQuery: null, entities: [] })
    const query = buildSearchQuery(ref)
    expect(query.length).toBeGreaterThan(10)
  })

  test('appends approximate date year when present', () => {
    const ref = makeStoryRef({ searchQuery: null, approximateDate: '2026-03-17' })
    const query = buildSearchQuery(ref)
    expect(query).toContain('2026')
  })

  test('returns headline as fallback for empty searchQuery string', () => {
    const ref = makeStoryRef({ searchQuery: '' })
    const query = buildSearchQuery(ref)
    expect(query.length).toBeGreaterThan(5)
  })
})

// ── normaliseUrl ────────────────────────────────────────

describe('normaliseUrl', () => {
  test('strips trailing slash', () => {
    expect(normaliseUrl('https://example.com/article/')).toBe('https://example.com/article')
  })

  test('strips www prefix', () => {
    expect(normaliseUrl('https://www.example.com/article')).toBe('https://example.com/article')
  })

  test('strips query parameters', () => {
    expect(normaliseUrl('https://example.com/article?utm_source=foo&ref=bar'))
      .toBe('https://example.com/article')
  })

  test('strips fragment', () => {
    expect(normaliseUrl('https://example.com/article#section-2'))
      .toBe('https://example.com/article')
  })

  test('lowercases hostname', () => {
    expect(normaliseUrl('https://TechCrunch.COM/Article'))
      .toBe('https://techcrunch.com/Article')
  })

  test('handles null/undefined gracefully', () => {
    expect(normaliseUrl(null)).toBe('')
    expect(normaliseUrl(undefined)).toBe('')
    expect(normaliseUrl('')).toBe('')
  })

  test('combines all normalisations', () => {
    expect(normaliseUrl('https://www.TechCrunch.COM/article/?utm=foo#top'))
      .toBe('https://techcrunch.com/article')
  })
})

// ── parseSearchResponse ─────────────────────────────────

describe('parseSearchResponse', () => {
  test('extracts URLs from Gemini search response JSON', () => {
    const response = {
      parsed: {
        articles: [
          { url: 'https://techcrunch.com/article-1', title: 'Article 1', relevance: 'high' },
          { url: 'https://reuters.com/article-2', title: 'Article 2', relevance: 'medium' },
        ]
      },
      raw: 'some raw text',
    }
    const results = parseSearchResponse(response)
    expect(results).toHaveLength(2)
    expect(results[0].url).toBe('https://techcrunch.com/article-1')
    expect(results[0].title).toBe('Article 1')
    expect(results[1].url).toBe('https://reuters.com/article-2')
  })

  test('extracts URLs from raw text when parsed is null', () => {
    const response = {
      parsed: null,
      raw: 'Found this article: https://techcrunch.com/2026/03/anthropic-survey and also https://reuters.com/ai-news',
    }
    const results = parseSearchResponse(response)
    expect(results.length).toBeGreaterThanOrEqual(2)
    expect(results.some(r => r.url.includes('techcrunch.com'))).toBe(true)
    expect(results.some(r => r.url.includes('reuters.com'))).toBe(true)
  })

  test('returns empty array when no URLs found', () => {
    const response = { parsed: null, raw: 'No results found for this query.' }
    const results = parseSearchResponse(response)
    expect(results).toEqual([])
  })

  test('deduplicates URLs', () => {
    const response = {
      parsed: null,
      raw: 'https://example.com/article and again https://example.com/article found',
    }
    const results = parseSearchResponse(response)
    expect(results).toHaveLength(1)
  })

  test('handles null/undefined response gracefully', () => {
    expect(parseSearchResponse(null)).toEqual([])
    expect(parseSearchResponse(undefined)).toEqual([])
    expect(parseSearchResponse({})).toEqual([])
  })

  test('filters out non-article URLs', () => {
    const response = {
      parsed: null,
      raw: 'https://techcrunch.com/article https://google.com https://youtube.com/watch?v=123 https://reuters.com/news',
    }
    const results = parseSearchResponse(response)
    // Should filter google.com (search engine) and youtube.com (video)
    const urls = results.map(r => r.url)
    expect(urls).not.toContain('https://google.com')
    expect(urls).not.toContain('https://youtube.com/watch?v=123')
  })
})

// ── isStoryAlreadyDiscovered ────────────────────────────

describe('isStoryAlreadyDiscovered', () => {
  test('matches by exact URL', () => {
    const ref = makeStoryRef({ urlMentioned: 'https://techcrunch.com/2026/03/17/anthropic-ai-survey' })
    const corpus = [makeExistingArticle()]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(true)
    expect(result.reason).toBe('url')
  })

  test('matches by normalised URL (strips www, trailing slash, query params)', () => {
    const ref = makeStoryRef({ urlMentioned: 'https://www.techcrunch.com/2026/03/17/anthropic-ai-survey/' })
    const corpus = [makeExistingArticle({ url: 'https://techcrunch.com/2026/03/17/anthropic-ai-survey' })]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(true)
    expect(result.reason).toBe('url')
  })

  test('matches by title similarity above threshold', () => {
    const ref = makeStoryRef({ headline: 'Anthropic Launches Massive AI Attitudes Survey' })
    const corpus = [makeExistingArticle({ title: 'Anthropic Launches Massive AI Attitudes Survey Results' })]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(true)
    expect(result.reason).toBe('title')
  })

  test('respects date window for title matching (within 3 days)', () => {
    const ref = makeStoryRef({
      headline: 'Anthropic Launches Massive AI Attitudes Survey',
      approximateDate: '2026-03-17',
    })
    const corpus = [makeExistingArticle({
      title: 'Anthropic Launches Massive AI Attitudes Survey Results',
      date_published: '2026-03-19', // within 3 days
    })]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(true)
  })

  test('rejects title match outside date window', () => {
    const ref = makeStoryRef({
      headline: 'Anthropic Launches Massive AI Attitudes Survey',
      approximateDate: '2026-03-17',
    })
    const corpus = [makeExistingArticle({
      title: 'Anthropic Launches Massive AI Attitudes Survey Results',
      date_published: '2026-02-01', // way outside 3-day window
    })]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(false)
  })

  test('returns not matched when corpus is empty', () => {
    const ref = makeStoryRef()
    const result = isStoryAlreadyDiscovered(ref, [])
    expect(result.matched).toBe(false)
  })

  test('returns not matched when no URL and low title similarity', () => {
    const ref = makeStoryRef({ headline: 'Completely Different Topic About Quantum Computing' })
    const corpus = [makeExistingArticle()]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(false)
  })

  test('skips date window check when approximateDate is null', () => {
    const ref = makeStoryRef({
      headline: 'Anthropic Launches Massive AI Attitudes Survey',
      approximateDate: null,
    })
    const corpus = [makeExistingArticle({
      title: 'Anthropic Launches Massive AI Attitudes Survey Results',
      date_published: '2026-01-01', // would be outside window, but no date to check
    })]
    const result = isStoryAlreadyDiscovered(ref, corpus)
    expect(result.matched).toBe(true)
    expect(result.reason).toBe('title')
  })
})

// ── buildArticleFromStoryRef ────────────────────────────

describe('buildArticleFromStoryRef', () => {
  test('constructs article JSON with all required fields', () => {
    const ref = makeStoryRef()
    const fetchResult = {
      url: 'https://techcrunch.com/2026/03/17/anthropic-survey',
      title: 'Anthropic Survey Results',
      fullText: 'Full article text here about the survey...',
      datePublished: '2026-03-17',
      dateMethod: 'meta-og',
      dateConfidence: 'high',
      rawHtml: '<html>...</html>',
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.title).toBe('Anthropic Survey Results')
    expect(article.url).toBe('https://techcrunch.com/2026/03/17/anthropic-survey')
    expect(article.source).toBe('techcrunch.com')
    expect(article.date_published).toBe('2026-03-17')
    expect(article.full_text).toBe('Full article text here about the survey...')
    expect(article.snippet).toBe('Full article text here about the survey...')
    expect(article.discoverySource).toBe('podcast-referenced')
    expect(article.confidence).toBe('high')
    expect(article.sourceEpisode).toBe('AI Daily Brief — What People Really Want From AI')
    expect(article.source_type).toBe('editorial-discover')
    expect(article.scraped_at).toBeTruthy()
    expect(article.found_by).toContain('Editorial DISCOVER')
  })

  test('extracts hostname from URL for source field', () => {
    const ref = makeStoryRef()
    const fetchResult = {
      url: 'https://www.reuters.com/technology/ai-survey',
      title: 'Test',
      fullText: 'text',
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.source).toBe('reuters.com')
  })

  test('uses story ref headline as fallback title', () => {
    const ref = makeStoryRef()
    const fetchResult = {
      url: 'https://example.com/article',
      title: null,
      fullText: 'text',
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.title).toBe(ref.headline)
  })

  test('uses approximateDate as fallback date', () => {
    const ref = makeStoryRef({ approximateDate: '2026-03-17' })
    const fetchResult = {
      url: 'https://example.com/article',
      title: 'Test',
      fullText: 'text',
      datePublished: null,
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.date_published).toBe('2026-03-17')
    expect(article.date_confidence).toBe('low')
  })

  test('truncates snippet to 300 chars', () => {
    const ref = makeStoryRef()
    const longText = 'A'.repeat(500)
    const fetchResult = {
      url: 'https://example.com/article',
      title: 'Test',
      fullText: longText,
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.snippet.length).toBe(300)
  })

  test('includes podcast context in found_by', () => {
    const ref = makeStoryRef({ sourceEpisode: 'Cognitive Revolution — Deep Dive' })
    const fetchResult = {
      url: 'https://example.com/article',
      title: 'Test',
      fullText: 'text',
    }
    const article = buildArticleFromStoryRef(ref, fetchResult)
    expect(article.found_by).toContain('Editorial DISCOVER')
    expect(article.sourceEpisode).toBe('Cognitive Revolution — Deep Dive')
  })
})

// ── classifyFetchResult ─────────────────────────────────

describe('classifyFetchResult', () => {
  test('classifies success with sufficient content', () => {
    const result = classifyFetchResult({ html: '<html><body>' + 'x'.repeat(400) + '</body></html>', error: null })
    expect(result.status).toBe('success')
  })

  test('classifies paywall when content too short', () => {
    const result = classifyFetchResult({ html: '<html><body>Subscribe to read</body></html>', error: null })
    expect(result.status).toBe('paywall')
  })

  test('classifies error on HTTP failure', () => {
    const result = classifyFetchResult({ html: null, error: 'HTTP 500' })
    expect(result.status).toBe('error')
    expect(result.error).toBe('HTTP 500')
  })

  test('classifies error on null html', () => {
    const result = classifyFetchResult({ html: null, error: 'timeout' })
    expect(result.status).toBe('error')
  })

  test('classifies paywall on 401/403 errors', () => {
    const result = classifyFetchResult({ html: null, error: 'HTTP 401' })
    expect(result.status).toBe('paywall')
  })
})

// ── createProgressTracker ───────────────────────────────

describe('createProgressTracker', () => {
  test('creates empty tracker', () => {
    const tracker = createProgressTracker()
    expect(tracker.getProcessed()).toEqual([])
    expect(tracker.getStats()).toEqual({
      total: 0,
      found: 0,
      duplicate: 0,
      paywall: 0,
      noUrl: 0,
      error: 0,
    })
  })

  test('records processed story with status', () => {
    const tracker = createProgressTracker()
    tracker.record('Anthropic Survey', 'found', { url: 'https://example.com' })
    const processed = tracker.getProcessed()
    expect(processed).toHaveLength(1)
    expect(processed[0].headline).toBe('Anthropic Survey')
    expect(processed[0].status).toBe('found')
    expect(processed[0].url).toBe('https://example.com')
  })

  test('tracks stats by status', () => {
    const tracker = createProgressTracker()
    tracker.record('Story 1', 'found', {})
    tracker.record('Story 2', 'found', {})
    tracker.record('Story 3', 'duplicate', {})
    tracker.record('Story 4', 'paywall', {})
    tracker.record('Story 5', 'error', {})
    tracker.record('Story 6', 'no-url', {})
    const stats = tracker.getStats()
    expect(stats.total).toBe(6)
    expect(stats.found).toBe(2)
    expect(stats.duplicate).toBe(1)
    expect(stats.paywall).toBe(1)
    expect(stats.error).toBe(1)
    expect(stats.noUrl).toBe(1)
  })

  test('isProcessed checks by headline', () => {
    const tracker = createProgressTracker()
    tracker.record('Anthropic Survey', 'found', {})
    expect(tracker.isProcessed('Anthropic Survey')).toBe(true)
    expect(tracker.isProcessed('anthropic survey')).toBe(true) // case-insensitive
    expect(tracker.isProcessed('Different Story')).toBe(false)
  })

  test('serialises and deserialises', () => {
    const tracker = createProgressTracker()
    tracker.record('Story 1', 'found', { url: 'https://a.com' })
    tracker.record('Story 2', 'paywall', {})

    const json = tracker.toJSON()
    expect(typeof json).toBe('object')
    expect(json.processed).toHaveLength(2)
    expect(json.stats.total).toBe(2)

    const restored = createProgressTracker(json)
    expect(restored.isProcessed('Story 1')).toBe(true)
    expect(restored.getStats().total).toBe(2)
  })

  test('getAll returns copy, not reference', () => {
    const tracker = createProgressTracker()
    tracker.record('Story 1', 'found', {})
    const all = tracker.getProcessed()
    all.push({ headline: 'injected' })
    expect(tracker.getProcessed()).toHaveLength(1) // original unchanged
  })
})
