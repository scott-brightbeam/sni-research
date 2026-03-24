#!/usr/bin/env bun
/**
 * draft.js — Draft generation for SNI Research Tool
 *
 * Two-step process:
 *   1. Theme selection — picks a cross-sector editorial theme
 *   2. Draft generation — writes the complete newsletter draft
 *
 * Uses research context built from verified articles and the previous
 * published report for continuity.
 *
 * Usage:
 *   bun scripts/draft.js --week 9
 *   bun scripts/draft.js --week 9 --year 2026
 *   bun scripts/draft.js --week 9 --model claude-sonnet-4-20250514
 *   bun scripts/draft.js --week 9 --shortlist      (use select.js output instead of raw articles)
 *   bun scripts/draft.js --week 9 --dry-run
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, renderPrompt, countTokens, loadSectorNames } from './lib/prompt.js';
import { getWeekWindow, getISOWeekNumber } from './lib/week.js';
import { withRetry } from './lib/retry.js';
import { loadEnvKey } from './lib/env.js';
import { flagProhibitedLanguage } from './lib/prohibited.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// ─── Post-processing ─────────────────────────────────────────────────────────

/**
 * Fix common formatting issues that LLMs produce despite instructions.
 * Applied as a safety net after draft generation.
 */
function postProcessDraft(text) {
  let result = text;

  // Fix currency: $110 billion → $110bn, $60 million → $60m
  result = result.replace(/\$([\d.,]+)\s+billion/gi, (_, n) => `$${n}bn`);
  result = result.replace(/\$([\d.,]+)\s+million/gi, (_, n) => `$${n}m`);
  result = result.replace(/£([\d.,]+)\s+billion/gi, (_, n) => `£${n}bn`);
  result = result.replace(/£([\d.,]+)\s+million/gi, (_, n) => `£${n}m`);
  result = result.replace(/€([\d.,]+)\s+billion/gi, (_, n) => `€${n}bn`);
  result = result.replace(/€([\d.,]+)\s+million/gi, (_, n) => `€${n}m`);

  // Fix double quotes → single quotes in prose (not in markdown links)
  result = result.replace(/(?<!\[)(?<!\()"\b/g, '\u2018'); // opening double → opening single
  result = result.replace(/\b"(?!\])/g, '\u2019'); // closing double → closing single
  result = result.replace(/[\u2018\u2019]/g, "'"); // curly singles → straight singles

  // Remove stray/duplicate body section headings with no content
  // Pattern: known section name on its own line, blank line, then another heading
  const bodyHeadings = [
    'AI industry', 'Biopharma', 'MedTech and digital health',
    'Complex manufacturing', 'Insurance',
  ];
  const headingAlt = bodyHeadings.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Match a bare section name (with optional ## prefix) followed by blank line(s)
  // then another section name or linked heading [...](...) — remove the empty one
  const strayRe = new RegExp(
    `^(#{0,3}\\s*)?(${headingAlt})\\s*\\n\\s*\\n(?=\\s*(#{0,3}\\s*)?(${headingAlt}|\\[))`,
    'gim',
  );
  const before = result;
  result = result.replace(strayRe, '');
  if (result !== before) log('  Removed stray duplicate section heading');

  // Prohibited language — auto-fix safe terms, flag the rest
  const { cleaned, autoFixed, flagged } = flagProhibitedLanguage(result);
  result = cleaned;
  if (autoFixed.length) log(`  Auto-fixed prohibited language: ${autoFixed.join(', ')}`);
  if (flagged.length) warn(`  Flagged (context-dependent): ${flagged.join(', ')}`);

  return result;
}

// ─── Token budgets ────────────────────────────────────────────────────────────

const RESEARCH_CONTEXT_BUDGET = 25000;
const PREVIOUS_REPORT_BUDGET = 10000;

// ─── Sector config ────────────────────────────────────────────────────────────

const sectorNames = loadSectorNames();
const SECTOR_ORDER = Object.entries(sectorNames)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key]) => key);

// ─── Article loading ──────────────────────────────────────────────────────────

/**
 * Load verified articles for a date window.
 * Returns lightweight summaries (no full_text or _raw_html).
 * Sorted by confidence desc, then date desc.
 */
function loadArticles(dateWindow) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return [];

  // Look back 7 extra days to catch high-significance stories the editor might carry forward
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
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'));
          articles.push({
            title: raw.title,
            url: raw.url,
            source: raw.source,
            date_published: raw.date_published,
            sector: raw.sector || 'general',
            snippet: (raw.snippet || '').slice(0, 300),
            confidence: raw.confidence || 'medium',
            score_reason: raw.score_reason || '',
          });
        } catch { /* skip corrupt files */ }
      }
    }
  }

  // Deduplicate by URL
  const seen = new Set();
  const deduped = articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });

  // Sort: high confidence first, then by date desc
  const confOrder = { high: 0, medium: 1, low: 2 };
  return deduped.sort((a, b) => {
    const ca = confOrder[a.confidence] ?? 1;
    const cb = confOrder[b.confidence] ?? 1;
    if (ca !== cb) return ca - cb;
    return b.date_published.localeCompare(a.date_published);
  });
}

/**
 * Load previous published report for context.
 * Returns markdown string or null if not found.
 */
function loadPreviousReport(weekNumber) {
  const prevWeek = weekNumber - 1;
  const path = join(ROOT, 'output', 'published', `week-${prevWeek}.md`);
  try {
    const text = readFileSync(path, 'utf8');
    // Truncate to budget if needed
    const tokens = countTokens(text);
    if (tokens > PREVIOUS_REPORT_BUDGET) {
      // Keep just the tl;dr section + structure for reference
      const tldrEnd = text.indexOf('And if you\'re still hungry');
      if (tldrEnd !== -1) {
        return text.slice(0, tldrEnd + 60) + '\n\n[... body sections truncated for context budget ...]';
      }
      // Fallback: hard truncate
      const words = text.split(/\s+/);
      return words.slice(0, 2000).join(' ') + '\n\n[... truncated ...]';
    }
    return text;
  } catch {
    return null;
  }
}

/**
 * Extract the theme phrase from a previous report's tl;dr line.
 * Returns the theme string or 'none (first issue)'.
 */
function extractPreviousTheme(previousReport) {
  if (!previousReport) return 'none (first issue)';
  const match = previousReport.match(/tl;dr:\s*(.+)/i);
  return match ? match[1].trim() : 'unknown';
}

// ─── Research context builder ─────────────────────────────────────────────────

/**
 * Build the research context markdown that gets injected into the draft prompt.
 * Groups articles by sector, includes title/url/source/date/confidence/snippet.
 * Truncates lowest-confidence articles if over token budget.
 */
function buildResearchContext(articles, weekNumber, year, dateWindow) {
  const grouped = {};
  for (const a of articles) {
    if (!grouped[a.sector]) grouped[a.sector] = [];
    grouped[a.sector].push(a);
  }

  function formatContext(groups) {
    const lines = [
      `# Research Context: Week ${weekNumber}, ${year}`,
      `Date range: ${dateWindow.start} – ${dateWindow.end}`,
      `Total articles: ${Object.values(groups).reduce((sum, g) => sum + g.length, 0)}`,
      '',
    ];

    for (const sector of SECTOR_ORDER) {
      const sectorArticles = groups[sector];
      if (!sectorArticles || sectorArticles.length === 0) continue;
      const displayName = sectorNames[sector]?.config || sector;
      lines.push(`## ${displayName} (${sectorArticles.length} articles)`);
      lines.push('');

      for (const a of sectorArticles) {
        lines.push(`### ${a.title}`);
        lines.push(`- Source: ${a.source} | Published: ${a.date_published}`);
        lines.push(`- URL: ${a.url}`);
        lines.push(`- Confidence: ${a.confidence}`);
        lines.push(`- Snippet: ${a.snippet}`);
        lines.push('');
      }
    }
    return lines.join('\n');
  }

  // First pass: build full context
  let context = formatContext(grouped);
  let tokens = countTokens(context);

  if (tokens <= RESEARCH_CONTEXT_BUDGET) {
    log(`Research context: ${tokens} tokens (within ${RESEARCH_CONTEXT_BUDGET} budget)`);
    return context;
  }

  // Truncation: remove lowest-confidence articles round-robin from largest sectors
  log(`Research context ${tokens} tokens exceeds budget ${RESEARCH_CONTEXT_BUDGET}, truncating...`);
  let removed = 0;

  while (tokens > RESEARCH_CONTEXT_BUDGET) {
    // Find the largest sector with low/medium confidence articles to remove
    const sectorSizes = SECTOR_ORDER
      .map(s => ({ sector: s, count: (grouped[s] || []).length }))
      .filter(s => s.count > 2) // keep minimum 2 per sector
      .sort((a, b) => b.count - a.count);

    if (sectorSizes.length === 0) break; // can't remove more

    const target = sectorSizes[0].sector;
    const arr = grouped[target];
    // Remove last article (lowest confidence due to sort order)
    const removedArticle = arr.pop();
    removed++;
    log(`  Truncated: ${removedArticle.title.slice(0, 50)}... (${target})`);

    context = formatContext(grouped);
    tokens = countTokens(context);
  }

  log(`Truncated ${removed} articles, final context: ${tokens} tokens`);
  return context;
}

// ─── Theme selection ──────────────────────────────────────────────────────────

/**
 * Call Claude to select the editorial theme.
 * Returns { title, rationale, angle }.
 */
async function selectTheme(anthropic, researchContext, previousTheme, modelOverride) {
  const { meta, template } = loadPrompt('draft-theme');
  const model = modelOverride || meta.model;
  const maxTokens = meta.max_tokens || 1000;

  const prompt = renderPrompt(template, {
    research_pack: researchContext,
    previous_report_theme: previousTheme,
  });

  log(`Theme selection: calling ${model}...`);
  const response = await withRetry(
    () => anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
    { onRetry: (attempt, err) => warn(`Theme retry ${attempt}: ${err.message}`) }
  );

  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response from theme selection');

  // Debug: log first 200 chars of raw response
  log(`Theme raw response (first 200 chars): ${text.slice(0, 200).replace(/\n/g, '\\n')}`);

  // Extract JSON — multiple strategies
  let result;

  // Strategy 1: Strip markdown fences line-by-line, then find balanced braces
  let jsonText = text.split('\n')
    .filter(line => !line.trim().startsWith('```'))
    .join('\n');

  // Find the outermost balanced JSON object
  let depth = 0, start = -1, end = -1;
  let inString = false, escape = false;
  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"' && !escape) { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start !== -1) { end = i + 1; break; }
    }
  }

  if (start !== -1 && end !== -1) {
    try {
      result = JSON.parse(jsonText.slice(start, end));
    } catch (parseErr) {
      warn(`Theme JSON parse failed (strategy 1): ${parseErr.message}`);
      warn(`Attempted JSON (first 300 chars): ${jsonText.slice(start, start + 300)}`);
    }
  }

  // Strategy 2: Try the raw text with simple regex
  if (!result) {
    const rawMatch = text.match(/\{[\s\S]*"themes"[\s\S]*\}/);
    if (rawMatch) {
      try {
        result = JSON.parse(rawMatch[0]);
      } catch (e) {
        warn(`Theme JSON parse failed (strategy 2): ${e.message}`);
      }
    }
  }

  // Strategy 3: Extract theme title from prose as last resort
  if (!result) {
    warn(`Could not parse theme JSON. Full response:\n${text.slice(0, 1000)}`);
    // Try to find a quoted theme phrase
    const titleMatch = text.match(/"title"\s*:\s*"([^"]+)"/);
    if (titleMatch) {
      result = { themes: [{ title: titleMatch[1], rationale: 'Extracted from unparseable JSON', angle: '' }], selected: 0 };
      warn(`Extracted theme title from partial JSON: "${titleMatch[1]}"`);
    } else {
      throw new Error('No JSON or theme title found in theme response');
    }
  }

  const selectedIdx = result.selected ?? 0;
  const selected = result.themes?.[selectedIdx];

  if (!selected || !selected.title) {
    throw new Error('Invalid theme selection result: missing title');
  }

  ok(`Theme selected: "${selected.title}"`);
  log(`  Rationale: ${selected.rationale}`);
  return selected;
}

// ─── Draft generation ─────────────────────────────────────────────────────────

/**
 * Call Claude to generate the full newsletter draft.
 * Uses system prompt (draft-system.md) + user prompt (draft-write.md).
 * Returns markdown string.
 */
async function generateDraft(anthropic, theme, researchContext, previousReport, modelOverride) {
  const system = loadPrompt('draft-system');
  const { meta, template } = loadPrompt('draft-write');
  const model = modelOverride || meta.model;
  const maxTokens = meta.max_tokens || 8000;

  const sectorOrder = SECTOR_ORDER
    .map(s => sectorNames[s]?.body || s)
    .join(', ');

  const userPrompt = renderPrompt(template, {
    theme: theme.title,
    research_pack: researchContext,
    previous_report: previousReport || 'Not available (first issue)',
    sector_order: sectorOrder,
  });

  const totalInput = countTokens(system.template) + countTokens(userPrompt);
  log(`Draft generation: calling ${model} (input: ~${totalInput} tokens, max output: ${maxTokens})...`);

  // Use streaming to avoid Bun connection timeouts on long generations
  const response = await withRetry(
    async () => {
      const stream = anthropic.messages.stream({
        model,
        max_tokens: maxTokens,
        system: system.template,
        messages: [{ role: 'user', content: userPrompt }],
      });

      // Actively consume events to keep connection alive
      let chunks = 0;
      stream.on('text', () => { chunks++; });
      const msg = await stream.finalMessage();
      log(`Received ${chunks} text chunks via stream`);
      return msg;
    },
    { onRetry: (attempt, err) => warn(`Draft retry ${attempt}: ${err.message}`) }
  );

  const text = response.content[0]?.text;
  if (!text) throw new Error('Empty response from draft generation');

  // Check for truncation
  if (response.stop_reason === 'max_tokens') {
    warn('Draft was truncated (hit max_tokens). Consider increasing budget.');
    return text + '\n\n[TRUNCATED — hit max_tokens limit]';
  }

  const wordCount = text.trim().split(/\s+/).length;
  ok(`Draft generated: ${wordCount} words`);
  return text;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runDraft(args = {}) {
  const startTime = Date.now();

  if (!args.week) {
    const today = new Date().toISOString().slice(0, 10);
    args.week = getISOWeekNumber(today);
    log(`No --week specified, using current week: ${args.week}`);
  }
  const year = args.year || new Date().getFullYear();
  const dateWindow = getWeekWindow(args.week, year);

  console.log('');
  const mode = args.shortlist ? 'Shortlist' : 'Standard';
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Draft Generation');
  console.log(`  Week ${args.week}, ${year} (${mode})`);
  console.log(`  Date window: ${dateWindow.start} → ${dateWindow.end}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  let researchContext;
  let articleCount;
  let bySector = {};

  if (args.shortlist) {
    // ─── Shortlist mode: read select.js output directly ─────────
    const selectCtx = join(ROOT, 'output', `select-context-week-${args.week}.md`);
    if (!existsSync(selectCtx)) {
      throw new Error(
        `No select context found at ${selectCtx}\n` +
        `Run first: bun scripts/select.js --week ${args.week}`
      );
    }
    researchContext = readFileSync(selectCtx, 'utf8');
    const contextTokens = countTokens(researchContext);

    // Parse article count and sector breakdown from context header
    const totalMatch = researchContext.match(/Total articles:\s*(\d+)/);
    articleCount = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    const sectorMatches = [...researchContext.matchAll(/^## .+?\((\d+) articles?\)/gm)];
    for (const m of sectorMatches) {
      const heading = m[0];
      const count = parseInt(m[1], 10);
      // Extract sector display name from heading
      const nameMatch = heading.match(/^## (.+?)\s*\(/);
      if (nameMatch) bySector[nameMatch[1]] = count;
    }

    log(`Loaded select context: ${articleCount} articles, ${contextTokens} tokens`);
    log('  (editorially selected — skipping token-budget truncation)');
    for (const [name, count] of Object.entries(bySector)) {
      log(`  ${name}: ${count} articles`);
    }
  } else {
    // ─── Standard mode: scan data/verified/ ─────────────────────
    const articles = loadArticles(dateWindow);
    articleCount = articles.length;
    log(`Loaded ${articleCount} verified articles`);

    if (articleCount === 0) {
      warn('No articles found. Run fetch.js and score.js first.');
      return { draftPath: null, theme: null, stats: { articles: 0 } };
    }

    for (const a of articles) {
      bySector[a.sector] = (bySector[a.sector] || 0) + 1;
    }
    for (const sector of SECTOR_ORDER) {
      if (bySector[sector]) log(`  ${sector}: ${bySector[sector]} articles`);
    }

    researchContext = buildResearchContext(articles, args.week, year, dateWindow);
  }

  // Load previous report
  const previousReport = loadPreviousReport(args.week);
  const previousTheme = extractPreviousTheme(previousReport);
  log(`Previous theme: "${previousTheme}"`);

  // ─── Dry run ─────────────────────────────────────────────────
  if (args.dryRun) {
    const contextTokens = countTokens(researchContext);
    const prevTokens = previousReport ? countTokens(previousReport) : 0;
    log('Dry run — not calling APIs');
    log(`  Research context: ${contextTokens} tokens`);
    log(`  Previous report: ${prevTokens} tokens`);
    log(`  Articles by sector: ${JSON.stringify(bySector)}`);

    // Save context for review (only in standard mode — shortlist already has its own context)
    if (!args.shortlist) {
      const contextPath = join(ROOT, 'output', `draft-context-week-${args.week}.md`);
      try {
        mkdirSync(join(ROOT, 'output'), { recursive: true });
        writeFileSync(contextPath, researchContext);
        ok(`Context saved to ${contextPath}`);
      } catch (err) {
        warn(`Failed to save context: ${err.message}`);
      }
    }

    return {
      draftPath: null,
      theme: null,
      dryRun: true,
      stats: { articles: articleCount, bySector, contextTokens },
    };
  }

  // ─── API calls ───────────────────────────────────────────────
  const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
  if (!apiKey) {
    log('ANTHROPIC_API_KEY not configured. Newsletter draft now runs through Claude Code.');
    process.exit(0);
  }

  const anthropic = new Anthropic({ apiKey, timeout: 10 * 60 * 1000 }); // 10 min for long drafts

  // Step 1: Theme selection
  let theme;
  try {
    theme = await selectTheme(anthropic, researchContext, previousTheme, args.model);
  } catch (err) {
    warn(`Theme selection failed: ${err.message}`);
    theme = { title: 'This week in AI', rationale: 'Generic fallback (theme selection failed)', angle: 'all sectors' };
    warn(`Using fallback theme: "${theme.title}"`);
  }

  // Step 2: Draft generation
  const rawDraft = await generateDraft(anthropic, theme, researchContext, previousReport, args.model);

  // Post-process: fix currency formatting, quotes
  const draft = postProcessDraft(rawDraft);
  const fixes = rawDraft !== draft;
  if (fixes) ok('Post-processing applied (currency/quote formatting fixes)');

  // Save draft
  mkdirSync(join(ROOT, 'output'), { recursive: true });
  const draftPath = join(ROOT, 'output', `draft-week-${args.week}.md`);
  try {
    writeFileSync(draftPath, draft);
    ok(`Draft saved to ${draftPath}`);
  } catch (err) {
    warn(`Failed to save draft: ${err.message}`);
    return { draftPath: null, theme: theme.title, stats: { articles: articleCount, bySector } };
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const wordCount = draft.trim().split(/\s+/).length;

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Draft complete in ${elapsed}s`);
  console.log(`  Theme: "${theme.title}"`);
  console.log(`  Words: ${wordCount}`);
  console.log(`  Path: ${draftPath}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  return {
    draftPath,
    theme: theme.title,
    stats: {
      articles: articleCount,
      bySector,
      wordCount,
      elapsed: parseFloat(elapsed),
    },
  };
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week')      args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year')      args.year = parseInt(argv[++i], 10);
    if (argv[i] === '--model')     args.model = argv[++i];
    if (argv[i] === '--shortlist') args.shortlist = true;
    if (argv[i] === '--dry-run')   args.dryRun = true;
  }

  runDraft(args)
    .then(result => {
      if (result.dryRun) {
        log(`Result: dry-run (${result.stats.articles} articles, ${result.stats.contextTokens} tokens)`);
      } else {
        log(`Result: theme="${result.theme}" words=${result.stats?.wordCount || 0} path=${result.draftPath}`);
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Fatal error:', err);
      process.exit(1);
    });
}
