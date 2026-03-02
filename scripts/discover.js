#!/usr/bin/env bun
/**
 * discover.js — Multi-model story discovery for SNI Research Tool
 *
 * Sends the scored article list to GPT-5.2 and Gemini Pro 3.1.
 * Each model independently identifies stories the RSS + Brave fetch missed.
 * New URLs are fetched, date-verified, saved and marked for scoring.
 *
 * Usage:
 *   bun scripts/discover.js --week 9
 *   bun scripts/discover.js --week 9 --year 2026
 *   bun scripts/discover.js --week 9 --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as cheerio from 'cheerio';
import { callBothModels, availableProviders } from './lib/multi-model.js';
import { loadPrompt, renderPrompt } from './lib/prompt.js';
import { getWeekWindow, getISOWeekNumber } from './lib/week.js';
import { fetchPage, isPaywalled, extractArticleText, saveArticle, slugify, ensureDir } from './lib/extract.js';
import { verifyDate, isInWindow } from './verify.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MAX_CANDIDATES_PER_MODEL = 15;
const MAX_URLS_TO_FETCH = 30;
const FETCH_DELAY_MS = 1500;
const VALID_SECTORS = new Set(['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']);

// ─── Article list builder ─────────────────────────────────────────────────────

/**
 * Load all verified articles for the week and build a compact summary.
 */
function loadExistingArticles(dateWindow) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return { articles: [], urls: new Set(), summary: '' };

  const articles = [];
  const urls = new Set();
  const dateDirs = readdirSync(verifiedDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name >= dateWindow.start && d.name <= dateWindow.end)
    .map(d => d.name);

  for (const dateDir of dateDirs) {
    const datePath = join(verifiedDir, dateDir);
    const sectorDirs = readdirSync(datePath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    for (const sectorDir of sectorDirs) {
      const sectorPath = join(datePath, sectorDir);
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'));
          articles.push({
            title: raw.title,
            source: raw.source,
            sector: raw.sector || sectorDir,
            url: raw.url,
          });
          urls.add(raw.url);
        } catch { /* skip corrupt */ }
      }
    }
  }

  // Build compact summary for the prompt
  const lines = articles.map(a =>
    `- [${a.sector}] "${a.title}" (${a.source})`
  );

  return { articles, urls, summary: lines.join('\n') };
}

// ─── Candidate processing ─────────────────────────────────────────────────────

/**
 * Parse and validate candidates from a model response.
 */
function parseCandidates(parsed, providerName) {
  if (!parsed?.missing_stories || !Array.isArray(parsed.missing_stories)) {
    warn(`${providerName}: no missing_stories array in response`);
    return [];
  }

  return parsed.missing_stories
    .slice(0, MAX_CANDIDATES_PER_MODEL)
    .filter(s => {
      if (!s.url || !s.title) {
        warn(`${providerName}: skipping candidate without url/title`);
        return false;
      }
      if (!s.url.startsWith('http')) {
        warn(`${providerName}: skipping non-HTTP URL: ${s.url}`);
        return false;
      }
      return true;
    })
    .map(s => ({
      title: s.title,
      url: s.url,
      source: s.source || 'unknown',
      sector: VALID_SECTORS.has(s.sector) ? s.sector : 'general',
      reason: s.reason || '',
      suggested_by: providerName,
    }));
}

/**
 * Deduplicate candidates by URL and title similarity.
 */
function deduplicateCandidates(candidates, existingUrls) {
  const seen = new Set();
  const seenTitles = new Set();

  return candidates.filter(c => {
    // Exact URL match against existing
    if (existingUrls.has(c.url)) return false;

    // Exact URL dedup among candidates
    if (seen.has(c.url)) return false;
    seen.add(c.url);

    // Title similarity dedup (normalised)
    const normTitle = c.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    if (seenTitles.has(normTitle)) return false;
    seenTitles.add(normTitle);

    return true;
  });
}

/**
 * Fetch a candidate URL, verify date, extract content and save.
 */
async function processCandidate(candidate, dateWindow, dryRun) {
  const { url, sector, title } = candidate;

  if (isPaywalled(url)) {
    return { status: 'skipped', reason: 'paywall' };
  }

  if (dryRun) {
    return { status: 'dry-run', reason: 'would fetch' };
  }

  // Fetch page
  const { html, headers, error } = await fetchPage(url);
  if (error || !html) {
    return { status: 'failed', reason: `fetch error: ${error}` };
  }

  // Parse and extract
  const $ = cheerio.load(html);

  // Verify date
  const dateResult = verifyDate(html, url, null, headers);
  if (!dateResult.verified) {
    return { status: 'failed', reason: 'date not verified' };
  }
  if (!isInWindow(dateResult.date, dateWindow.start, dateWindow.end)) {
    return { status: 'failed', reason: `date ${dateResult.date} outside window` };
  }

  // Extract article text
  const fullText = extractArticleText($);
  const snippet = fullText.slice(0, 300);

  // Build article object matching fetch.js format
  const article = {
    title: candidate.title,
    url,
    source: candidate.source,
    date_published: dateResult.date,
    date_verified_method: dateResult.method,
    date_confidence: dateResult.confidence,
    sector,
    snippet,
    full_text: fullText,
    scraped_at: new Date().toISOString(),
    source_stage: 'discover',
    discovered_by: candidate.suggested_by,
    discover_reason: candidate.reason,
    _raw_html: html,
  };

  // Save using existing saveArticle utility
  const stats = { saved: 0 };
  saveArticle(article, sector, stats);

  if (stats.saved > 0) {
    return { status: 'added', date: dateResult.date };
  }
  return { status: 'failed', reason: 'save failed' };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run multi-model story discovery.
 *
 * @param {object} args
 * @param {number} args.week
 * @param {number} [args.year]
 * @param {boolean} [args.dryRun]
 * @returns {Promise<object>} stats
 */
export async function runDiscover(args = {}) {
  const startTime = Date.now();

  if (!args.week) {
    args.week = getISOWeekNumber(new Date().toISOString().slice(0, 10));
    log(`No --week specified, using current week: ${args.week}`);
  }
  const year = args.year || new Date().getFullYear();
  const dateWindow = getWeekWindow(args.week, year);
  const dryRun = !!args.dryRun;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Multi-Model Discovery');
  console.log(`  Week ${args.week}, ${year}`);
  console.log(`  Date window: ${dateWindow.start} → ${dateWindow.end}`);
  if (dryRun) console.log('  DRY RUN — no fetches or saves');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Check provider availability
  const providers = availableProviders();
  if (!providers.openai && !providers.gemini) {
    warn('No multi-model API keys configured. Skipping discovery.');
    return { candidatesFromOpenAI: 0, candidatesFromGemini: 0, totalCandidates: 0, fetched: 0, dateVerified: 0, added: 0, failed: 0, errors: ['No API keys'] };
  }
  log(`Providers: OpenAI=${providers.openai ? 'yes' : 'no'}, Gemini=${providers.gemini ? 'yes' : 'no'}`);

  // Load existing articles
  const { articles, urls: existingUrls, summary } = loadExistingArticles(dateWindow);
  log(`Existing articles: ${articles.length}`);

  if (articles.length === 0) {
    warn('No existing articles found. Run fetch + score first.');
    return { candidatesFromOpenAI: 0, candidatesFromGemini: 0, totalCandidates: 0, fetched: 0, dateVerified: 0, added: 0, failed: 0, errors: [] };
  }

  // Build prompt
  const { template } = loadPrompt('discover');
  const prompt = renderPrompt(template, {
    start_date: dateWindow.start,
    end_date: dateWindow.end,
    article_list: `Week ${args.week}, ${year} (${dateWindow.start} to ${dateWindow.end})\n` +
      `Sectors: General AI, Biopharma, MedTech, Complex Manufacturing, Insurance\n\n` +
      `Articles already collected (${articles.length} total):\n${summary}`,
  });

  // Call both models
  log('Calling GPT-5.2 and Gemini Pro 3.1 in parallel...');
  const results = await callBothModels(prompt);

  const stats = {
    candidatesFromOpenAI: 0,
    candidatesFromGemini: 0,
    totalCandidates: 0,
    fetched: 0,
    dateVerified: 0,
    added: 0,
    failed: 0,
    errors: [],
  };

  // Parse candidates from each model
  let allCandidates = [];

  if (results.openai.parsed) {
    const openaiCandidates = parseCandidates(results.openai.parsed, 'GPT-5.2');
    stats.candidatesFromOpenAI = openaiCandidates.length;
    allCandidates.push(...openaiCandidates);
    ok(`GPT-5.2: ${openaiCandidates.length} candidates`);
  } else {
    stats.errors.push(`OpenAI: ${results.openai.error}`);
    warn(`GPT-5.2 failed: ${results.openai.error}`);
  }

  if (results.gemini.parsed) {
    const geminiCandidates = parseCandidates(results.gemini.parsed, 'Gemini-Pro-3.1');
    stats.candidatesFromGemini = geminiCandidates.length;
    allCandidates.push(...geminiCandidates);
    ok(`Gemini Pro 3.1: ${geminiCandidates.length} candidates`);
  } else {
    stats.errors.push(`Gemini: ${results.gemini.error}`);
    warn(`Gemini Pro 3.1 failed: ${results.gemini.error}`);
  }

  // Deduplicate
  const candidates = deduplicateCandidates(allCandidates, existingUrls)
    .slice(0, MAX_URLS_TO_FETCH);
  stats.totalCandidates = candidates.length;
  log(`Unique candidates after dedup: ${candidates.length}`);

  if (candidates.length === 0) {
    ok('No new candidates to process');
  } else {
    // Process each candidate
    for (const candidate of candidates) {
      log(`Processing: ${candidate.title.slice(0, 60)}...`);
      try {
        const result = await processCandidate(candidate, dateWindow, dryRun);
        stats.fetched++;

        if (result.status === 'added') {
          stats.dateVerified++;
          stats.added++;
          ok(`Added: ${candidate.title.slice(0, 60)}`);
        } else if (result.status === 'dry-run') {
          ok(`[DRY RUN] Would fetch: ${candidate.title.slice(0, 60)}`);
        } else {
          stats.failed++;
          warn(`Skipped: ${candidate.title.slice(0, 50)} — ${result.reason}`);
        }
      } catch (err) {
        stats.failed++;
        warn(`Error processing ${candidate.url}: ${err.message}`);
      }

      // Rate limit between fetches
      if (!dryRun) await sleep(FETCH_DELAY_MS);
    }
  }

  // Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Discovery Complete');
  console.log(`  Time: ${elapsed}s`);
  console.log(`  GPT-5.2 candidates: ${stats.candidatesFromOpenAI}`);
  console.log(`  Gemini Pro 3.1 candidates: ${stats.candidatesFromGemini}`);
  console.log(`  After dedup: ${stats.totalCandidates}`);
  console.log(`  Added to verified: ${stats.added}`);
  console.log(`  Failed/skipped: ${stats.failed}`);
  if (stats.errors.length > 0) {
    console.log(`  Errors: ${stats.errors.join('; ')}`);
  }
  console.log('═══════════════════════════════════════════════');
  console.log('');

  return stats;
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  process.on('unhandledRejection', (reason) => {
    console.warn(`[unhandledRejection] ${reason}`);
  });

  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')    args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')    args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--dry-run') args.dryRun = true;
  }

  runDiscover(args)
    .then(stats => {
      log(`Result: candidates=${stats.totalCandidates} added=${stats.added} failed=${stats.failed}`);
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
