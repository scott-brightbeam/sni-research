/**
 * headlines.js - Scrape article headlines from publication index pages
 * and search Brave for open/free copies.
 */

import * as cheerio from 'cheerio';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fetchPage, isPaywalled } from './extract.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const FALLBACK_SELECTORS = [
  'h2 a',
  'h3 a',
  'article h2',
  'article h3',
  '.article-title a',
  '[class*="headline"] a',
  '[class*="story"] h2',
  '[class*="story"] h3',
];

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'shall', 'not', 'no', 'its',
  'it', 'this', 'that', 'these', 'those', 'as', 'into', 'how', 'what',
  'which', 'who', 'where', 'when', 'why',
]);

const MIN_HEADLINE_LENGTH = 30;
const MAX_HEADLINE_LENGTH = 200;

// ─── Headline extraction ─────────────────────────────────────────────────────

/**
 * Extract headlines from raw HTML using a configured selector with fallbacks.
 * Exported separately so tests can call it directly without mocking fetchPage.
 *
 * @param {string} html - Raw HTML string
 * @param {string} configuredSelector - CSS selector to try first
 * @returns {{ headline: string }[]}
 */
export function extractHeadlinesFromHtml(html, configuredSelector) {
  const $ = cheerio.load(html);

  let headlines = extractWithSelector($, configuredSelector);

  // If configured selector found nothing, try fallbacks in order
  if (headlines.length === 0) {
    for (const sel of FALLBACK_SELECTORS) {
      headlines = extractWithSelector($, sel);
      if (headlines.length > 0) break;
    }
  }

  // Filter by length
  headlines = headlines.filter(
    h => h.length >= MIN_HEADLINE_LENGTH && h.length <= MAX_HEADLINE_LENGTH,
  );

  // Deduplicate by normalised text (lowercase, trim, collapse whitespace)
  const seen = new Set();
  const unique = [];
  for (const h of headlines) {
    const key = h.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(h);
    }
  }

  return unique;
}

function extractWithSelector($, selector) {
  const results = [];
  $(selector).each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text) results.push(text);
  });
  return results;
}

// ─── scrapeHeadlines ─────────────────────────────────────────────────────────

/**
 * Scrape headlines from a publication source page.
 *
 * @param {{ name: string, url: string, selector: string }} source
 * @returns {Promise<{ headlines: { headline: string, sourceUrl: string, sourceName: string }[], error: string|null }>}
 */
export async function scrapeHeadlines(source) {
  const { html, error } = await fetchPage(source.url);

  if (error) {
    return { headlines: [], error };
  }

  const raw = extractHeadlinesFromHtml(html, source.selector);

  const headlines = raw.map(h => ({
    headline: h,
    sourceUrl: source.url,
    sourceName: source.name,
  }));

  return { headlines, error: null };
}

// ─── Keyword extraction ──────────────────────────────────────────────────────

/**
 * Extract significant keywords from a headline for fallback search.
 * Removes stop words, keeps first 7 remaining words.
 *
 * @param {string} headline
 * @returns {string}
 */
export function extractKeywords(headline) {
  const words = headline
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/[^a-z]/g, ''))
    .filter(w => w && !STOP_WORDS.has(w));

  return words.slice(0, 7).join(' ');
}

// ─── Brave search ────────────────────────────────────────────────────────────

/**
 * Search Brave for open/free copies of a headline.
 *
 * @param {string} headline
 * @param {string} apiKey - Brave Search API subscription token
 * @returns {Promise<{ url: string, title: string }[]>}
 */
export async function searchHeadlineOnBrave(headline, apiKey) {
  // Try exact phrase search first
  let results = await queryBrave(`"${headline}"`, apiKey);

  // If zero results, fall back to keyword search
  if (results.length === 0) {
    const keywords = extractKeywords(headline);
    if (keywords) {
      results = await queryBrave(keywords, apiKey);
    }
  }

  return results;
}

async function queryBrave(query, apiKey) {
  // Rate limit: 1.5s delay before each call
  await new Promise(r => setTimeout(r, 1500));

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('freshness', 'pw');

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const webResults = data.web?.results || [];

    // Filter out paywalled results, take first 3
    return webResults
      .filter(r => !isPaywalled(r.url))
      .slice(0, 3)
      .map(r => ({ url: r.url, title: r.title }));
  } catch {
    return [];
  }
}

// ─── Source health tracking ──────────────────────────────────────────────────

/**
 * Load source health data from disk.
 * @param {string} dataDir
 * @returns {Map<string, { lastSuccess: string|null, consecutiveFailures: number, lastError: string|null }>}
 */
export function loadSourceHealth(dataDir) {
  const filePath = join(dataDir, 'source-health.json');
  if (!existsSync(filePath)) return new Map();

  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8'));
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

/**
 * Save source health data to disk.
 * @param {string} dataDir
 * @param {Map} healthMap
 */
export function saveSourceHealth(dataDir, healthMap) {
  const filePath = join(dataDir, 'source-health.json');
  const obj = Object.fromEntries(healthMap);
  writeFileSync(filePath, JSON.stringify(obj, null, 2));
}

/**
 * Check if a source should be skipped due to repeated failures.
 * @param {Map} healthMap
 * @param {string} sourceName
 * @returns {boolean}
 */
export function shouldSkipSource(healthMap, sourceName) {
  const entry = healthMap.get(sourceName);
  if (!entry) return false;
  return entry.consecutiveFailures >= 3;
}

/**
 * Record a successful scrape for a source.
 * @param {Map} healthMap
 * @param {string} sourceName
 */
export function recordSuccess(healthMap, sourceName) {
  healthMap.set(sourceName, {
    lastSuccess: new Date().toISOString(),
    consecutiveFailures: 0,
    lastError: null,
  });
}

/**
 * Record a failed scrape for a source.
 * @param {Map} healthMap
 * @param {string} sourceName
 * @param {string} error
 */
export function recordFailure(healthMap, sourceName, error) {
  const existing = healthMap.get(sourceName) || {
    lastSuccess: null,
    consecutiveFailures: 0,
    lastError: null,
  };
  healthMap.set(sourceName, {
    lastSuccess: existing.lastSuccess,
    consecutiveFailures: existing.consecutiveFailures + 1,
    lastError: error,
  });
}
