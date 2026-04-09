#!/usr/bin/env bun
/**
 * ainewshub-fetch.js — Fetch AI news articles from AI NewsHub (ainewshub.ie)
 *
 * AI NewsHub aggregates from 7,000+ media sources with pre-enriched metadata:
 * NLP summaries, sentiment analysis, bias detection, topic & sector tags.
 *
 * Authenticates via JWT, fetches latest articles by country (IE, GB, EU, US),
 * maps to SNI article schema, deduplicates against existing corpus, and saves
 * to data/verified/ using the standard pipeline format.
 *
 * Designed to run at 03:30 daily, before the 04:00 Brave fetch.
 *
 * Usage:
 *   bun scripts/ainewshub-fetch.js                    # All countries, default page size
 *   bun scripts/ainewshub-fetch.js --country IE       # Ireland only
 *   bun scripts/ainewshub-fetch.js --page-size 100    # More articles per country
 *   bun scripts/ainewshub-fetch.js --days 3            # Articles from last 3 days
 *   bun scripts/ainewshub-fetch.js --dry-run           # Preview without saving
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadEnvKey } from './lib/env.js';
import { saveArticle, slugify } from './lib/extract.js';
import { assignSector } from './categorise.js';
import { sendTelegram } from './lib/telegram.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Configuration ───────────────────────────────────────────────────────────

const API_BASE = 'https://api.ainewshub.ie';
const SOURCE_TYPE = 'ainewshub';

/** Countries to fetch, with their API codes and labels */
const COUNTRIES = [
  { code: 'IE', label: 'Ireland' },
  { code: 'GB', label: 'UK' },
  { code: 'EU', label: 'EU' },
  { code: 'US', label: 'USA' },
];

/**
 * Map AI NewsHub industry_sectors to SNI sectors.
 * Their 12 sectors → our 5. Unmapped sectors fall through to assignSector().
 */
const SECTOR_MAP = {
  'Healthcare': null,       // Could be biopharma or medtech — let assignSector decide
  'Finance': 'insurance',   // Closest SNI sector
  'Energy': 'manufacturing',
  'Regulations': null,      // Cross-cutting — let assignSector decide
  'Agriculture': null,      // Let assignSector decide (could be manufacturing)
  'Education': 'general',
  'Tech': 'general',
  'Legal': 'general',
  'Arts': 'general',
  'Communication': 'general',
  'Food': 'general',
  'Sports': 'general',
};

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] || defaultVal;
}
const hasFlag = (name) => args.includes(`--${name}`);

const PAGE_SIZE = parseInt(getArg('page-size', '50'), 10);
const DAYS_BACK = parseInt(getArg('days', '7'), 10);
const COUNTRY_FILTER = getArg('country', null);
const DRY_RUN = hasFlag('dry-run');

// ─── Logging ─────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 19);
const log = (msg) => console.log(`[${ts()}] ${msg}`);
const warn = (msg) => console.warn(`[${ts()}] ⚠  ${msg}`);

// ─── Auth ────────────────────────────────────────────────────────────────────

async function authenticate() {
  const email = loadEnvKey('AINEWSHUB_EMAIL');
  const password = loadEnvKey('AINEWSHUB_PASSWORD');

  if (!email || !password) {
    console.error('Missing AINEWSHUB_EMAIL or AINEWSHUB_PASSWORD in .env');
    process.exit(1);
  }

  log('Authenticating with AI NewsHub...');
  const resp = await fetch(`${API_BASE}/auth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`Authentication failed (${resp.status}): ${body}`);
    process.exit(1);
  }

  const data = await resp.json();
  const token = data.access || data.token;
  if (!token) {
    console.error('No access token in auth response');
    process.exit(1);
  }

  log('✓ Authenticated');
  return token;
}

// ─── Fetch articles ──────────────────────────────────────────────────────────

async function fetchArticles(token, countryCode, pageSize) {
  const url = `${API_BASE}/contents/articles/?page_size=${pageSize}&country=${countryCode}&ordering=-published_date`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!resp.ok) {
    warn(`Failed to fetch ${countryCode} articles (${resp.status})`);
    return [];
  }

  const data = await resp.json();
  return data.results || [];
}

// ─── Existing article index ──────────────────────────────────────────────────

/**
 * Build a Set of normalised URLs from existing data/verified/ articles
 * for the relevant date range, to avoid saving duplicates.
 */
function buildExistingUrlIndex(cutoffDate) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  const urls = new Set();

  if (!existsSync(verifiedDir)) return urls;

  for (const dateDir of readdirSync(verifiedDir)) {
    // Only check date dirs in our range
    if (dateDir < cutoffDate) continue;

    const datePath = join(verifiedDir, dateDir);
    try {
      for (const sectorDir of readdirSync(datePath)) {
        const sectorPath = join(datePath, sectorDir);
        try {
          for (const file of readdirSync(sectorPath)) {
            if (!file.endsWith('.json')) continue;
            try {
              const article = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'));
              if (article.url) urls.add(normaliseUrl(article.url));
            } catch { /* skip malformed files */ }
          }
        } catch { /* skip unreadable sector dirs */ }
      }
    } catch { /* skip unreadable date dirs */ }
  }

  return urls;
}

function normaliseUrl(url) {
  return url
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^http:/, 'https:');
}

// ─── Article mapping ─────────────────────────────────────────────────────────

/**
 * Map an AI NewsHub article to the SNI article schema.
 * Returns null if the article should be skipped (too old, no URL, etc.).
 */
function mapArticle(raw, cutoffDate) {
  if (!raw.external_url || !raw.title) return null;

  // Parse and validate date
  const pubDate = raw.published_date ? new Date(raw.published_date) : null;
  if (!pubDate || isNaN(pubDate.getTime())) return null;

  const dateStr = pubDate.toISOString().slice(0, 10); // YYYY-MM-DD
  if (dateStr < cutoffDate) return null;

  // Extract their enriched metadata
  const topicNames = (raw.topics || []).map(t => t.name).join(', ');
  const sectorNames = (raw.industry_sectors || []).map(s => s.name);
  const publisherName = raw.publisher?.name || 'Unknown';
  const sentiment = raw.metadata?.['llm__sentiment__analysis__tags'] || '';
  const biasInfo = raw.metadata?.['llm__bias_detection__tags'] || '';

  // Use their NLP summary as the article text. We don't fetch full text
  // from the original source — that's what our Brave pipeline does.
  // AI NewsHub's value is the curated metadata + discovery signal.
  const summary = raw.summary || raw.description || '';
  const snippet = summary.slice(0, 300);

  // Determine SNI sector:
  // 1. Check if their sector maps directly to an SNI sector
  // 2. Fall back to assignSector() keyword matching on title + summary
  let sector = 'general';
  for (const name of sectorNames) {
    const mapped = SECTOR_MAP[name];
    if (mapped) {
      sector = mapped;
      break;
    }
  }
  // If no direct mapping, use keyword-based assignment
  if (sector === 'general') {
    const keywordSector = assignSector(raw.title, summary, null);
    if (keywordSector) sector = keywordSector;
  }

  return {
    title: raw.title.trim(),
    url: raw.external_url,
    source: publisherName,
    source_type: SOURCE_TYPE,
    date_published: dateStr,
    date_verified_method: 'ainewshub-api',
    date_confidence: 'high',
    sector,
    keywords_matched: [],
    snippet,
    full_text: summary,
    found_by: [`AINewsHub: ${raw.country || 'mixed'}`],
    scraped_at: new Date().toISOString(),
    // Preserve AI NewsHub enrichments as extra fields
    ainewshub: {
      id: raw.id,
      topics: topicNames,
      industry_sectors: sectorNames.join(', '),
      sentiment,
      bias: biasInfo,
      country: raw.country,
      publisher_country: raw.publisher?.country || '',
    },
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  log('═══ AI NewsHub Fetch ═══');
  log(`Page size: ${PAGE_SIZE} | Days back: ${DAYS_BACK} | Dry run: ${DRY_RUN}`);

  const cutoffDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  log(`Cutoff date: ${cutoffDate}`);

  // Authenticate
  const token = await authenticate();

  // Build dedup index
  log('Building existing article index for deduplication...');
  const existingUrls = buildExistingUrlIndex(cutoffDate);
  log(`Found ${existingUrls.size} existing articles in date range`);

  // Determine which countries to fetch
  const countries = COUNTRY_FILTER
    ? COUNTRIES.filter(c => c.code === COUNTRY_FILTER.toUpperCase())
    : COUNTRIES;

  if (countries.length === 0) {
    console.error(`Unknown country code: ${COUNTRY_FILTER}`);
    process.exit(1);
  }

  const stats = {
    fetched: 0,
    skipped_old: 0,
    skipped_no_url: 0,
    skipped_duplicate: 0,
    saved: 0,
    errors: 0,
    newestDate: null,
  };

  for (const { code, label } of countries) {
    log(`\n── Fetching ${label} (${code}) ──`);

    const articles = await fetchArticles(token, code, PAGE_SIZE);
    log(`Received ${articles.length} articles from API`);
    stats.fetched += articles.length;

    for (const raw of articles) {
      // Track the newest date seen from the API
      const rawDate = raw.published_date ? raw.published_date.slice(0, 10) : null;
      if (rawDate && (!stats.newestDate || rawDate > stats.newestDate)) stats.newestDate = rawDate;

      const mapped = mapArticle(raw, cutoffDate);
      if (!mapped) {
        stats.skipped_old++;
        continue;
      }

      // Dedup against existing corpus
      const normUrl = normaliseUrl(mapped.url);
      if (existingUrls.has(normUrl)) {
        stats.skipped_duplicate++;
        continue;
      }

      if (DRY_RUN) {
        log(`  [dry-run] Would save [${mapped.sector}] ${mapped.title.slice(0, 70)}`);
        stats.saved++;
        existingUrls.add(normUrl);
        continue;
      }

      try {
        saveArticle(mapped, mapped.sector, stats);
        existingUrls.add(normUrl); // Prevent dupes within this run
      } catch (err) {
        warn(`Failed to save "${mapped.title.slice(0, 50)}": ${err.message}`);
        stats.errors++;
      }
    }
  }

  // Summary
  log('\n═══ Summary ═══');
  log(`Fetched:    ${stats.fetched}`);
  log(`Saved:      ${stats.saved}`);
  log(`Duplicates: ${stats.skipped_duplicate}`);
  log(`Too old:    ${stats.skipped_old}`);
  log(`Errors:     ${stats.errors}`);
  if (stats.newestDate) log(`Newest API article: ${stats.newestDate} (cutoff: ${cutoffDate})`);

  if (stats.saved > 0) {
    log(`\n✓ ${stats.saved} new articles added to data/verified/`);
  } else {
    log('\nNo new articles to add.');
  }

  // Staleness alert: if we fetched articles but saved none and ALL were too old,
  // the API's ingestion pipeline has likely stalled. Alert via Telegram.
  if (!DRY_RUN && stats.fetched > 0 && stats.saved === 0 && stats.skipped_duplicate === 0 && stats.skipped_old === stats.fetched) {
    const msg = `⚠️ <b>AI NewsHub API stall detected</b>\n\n`
      + `Fetched ${stats.fetched} articles — ALL rejected as too old (cutoff: ${cutoffDate}).\n`
      + `The API has not ingested new content since approximately 30 March 2026.\n\n`
      + `Action: check ainewshub.ie status or contact support.`
    warn('API STALL: All fetched articles are older than cutoff — sending alert');
    await sendTelegram(msg).catch(err => warn(`Telegram alert failed: ${err.message}`));
  }
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
