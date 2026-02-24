/**
 * fetch.js - Main SNI Research Tool fetcher
 *
 * Checks RSS feeds and Brave Search, verifies article dates, saves qualified articles.
 *
 * Usage:
 *   bun scripts/fetch.js --test              # Last 7 days
 *   bun scripts/fetch.js --start-date 2026-02-13 --end-date 2026-02-20
 *   bun scripts/fetch.js --sector insurance  # Single sector only
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { verifyDate, isInWindow } from './verify.js';
import { assignSector, checkOffLimits } from './categorise.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ───────────────────────────────────────────────────────────────────

const sourcesConfig = yaml.load(readFileSync(join(ROOT, 'config', 'sources.yaml'), 'utf8'));
const offLimits = yaml.load(readFileSync(join(ROOT, 'config', 'off-limits.yaml'), 'utf8'));
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const RATE_LIMIT_MS = 1500; // 1.5 seconds between requests
const MAX_ITEMS_PER_FEED = 20; // Cap per feed to prevent very large feeds stalling the run

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  ${msg}`); }
function ok(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ✓  ${msg}`); }
function skip(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}]    ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
}

function ensureDir(dir) { mkdirSync(dir, { recursive: true }); }

function getDateWindow(args) {
  const today = new Date();
  if (args.test) {
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: today.toISOString().slice(0, 10),
    };
  }
  if (args.startDate && args.endDate) {
    return { startDate: args.startDate, endDate: args.endDate };
  }
  // Default: today only
  const d = today.toISOString().slice(0, 10);
  return { startDate: d, endDate: d };
}

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--test') args.test = true;
    if (argv[i] === '--start-date') args.startDate = argv[++i];
    if (argv[i] === '--end-date') args.endDate = argv[++i];
    if (argv[i] === '--sector') args.sector = argv[++i];
  }
  return args;
}

function isPaywalled(url) {
  const blocked = sourcesConfig.paywall_domains || [];
  return blocked.some(domain => url.includes(domain));
}

// ─── HTTP Fetching ────────────────────────────────────────────────────────────

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function fetchPage(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: controller.signal,
      redirect: 'follow',
    });

    if (res.status === 403 || res.status === 401 || res.status === 429) {
      clearTimeout(timeout);
      return { error: `HTTP ${res.status}`, html: null, headers: null };
    }
    if (!res.ok) {
      clearTimeout(timeout);
      return { error: `HTTP ${res.status}`, html: null, headers: null };
    }

    // Race res.text() against the same timeout to prevent infinite hangs
    const html = await Promise.race([
      res.text(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('body-read-timeout')), timeoutMs)),
    ]);
    clearTimeout(timeout);
    const headers = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    return { html, headers, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.message, html: null, headers: null };
  }
}

// ─── Article Extraction ───────────────────────────────────────────────────────

function extractArticleText($) {
  // Try common article containers
  const selectors = [
    'article .article-body',
    'article .post-content',
    'article .entry-content',
    '[class*="article-content"]',
    '[class*="post-content"]',
    '[class*="story-body"]',
    'article',
    'main',
    '.content',
  ];
  for (const sel of selectors) {
    const el = $(sel);
    if (el.length) {
      const text = el.text().replace(/\s+/g, ' ').trim();
      if (text.length > 200) return text.slice(0, 10000);
    }
  }
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 10000);
}

// ─── File Saving ──────────────────────────────────────────────────────────────

function saveArticle(article, sector, stats) {
  const dateDir = article.date_published;
  const verifiedDir = join(ROOT, 'data', 'verified', dateDir, sector);
  const rawDir = join(ROOT, 'data', 'raw', dateDir, sector);
  ensureDir(verifiedDir);
  ensureDir(rawDir);

  const slug = slugify(article.title);
  const filename = `${slug}`;

  // Save metadata JSON
  const jsonPath = join(verifiedDir, `${filename}.json`);
  writeFileSync(jsonPath, JSON.stringify(article, null, 2));

  // Save readable MD
  const mdContent = `---
title: ${article.title}
url: ${article.url}
source: ${article.source}
date_published: ${article.date_published}
date_verified_method: ${article.date_verified_method}
date_confidence: ${article.date_confidence}
sector: ${sector}
scraped_at: ${article.scraped_at}
---

${article.full_text || article.snippet || ''}
`;
  writeFileSync(join(verifiedDir, `${filename}.md`), mdContent);

  // Save raw HTML
  if (article._raw_html) {
    writeFileSync(join(rawDir, `${filename}.html`), article._raw_html);
  }

  stats.saved++;
  ok(`Saved [${sector}] ${article.title.slice(0, 70)}`);
}

function saveFlagged(article, reason, stats) {
  const flaggedDir = join(ROOT, 'data', 'flagged');
  ensureDir(flaggedDir);
  const slug = slugify(article.title || article.url);
  writeFileSync(
    join(flaggedDir, `${new Date().toISOString().slice(0, 10)}-${slug}.json`),
    JSON.stringify({ ...article, flagged_reason: reason }, null, 2)
  );
  stats.flagged++;
  skip(`Flagged: ${article.title?.slice(0, 60) || article.url} — ${reason}`);
}

// ─── RSS Processing ───────────────────────────────────────────────────────────

const rssParser = new Parser({
  customFields: {
    item: ['pubDate', 'dc:date', 'published', 'updated'],
  },
  timeout: 10000,
});

async function processRssFeed(feedUrl, feedName, sector, window, stats, seen) {
  log(`RSS [${sector}] ${feedName}`);
  let feed;
  try {
    feed = await rssParser.parseURL(feedUrl);
  } catch (e) {
    warn(`Failed to fetch RSS ${feedUrl}: ${e.message}`);
    stats.feedErrors++;
    return;
  }

  log(`  ${feed.items.length} items in feed`);
  let processed = 0;
  let fetched = 0;

  for (const item of feed.items) {
    if (fetched >= MAX_ITEMS_PER_FEED) {
      skip(`Feed cap reached (${MAX_ITEMS_PER_FEED}) for ${feedName}`);
      break;
    }
    const url = item.link || item.url;
    if (!url || seen.has(url)) continue;

    // Quick date check from RSS before fetching full page
    const rssDate = item.pubDate || item['dc:date'] || item.published || item.updated || item.isoDate;
    let roughDate = null;
    if (rssDate) {
      try {
        const d = new Date(rssDate);
        if (!isNaN(d.getTime())) {
          roughDate = d.toISOString().slice(0, 10);
        }
      } catch { /* ignore */ }
    }

    // Pre-filter: skip if RSS date is clearly outside window (allow 1 day slack)
    if (roughDate) {
      const windowStart = new Date(window.startDate);
      windowStart.setDate(windowStart.getDate() - 1);
      const windowEnd = new Date(window.endDate);
      windowEnd.setDate(windowEnd.getDate() + 1);
      const articleDate = new Date(roughDate);
      if (articleDate < windowStart || articleDate > windowEnd) {
        continue;
      }
    }

    if (isPaywalled(url)) {
      skip(`Paywall skip: ${url}`);
      stats.paywalled++;
      continue;
    }

    seen.add(url);
    fetched++;

    // Fetch full page
    await sleep(RATE_LIMIT_MS);
    const { html, headers, error } = await fetchPage(url);
    if (error || !html) {
      warn(`Fetch error ${url}: ${error}`);
      stats.fetchErrors++;
      continue;
    }

    // Verify date
    const dateResult = verifyDate(html, url, rssDate, headers);
    if (!dateResult.verified) {
      saveFlagged({ title: item.title || '', url, source: feedName }, 'date-unverified', stats);
      continue;
    }

    if (!isInWindow(dateResult.date, window.startDate, window.endDate)) {
      skip(`Out of window (${dateResult.date}): ${item.title?.slice(0, 50)}`);
      continue;
    }

    // Extract text
    const $ = cheerio.load(html);
    const fullText = extractArticleText($);
    const title = item.title || $('title').text() || '';

    // Check off-limits
    const offLimitCheck = checkOffLimits(title, fullText, offLimits);
    if (offLimitCheck.blocked) {
      skip(`Off-limits [${offLimitCheck.reason}]: ${title.slice(0, 50)}`);
      stats.offLimits++;
      continue;
    }

    // Assign sector
    const assignedSector = assignSector(title, fullText, sector === 'cross_sector' ? null : sector);
    if (!assignedSector) {
      skip(`No sector match: ${title.slice(0, 50)}`);
      continue;
    }

    const article = {
      title: title.trim(),
      url,
      source: feedName,
      date_published: dateResult.date,
      date_verified_method: dateResult.method,
      date_confidence: dateResult.confidence,
      sector: assignedSector,
      keywords_matched: [],
      snippet: fullText.slice(0, 300),
      full_text: fullText,
      scraped_at: new Date().toISOString(),
      _raw_html: html.slice(0, 500000), // Cap raw HTML at 500KB
    };

    saveArticle(article, assignedSector, stats);
    processed++;
  }
  log(`  Processed ${processed} articles from ${feedName}`);
}

// ─── Brave Search Processing ──────────────────────────────────────────────────

async function searchBrave(query) {
  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not set - skipping general feed');
    return [];
  }
  try {
    const params = new URLSearchParams({
      q: query,
      count: '20',
      freshness: 'pw', // Past week
      search_lang: 'en',
    });
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: {
        'X-Subscription-Token': BRAVE_API_KEY,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      warn(`Brave API error ${res.status} for: ${query}`);
      return [];
    }
    const data = await res.json();
    return (data.web?.results || []).map(r => ({ url: r.url, title: r.title, snippet: r.description }));
  } catch (e) {
    warn(`Brave search error: ${e.message}`);
    return [];
  }
}

async function processGeneralFeed(window, stats, seen) {
  log('─── General AI Feed (Brave Search) ───');
  const queries = sourcesConfig.general_search_queries || [];
  log(`Running ${queries.length} search queries`);

  for (const query of queries) {
    log(`  Search: ${query}`);
    await sleep(RATE_LIMIT_MS);
    const results = await searchBrave(query);
    log(`  → ${results.length} results`);

    for (const result of results) {
      const url = result.url;
      if (!url || seen.has(url)) continue;
      if (isPaywalled(url)) {
        stats.paywalled++;
        continue;
      }

      seen.add(url);
      await sleep(RATE_LIMIT_MS);
      const { html, headers, error } = await fetchPage(url);
      if (error || !html) {
        stats.fetchErrors++;
        continue;
      }

      // IMPORTANT: Never trust Brave's date metadata - always verify from page
      const dateResult = verifyDate(html, url, null, headers);
      if (!dateResult.verified) {
        saveFlagged({ title: result.title || '', url, source: 'Brave Search' }, 'date-unverified', stats);
        continue;
      }

      if (!isInWindow(dateResult.date, window.startDate, window.endDate)) {
        skip(`Out of window (${dateResult.date}): ${result.title?.slice(0, 50)}`);
        continue;
      }

      const $ = cheerio.load(html);
      const fullText = extractArticleText($);
      const title = result.title || $('title').text() || '';

      const offLimitCheck = checkOffLimits(title, fullText, offLimits);
      if (offLimitCheck.blocked) {
        skip(`Off-limits: ${title.slice(0, 50)}`);
        stats.offLimits++;
        continue;
      }

      const assignedSector = assignSector(title, fullText, null);
      if (!assignedSector) continue;

      // For general feed, prefer 'general' sector unless clearly sector-specific
      const finalSector = assignedSector;

      const article = {
        title: title.trim(),
        url,
        source: new URL(url).hostname.replace('www.', ''),
        date_published: dateResult.date,
        date_verified_method: dateResult.method,
        date_confidence: dateResult.confidence,
        sector: finalSector,
        keywords_matched: [],
        snippet: fullText.slice(0, 300),
        full_text: fullText,
        scraped_at: new Date().toISOString(),
        _raw_html: html.slice(0, 500000),
      };

      saveArticle(article, finalSector, stats);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const window = getDateWindow(args);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Fetch');
  console.log(`  Date window: ${window.startDate} → ${window.endDate}`);
  if (args.test) console.log('  Mode: TEST (last 7 days)');
  if (args.sector) console.log(`  Sector filter: ${args.sector}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not configured - general feed will be skipped');
  }

  const stats = {
    saved: 0,
    flagged: 0,
    fetchErrors: 0,
    feedErrors: 0,
    paywalled: 0,
    offLimits: 0,
    startTime: Date.now(),
  };

  const seen = new Set(); // URL deduplication across all sources

  const rssFeeds = sourcesConfig.rss_feeds || {};
  const sectorOrder = ['biopharma', 'medtech', 'manufacturing', 'insurance', 'cross_sector'];

  // Process RSS feeds
  for (const sector of sectorOrder) {
    if (args.sector && sector !== args.sector && sector !== 'cross_sector') continue;
    const feeds = rssFeeds[sector];
    if (!feeds) continue;

    console.log('');
    log(`─── Sector: ${sector.toUpperCase()} ───`);
    for (const feed of feeds) {
      await processRssFeed(feed.url, feed.name, sector, window, stats, seen);
    }
  }

  // Process general AI feed via Brave Search
  if (!args.sector || args.sector === 'general') {
    console.log('');
    await processGeneralFeed(window, stats, seen);
  }

  // Summary
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(0);
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Fetch Complete');
  console.log(`  Saved:        ${stats.saved} articles`);
  console.log(`  Flagged:      ${stats.flagged} (date unverified)`);
  console.log(`  Off-limits:   ${stats.offLimits}`);
  console.log(`  Fetch errors: ${stats.fetchErrors}`);
  console.log(`  Paywalled:    ${stats.paywalled}`);
  console.log(`  Time:         ${elapsed}s`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`Run next: bun scripts/report.js ${args.test ? '--test' : `--start-date ${window.startDate} --end-date ${window.endDate}`}`);

  // Save run stats
  ensureDir(join(ROOT, 'data'));
  writeFileSync(
    join(ROOT, 'data', `last-run-${window.endDate}.json`),
    JSON.stringify({ ...stats, window, elapsed: `${elapsed}s`, completedAt: new Date().toISOString() }, null, 2)
  );
}

// Catch unhandled rejections (e.g. from AbortController edge cases) without crashing
process.on('unhandledRejection', (reason) => {
  console.warn(`[unhandledRejection] ${reason}`);
});

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
