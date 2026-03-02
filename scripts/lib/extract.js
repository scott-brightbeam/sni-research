/**
 * extract.js - Shared utility functions for SNI Research Tool
 *
 * Extracted from fetch.js so both the automated pipeline and
 * the manual ingest server can share the same code.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

// Lazy-loaded config for isPaywalled()
let sourcesConfig = null;

function loadSources() {
  if (!sourcesConfig) {
    sourcesConfig = yaml.load(readFileSync(join(ROOT, 'config', 'sources.yaml'), 'utf8'));
  }
  return sourcesConfig;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function ensureDir(dir) { mkdirSync(dir, { recursive: true }); }

export function isPaywalled(url) {
  const blocked = loadSources().paywall_domains || [];
  return blocked.some(domain => url.includes(domain));
}

export async function fetchPage(url, timeoutMs = 15000) {
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

export function extractArticleText($) {
  // Remove boilerplate elements that can leak keywords into article text.
  $('nav, footer, aside, [role="navigation"], [class*="sidebar"], [class*="footer"], [class*="nav-"], [class*="menu"], [class*="featured-stories"], [class*="related"]').remove();
  $('script, style, noscript').remove();

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

export function saveArticle(article, sector, stats) {
  const dateDir = article.date_published;
  const verifiedDir = join(ROOT, 'data', 'verified', dateDir, sector);
  const rawDir = join(ROOT, 'data', 'raw', dateDir, sector);
  ensureDir(verifiedDir);
  ensureDir(rawDir);

  const slug = slugify(article.title);
  const filename = `${slug}`;

  // Save metadata JSON — if this fails, skip MD and HTML for this article
  const jsonPath = join(verifiedDir, `${filename}.json`);
  try {
    writeFileSync(jsonPath, JSON.stringify(article, null, 2));
  } catch (err) {
    console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  Failed to save JSON for "${article.title?.slice(0, 50)}": ${err.message}`);
    return;
  }

  // Save readable MD — quote YAML frontmatter values to prevent injection
  // Titles containing : " ' # [ ] or newlines would break unquoted YAML
  const yamlStr = (s) => JSON.stringify(s || '');
  const mdContent = `---
title: ${yamlStr(article.title)}
url: ${yamlStr(article.url)}
source: ${yamlStr(article.source)}
date_published: ${article.date_published}
date_verified_method: ${article.date_verified_method}
date_confidence: ${article.date_confidence}
sector: ${sector}
scraped_at: ${article.scraped_at}
---

${article.full_text || article.snippet || ''}
`;
  try {
    writeFileSync(join(verifiedDir, `${filename}.md`), mdContent);
  } catch (err) {
    console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  Failed to save MD for "${article.title?.slice(0, 50)}": ${err.message}`);
  }

  // Save raw HTML
  if (article._raw_html) {
    try {
      writeFileSync(join(rawDir, `${filename}.html`), article._raw_html);
    } catch { /* raw HTML is non-critical */ }
  }

  stats.saved++;
  console.log(`[${new Date().toISOString().slice(11, 19)}] \u2713  Saved [${sector}] ${article.title.slice(0, 70)}`);
}

export function saveFlagged(article, reason, stats) {
  const flaggedDir = join(ROOT, 'data', 'flagged');
  ensureDir(flaggedDir);
  const slug = slugify(article.title || article.url);
  try {
    writeFileSync(
      join(flaggedDir, `${new Date().toISOString().slice(0, 10)}-${slug}.json`),
      JSON.stringify({ ...article, flagged_reason: reason }, null, 2)
    );
  } catch (err) {
    console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  Failed to save flagged article: ${err.message}`);
    return;
  }
  stats.flagged++;
  console.log(`[${new Date().toISOString().slice(11, 19)}]    Flagged: ${article.title?.slice(0, 60) || article.url} \u2014 ${reason}`);
}
