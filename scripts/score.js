/**
 * score.js - Relevance scorer for SNI Research Tool
 *
 * Evaluates verified articles for genuine AI/ML relevance in their sector.
 * Low-relevance articles are moved to data/review/ with a reason logged.
 * Articles are never deleted - review/ is a holding area, not a bin.
 *
 * Scoring modes:
 *   LLM mode  - uses Anthropic claude-haiku-3-5 (requires ANTHROPIC_API_KEY in .env)
 *   Heuristic - fallback when no API key present; pattern-based, no cost
 *
 * Usage:
 *   bun scripts/score.js --date 2026-02-23
 *   bun scripts/score.js --start-date 2026-02-16 --end-date 2026-02-23
 *   bun scripts/score.js --date 2026-02-23 --dry-run   (preview, no moves)
 *   bun scripts/score.js --date 2026-02-23 --heuristic (force heuristic mode)
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-haiku-4-5';
const RATE_LIMIT_MS = 300; // Haiku is fast, no need for long delays

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`); }
function ok(msg)  { console.log(`[${new Date().toISOString().slice(11, 19)}] ✓  ${msg}`); }
function skip(msg){ console.log(`[${new Date().toISOString().slice(11, 19)}]    ${msg}`); }
function warn(msg){ console.warn(`[${new Date().toISOString().slice(11, 19)}] ⚠  ${msg}`); }
function moved(msg){ console.log(`[${new Date().toISOString().slice(11, 19)}] →  ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--date')        args.date = argv[++i];
    if (argv[i] === '--start-date')  args.startDate = argv[++i];
    if (argv[i] === '--end-date')    args.endDate = argv[++i];
    if (argv[i] === '--dry-run')     args.dryRun = true;
    if (argv[i] === '--heuristic')   args.heuristic = true;
  }
  return args;
}

function getDateRange(args) {
  if (args.date) return { startDate: args.date, endDate: args.date };
  if (args.startDate && args.endDate) return { startDate: args.startDate, endDate: args.endDate };
  const today = new Date().toISOString().slice(0, 10);
  return { startDate: today, endDate: today };
}

// ─── Article Loading ──────────────────────────────────────────────────────────

function loadArticlesInRange(startDate, endDate) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return [];

  const articles = [];
  const dateDirs = readdirSync(verifiedDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name >= startDate && d.name <= endDate)
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
          const article = JSON.parse(readFileSync(jsonPath, 'utf8'));
          article._jsonPath = jsonPath;
          article._mdPath = jsonPath.replace('.json', '.md');
          article._rawHtmlPath = join(ROOT, 'data', 'raw', dateDir, sectorDir, file.replace('.json', '.html'));
          article._dateDir = dateDir;
          article._sectorDir = sectorDir;
          articles.push(article);
        } catch { /* skip corrupt files */ }
      }
    }
  }
  return articles;
}

// ─── Heuristic Scorer ─────────────────────────────────────────────────────────
// Used when no ANTHROPIC_API_KEY is present. Pattern-based. Zero cost.

// Short terms (2-5 chars) need word-boundary regex matching to avoid substring false positives.
// e.g. "AI" must not match "against", "paid", "trail" etc.
// Longer terms can use simple includes() safely.
const AI_TITLE_TERMS_REGEX = [
  /\bAI\b/i,
  /\bLLM\b/i,
  /\bGPT\b/i,
  /\bAGI\b/i,
];

const AI_TITLE_TERMS_SUBSTRING = [
  // Core AI/ML terms
  'artificial intelligence',
  'machine learning',
  'deep learning',
  'generative AI',
  'large language model',
  'foundation model',
  'AI-powered',
  'AI-driven',
  'AI-enabled',
  'AI-native',
  'algorithm',
  'agentic',
  'chatbot',
  'neural network',
  'computer vision',
  'digital twin',
  'physical AI',
  'autonomous',
  'robotics',
  'robot',
  'automation',
  'predictive',
  // AI companies and products (unambiguous signals in any context)
  'OpenAI',
  'Anthropic',
  'Claude',
  'Gemini',
  'DeepMind',
  'Mistral',
  'Cohere',
  'xAI',
  'Grok',
  'Nvidia',
  'Copilot',
  'SaaSpocalypse',
  'hyperscaler',
  'AWS Bedrock',
  'Azure AI',
  // Sector-specific signals strong enough on their own
  'insurtech',
  'medtech',
  'semiconductor',
  'humanoid',
];

// Title patterns that almost always signal irrelevant content.
// Each entry: [regex, human-readable label]
const NEGATIVE_TITLE_PATTERNS = [
  // People moves (no AI angle)
  [/^People (Moves?|Changes?):/i, 'People moves section'],
  [/\b(names?|appoints?|promotes?|promoted|joins|hired|retires?|retirement|stepping down|steps down)\b.{0,80}\b(CEO|CFO|CTO|COO|EVP|SVP|VP|President|Director|Officer|Partner|Principal)\b/i, 'Executive appointment or departure'],
  // Legal non-AI
  [/\b(sentenced|charged with|DUI|assault|convicted|indicted|verdict against|judgment against)\b/i, 'Legal/criminal matter'],
  // Weather and natural disasters
  [/\b(blizzard|snowstorm|hurricane|tornado|wildfire|earthquake|floods?|flooding|storm warning)\b/i, 'Natural disaster or weather event'],
  // Sports and entertainment
  [/\b(NFL|NBA|MLB|MLS|soccer|football|basketball|baseball|hockey|tennis|golf|Olympics|athlete|player)\b/i, 'Sports/entertainment'],
  // Pure political / non-AI regulatory (only if no strong AI signal in title)
  [/\b(tariff|tax cut|senate|congress|parliament|election|vote|ballot)\b/i, 'Political/tariff news'],
  // Financial results with no AI angle
  [/\b(Q[1-4] (results?|earnings?)|full[- ]year (results?|earnings?)|annual results?|consolidated turnover|GWP (nears?|hits?|reaches?))\b/i, 'Financial results (no AI angle)'],
];

function hasAiSignal(text) {
  // Check regex terms (word-boundary safe for short terms like AI, LLM, GPT)
  if (AI_TITLE_TERMS_REGEX.some(r => r.test(text))) return true;
  // Check substring terms (long enough that false substring matches are unlikely)
  const lower = text.toLowerCase();
  return AI_TITLE_TERMS_SUBSTRING.some(t => lower.includes(t.toLowerCase()));
}

function heuristicScore(article) {
  const title = article.title || '';
  const snippet = article.snippet || '';

  const aiInTitle   = hasAiSignal(title);
  const aiInSnippet = hasAiSignal(snippet);

  // Check negative patterns in title.
  // If a pattern fires AND there's no strong AI signal in the title, move to review.
  for (const [pattern, label] of NEGATIVE_TITLE_PATTERNS) {
    if (pattern.test(title) && !aiInTitle) {
      return {
        relevant: false,
        confidence: 'high',
        reason: label,
      };
    }
  }

  // No AI in title or snippet opening → review
  if (!aiInTitle && !aiInSnippet) {
    return {
      relevant: false,
      confidence: 'medium',
      reason: 'No AI/ML signal in title or opening paragraph',
    };
  }

  // AI in snippet but not title → borderline keep (move to review for now)
  if (!aiInTitle && aiInSnippet) {
    return {
      relevant: false,
      confidence: 'low',
      reason: 'AI signal only in opening paragraph, not title — borderline',
    };
  }

  // AI in title → keep
  return {
    relevant: true,
    confidence: 'high',
    reason: 'AI/ML signal in title',
  };
}

// ─── LLM Scorer ───────────────────────────────────────────────────────────────

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

const SECTOR_DESCRIPTIONS = {
  general:       'frontier AI models, hyperscaler AI services, agentic AI, AI regulation, AI funding rounds, AI safety',
  biopharma:     'AI in drug discovery, clinical trials, FDA/EMA approvals, biotech, pharmaceutical R&D',
  medtech:       'AI medical devices, FDA clearances, diagnostic AI, surgical robots, digital health',
  manufacturing: 'AI in semiconductor manufacturing, industrial robotics, factory automation, digital twins',
  insurance:     'AI in underwriting, claims processing, insurtech, actuarial AI, AI-native insurance products',
};

async function llmScore(article) {
  const sector = article.sector || 'general';
  const sectorDesc = SECTOR_DESCRIPTIONS[sector] || sector;
  const title = article.title || '(no title)';
  const snippet = (article.snippet || '').slice(0, 400);

  const prompt = `You are a relevance filter for a professional AI industry newsletter called SNI.

SNI covers: ${sectorDesc}.

Rate this article for relevance. The article must be PRIMARILY about AI/ML technology in the sector - not a passing mention of AI in an unrelated article.

Title: ${title}
Opening: ${snippet}

Reply with JSON only, no prose:
{"relevant": true/false, "confidence": "high/medium/low", "reason": "one sentence"}`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 100,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].text.trim();
    // Extract JSON from response (handle occasional wrapper text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    warn(`LLM score failed for "${title.slice(0, 50)}": ${e.message} — falling back to heuristic`);
    return heuristicScore(article);
  }
}

// ─── Article Mover ────────────────────────────────────────────────────────────

function moveToReview(article, reason, dryRun, stats) {
  const reviewDir = join(ROOT, 'data', 'review', article._dateDir, article._sectorDir);

  if (dryRun) {
    moved(`[DRY RUN] Would move: ${article.title?.slice(0, 70)}`);
    moved(`           Reason: ${reason}`);
    stats.wouldMove++;
    return;
  }

  mkdirSync(reviewDir, { recursive: true });

  // Move .json
  if (existsSync(article._jsonPath)) {
    const dest = join(reviewDir, article._jsonPath.split('\\').pop());
    renameSync(article._jsonPath, dest);
  }

  // Move .md
  if (existsSync(article._mdPath)) {
    const dest = join(reviewDir, article._mdPath.split('\\').pop());
    renameSync(article._mdPath, dest);
  }

  // Move raw HTML if it exists
  if (existsSync(article._rawHtmlPath)) {
    const rawReviewDir = join(ROOT, 'data', 'review', 'raw', article._dateDir, article._sectorDir);
    mkdirSync(rawReviewDir, { recursive: true });
    const dest = join(rawReviewDir, article._rawHtmlPath.split('\\').pop());
    try { renameSync(article._rawHtmlPath, dest); } catch { /* raw HTML is non-critical */ }
  }

  // Write reason file alongside moved article
  const slug = article._jsonPath.split('\\').pop().replace('.json', '');
  writeFileSync(
    join(reviewDir, `${slug}_review-reason.txt`),
    `Moved by score.js at ${new Date().toISOString()}\nReason: ${reason}\nTitle: ${article.title}\nURL: ${article.url}\n`
  );

  moved(`Moved to review: ${article.title?.slice(0, 70)}`);
  moved(`         Reason: ${reason}`);
  stats.moved++;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const { startDate, endDate } = getDateRange(args);
  const useLLM = !!ANTHROPIC_API_KEY && !args.heuristic;
  const dryRun = !!args.dryRun;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Relevance Scorer');
  console.log(`  Date range: ${startDate} → ${endDate}`);
  console.log(`  Mode:       ${useLLM ? `LLM (${MODEL})` : 'Heuristic (no API key)'}`);
  if (dryRun) console.log('  DRY RUN - no files will be moved');
  console.log('═══════════════════════════════════════════════');
  console.log('');

  if (!useLLM && !args.heuristic) {
    warn('ANTHROPIC_API_KEY not set. Running in heuristic mode.');
    warn('Add ANTHROPIC_API_KEY to .env for LLM-based scoring.');
    console.log('');
  }

  const articles = loadArticlesInRange(startDate, endDate);
  log(`Loaded ${articles.length} articles to score`);

  if (articles.length === 0) {
    log('Nothing to score. Run fetch.js first.');
    return;
  }

  const stats = {
    total: articles.length,
    kept: 0,
    moved: 0,
    wouldMove: 0,
    byReason: {},
  };

  // Group log output by sector for readability
  const bySector = {};
  for (const article of articles) {
    const s = article.sector || 'unknown';
    if (!bySector[s]) bySector[s] = [];
    bySector[s].push(article);
  }

  const sectorOrder = ['general', 'biopharma', 'medtech', 'manufacturing', 'insurance'];
  const allSectors = [...new Set([...sectorOrder, ...Object.keys(bySector)])];

  for (const sector of allSectors) {
    const sectorArticles = bySector[sector];
    if (!sectorArticles || sectorArticles.length === 0) continue;

    console.log('');
    log(`─── ${sector.toUpperCase()} (${sectorArticles.length} articles) ───`);

    for (const article of sectorArticles) {
      const title = article.title?.slice(0, 65) || '(no title)';

      let result;
      if (useLLM) {
        await sleep(RATE_LIMIT_MS);
        result = await llmScore(article);
      } else {
        result = heuristicScore(article);
      }

      if (!result.relevant || result.confidence === 'low') {
        const reason = `[${result.confidence}] ${result.reason}`;
        stats.byReason[result.reason] = (stats.byReason[result.reason] || 0) + 1;
        moveToReview(article, reason, dryRun, stats);
      } else {
        ok(`Keep [${result.confidence}]: ${title}`);
        stats.kept++;
      }
    }
  }

  // Summary
  const movedCount = dryRun ? stats.wouldMove : stats.moved;
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  Score Complete');
  console.log(`  Total:    ${stats.total} articles`);
  console.log(`  Kept:     ${stats.kept}`);
  console.log(`  ${dryRun ? 'Would move' : 'Moved to review'}: ${movedCount}`);
  if (Object.keys(stats.byReason).length > 0) {
    console.log('');
    console.log('  Top reasons moved:');
    const sorted = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [reason, count] of sorted) {
      console.log(`    (${count}x) ${reason.slice(0, 60)}`);
    }
  }
  if (!dryRun && movedCount > 0) {
    console.log('');
    console.log(`  Review folder: data/review/${startDate}/`);
    console.log('  To restore an article: move it back to data/verified/<date>/<sector>/');
  }
  console.log('═══════════════════════════════════════════════');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });

process.on('unhandledRejection', (reason) => {
  console.warn(`[unhandledRejection] ${reason}`);
});
