/**
 * report.js - Research pack generator for SNI Research Tool
 *
 * Reads verified articles, groups by sector, checks off-limits,
 * and generates a markdown research pack.
 *
 * Usage:
 *   bun scripts/report.js --test              # Last 7 days
 *   bun scripts/report.js --week 9            # ISO week 9 of current year
 *   bun scripts/report.js --week 9 --year 2026
 *   bun scripts/report.js --start-date 2026-02-13 --end-date 2026-02-20
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { getISOWeekNumber, getISOYearForWeek, getWeekWindow } from './lib/week.js';
import { loadSectorNames } from './lib/prompt.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const sectorsConfig = yaml.load(readFileSync(join(ROOT, 'config', 'sectors.yaml'), 'utf8'));
const offLimits = yaml.load(readFileSync(join(ROOT, 'config', 'off-limits.yaml'), 'utf8'));

// Canonical sector ordering and display names from config
const sectorNamesConfig = loadSectorNames();
const SECTOR_ORDER = Object.entries(sectorNamesConfig)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key]) => key);
const SECTOR_DISPLAY_NAMES = Object.fromEntries(
  Object.entries(sectorNamesConfig).map(([key, val]) => [key, val.config])
);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--test') args.test = true;
    if (argv[i] === '--start-date') args.startDate = argv[++i];
    if (argv[i] === '--end-date') args.endDate = argv[++i];
    if (argv[i] === '--week') args.week = parseInt(argv[++i], 10);
    if (argv[i] === '--year') args.year = parseInt(argv[++i], 10);
  }
  return args;
}

function getDateWindow(args) {
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
  const d = today.toISOString().slice(0, 10);
  return { startDate: d, endDate: d };
}

function getAllVerifiedArticles(window) {
  const verifiedDir = join(ROOT, 'data', 'verified');
  if (!existsSync(verifiedDir)) return [];

  const articles = [];
  const dateDirs = readdirSync(verifiedDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name >= window.startDate && d.name <= window.endDate)
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
          const article = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'));
          // Remove raw HTML from report processing
          delete article._raw_html;
          articles.push(article);
        } catch { /* skip corrupt files */ }
      }
    }
  }

  // Sort by date descending, then by title
  return articles.sort((a, b) => {
    if (b.date_published !== a.date_published) return b.date_published.localeCompare(a.date_published);
    return a.title.localeCompare(b.title);
  });
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

function groupBySector(articles) {
  const groups = {};
  for (const article of articles) {
    const sector = article.sector || 'general';
    if (!groups[sector]) groups[sector] = [];
    groups[sector].push(article);
  }
  return groups;
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00Z');
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch { return dateStr; }
}

// Replaced naive day-of-year/7 math with proper ISO week calculation
function getWeekNumber(dateStr) {
  return getISOWeekNumber(dateStr);
}

function summariseSector(articles, sectorName, displayName) {
  if (!articles || articles.length === 0) return '';

  const lines = [`## ${displayName} (${articles.length} article${articles.length !== 1 ? 's' : ''}, all dates verified)\n`];

  articles.forEach((a, i) => {
    const verifiedNote = `verified: ${a.date_verified_method}`;
    const summary = a.snippet
      ? a.snippet.replace(/\s+/g, ' ').trim().slice(0, 300)
      : '(no snippet available)';

    lines.push(`### Story ${i + 1}: ${a.title}`);
    lines.push(`- Source: ${a.source}`);
    lines.push(`- URL: ${a.url}`);
    lines.push(`- Published: ${formatDate(a.date_published)} (${verifiedNote})`);
    lines.push(`- Confidence: ${a.date_confidence}`);
    lines.push(`- Summary: ${summary}`);
    lines.push('');
  });

  return lines.join('\n');
}

function checkOffLimitsReport(articles, offLimits) {
  const conflicts = [];
  for (const article of articles) {
    const searchText = `${article.title} ${article.snippet || ''}`.toLowerCase();
    for (const [week, entries] of Object.entries(offLimits)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        const company = entry.company?.toLowerCase();
        const topic = entry.topic?.toLowerCase();
        if (!company) continue;
        if (searchText.includes(company)) {
          const topicWords = (topic || '').split(' ').filter(w => w.length > 3);
          const matches = topicWords.filter(w => searchText.includes(w)).length;
          if (matches >= Math.max(1, Math.floor(topicWords.length * 0.5))) {
            conflicts.push({
              article: article.title,
              reason: `${week}: ${entry.company} - ${entry.topic}`,
            });
          }
        }
      }
    }
  }
  return conflicts;
}

function generateReport(articles, window) {
  const deduplicated = deduplicateArticles(articles);
  const grouped = groupBySector(deduplicated);
  const weeksRange = `${formatDate(window.startDate)} - ${formatDate(window.endDate)}`;
  const weekNum = getWeekNumber(window.endDate);
  const weekYear = getISOYearForWeek(window.endDate);

  const offLimitConflicts = checkOffLimitsReport(deduplicated, offLimits);
  const weeksChecked = Object.keys(offLimits).join(', ');

  let report = `# SNI Research Pack: Week ${weekNum}, ${weekYear}
Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
Date range: ${weeksRange}
Total verified articles: ${deduplicated.length}

---

`;

  // Headline summary table
  report += `## Headlines Overview\n\n`;
  for (const sector of SECTOR_ORDER) {
    const articles = grouped[sector];
    if (!articles || articles.length === 0) continue;
    const name = SECTOR_DISPLAY_NAMES[sector] || sector;
    report += `**${name}** (${articles.length})\n`;
    for (const a of articles) {
      report += `• ${a.title} [${a.source}, ${a.date_published}]\n`;
    }
    report += '\n';
  }

  report += '---\n\n';

  // Detailed sector sections
  for (const sector of SECTOR_ORDER) {
    const sectorArticles = grouped[sector];
    const displayName = SECTOR_DISPLAY_NAMES[sector] || sector;
    if (sectorArticles && sectorArticles.length > 0) {
      report += summariseSector(sectorArticles, sector, displayName);
      report += '---\n\n';
    }
  }

  // Off-limits check
  report += `## Off-Limits Check\n`;
  report += `- Checked against: ${weeksChecked}\n`;
  if (offLimitConflicts.length === 0) {
    report += `- Conflicts found: 0 ✓\n`;
  } else {
    report += `- Conflicts found: ${offLimitConflicts.length} ⚠\n`;
    for (const conflict of offLimitConflicts) {
      report += `  - "${conflict.article}" → ${conflict.reason}\n`;
    }
  }
  report += '\n';

  // Stats
  report += `## Collection Statistics\n`;
  for (const sector of SECTOR_ORDER) {
    const count = grouped[sector]?.length || 0;
    const name = SECTOR_DISPLAY_NAMES[sector] || sector;
    report += `- ${name}: ${count} articles\n`;
  }

  return { report, stats: { total: deduplicated.length, bySector: Object.fromEntries(SECTOR_ORDER.map(s => [s, grouped[s]?.length || 0])) } };
}

export async function runReport(args = {}) {
  const window = getDateWindow(args);

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('  SNI Research Tool - Report');
  if (args.week) console.log(`  Week mode: Week ${args.week}, ${args.year || new Date().getFullYear()}`);
  console.log(`  Date window: ${window.startDate} → ${window.endDate}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  const articles = getAllVerifiedArticles(window);
  console.log(`Found ${articles.length} verified articles in window`);

  if (articles.length === 0) {
    console.log('No articles found. Run fetch.js first.');
    return { total: 0, bySector: {}, reportPath: null };
  }

  const { report, stats } = generateReport(articles, window);

  // Save report
  mkdirSync(join(ROOT, 'output'), { recursive: true });
  const weekNum = getWeekNumber(window.endDate);
  const suffix = args.test ? 'test' : `week-${weekNum}`;
  const reportPath = join(ROOT, 'output', `${window.endDate}-${suffix}-research.md`);
  try {
    writeFileSync(reportPath, report);
  } catch (err) {
    console.warn(`Failed to save report: ${err.message}`);
    return { ...stats, reportPath: null };
  }

  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Report saved: ${reportPath}`);
  console.log('');
  console.log('  Articles by sector:');
  for (const [sector, count] of Object.entries(stats.bySector)) {
    if (count > 0) console.log(`    ${sector.padEnd(15)} ${count}`);
  }
  console.log(`    ${'TOTAL'.padEnd(15)} ${stats.total}`);
  console.log('═══════════════════════════════════════════════');
  console.log('');

  // Print headline summary to console
  console.log('── Headline Summary ────────────────────────────');
  const grouped = {};
  for (const a of articles) {
    if (!grouped[a.sector]) grouped[a.sector] = [];
    grouped[a.sector].push(a);
  }
  for (const sector of SECTOR_ORDER) {
    const sArticles = grouped[sector];
    if (!sArticles || sArticles.length === 0) continue;
    console.log(`\n${SECTOR_DISPLAY_NAMES[sector] || sector} (${sArticles.length}):`);
    for (const a of sArticles) {
      console.log(`  • ${a.title.slice(0, 80)} [${a.date_published}]`);
    }
  }
  console.log('');

  return { ...stats, reportPath };
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  runReport(args)
    .then(stats => {
      console.log(`Result: ${stats.total} articles, report: ${stats.reportPath || 'none'}`);
      process.exit(0);
    })
    .catch(e => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
}
