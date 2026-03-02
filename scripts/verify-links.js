#!/usr/bin/env bun
/**
 * verify-links.js — Link verification for SNI draft reports
 *
 * Extracts all markdown links from a draft, fetches each URL, and checks:
 *   - HTTP status (dead links, timeouts)
 *   - Content match (does the page mention the entity from the anchor text?)
 *   - Paywall detection (known paywall domains)
 *
 * Rate-limited: 1.5s between requests, extra 3s between same-domain requests.
 *
 * Usage:
 *   bun scripts/verify-links.js --draft output/draft-week-9.md
 *   bun scripts/verify-links.js --draft output/draft-week-9.md --dry-run
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fetchPage, isPaywalled } from './lib/extract.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const LINK_CHECK_RATE_MS = 1500;
const LINK_SAME_DOMAIN_EXTRA_MS = 3000;
const NETWORK_FAIL_THRESHOLD = 0.8;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Link extraction ─────────────────────────────────────────────────────────

/**
 * Extract all markdown links from text.
 * Returns array of { url, anchorText, line }.
 */
function extractLinks(markdown) {
  const lines = markdown.split('\n');
  const links = [];
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

  for (let i = 0; i < lines.length; i++) {
    let match;
    while ((match = linkPattern.exec(lines[i])) !== null) {
      links.push({
        anchorText: match[1].trim(),
        url: match[2].trim(),
        line: i + 1,
      });
    }
  }

  // Deduplicate by URL (same URL may appear in tl;dr and body)
  const seen = new Set();
  return links.filter(link => {
    if (seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

/**
 * Extract the primary entity name from anchor text.
 * Takes the first 3 significant words (skips articles and prepositions).
 */
function extractEntity(anchorText) {
  const stopwords = new Set(['the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'with', 'its', 'on', 'at', 'by', 'from', 'as']);
  const words = anchorText
    .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !stopwords.has(w.toLowerCase()));
  return words.slice(0, 3).join(' ');
}

/**
 * Get the domain from a URL.
 */
function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// ─── Link verification ──────────────────────────────────────────────────────

/**
 * Verify a single link.
 * Fetches the URL, checks HTTP status and content match.
 *
 * @returns {LinkCheckResult}
 */
async function verifyLink(url, anchorText) {
  const startMs = Date.now();

  // Paywall check (no fetch needed)
  if (isPaywalled(url)) {
    return {
      url,
      status: 'paywall',
      httpStatus: null,
      entityFound: false,
      responseTimeMs: Date.now() - startMs,
      error: null,
    };
  }

  // Fetch the page
  const { html, error } = await fetchPage(url, 15000);

  if (error) {
    const isTimeout = error.includes('abort') || error.includes('timeout');
    return {
      url,
      status: isTimeout ? 'timeout' : 'dead',
      httpStatus: error.match(/HTTP (\d+)/)?.[1] ? parseInt(error.match(/HTTP (\d+)/)[1]) : null,
      entityFound: false,
      responseTimeMs: Date.now() - startMs,
      error,
    };
  }

  if (!html) {
    return {
      url,
      status: 'dead',
      httpStatus: null,
      entityFound: false,
      responseTimeMs: Date.now() - startMs,
      error: 'No HTML content returned',
    };
  }

  // Content match: check if entity from anchor text appears in page
  const entity = extractEntity(anchorText);
  const pageText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const entityLower = entity.toLowerCase();

  // Split entity into words and check if each word appears
  const entityWords = entityLower.split(/\s+/).filter(w => w.length > 2);
  const matchCount = entityWords.filter(w => pageText.includes(w)).length;
  const entityFound = entityWords.length === 0 || matchCount >= Math.ceil(entityWords.length * 0.5);

  return {
    url,
    status: entityFound ? 'ok' : 'content_mismatch',
    httpStatus: 200,
    entityFound,
    responseTimeMs: Date.now() - startMs,
    error: null,
  };
}

// ─── Main function ───────────────────────────────────────────────────────────

/**
 * Run link verification on a draft.
 *
 * @param {object} args
 * @param {string} args.draft — path to draft markdown file
 * @param {boolean} [args.dryRun] — extract links only, skip fetches
 * @returns {{ linksPath: string, results: LinkCheckResult[], summary: object }}
 */
export async function runLinkCheck(args) {
  const startTime = Date.now();
  const draftPath = args.draft;

  if (!draftPath || !existsSync(draftPath)) {
    throw new Error(`Draft file not found: ${draftPath}`);
  }

  log(`Reading draft: ${draftPath}`);
  const draftText = readFileSync(draftPath, 'utf8');

  const links = extractLinks(draftText);
  log(`Found ${links.length} unique links`);

  if (links.length === 0) {
    warn('No links found in draft');
    return { linksPath: null, results: [], summary: { total: 0, ok: 0, dead: 0, timeout: 0, mismatch: 0, paywall: 0 } };
  }

  // Determine week number from filename
  const weekMatch = draftPath.match(/week-(\d+)/i);
  const weekNum = weekMatch ? weekMatch[1] : 'unknown';

  if (args.dryRun) {
    log('Dry run — listing links without verification:');
    for (const link of links) {
      console.log(`  Line ${link.line}: [${link.anchorText.slice(0, 50)}](${link.url})`);
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    ok(`Dry run complete in ${elapsed}s — would verify ${links.length} links`);
    return {
      linksPath: null,
      results: [],
      summary: { total: links.length, ok: 0, dead: 0, timeout: 0, mismatch: 0, paywall: 0, mode: 'dry-run' },
    };
  }

  // Verify each link with rate limiting
  const results = [];
  let lastDomain = '';
  let networkErrors = 0;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const domain = getDomain(link.url);
    const progress = `[${i + 1}/${links.length}]`;

    // Rate limiting
    if (i > 0) {
      await sleep(LINK_CHECK_RATE_MS);
      if (domain === lastDomain) {
        await sleep(LINK_SAME_DOMAIN_EXTRA_MS);
      }
    }
    lastDomain = domain;

    log(`${progress} Checking: ${link.url.slice(0, 80)}...`);
    const result = await verifyLink(link.url, link.anchorText);
    results.push(result);

    // Track network errors
    if (result.status === 'dead' || result.status === 'timeout') {
      const isNetworkError = result.error &&
        (result.error.includes('fetch failed') ||
         result.error.includes('ECONNREFUSED') ||
         result.error.includes('ECONNRESET') ||
         result.error.includes('abort') ||
         result.error.includes('timeout') ||
         result.error.includes('network'));
      if (isNetworkError) networkErrors++;
    }

    // Status indicator
    const statusIcon = result.status === 'ok' ? '✓' :
                       result.status === 'paywall' ? '⊘' :
                       result.status === 'content_mismatch' ? '?' : '✗';
    log(`${progress} ${statusIcon} ${result.status} (${result.responseTimeMs}ms)`);

    // Early abort if network appears down
    if (i >= 3 && networkErrors / (i + 1) > NETWORK_FAIL_THRESHOLD) {
      warn('Network appears unavailable — aborting link verification');
      break;
    }
  }

  // Compile summary
  const summary = {
    total: links.length,
    checked: results.length,
    ok: results.filter(r => r.status === 'ok').length,
    dead: results.filter(r => r.status === 'dead').length,
    timeout: results.filter(r => r.status === 'timeout').length,
    mismatch: results.filter(r => r.status === 'content_mismatch').length,
    paywall: results.filter(r => r.status === 'paywall').length,
    networkAbort: results.length < links.length,
  };

  // Save results
  const outputDir = join(ROOT, 'output');
  const linksPath = join(outputDir, `links-week-${weekNum}.json`);
  const output = { summary, results };
  try {
    writeFileSync(linksPath, JSON.stringify(output, null, 2), 'utf8');
    ok(`Link results saved to ${linksPath}`);
  } catch (e) {
    warn(`Failed to save link results: ${e.message}`);
  }

  // Log summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`Link check summary: ${summary.ok} ok, ${summary.dead} dead, ${summary.timeout} timeout, ${summary.mismatch} mismatch, ${summary.paywall} paywall`);
  if (summary.dead > 0) warn(`Dead links: ${results.filter(r => r.status === 'dead').map(r => r.url).join(', ')}`);
  if (summary.mismatch > 0) warn(`Content mismatches: ${results.filter(r => r.status === 'content_mismatch').map(r => r.url).join(', ')}`);
  ok(`Done in ${elapsed}s — ${summary.ok}/${summary.checked} verified`);

  return { linksPath, results, summary };
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--draft')   { args.draft = argv[++i]; continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
  }

  if (!args.draft) {
    console.error('Usage: bun scripts/verify-links.js --draft <path> [--dry-run]');
    process.exit(1);
  }

  runLinkCheck(args)
    .then(({ summary }) => {
      log(`Result: ${summary.ok}/${summary.total} ok`);
      process.exit(0);
    })
    .catch(err => {
      warn(`Fatal: ${err.message}`);
      process.exit(1);
    });
}
