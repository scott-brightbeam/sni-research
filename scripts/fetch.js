/**
 * fetch.js - Main SNI Research Tool fetcher
 *
 * Checks RSS feeds and Brave Search, verifies article dates, saves qualified articles.
 *
 * Usage:
 *   bun scripts/fetch.js --test              # Last 7 days
 *   bun scripts/fetch.js --week 9            # ISO week 9 of current year (Mon–Fri)
 *   bun scripts/fetch.js --week 9 --year 2026
 *   bun scripts/fetch.js --start-date 2026-02-13 --end-date 2026-02-20
 *   bun scripts/fetch.js --sector insurance  # Single sector only
 *   bun scripts/fetch.js --layer L1         # Run only Layer 1 queries
 *   bun scripts/fetch.js --dry-run           # Show what would happen, skip fetches
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { verifyDate, isInWindow } from './verify.js';
import { assignSector, checkOffLimits } from './categorise.js';
import { slugify, ensureDir, fetchPage, isPaywalled, extractArticleText,
         saveArticle, saveFlagged, USER_AGENT } from './lib/extract.js';
import { getWeekWindow } from './lib/week.js';
import { loadQueries } from './lib/queries.js';
import { scrapeHeadlines, searchHeadlineOnBrave, loadSourceHealth, saveSourceHealth, shouldSkipSource, recordSuccess, recordFailure } from './lib/headlines.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Config ───────────────────────────────────────────────────────────────────

const sourcesConfig = yaml.load(readFileSync(join(ROOT, 'config', 'sources.yaml'), 'utf8'));
const searchQueriesConfig = yaml.load(readFileSync(join(ROOT, 'config', 'search-queries.yaml'), 'utf8'));
const offLimits = yaml.load(readFileSync(join(ROOT, 'config', 'off-limits.yaml'), 'utf8'));
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const RATE_LIMIT_MS = 1500; // 1.5 seconds between requests
const MAX_ITEMS_PER_FEED = 20; // Cap per feed to prevent very large feeds stalling the run

// Only these sector keys pass a hint to assignSector().
// All other feed categories (cross_sector, ai_labs, tech_press, etc.) are categorised purely by content.
const HINT_SECTORS = new Set(['biopharma', 'medtech', 'manufacturing', 'insurance']);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function warn(msg) { console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  ${msg}`); }
function ok(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ✓  ${msg}`); }
function skip(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}]    ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getDateWindow(args) {
  // --week flag takes precedence (uses lib/week.js ISO week calculation)
  if (args.week) {
    const year = args.year || new Date().getFullYear();
    const { start, end } = getWeekWindow(args.week, year);
    return { startDate: start, endDate: end };
  }
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--test') args.test = true;
    if (argv[i] === '--start-date') args.startDate = argv[++i];
    if (argv[i] === '--end-date') args.endDate = argv[++i];
    if (argv[i] === '--sector') args.sector = argv[++i];
    if (argv[i] === '--week') args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year') args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--layer') args.layer = argv[++i];
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  return args;
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

    seen.set(url, { path: null, foundBy: [`RSS: ${feedName}`] });
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

    // Gate: skip thin/paywalled content
    if (fullText.length < 300) {
      skip(`Content too short (${fullText.length} chars, likely paywalled): ${title.slice(0, 50)}`);
      stats.paywalled++;
      continue;
    }

    // Check off-limits
    const offLimitCheck = checkOffLimits(title, fullText, offLimits);
    if (offLimitCheck.blocked) {
      skip(`Off-limits [${offLimitCheck.reason}]: ${title.slice(0, 50)}`);
      stats.offLimits++;
      continue;
    }

    // Assign sector
    const assignedSector = assignSector(title, fullText, HINT_SECTORS.has(sector) ? sector : null);
    if (!assignedSector) {
      skip(`No sector match: ${title.slice(0, 50)}`);
      continue;
    }

    const article = {
      title: title.trim(),
      url,
      source: feedName,
      source_type: 'automated',
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

    article.found_by = [`RSS: ${feedName}`];
    const jsonPath = saveArticle(article, assignedSector, stats);
    if (jsonPath) {
      const entry = seen.get(url);
      if (entry) entry.path = jsonPath;
    }
    processed++;
  }
  log(`  Processed ${processed} articles from ${feedName}`);
}

// ─── Brave Search Processing ──────────────────────────────────────────────────

async function searchBrave(query, freshness = 'pw') {
  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not set - skipping search');
    return [];
  }
  try {
    const params = new URLSearchParams({
      q: query,
      count: '20',
      freshness: freshness,
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

async function processSearchQueries(window, stats, seen, args) {
  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not set - skipping search queries');
    return;
  }

  const queryWindow = { start: window.startDate, end: window.endDate, sector: args.sector };
  const queries = loadQueries(searchQueriesConfig.search_queries, queryWindow);

  // Determine which layers to run
  const layerFilter = args.layer ? args.layer.toUpperCase() : null;
  const layers = [
    { name: 'L1', items: queries.layer1 },
    { name: 'L2', items: queries.layer2 },
    { name: 'L3', items: queries.layer3 },
    { name: 'L4', items: queries.layer4 },
  ];

  for (const layer of layers) {
    if (layerFilter && layerFilter !== layer.name) continue;
    if (layer.items.length === 0) continue;

    console.log('');
    log(`─── ${layer.name}: ${layer.items.length} queries ───`);

    for (const q of layer.items) {
      log(`  Search: ${q.label}`);
      await sleep(RATE_LIMIT_MS);
      const results = await searchBrave(q.query, q.freshness);
      log(`  → ${results.length} results`);

      // Track per-query stats
      const qStats = { results: results.length, new: 0, saved: 0, paywalled: 0, errors: 0 };

      for (const result of results) {
        const url = result.url;
        if (!url) continue;

        // Duplicate: accumulate found_by without re-fetching
        if (seen.has(url)) {
          const entry = seen.get(url);
          if (!entry.foundBy.includes(q.label)) {
            entry.foundBy.push(q.label);
          }
          continue;
        }

        if (isPaywalled(url)) {
          stats.paywalled++;
          qStats.paywalled++;
          continue;
        }

        qStats.new++;
        seen.set(url, { path: null, foundBy: [q.label] });

        await sleep(RATE_LIMIT_MS);
        const { html, headers, error } = await fetchPage(url);
        if (error || !html) {
          stats.fetchErrors++;
          qStats.errors++;
          continue;
        }

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

        if (fullText.length < 300) {
          skip(`Content too short (${fullText.length} chars, likely paywalled): ${title.slice(0, 50)}`);
          stats.paywalled++;
          qStats.paywalled++;
          continue;
        }

        const offLimitCheck = checkOffLimits(title, fullText, offLimits);
        if (offLimitCheck.blocked) {
          skip(`Off-limits: ${title.slice(0, 50)}`);
          stats.offLimits++;
          continue;
        }

        const sectorHint = q.sector && HINT_SECTORS.has(q.sector) ? q.sector : null;
        const assignedSector = assignSector(title, fullText, sectorHint);
        if (!assignedSector) continue;

        const article = {
          title: title.trim(),
          url,
          source: new URL(url).hostname.replace('www.', ''),
          source_type: 'automated',
          date_published: dateResult.date,
          date_verified_method: dateResult.method,
          date_confidence: dateResult.confidence,
          sector: assignedSector,
          keywords_matched: [],
          snippet: fullText.slice(0, 300),
          full_text: fullText,
          scraped_at: new Date().toISOString(),
          found_by: [q.label],
          _raw_html: html.slice(0, 500000),
        };

        const jsonPath = saveArticle(article, assignedSector, stats);
        if (jsonPath) {
          const entry = seen.get(url);
          if (entry) entry.path = jsonPath;
          qStats.saved++;
        }
      }

      stats.queryStats[q.label] = qStats;
    }
  }
}

async function processHeadlines(window, stats, seen, args) {
  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not set - skipping headlines');
    return;
  }

  const sources = searchQueriesConfig.headline_sources || [];
  if (sources.length === 0) return;

  console.log('');
  log(`─── Headlines: ${sources.length} sources ───`);

  const healthMap = loadSourceHealth(join(ROOT, 'data'));

  for (const source of sources) {
    if (shouldSkipSource(healthMap, source.name)) {
      skip(`Skipping unhealthy source: ${source.name}`);
      continue;
    }

    log(`  Scraping: ${source.name}`);
    const { headlines, error } = await scrapeHeadlines(source);

    if (error) {
      warn(`  Failed: ${source.name} — ${error}`);
      recordFailure(healthMap, source.name, error);
      stats.headlineStats.errors++;
      stats.headlineStats.perSource[source.name] = { headlines: 0, searched: 0, found: 0, errors: 1 };
      continue;
    }

    recordSuccess(healthMap, source.name);
    log(`  → ${headlines.length} headlines`);
    stats.headlineStats.sources++;
    stats.headlineStats.headlines += headlines.length;

    const srcStats = { headlines: headlines.length, searched: 0, found: 0, errors: 0 };
    stats.headlineStats.perSource[source.name] = srcStats;

    for (const hl of headlines) {
      stats.headlineStats.searched++;
      srcStats.searched++;
      const braveResults = await searchHeadlineOnBrave(hl.headline, BRAVE_API_KEY);

      for (const result of braveResults) {
        const url = result.url;
        if (!url) continue;

        const hlLabel = `HL: ${source.name} — ${hl.headline.slice(0, 60)}`;

        if (seen.has(url)) {
          const entry = seen.get(url);
          if (!entry.foundBy.includes(hlLabel)) {
            entry.foundBy.push(hlLabel);
          }
          continue;
        }

        if (isPaywalled(url)) {
          stats.paywalled++;
          continue;
        }

        seen.set(url, { path: null, foundBy: [hlLabel] });
        stats.headlineStats.found++;
        srcStats.found++;

        await sleep(RATE_LIMIT_MS);
        const { html, headers, error: fetchError } = await fetchPage(url);
        if (fetchError || !html) {
          stats.fetchErrors++;
          continue;
        }

        const dateResult = verifyDate(html, url, null, headers);
        if (!dateResult.verified) {
          saveFlagged({ title: result.title || '', url, source: source.name }, 'date-unverified', stats);
          continue;
        }

        if (!isInWindow(dateResult.date, window.startDate, window.endDate)) {
          skip(`Out of window (${dateResult.date}): ${result.title?.slice(0, 50)}`);
          continue;
        }

        const $ = cheerio.load(html);
        const fullText = extractArticleText($);
        const title = result.title || $('title').text() || '';

        if (fullText.length < 300) {
          skip(`Content too short (${fullText.length} chars): ${title.slice(0, 50)}`);
          stats.paywalled++;
          continue;
        }

        const offLimitCheck = checkOffLimits(title, fullText, offLimits);
        if (offLimitCheck.blocked) {
          skip(`Off-limits: ${title.slice(0, 50)}`);
          stats.offLimits++;
          continue;
        }

        const assignedSector = assignSector(title, fullText, null);
        if (!assignedSector) continue;

        const article = {
          title: title.trim(),
          url,
          source: new URL(url).hostname.replace('www.', ''),
          source_type: 'automated',
          date_published: dateResult.date,
          date_verified_method: dateResult.method,
          date_confidence: dateResult.confidence,
          sector: assignedSector,
          keywords_matched: [],
          snippet: fullText.slice(0, 300),
          full_text: fullText,
          scraped_at: new Date().toISOString(),
          found_by: [hlLabel],
          _raw_html: html.slice(0, 500000),
        };

        const jsonPath = saveArticle(article, assignedSector, stats);
        if (jsonPath) {
          const entry = seen.get(url);
          if (entry) entry.path = jsonPath;
        }
      }
    }
  }

  saveSourceHealth(join(ROOT, 'data'), healthMap);
}

function reconcileFoundBy(seen) {
  let reconciled = 0;
  for (const [url, entry] of seen) {
    if (entry.foundBy.length > 1 && entry.path) {
      try {
        const existing = JSON.parse(readFileSync(entry.path, 'utf8'));
        const merged = [...new Set([...(existing.found_by || []), ...entry.foundBy])];
        existing.found_by = merged;
        writeFileSync(entry.path, JSON.stringify(existing, null, 2));
        reconciled++;
      } catch {
        // Non-critical — skip silently
      }
    }
  }
  if (reconciled > 0) {
    log(`Reconciled ${reconciled} articles with multiple discovery sources`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runFetch(args = {}) {
  const window = getDateWindow(args);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Fetch');
  console.log(`  Date window: ${window.startDate} → ${window.endDate}`);
  if (args.test) console.log('  Mode: TEST (last 7 days)');
  if (args.week) console.log(`  Mode: WEEK ${args.week}${args.year ? ` (${args.year})` : ''}`);
  if (args.sector) console.log(`  Sector filter: ${args.sector}`);
  if (args.layer) console.log(`  Layer filter: ${args.layer}`);
  if (args.dryRun) console.log('  Mode: DRY RUN');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  if (!BRAVE_API_KEY) {
    warn('BRAVE_API_KEY not configured - general feed will be skipped');
  }

  // Dry-run: show what would happen without fetching
  if (args.dryRun) {
    const rssFeeds = sourcesConfig.rss_feeds || {};
    let totalFeeds = 0;
    for (const sector of ['biopharma', 'medtech', 'manufacturing', 'insurance', 'cross_sector', 'ai_labs', 'tech_press', 'newsletters', 'wire_services']) {
      const feeds = rssFeeds[sector];
      if (!feeds) continue;
      if (args.sector && HINT_SECTORS.has(sector) && sector !== args.sector) continue;
      log(`  ${sector}: ${feeds.length} feeds`);
      totalFeeds += feeds.length;
    }

    // Show per-layer query counts
    const queryWindow = { start: window.startDate, end: window.endDate, sector: args.sector };
    const queries = loadQueries(searchQueriesConfig.search_queries, queryWindow);
    const layerFilter = args.layer ? args.layer.toUpperCase() : null;

    const layerCounts = { L1: queries.layer1.length, L2: queries.layer2.length, L3: queries.layer3.length, L4: queries.layer4.length };
    for (const [name, count] of Object.entries(layerCounts)) {
      if (layerFilter && layerFilter !== name) continue;
      log(`  ${name}: ${count} queries`);
    }

    const headlineSources = searchQueriesConfig.headline_sources || [];
    if (!layerFilter || layerFilter === 'HEADLINES') {
      log(`  Headlines: ${headlineSources.length} sources`);
    }

    const totalQueries = Object.entries(layerCounts)
      .filter(([name]) => !layerFilter || layerFilter === name)
      .reduce((sum, [, count]) => sum + count, 0);

    log(`Would fetch ${totalFeeds} RSS feeds, ${totalQueries} Brave queries, ${headlineSources.length} headline sources`);
    return { dryRun: true, totalFeeds, braveQueries: totalQueries, headlineSources: headlineSources.length, window };
  }

  const stats = {
    saved: 0,
    flagged: 0,
    fetchErrors: 0,
    feedErrors: 0,
    paywalled: 0,
    offLimits: 0,
    queryStats: {},
    headlineStats: { sources: 0, headlines: 0, searched: 0, found: 0, errors: 0, perSource: {} },
    startTime: Date.now(),
  };

  const seen = new Map(); // URL → { path, foundBy[] } for deduplication + attribution

  const rssFeeds = sourcesConfig.rss_feeds || {};
  const sectorOrder = [
    'biopharma', 'medtech', 'manufacturing', 'insurance',
    'cross_sector', 'ai_labs', 'tech_press', 'newsletters', 'wire_services',
  ];

  // Process RSS feeds
  const shouldRunRss = !args.layer || args.layer.toLowerCase() === 'rss';
  if (shouldRunRss) {
    for (const sector of sectorOrder) {
      if (args.sector && HINT_SECTORS.has(sector) && sector !== args.sector) continue;
      const feeds = rssFeeds[sector];
      if (!feeds) continue;

      console.log('');
      log(`─── Sector: ${sector.toUpperCase()} ───`);
      for (const feed of feeds) {
        await processRssFeed(feed.url, feed.name, sector, window, stats, seen);
      }
    }
  }

  // Process search queries (L1–L4) — always run unless --layer filters
  if (!args.layer || ['L1','L2','L3','L4'].includes(args.layer.toUpperCase())) {
    await processSearchQueries(window, stats, seen, args);
  }

  // Process headlines — scrape paywalled index pages + search for open copies
  if (!args.layer || args.layer.toLowerCase() === 'headlines') {
    await processHeadlines(window, stats, seen, args);
  }

  // Reconcile found_by for articles discovered by multiple sources
  reconcileFoundBy(seen);

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
  console.log(`  Queries:      ${Object.keys(stats.queryStats).length} executed`);
  console.log(`  Headlines:    ${stats.headlineStats.sources} sources, ${stats.headlineStats.headlines} scraped, ${stats.headlineStats.found} found`);
  console.log(`  Time:         ${elapsed}s`);
  console.log('═══════════════════════════════════════════════');
  console.log('');
  console.log(`Run next: bun scripts/report.js ${args.test ? '--test' : `--start-date ${window.startDate} --end-date ${window.endDate}`}`);

  // Save run stats
  const runStats = { ...stats, window, elapsed: `${elapsed}s`, completedAt: new Date().toISOString() };
  try {
    ensureDir(join(ROOT, 'data'));
    writeFileSync(
      join(ROOT, 'data', `last-run-${window.endDate}.json`),
      JSON.stringify(runStats, null, 2)
    );
  } catch (err) {
    warn(`Failed to save run stats: ${err.message}`);
  }

  return runStats;
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  // Catch unhandled rejections (e.g. from AbortController edge cases) without crashing
  process.on('unhandledRejection', (reason) => {
    console.warn(`[unhandledRejection] ${reason}`);
  });

  const args = parseArgs(process.argv.slice(2));
  runFetch(args)
    .then(stats => {
      if (stats.dryRun) {
        log(`Result: dry-run (${stats.totalFeeds} feeds, ${stats.braveQueries} Brave queries, ${stats.headlineSources} headline sources)`);
      } else {
        log(`Result: saved=${stats.saved} flagged=${stats.flagged} errors=${stats.fetchErrors}`);
      }
      process.exit(0);
    })
    .catch(e => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
}
