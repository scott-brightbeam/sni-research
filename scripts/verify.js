/**
 * verify.js - Date verification for SNI Research Tool
 *
 * Implements a 7-method priority cascade to confirm article publication dates.
 * Date verification is non-negotiable: unverified articles never enter verified/.
 *
 * Usage: import { verifyDate } from './verify.js'
 * Returns: { date: 'YYYY-MM-DD', confidence: 'high|medium|low', method: string, verified: bool }
 */

import * as cheerio from 'cheerio';

// URL date patterns for known publishers
const URL_DATE_PATTERNS = [
  // BusinessWire: /20260217/
  { regex: /\/(\d{4})(\d{2})(\d{2})\//, format: 'compact' },
  // Standard: /2026/02/17/ or /2026/02/17
  { regex: /\/(\d{4})\/(\d{2})\/(\d{2})\/?/, format: 'slashes' },
  // With stories prefix: /stories/2026/02/17/
  { regex: /\/stories\/(\d{4})\/(\d{2})\/(\d{2})\/?/, format: 'slashes' },
  // Dashed: /2026-02-17
  { regex: /\/(\d{4})-(\d{2})-(\d{2})/, format: 'dashes' },
];

// Visible date text patterns
const VISIBLE_DATE_PATTERNS = [
  // February 18, 2026
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i,
  // 18 Feb 2026
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})\b/i,
  // 2026-02-18
  /\b(\d{4})-(\d{2})-(\d{2})\b/,
  // Feb 18, 2026
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
];

const MONTH_MAP = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04',
  jun: '06', jul: '07', aug: '08', sep: '09',
  oct: '10', nov: '11', dec: '12',
};

function padTwo(n) {
  return String(n).padStart(2, '0');
}

function parseUrlDate(url) {
  for (const pattern of URL_DATE_PATTERNS) {
    const match = url.match(pattern.regex);
    if (!match) continue;
    try {
      let year, month, day;
      if (pattern.format === 'compact') {
        year = match[1]; month = match[2]; day = match[3];
      } else {
        year = match[1]; month = match[2]; day = match[3];
      }
      // Sanity check
      const y = parseInt(year); const m = parseInt(month); const d = parseInt(day);
      if (y >= 2020 && y <= 2030 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${year}-${padTwo(m)}-${padTwo(d)}`;
      }
    } catch { continue; }
  }
  return null;
}

function parseVisibleDate(text) {
  for (const pattern of VISIBLE_DATE_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    try {
      // Pattern 1: Month DD, YYYY
      if (pattern.source.startsWith('\\b(Jan')) {
        const month = MONTH_MAP[match[1].toLowerCase().slice(0, 3)];
        const day = padTwo(parseInt(match[2]));
        const year = match[3];
        if (month && year >= '2020') return `${year}-${month}-${day}`;
      }
      // Pattern 2: DD Month YYYY
      if (pattern.source.startsWith('\\b(\\d{1,2})\\s+(Jan')) {
        const day = padTwo(parseInt(match[1]));
        const month = MONTH_MAP[match[2].toLowerCase().slice(0, 3)];
        const year = match[3];
        if (month && year >= '2020') return `${year}-${month}-${day}`;
      }
      // Pattern 3: YYYY-MM-DD
      if (pattern.source.startsWith('\\b(\\d{4})-')) {
        const y = parseInt(match[1]);
        if (y >= 2020 && y <= 2030) return `${match[1]}-${match[2]}-${match[3]}`;
      }
      // Pattern 4: Mon DD, YYYY
      if (pattern.source.startsWith('\\b(Jan|Feb')) {
        const month = MONTH_MAP[match[1].toLowerCase().slice(0, 3)];
        const day = padTwo(parseInt(match[2]));
        const year = match[3];
        if (month && year >= '2020') return `${year}-${month}-${day}`;
      }
    } catch { continue; }
  }
  return null;
}

function normaliseDate(rawDate) {
  if (!rawDate) return null;
  try {
    // Handle ISO 8601 strings
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return null;
    const year = d.getFullYear();
    if (year < 2020 || year > 2030) return null;
    return `${year}-${padTwo(d.getMonth() + 1)}-${padTwo(d.getDate())}`;
  } catch { return null; }
}

/**
 * Main date verification function.
 *
 * @param {string} html - Full HTML content of the article page
 * @param {string} url - Article URL
 * @param {string|null} rssDate - Publication date from RSS feed (highest confidence if provided)
 * @param {object|null} headers - HTTP response headers (for Last-Modified fallback)
 * @returns {{ date: string|null, confidence: string, method: string, verified: boolean }}
 */
export function verifyDate(html, url, rssDate = null, headers = null) {
  // Method 1: RSS pubDate (highest confidence - embedded in feed XML)
  if (rssDate) {
    const d = normaliseDate(rssDate);
    if (d) return { date: d, confidence: 'high', method: 'rss-pubdate', verified: true };
  }

  const $ = cheerio.load(html || '');

  // Method 2: schema.org JSON-LD datePublished
  const scripts = $('script[type="application/ld+json"]');
  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).html();
      if (!raw) continue;
      // Handle arrays of JSON-LD objects
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const dateStr = item.datePublished || item.dateCreated ||
          (item['@graph'] && item['@graph'].find(n => n.datePublished)?.datePublished);
        if (dateStr) {
          const d = normaliseDate(dateStr);
          if (d) return { date: d, confidence: 'high', method: 'schema.org-jsonld', verified: true };
        }
      }
    } catch { continue; }
  }

  // Method 3: Open Graph article:published_time
  const ogDate = $('meta[property="article:published_time"]').attr('content') ||
    $('meta[property="og:article:published_time"]').attr('content');
  if (ogDate) {
    const d = normaliseDate(ogDate);
    if (d) return { date: d, confidence: 'high', method: 'opengraph', verified: true };
  }

  // Method 4: meta name date/pubdate tags
  const metaDate = $('meta[name="date"]').attr('content') ||
    $('meta[name="pubdate"]').attr('content') ||
    $('meta[name="publish-date"]').attr('content') ||
    $('meta[name="publication_date"]').attr('content') ||
    $('meta[itemprop="datePublished"]').attr('content') ||
    $('[itemprop="datePublished"]').attr('datetime') ||
    $('[itemprop="datePublished"]').attr('content');
  if (metaDate) {
    const d = normaliseDate(metaDate);
    if (d) return { date: d, confidence: 'high', method: 'meta-date', verified: true };
  }

  // Method 5: <time datetime="..."> elements near article header
  // Prefer time elements in header/article regions
  let timeDate = null;
  const timeSelectors = [
    'article time[datetime]',
    'header time[datetime]',
    '.article-date time[datetime]',
    '.publish-date time[datetime]',
    '.post-date time[datetime]',
    'time[datetime][class*="date"]',
    'time[datetime][class*="publish"]',
    'time[datetime]',
  ];
  for (const sel of timeSelectors) {
    const el = $(sel).first();
    if (el.length) {
      const dt = el.attr('datetime');
      if (dt) {
        const d = normaliseDate(dt);
        if (d) { timeDate = d; break; }
      }
    }
  }
  if (timeDate) {
    return { date: timeDate, confidence: 'medium-high', method: 'time-element', verified: true };
  }

  // Method 6: URL date pattern extraction
  const urlDate = parseUrlDate(url);
  if (urlDate) {
    return { date: urlDate, confidence: 'medium', method: 'url-pattern', verified: true };
  }

  // Method 7: Visible date text near article header
  // Extract text from header/article areas, look for date patterns
  const headerText = [
    $('article header').text(),
    $('header.article-header').text(),
    $('[class*="article-meta"]').text(),
    $('[class*="publish"]').text(),
    $('[class*="byline"]').text(),
    $('[class*="date"]').first().text(),
    $('article').find('p, span, div').first().text(),
  ].join(' ');

  const visibleDate = parseVisibleDate(headerText);
  if (visibleDate) {
    return { date: visibleDate, confidence: 'medium', method: 'visible-text', verified: true };
  }

  // Method 8: HTTP Last-Modified header (lowest confidence)
  if (headers) {
    const lastMod = headers['last-modified'];
    if (lastMod) {
      const d = normaliseDate(lastMod);
      if (d) return { date: d, confidence: 'low', method: 'last-modified', verified: true };
    }
  }

  // No date found
  return { date: null, confidence: 'none', method: 'unverified', verified: false };
}

/**
 * Check if a date string falls within the given window.
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} startDate - YYYY-MM-DD inclusive
 * @param {string} endDate - YYYY-MM-DD inclusive
 */
export function isInWindow(dateStr, startDate, endDate) {
  if (!dateStr) return false;
  return dateStr >= startDate && dateStr <= endDate;
}
