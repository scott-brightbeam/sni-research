/**
 * server.js - Local ingest server for SNI Research Tool
 *
 * HTTP endpoint that the Chrome extension and CLI tool talk to.
 * Receives article URLs (optionally with pre-captured HTML),
 * runs them through the same pipeline as the automated fetcher.
 *
 * Usage: bun scripts/server.js
 * Endpoint: POST http://localhost:3847/ingest
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import * as cheerio from 'cheerio';
import { slugify, fetchPage, extractArticleText, saveArticle } from './lib/extract.js';
import { verifyDate } from './verify.js';
import { assignSector, checkOffLimits } from './categorise.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const offLimits = yaml.load(readFileSync(join(ROOT, 'config', 'off-limits.yaml'), 'utf8'));

const VALID_SECTORS = new Set(['general', 'biopharma', 'medtech', 'manufacturing', 'insurance']);
const PORT = 3847;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Core ingest function — used by both the HTTP server and CLI tool.
 *
 * @param {object} body - { url, html?, title?, sectorOverride? }
 * @returns {object} Result with status/error fields. _status field indicates HTTP status code.
 */
export async function ingestArticle(body) {
  // 1. VALIDATE
  const url = body?.url;
  if (!url || typeof url !== 'string') {
    return { _status: 400, error: 'url is required' };
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { _status: 400, error: 'url must start with http:// or https://' };
  }

  // 2. FETCH (if no HTML provided by extension)
  let html = body.html || null;
  let headers = null;
  if (!html) {
    const result = await fetchPage(url);
    if (result.error || !result.html) {
      return { _status: 500, error: `Fetch failed: ${result.error || 'empty response'}` };
    }
    html = result.html;
    headers = result.headers;
  }

  // 3. PARSE
  const $ = cheerio.load(html);
  const fullText = extractArticleText($);
  let title = body.title || $('title').text() || $('h1').first().text() || '';
  title = title.replace(/\s+/g, ' ').trim();
  if (!title) title = 'Untitled';

  // 4. CONTENT GATE (lower bar than automated — user chose this article)
  if (fullText.length < 100) {
    return { _status: 400, error: `Content too short (${fullText.length} chars — page may be paywalled or empty)` };
  }

  // 5. DATE VERIFICATION
  const dateResult = verifyDate(html, url, null, headers);
  let dateWarning = null;
  if (!dateResult.verified) {
    dateResult.date = new Date().toISOString().slice(0, 10);
    dateResult.method = 'today-fallback';
    dateResult.confidence = 'none';
    dateWarning = 'Date could not be verified; using today\'s date';
  }

  // 6. SECTOR ASSIGNMENT
  let sector;
  let sectorOverrideFlag = false;
  if (body.sectorOverride && VALID_SECTORS.has(body.sectorOverride)) {
    sector = body.sectorOverride;
    sectorOverrideFlag = true;
  } else {
    sector = assignSector(title, fullText, null) || 'general';
  }

  // 7. OFF-LIMITS CHECK (warn but don't block — user explicitly chose this)
  const offLimitCheck = checkOffLimits(title, fullText, offLimits);

  // 8. DUPLICATE CHECK
  const slug = slugify(title);
  const targetPath = join(ROOT, 'data', 'verified', dateResult.date, sector, `${slug}.json`);
  if (existsSync(targetPath)) {
    return { status: 'duplicate', title, sector, date_published: dateResult.date };
  }

  // 9. BUILD ARTICLE OBJECT
  const article = {
    title,
    url,
    source: new URL(url).hostname.replace('www.', ''),
    source_type: 'manual',
    date_published: dateResult.date,
    date_verified_method: dateResult.method,
    date_confidence: dateResult.confidence,
    sector,
    keywords_matched: [],
    snippet: fullText.slice(0, 300),
    full_text: fullText,
    scraped_at: new Date().toISOString(),
    _raw_html: html.slice(0, 500000),
  };
  if (dateWarning) article.date_warning = dateWarning;
  if (sectorOverrideFlag) article.sector_override = true;

  // 10. SAVE
  const stats = { saved: 0, flagged: 0 };
  saveArticle(article, sector, stats);

  // 11. RESPOND
  return {
    status: 'saved',
    title,
    sector,
    date_published: dateResult.date,
    date_confidence: dateResult.confidence,
    date_method: dateResult.method,
    ...(dateWarning ? { date_warning: dateWarning } : {}),
    ...(offLimitCheck.blocked ? { off_limits_warning: offLimitCheck.reason } : {}),
  };
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    async fetch(req) {
      const reqUrl = new URL(req.url);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      // Health check
      if (req.method === 'GET' && reqUrl.pathname === '/health') {
        return Response.json({ status: 'ok' }, { headers: corsHeaders });
      }

      // Ingest endpoint
      if (req.method === 'POST' && reqUrl.pathname === '/ingest') {
        try {
          const body = await req.json();
          const result = await ingestArticle(body);
          const httpStatus = result._status || 200;
          delete result._status;
          return Response.json(result, { status: httpStatus, headers: corsHeaders });
        } catch (e) {
          if (e instanceof SyntaxError) {
            return Response.json(
              { error: 'Invalid JSON in request body' },
              { status: 400, headers: corsHeaders }
            );
          }
          return Response.json(
            { error: `Server error: ${e.message}` },
            { status: 500, headers: corsHeaders }
          );
        }
      }

      // 404 for everything else
      return Response.json({ error: 'Not found' }, { status: 404, headers: corsHeaders });
    },
  });
  console.log(`SNI Research Server listening on http://localhost:${PORT}`);
}
