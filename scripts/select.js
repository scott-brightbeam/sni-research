#!/usr/bin/env bun
/**
 * select.js — Multi-model story selection pipeline for SNI Research Tool
 *
 * Parallel scoring tracks + final Opus selection:
 *   Track A (General AI):
 *     A1. Opus scores ~200 articles (1–10)
 *     A2. Gemini+Search checks coverage volume (top 20)
 *     A3. Opus combines scores + coverage → ~10–15 picks
 *   Track B (Verticals):
 *     B1. Opus scores all vertical articles (1–10)
 *     B2. GPT scores independently
 *     B3. Opus evaluates both score sets → per-sector picks
 *   Final:
 *     Opus selects ~25–30 from merged pool (~40–50 stories)
 *
 * Usage:
 *   bun scripts/select.js --week 9
 *   bun scripts/select.js --week 9 --year 2026
 *   bun scripts/select.js --week 9 --dry-run
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, renderPrompt, countTokens, loadSectorNames } from './lib/prompt.js';
import { getWeekWindow } from './lib/week.js';
import { withRetry } from './lib/retry.js';
import { loadEnvKey } from './lib/env.js';
import { callModel, callGeminiWithSearch, extractJSON, withConcurrency } from './lib/multi-model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT = join(ROOT, 'output');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// ─── Model config ─────────────────────────────────────────────────────────────

const MODEL = 'claude-opus-4-6';

// ─── Sector config ────────────────────────────────────────────────────────────

const sectorNames = loadSectorNames();
const SECTOR_ORDER = Object.entries(sectorNames)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key]) => key);

// ─── URL normalisation ────────────────────────────────────────────────────────

/**
 * Normalise a URL for consistent matching.
 * Strips query/anchor, trailing slashes, normalises http→https.
 * @param {string} url
 * @returns {string}
 */
export function normaliseUrl(url) {
  return url
    .replace(/^\*{1,2}/, '')   // strip leading ** markdown bold
    .replace(/\*{1,2}$/, '')   // strip trailing **
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^http:/, 'https:');
}

// ─── Article loading ──────────────────────────────────────────────────────────

/**
 * Load verified articles for selection.
 * Similar to draft.js loadArticles() but extracts 350-word excerpts from full_text
 * and stores jsonPath for full-text loading in Step 2.
 *
 * @param {{ start: string, end: string }} dateWindow
 * @returns {{ articles: object[], articleIndex: Map<string, object> }}
 */
export function loadArticlesForSelection(dateWindow) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return { articles: [], articleIndex: new Map() };

  // Look back 7 extra days (matching draft.js pattern)
  const extendedStart = new Date(dateWindow.start + 'T00:00:00Z');
  extendedStart.setUTCDate(extendedStart.getUTCDate() - 7);
  const lookbackDate = extendedStart.toISOString().slice(0, 10);

  const articles = [];
  const dateDirs = readdirSync(verifiedDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name >= lookbackDate && d.name <= dateWindow.end)
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
          const jsonPath = join(sectorPath, file);
          const raw = JSON.parse(readFileSync(jsonPath, 'utf8'));

          const fullText = raw.full_text?.trim() || '';
          const excerpt = fullText
            ? fullText.split(/\s+/).slice(0, 350).join(' ')
            : (raw.snippet || raw.title);
          const hasFullText = fullText.length > 100;

          articles.push({
            title: raw.title,
            url: raw.url,
            source: raw.source,
            date_published: raw.date_published,
            sector: raw.sector || 'general',
            confidence: raw.confidence || 'medium',
            score_reason: raw.score_reason || '',
            excerpt,
            jsonPath,
            _hasFullText: hasFullText,
          });
        } catch { /* skip corrupt files */ }
      }
    }
  }

  // Deduplicate by normalised URL
  const seen = new Set();
  const deduped = articles.filter(a => {
    const norm = normaliseUrl(a.url);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });

  // Sort: high confidence first, then by date desc
  const confOrder = { high: 0, medium: 1, low: 2 };
  const sorted = deduped.sort((a, b) => {
    const ca = confOrder[a.confidence] ?? 1;
    const cb = confOrder[b.confidence] ?? 1;
    if (ca !== cb) return ca - cb;
    return b.date_published.localeCompare(a.date_published);
  });

  // Build articleIndex: Map<normalisedUrl, articleObject>
  const articleIndex = new Map();
  for (const a of sorted) {
    articleIndex.set(normaliseUrl(a.url), a);
  }

  return { articles: sorted, articleIndex };
}

// ─── Published reference loading ──────────────────────────────────────────────

/**
 * Load a recent published newsletter as quality/format reference.
 * Walks back from week N-1 up to 4 weeks.
 *
 * When running retroactively (e.g. week 9 with week-9.md already published),
 * still uses week-8 — the editorial bar should come from a prior issue.
 *
 * @param {number} week
 * @param {number} year
 * @returns {{ week: number, text: string }}
 */
function loadPublishedReference(week, year) {
  const publishedDir = join(OUTPUT, 'published');
  for (let w = week - 1; w >= Math.max(1, week - 4); w--) {
    const p = join(publishedDir, `week-${w}.md`);
    if (existsSync(p)) {
      return { week: w, text: readFileSync(p, 'utf8') };
    }
  }
  throw new Error('No published newsletter found. Need at least one in output/published/');
}

// ─── Group articles by sector ─────────────────────────────────────────────────

/**
 * Group articles by sector in canonical order.
 * @param {object[]} articles
 * @returns {Map<string, object[]>}
 */
function groupBySector(articles) {
  const grouped = new Map();
  for (const sector of SECTOR_ORDER) {
    const sectorArticles = articles.filter(a => a.sector === sector);
    if (sectorArticles.length > 0) {
      grouped.set(sector, sectorArticles);
    }
  }
  // Catch any articles in sectors not in SECTOR_ORDER
  for (const a of articles) {
    if (!SECTOR_ORDER.includes(a.sector)) {
      if (!grouped.has(a.sector)) grouped.set(a.sector, []);
      grouped.get(a.sector).push(a);
    }
  }
  return grouped;
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/**
 * Parse a shortlist response (Round 1 or triage rounds).
 * Handles both ---SHORTLIST--- and ---UPDATED SHORTLIST--- delimiters.
 *
 * @param {string} response
 * @param {Map<string, object>} articleIndex
 * @param {string} roundLabel — e.g. 'Round 1', 'Triage (Gemini)'
 * @returns {object[]} — shortlisted article objects with `reasoning` field added
 */
function parseShortlist(response, articleIndex, roundLabel) {
  const shortlist = [];

  // Strategy 1: delimited format (---SHORTLIST--- / ---UPDATED SHORTLIST---)
  const block = response.match(/---(?:UPDATED )?SHORTLIST---([\s\S]+?)---END (?:UPDATED )?SHORTLIST---/);
  if (block) {
    const lines = block[1].trim().split('\n').filter(l => l.trim());
    for (const line of lines) {
      const urlMatch = line.match(/https?:\/\/[^\s|]+/);
      if (!urlMatch) {
        if (line.match(/^\d+\./)) warn(`  Skipping unparseable line: ${line.slice(0, 80)}`);
        continue;
      }
      const url = normaliseUrl(urlMatch[0]);
      const article = articleIndex.get(url);
      if (!article) { warn(`  URL not in article pool: ${url}`); continue; }
      const reasoning = line.split('|').slice(2).join('|').trim() || '';
      shortlist.push({ ...article, reasoning });
    }
  }

  // Strategy 2: markdown format — numbered items with **URL:** and **Reasoning:** fields
  if (shortlist.length === 0) {
    log(`  ${roundLabel}: no delimited block found, trying markdown format...`);
    // Split on numbered items (1. **URL:** ... or 1. https://...)
    const entries = [...response.matchAll(/\d+\.\s+\*\*URL:\*\*\s*(https?:\/\/[^\s\n]+)/g)];
    if (entries.length > 0) {
      for (const entry of entries) {
        const url = normaliseUrl(entry[1]);
        const article = articleIndex.get(url);
        if (!article) { warn(`  URL not in article pool: ${url}`); continue; }
        // Extract reasoning from the text after the URL match
        const startIdx = entry.index + entry[0].length;
        const nextEntry = response.indexOf('\n\n', startIdx + 1);
        const chunk = response.slice(startIdx, nextEntry > 0 ? nextEntry : startIdx + 500);
        const reasonMatch = chunk.match(/\*\*Reasoning:\*\*\s*(.+)/);
        const reasoning = reasonMatch ? reasonMatch[1].trim() : '';
        shortlist.push({ ...article, reasoning });
      }
    }
  }

  // Strategy 3: numbered list with bold URL — e.g. `1. **https://...** \n Sector: ... \n Reasoning text`
  if (shortlist.length === 0) {
    log(`  ${roundLabel}: trying numbered bold-URL format...`);
    const boldUrlMatches = [...response.matchAll(/\d+\.\s+\*{1,2}(https?:\/\/[^\s*]+)\*{0,2}/g)];
    if (boldUrlMatches.length > 0) {
      for (const entry of boldUrlMatches) {
        const url = normaliseUrl(entry[1]);
        const article = articleIndex.get(url);
        if (!article) { warn(`  URL not in article pool: ${url}`); continue; }
        // Grab reasoning from text after the URL line until next numbered entry or section header
        const startIdx = entry.index + entry[0].length;
        const nextEntry = response.slice(startIdx).search(/\n\d+\.\s+\*{1,2}https?:|\n###?\s/);
        const chunk = response.slice(startIdx, nextEntry > 0 ? startIdx + nextEntry : startIdx + 500);
        // Reasoning is the non-Sector text (skip the "Sector: ..." line)
        const reasonLines = chunk.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('Sector:'));
        const reasoning = reasonLines.join(' ').trim();
        shortlist.push({ ...article, reasoning });
      }
    }
  }

  // Strategy 4: any URL on its own line with surrounding context
  if (shortlist.length === 0) {
    log(`  ${roundLabel}: no structured format found, trying bare URL extraction...`);
    const urlMatches = [...response.matchAll(/https?:\/\/[^\s\n|)*]+/g)];
    const seen = new Set();
    for (const m of urlMatches) {
      const url = normaliseUrl(m[0]);
      if (seen.has(url)) continue;
      seen.add(url);
      const article = articleIndex.get(url);
      if (!article) continue;
      shortlist.push({ ...article, reasoning: '' });
    }
  }

  if (shortlist.length === 0) {
    throw new Error(`${roundLabel}: could not parse any shortlisted stories from response`);
  }

  if (shortlist.length < 10) {
    throw new Error(`${roundLabel}: only ${shortlist.length} stories shortlisted (min 10)`);
  }
  if (shortlist.length > 40) {
    warn(`  ${roundLabel}: ${shortlist.length} stories shortlisted (expected 25-35)`);
  }

  return shortlist;
}



// ─── Track A prompt builders (General AI) ─────────────────────────────────────

/**
 * Build the Step A1 prompt: score all General AI articles.
 * @param {object[]} articles — General AI articles with excerpts
 * @param {{ week: number, text: string }} publishedRef
 * @returns {string}
 */
function buildScoringPromptGeneral(articles, publishedRef) {
  const { template } = loadPrompt('select-score-general');

  const articleLines = [];
  for (const a of articles) {
    articleLines.push(`### ${a.title}`);
    articleLines.push(`Source: ${a.source} | ${a.date_published} | Confidence: ${a.confidence}`);
    articleLines.push(`URL: ${a.url}`);
    articleLines.push(a.excerpt);
    articleLines.push('');
  }

  return renderPrompt(template, {
    published_reference: publishedRef.text,
    article_list: articleLines.join('\n'),
  });
}

/**
 * Build a coverage volume check prompt for a single article (Step A2).
 * @param {object} article
 * @param {{ start: string, end: string }} dateWindow
 * @returns {string}
 */
function buildCoveragePrompt(article, dateWindow) {
  const first100Words = article.excerpt.split(/\s+/).slice(0, 100).join(' ');
  return `How many distinct news articles were published about this specific event during ${dateWindow.start} to ${dateWindow.end}?

Event: ${article.title}
Key details: ${first100Words}

Search for news coverage of this specific event. Count all distinct articles (not just the sources I provided — search broadly).

Respond as JSON:
{
  "total_count": <number of distinct articles found>,
  "sources": [<UP TO 10 of the most prominent articles, each with "publication" and "title">],
  "notes": "<brief qualitative assessment of coverage breadth>"
}`;
}

/**
 * Build the Step A3 prompt: final General AI selection with scores + coverage.
 * @param {object[]} top20WithCoverage — articles with score, reasoning, coverage data
 * @param {{ week: number, text: string }} publishedRef
 * @returns {string}
 */
function buildFinalGeneralPrompt(top20WithCoverage, publishedRef) {
  const { template } = loadPrompt('select-final-general');

  const articleLines = [];
  for (const a of top20WithCoverage) {
    articleLines.push(`### ${a.title}`);
    articleLines.push(`URL: ${a.url}`);
    articleLines.push(`Score: ${a.score}/10 — ${a.reasoning}`);
    articleLines.push(`Coverage: ${a.coverageCount} distinct articles`);
    if (a.coverageNotes) articleLines.push(`Coverage notes: ${a.coverageNotes}`);
    articleLines.push(`Excerpt: ${a.excerpt}`);
    articleLines.push('');
  }

  return renderPrompt(template, {
    published_reference: publishedRef.text,
    scored_articles: articleLines.join('\n'),
  });
}

// ─── Track B prompt builders (Verticals) ──────────────────────────────────────

/**
 * Build the Step B1 prompt: score all vertical articles by sector.
 * @param {object[]} verticalArticles
 * @param {{ week: number, text: string }} publishedRef
 * @returns {string}
 */
function buildScoringPromptVertical(verticalArticles, publishedRef) {
  const { template } = loadPrompt('select-score-vertical');

  const grouped = groupBySector(verticalArticles);
  const articleLines = [];
  for (const [sector, sectorArticles] of grouped) {
    const displayName = sectorNames[sector]?.config || sector;
    articleLines.push(`## ${displayName} (${sectorArticles.length} articles)\n`);
    for (const a of sectorArticles) {
      articleLines.push(`### ${a.title}`);
      articleLines.push(`Source: ${a.source} | ${a.date_published} | Confidence: ${a.confidence}`);
      articleLines.push(`URL: ${a.url}`);
      articleLines.push(a.excerpt);
      articleLines.push('');
    }
  }

  return renderPrompt(template, {
    published_reference: publishedRef.text,
    vertical_articles: articleLines.join('\n'),
  });
}

/**
 * Build the Step B2 critic prompt: includes Opus scores for comparison.
 * @param {object[]} verticalArticles
 * @param {object} opusScores — parsed JSON from B1 (sector-keyed arrays)
 * @param {{ week: number, text: string }} publishedRef
 * @returns {string}
 */
function buildVerticalCriticPrompt(verticalArticles, opusScores, publishedRef) {
  const { template } = loadPrompt('select-score-vertical-critic');

  const grouped = groupBySector(verticalArticles);
  const articleLines = [];
  for (const [sector, sectorArticles] of grouped) {
    const displayName = sectorNames[sector]?.config || sector;
    articleLines.push(`## ${displayName} (${sectorArticles.length} articles)\n`);
    for (const a of sectorArticles) {
      articleLines.push(`### ${a.title}`);
      articleLines.push(`Source: ${a.source} | ${a.date_published} | Confidence: ${a.confidence}`);
      articleLines.push(`URL: ${a.url}`);
      articleLines.push(a.excerpt);
      articleLines.push('');
    }
  }

  return renderPrompt(template, {
    published_reference: publishedRef.text,
    vertical_articles: articleLines.join('\n'),
    opus_scores: JSON.stringify(opusScores, null, 2),
  });
}

/**
 * Build the Step B3 triage prompt: all three models' scores for final selection.
 * @param {object} opusScores
 * @param {object} geminiScores
 * @param {object} gptScores
 * @returns {string}
 */
function buildVerticalTriagePrompt(opusScores, geminiScores, gptScores) {
  const { template } = loadPrompt('select-vertical-triage');
  return renderPrompt(template, {
    opus_scores: JSON.stringify(opusScores, null, 2),
    gemini_scores: JSON.stringify(geminiScores, null, 2),
    gpt_scores: JSON.stringify(gptScores, null, 2),
  });
}

// ─── Final shortlist prompt builder ───────────────────────────────────────────

/**
 * Build the final shortlist prompt: Opus selects ~25-30 from the merged pool.
 * Replaces C1-C4 critique/triage with a single editorial selection.
 *
 * @param {object[]} mergedPool — all stories from Track A + Track B
 * @param {{ week: number, text: string }} publishedRef
 * @returns {string}
 */
function buildFinalShortlistPrompt(mergedPool, publishedRef) {
  const { template } = loadPrompt('select-final-shortlist');
  const lines = [];

  for (const a of mergedPool) {
    lines.push(`### ${a.title}`);
    lines.push(`Sector: ${a.sector} | Source: ${a.source} | ${a.date_published}`);
    lines.push(`URL: ${a.url}`);

    const scoreParts = [];
    if (a.score != null) scoreParts.push(`Opus: ${a.score}`);
    if (a.gptScore != null) scoreParts.push(`GPT: ${a.gptScore}`);
    if (a.geminiScore != null) scoreParts.push(`Gemini: ${a.geminiScore}`);
    if (a.coverageCount != null) scoreParts.push(`Coverage: ${a.coverageCount} articles`);
    lines.push(`Scores: ${scoreParts.join(' | ') || 'N/A'}`);

    if (a.reasoning) lines.push(`Reasoning: ${a.reasoning}`);
    lines.push(`Excerpt: ${a.excerpt}`);
    lines.push('');
  }

  return renderPrompt(template, {
    published_reference: publishedRef.text,
    story_pool: lines.join('\n'),
  });
}

// ─── Track runners ────────────────────────────────────────────────────────────

/**
 * Track A: General AI scoring pipeline (Steps A1–A3).
 *
 * A1: Opus scores all General AI articles (1–10)
 * A2: Gemini+Search checks coverage volume for top 20
 * A3: Opus combines scores + coverage → final ~10–15 picks
 *
 * @param {object[]} generalArticles
 * @param {Map<string, object>} articleIndex
 * @param {{ week: number, text: string }} publishedRef
 * @param {{ start: string, end: string }} dateWindow
 * @param {Anthropic} client
 * @param {string} systemPrompt
 * @returns {Promise<{ selected: object[], audit: object }>}
 */
async function runTrackA(generalArticles, articleIndex, publishedRef, dateWindow, client, systemPrompt) {
  const audit = { opus_scores: [], top_20_urls: [], coverage: [], final_selected: [] };

  // ─── A1: Opus scores General AI ─────────────────────────────────────────────
  log('Track A — Step A1: Opus scoring General AI articles...');
  const a1Start = Date.now();

  const scoringPrompt = buildScoringPromptGeneral(generalArticles, publishedRef);
  const scoringTokens = countTokens(scoringPrompt);
  log(`  A1 prompt: ~${Math.round(scoringTokens / 1000)}K tokens`);

  const a1Response = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 10000,
    system: systemPrompt,
    messages: [{ role: 'user', content: scoringPrompt }],
  }), { maxAttempts: 3 });

  const a1Text = a1Response.content[0].text;
  const a1Elapsed = ((Date.now() - a1Start) / 1000).toFixed(1);

  // Save debug output
  writeFileSync(join(OUTPUT, 'select-debug-a1.txt'), a1Text);

  const a1Parsed = extractJSON(a1Text);
  const scores = a1Parsed.scores || [];
  if (scores.length === 0) throw new Error('A1: No scores parsed from Opus response');

  // Sort by score desc, take top 20
  scores.sort((a, b) => b.score - a.score);
  const top20 = scores.slice(0, 20);
  audit.opus_scores = scores;
  audit.top_20_urls = top20.map(s => s.url);

  ok(`A1 complete in ${a1Elapsed}s — ${scores.length} articles scored, top 20 selected (range: ${top20[0]?.score}–${top20[top20.length - 1]?.score})`);

  // ─── A2: Gemini+Search coverage volume (top 20) ─────────────────────────────
  log('Track A — Step A2: Gemini+Search coverage volume checks (top 20)...');
  const a2Start = Date.now();

  const coverageTasks = top20.map(scored => () => {
    // Find the article object for this URL
    const normUrl = normaliseUrl(scored.url);
    const article = articleIndex.get(normUrl);
    if (!article) {
      warn(`  A2: URL not in article index: ${scored.url}`);
      return Promise.resolve({ url: scored.url, total_count: 0, sources: [], notes: 'URL not found in index' });
    }
    const prompt = buildCoveragePrompt(article, dateWindow);
    return callGeminiWithSearch(prompt, { maxTokens: 8000 })
      .then(result => {
        const parsed = result.parsed || {};
        return {
          url: scored.url,
          total_count: parsed.total_count || 0,
          sources: parsed.sources || [],
          notes: parsed.notes || '',
        };
      })
      .catch(err => {
        warn(`  A2: Coverage check failed for "${article.title}": ${err.message}`);
        return { url: scored.url, total_count: 0, sources: [], notes: `Error: ${err.message}` };
      });
  });

  const coverageResults = await withConcurrency(3, coverageTasks);
  const a2Elapsed = ((Date.now() - a2Start) / 1000).toFixed(1);
  audit.coverage = coverageResults;

  const successCount = coverageResults.filter(c => c.total_count > 0).length;
  ok(`A2 complete in ${a2Elapsed}s — ${successCount}/${coverageResults.length} with coverage data`);

  // ─── A3: Opus final General AI selection ────────────────────────────────────
  log('Track A — Step A3: Opus final General AI selection...');
  const a3Start = Date.now();

  // Merge scores with coverage
  const coverageMap = new Map(coverageResults.map(c => [normaliseUrl(c.url), c]));
  const top20WithCoverage = top20.map(scored => {
    const normUrl = normaliseUrl(scored.url);
    const article = articleIndex.get(normUrl);
    const coverage = coverageMap.get(normUrl) || { total_count: 0, notes: '' };
    return {
      ...scored,
      title: article?.title || '(unknown)',
      excerpt: article?.excerpt || '',
      coverageCount: coverage.total_count,
      coverageNotes: coverage.notes,
    };
  });

  const finalPrompt = buildFinalGeneralPrompt(top20WithCoverage, publishedRef);
  const a3Response = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: finalPrompt }],
  }), { maxAttempts: 3 });

  const a3Text = a3Response.content[0].text;
  const a3Elapsed = ((Date.now() - a3Start) / 1000).toFixed(1);

  writeFileSync(join(OUTPUT, 'select-debug-a3.txt'), a3Text);

  // Parse shortlist from A3 response
  const generalSelected = parseShortlist(a3Text, articleIndex, 'Track A (General AI)');

  // Enrich selected articles with scores and coverage
  for (const a of generalSelected) {
    const normUrl = normaliseUrl(a.url);
    const scored = top20.find(s => normaliseUrl(s.url) === normUrl);
    const coverage = coverageMap.get(normUrl);
    a.score = scored?.score || 0;
    a.coverageCount = coverage?.total_count || 0;
  }

  audit.final_selected = generalSelected.map(a => ({
    url: a.url, title: a.title, score: a.score, coverageCount: a.coverageCount, reasoning: a.reasoning,
  }));

  ok(`A3 complete in ${a3Elapsed}s — ${generalSelected.length} General AI stories selected`);

  return { selected: generalSelected, audit };
}

/**
 * Track B: Vertical scoring pipeline (Steps B1–B3).
 *
 * B1: Opus scores all vertical articles (1–10) by sector
 * B2: Gemini + GPT score independently
 * B3: Opus evaluates all three score sets → per-sector selection
 *
 * @param {object[]} verticalArticles
 * @param {Map<string, object>} articleIndex
 * @param {{ week: number, text: string }} publishedRef
 * @param {Anthropic} client
 * @param {string} systemPrompt
 * @returns {Promise<{ selected: object[], audit: object }>}
 */
async function runTrackB(verticalArticles, articleIndex, publishedRef, client, systemPrompt) {
  const audit = {};

  if (verticalArticles.length === 0) {
    warn('Track B: No vertical articles found');
    return { selected: [], audit };
  }

  // ─── B1: Opus scores verticals ──────────────────────────────────────────────
  log('Track B — Step B1: Opus scoring vertical articles...');
  const b1Start = Date.now();

  const b1Prompt = buildScoringPromptVertical(verticalArticles, publishedRef);
  const b1Tokens = countTokens(b1Prompt);
  log(`  B1 prompt: ~${Math.round(b1Tokens / 1000)}K tokens`);

  const b1Response = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: systemPrompt,
    messages: [{ role: 'user', content: b1Prompt }],
  }), { maxAttempts: 3 });

  const b1Text = b1Response.content[0].text;
  const b1Elapsed = ((Date.now() - b1Start) / 1000).toFixed(1);
  writeFileSync(join(OUTPUT, 'select-debug-b1.txt'), b1Text);

  const opusScores = extractJSON(b1Text);
  audit.opus_scores = opusScores;

  const totalScored = Object.values(opusScores).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  ok(`B1 complete in ${b1Elapsed}s — ${totalScored} vertical articles scored`);

  // ─── B2: GPT independent scoring ────────────────────────────────────────────
  log('Track B — Step B2: GPT independent scoring...');
  const b2Start = Date.now();

  const b2Prompt = buildVerticalCriticPrompt(verticalArticles, opusScores, publishedRef);

  const gptResult = await callModel('openai', b2Prompt, { maxTokens: 12000 })
    .then(r => { writeFileSync(join(OUTPUT, 'select-debug-b2-gpt.txt'), r.raw || ''); return r; })
    .catch(err => { warn(`B2 GPT failed: ${err.message}`); return { parsed: null, raw: '' }; });

  const gptScores = gptResult.parsed || {};
  audit.gpt_scores = gptScores;

  const b2Elapsed = ((Date.now() - b2Start) / 1000).toFixed(1);
  ok(`B2 complete in ${b2Elapsed}s — GPT: ${Object.keys(gptScores).length} sectors`);

  // ─── B3: Opus evaluates all scores ──────────────────────────────────────────
  log('Track B — Step B3: Opus evaluating all scores...');
  const b3Start = Date.now();

  const b3Prompt = buildVerticalTriagePrompt(opusScores, {}, gptScores);
  const b3Response = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 12000,
    system: systemPrompt,
    messages: [{ role: 'user', content: b3Prompt }],
  }), { maxAttempts: 3 });

  const b3Text = b3Response.content[0].text;
  const b3Elapsed = ((Date.now() - b3Start) / 1000).toFixed(1);
  writeFileSync(join(OUTPUT, 'select-debug-b3.txt'), b3Text);

  const b3Parsed = extractJSON(b3Text);

  // Extract selected articles from the triage result
  const verticalSelected = [];
  for (const [sector, data] of Object.entries(b3Parsed)) {
    const selected = data?.selected || [];
    audit[sector] = {
      opus_final: selected,
      dropped: data?.dropped || [],
      sector_average: data?.sector_average || 0,
    };

    for (const item of selected) {
      const normUrl = normaliseUrl(item.url);
      const article = articleIndex.get(normUrl);
      if (article) {
        verticalSelected.push({
          ...article,
          score: item.final_score || 0,
          reasoning: item.rationale || '',
        });
      } else {
        warn(`  B3: URL not in article index: ${item.url}`);
      }
    }
  }

  ok(`B3 complete in ${b3Elapsed}s — ${verticalSelected.length} vertical stories selected`);

  return { selected: verticalSelected, audit };
}

// ─── Output builders ──────────────────────────────────────────────────────────

/**
 * Build draft-ready context markdown from final shortlist.
 * Format matches existing draft-context-week-{N}.md structure.
 *
 * @param {object[]} shortlist
 * @param {number} weekNumber
 * @param {number} year
 * @param {{ start: string, end: string }} dateWindow
 * @returns {string}
 */
function buildSelectContext(shortlist, weekNumber, year, dateWindow) {
  const grouped = groupBySector(shortlist);
  const lines = [
    `# Research Context: Week ${weekNumber}, ${year}`,
    `Date range: ${dateWindow.start} – ${dateWindow.end}`,
    `Total articles: ${shortlist.length} (editorially selected)`,
    '',
  ];

  for (const [sector, sectorArticles] of grouped) {
    const displayName = sectorNames[sector]?.config || sector;
    lines.push(`## ${displayName} (${sectorArticles.length} articles)`);
    lines.push('');

    for (const a of sectorArticles) {
      lines.push(`### ${a.title}`);
      lines.push(`- Source: ${a.source} | Published: ${a.date_published}`);
      lines.push(`- URL: ${a.url}`);
      lines.push(`- Editorial note: ${a.reasoning || ''}`);
      lines.push(`- Excerpt: ${a.excerpt}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Main workflow ────────────────────────────────────────────────────────────

export async function runSelect({ week, year, dryRun = false }) {
  year = year || new Date().getFullYear();
  const dateWindow = getWeekWindow(week, year);

  log(`Loading articles for week ${week} (${dateWindow.start} – ${dateWindow.end})...`);

  // Load articles
  const { articles, articleIndex } = loadArticlesForSelection(dateWindow);
  if (articles.length === 0) {
    throw new Error(`No verified articles found for week ${week} (${dateWindow.start} – ${dateWindow.end})`);
  }

  // Load published reference
  const publishedRef = loadPublishedReference(week, year);
  log(`Published reference: week-${publishedRef.week}.md`);

  // Split articles by track
  const generalArticles = articles.filter(a => a.sector === 'general');
  const verticalArticles = articles.filter(a => a.sector !== 'general');

  // Sector breakdown
  const grouped = groupBySector(articles);
  const bySector = {};
  for (const [sector, sectorArticles] of grouped) {
    const displayName = sectorNames[sector]?.config || sector;
    bySector[displayName] = sectorArticles.length;
  }

  // Full-text stats
  const withFullText = articles.filter(a => a._hasFullText).length;

  ok(`Loaded ${articles.length} articles from ${grouped.size} sectors`);
  log(`  General AI: ${generalArticles.length} | Verticals: ${verticalArticles.length}`);
  for (const [name, count] of Object.entries(bySector)) {
    log(`  ${name}: ${count}`);
  }
  log(`  Articles with full text: ${withFullText}/${articles.length}`);

  if (dryRun) {
    // Build sample prompts for token estimates
    const a1Prompt = generalArticles.length > 0
      ? buildScoringPromptGeneral(generalArticles, publishedRef)
      : '';
    const b1Prompt = verticalArticles.length > 0
      ? buildScoringPromptVertical(verticalArticles, publishedRef)
      : '';
    const a1Tokens = countTokens(a1Prompt);
    const b1Tokens = countTokens(b1Prompt);

    console.log(`\n═══════════════════════════════════════════════`);
    console.log(`  SNI Story Selection — Week ${week} (dry run)`);
    console.log(`═══════════════════════════════════════════════`);
    console.log(`  Articles:          ${articles.length}`);
    console.log(`  General AI:        ${generalArticles.length}`);
    console.log(`  Verticals:         ${verticalArticles.length}`);
    console.log(`  With full text:    ${withFullText}`);
    console.log(`  Published ref:     week-${publishedRef.week}.md`);
    console.log(`  ────────────────────────────────────────────`);
    console.log(`  Track A (A1) est:  ~${Math.round(a1Tokens / 1000)}K tokens`);
    console.log(`  Track B (B1) est:  ~${Math.round(b1Tokens / 1000)}K tokens`);
    console.log(`  ────────────────────────────────────────────`);
    for (const [name, count] of Object.entries(bySector)) {
      console.log(`  ${name}: ${count}`);
    }
    console.log(`═══════════════════════════════════════════════\n`);
    return { dryRun: true, stats: { articles: articles.length, bySector, a1Tokens, b1Tokens } };
  }

  // ─── API setup ───────────────────────────────────────────────────────────────

  const { template: systemPrompt } = loadPrompt('select-system');

  const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey, timeout: 1200000 });

  const pipelineStart = Date.now();
  const triageLog = [];
  const audit = { general_ai: {}, verticals: {}, critique_rounds: {}, metadata: {} };

  // ═══════════════════════════════════════════════════════════════════════════════
  // PARALLEL TRACKS: A (General AI) + B (Verticals)
  // ═══════════════════════════════════════════════════════════════════════════════

  log('Starting parallel tracks A + B...');

  const [trackAResult, trackBResult] = await Promise.all([
    generalArticles.length > 0
      ? runTrackA(generalArticles, articleIndex, publishedRef, dateWindow, client, systemPrompt)
      : { selected: [], audit: {} },
    verticalArticles.length > 0
      ? runTrackB(verticalArticles, articleIndex, publishedRef, client, systemPrompt)
      : { selected: [], audit: {} },
  ]);

  audit.general_ai = trackAResult.audit;
  audit.verticals = trackBResult.audit;

  // ═══════════════════════════════════════════════════════════════════════════════
  // MERGE
  // ═══════════════════════════════════════════════════════════════════════════════

  let shortlist = [...trackAResult.selected, ...trackBResult.selected];
  const mergeGrouped = groupBySector(shortlist);
  ok(`Merge: ${shortlist.length} stories (${mergeGrouped.size} sectors) — General: ${trackAResult.selected.length}, Verticals: ${trackBResult.selected.length}`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // FINAL SELECTION: Opus selects ~25-30 from merged pool
  // ═══════════════════════════════════════════════════════════════════════════════

  log('Final selection: Opus selecting from merged pool...');
  const fsStart = Date.now();

  const fsPrompt = buildFinalShortlistPrompt(shortlist, publishedRef);
  const fsTokens = countTokens(fsPrompt);
  log(`  Final selection prompt: ~${Math.round(fsTokens / 1000)}K tokens`);

  const fsResponse = await withRetry(() => client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: fsPrompt }],
  }), { maxAttempts: 3 });

  const fsText = fsResponse.content[0].text;
  const fsStop = fsResponse.stop_reason;
  const fsElapsed = ((Date.now() - fsStart) / 1000).toFixed(1);
  if (fsStop === 'max_tokens') warn('  ⚠ Final selection truncated (hit max_tokens)');

  triageLog.push(`### Final selection\n${fsText}`);
  writeFileSync(join(OUTPUT, 'select-debug-final.txt'), fsText);

  const finalShortlist = parseShortlist(fsText, articleIndex, 'Final selection');
  ok(`Final selection in ${fsElapsed}s — ${shortlist.length} → ${finalShortlist.length} stories`);

  // ═══════════════════════════════════════════════════════════════════════════════
  // SAVE OUTPUTS
  // ═══════════════════════════════════════════════════════════════════════════════

  // Enrich final shortlist with scores where available
  const selectJson = finalShortlist.map(a => ({
    url: a.url,
    title: a.title,
    source: a.source,
    date_published: a.date_published,
    sector: a.sector,
    confidence: a.confidence,
    reasoning: a.reasoning,
    score: a.score || null,
    coverageCount: a.coverageCount || null,
  }));

  // Build context file for draft.js
  const selectContext = buildSelectContext(finalShortlist, week, year, dateWindow);

  // Audit trail
  audit.final_selection = {
    prompt_tokens: fsTokens,
    response: fsText,
    input_count: shortlist.length,
    output_count: finalShortlist.length,
  };
  audit.metadata = {
    timestamp: new Date().toISOString(),
    article_count: articles.length,
    general_ai_count: generalArticles.length,
    vertical_count: verticalArticles.length,
    final_shortlist_count: finalShortlist.length,
  };

  // File paths
  const selectJsonPath = join(OUTPUT, `select-week-${week}.json`);
  const selectTriagePath = join(OUTPUT, `select-triage-week-${week}.md`);
  const selectContextPath = join(OUTPUT, `select-context-week-${week}.md`);
  const selectAuditPath = join(OUTPUT, `select-audit-week-${week}.json`);

  writeFileSync(selectJsonPath, JSON.stringify(selectJson, null, 2));
  writeFileSync(selectTriagePath, triageLog.join('\n\n'));
  writeFileSync(selectContextPath, selectContext);
  writeFileSync(selectAuditPath, JSON.stringify(audit, null, 2));

  const totalElapsed = ((Date.now() - pipelineStart) / 1000).toFixed(1);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  SNI Story Selection — Week ${week}`);
  console.log(`═══════════════════════════════════════════════`);
  console.log(`  Track A: General AI scoring   ✓`);
  console.log(`  Track B: Vertical scoring     ✓`);
  console.log(`  Merge:                        ${trackAResult.selected.length} + ${trackBResult.selected.length} = ${trackAResult.selected.length + trackBResult.selected.length}`);
  console.log(`  Final selection (Opus)        ✓  ${fsElapsed}s`);
  console.log(`  Total:                           ${totalElapsed}s`);
  console.log(`  ────────────────────────────────────────────`);
  console.log(`  Stories:  ${articles.length} → ${shortlist.length} → ${finalShortlist.length}`);
  const finalGrouped = groupBySector(finalShortlist);
  for (const [sector, sectorArticles] of finalGrouped) {
    const displayName = sectorNames[sector]?.config || sector;
    console.log(`    ${displayName}: ${sectorArticles.length}`);
  }
  console.log(`  ────────────────────────────────────────────`);
  console.log(`  JSON:     ${selectJsonPath}`);
  console.log(`  Triage:   ${selectTriagePath}`);
  console.log(`  Context:  ${selectContextPath}`);
  console.log(`  Audit:    ${selectAuditPath}`);
  console.log(`═══════════════════════════════════════════════\n`);

  return { shortlist: finalShortlist, selectJson, triageLog: triageLog.join('\n\n'), totalElapsed };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')    args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')    args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--dry-run') args.dryRun = true;
  }

  if (!args.week) {
    console.error('Usage: bun scripts/select.js --week N [--year YYYY] [--dry-run]');
    process.exit(1);
  }

  console.log(`═══════════════════════════════════════════════`);
  console.log(`  SNI Research Tool - Story Selection`);
  console.log(`  Week ${args.week}, ${args.year || new Date().getFullYear()}`);
  console.log(`═══════════════════════════════════════════════\n`);

  runSelect(args)
    .then(result => {
      if (result.dryRun) return;
      log(`Result: ${result.shortlist?.length || 0} stories selected`);
    })
    .catch(err => {
      console.error('Selection failed:', err.message);
      if (err.stack) console.error(err.stack);
      process.exit(1);
    });
}
