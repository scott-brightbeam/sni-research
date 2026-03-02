#!/usr/bin/env bun
/**
 * update-off-limits.js — Parse published report → append off-limits entries
 *
 * Extracts company + topic from each story heading in a published SNI report,
 * then appends them to config/off-limits.yaml under the appropriate week key.
 *
 * Usage:
 *   bun scripts/update-off-limits.js output/published/week-9.md
 *   bun scripts/update-off-limits.js output/published/week-9.md --week 9
 *   bun scripts/update-off-limits.js output/published/week-9.md --dry-run
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { getISOWeekNumber } from './lib/week.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}]`, ...a);
const ok   = (...a) => console.log(`[${ts()}] ✓`, ...a);
const warn = (...a) => console.warn(`[${ts()}] ⚠`, ...a);

// Common English stopwords to strip from topic extraction
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'to', 'for', 'and', 'with', 'its', 'on',
  'at', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'has', 'have', 'had',
  'that', 'this', 'be', 'been', 'will', 'would', 'could', 'should', 'may',
  'can', 'do', 'does', 'did', 'not', 'or', 'but', 'if', 'than', 'into',
  'more', 'most', 'up', 'out', 'it', 'all', 'new', 'first',
]);

/**
 * Identify sector heading lines in the published report.
 * Returns array of { sector, lineIndex } marking where each body section starts.
 */
function findSectorSections(lines) {
  // Body sections start after "And if you're still hungry for more"
  // Sector headings in the body are plain text lines like:
  //   "AI industry", "Biopharma", "MedTech and digital health",
  //   "Complex manufacturing", "Insurance"
  const bodyStart = lines.findIndex(l => l.includes("still hungry for more"));
  if (bodyStart === -1) return [];

  const sectorPatterns = [
    { pattern: /^AI (?:industry|& tech)/i, sector: 'general' },
    { pattern: /^Biopharma/i, sector: 'biopharma' },
    { pattern: /^Med\s?Tech/i, sector: 'medtech' },
    { pattern: /^Complex manufacturing/i, sector: 'manufacturing' },
    { pattern: /^Insurance/i, sector: 'insurance' },
  ];

  const sections = [];
  for (let i = bodyStart + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const { pattern, sector } of sectorPatterns) {
      if (pattern.test(trimmed)) {
        sections.push({ sector, lineIndex: i });
        break;
      }
    }
  }
  return sections;
}

/**
 * Extract story headings from a body section.
 * Story headings are lines that contain a markdown link as the primary content:
 *   [Story title](url)
 *   ### [Story title](url)
 * Returns array of heading strings (link text only, no URLs).
 */
function extractStoryHeadings(lines, startIdx, endIdx) {
  const headings = [];
  const linkPattern = /^\[([^\]]+)\]\(https?:\/\/[^)]+\)\s*$/;
  const headingLinkPattern = /^#{1,3}\s*\[([^\]]+)\]\(https?:\/\/[^)]+\)\s*$/;

  for (let i = startIdx + 1; i < endIdx; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Match: [Title](url) or ### [Title](url)
    const m = trimmed.match(headingLinkPattern) || trimmed.match(linkPattern);
    if (m) {
      headings.push(m[1].trim());
    }
  }
  return headings;
}

/**
 * Extract company name from a story heading.
 * Strategy: take the first capitalised noun phrase (sequence of words
 * starting with uppercase, stopping at a lowercase word or common verb).
 */
function extractCompany(heading) {
  // Common patterns in SNI headings:
  //   "Anthropic raises $3.5bn..." → Anthropic
  //   "IQVIA acquires Charles River..." → IQVIA
  //   "State Farm, USAA and Allstate have filed..." → State Farm, USAA and Allstate
  //   "AI patents emerge..." → AI patents (less useful, but acceptable)
  //   "The SaaSpocalypse and the stack war" → SaaSpocalypse

  const words = heading.split(/\s+/);
  const companyWords = [];

  for (const word of words) {
    // Strip leading punctuation like quotes
    const clean = word.replace(/^['""]/, '');
    if (!clean) continue;

    // Check if word is capitalised or all-caps (proper noun / acronym)
    const isCapitalised = /^[A-Z]/.test(clean);
    const isAcronym = /^[A-Z]{2,}/.test(clean);
    // Common verbs/adjectives that signal end of company name
    const isVerb = /^(raises?|raised|acquires?|acquired|launches?|launched|secures?|secured|signs?|signed|reports?|reported|brings?|filed|expands?|expanded|announces?|announced|pushes?|pushed|backed|weighed|reinforces?|surges?|emerges?|falls?|fell|suffers?|suffered|rattles?|builds?|argued|closes?|closed|agreed|released|withheld|withholds?|scales?|scaled)$/i.test(clean);

    if (isVerb && companyWords.length > 0) break;

    if (isCapitalised || isAcronym) {
      companyWords.push(clean);
    } else if (companyWords.length > 0) {
      // Allow connectors like "and", "of", "&" within company names
      if (/^(and|of|&|the)$/i.test(clean)) {
        companyWords.push(clean);
      } else {
        break;
      }
    }
  }

  // Trim trailing connectors
  while (companyWords.length > 0 && /^(and|of|&|the)$/i.test(companyWords[companyWords.length - 1])) {
    companyWords.pop();
  }

  return companyWords.join(' ') || heading.split(/\s+/).slice(0, 2).join(' ');
}

/**
 * Extract topic keywords from a heading after removing the company name.
 * Returns 3-7 significant words.
 */
function extractTopic(heading, company) {
  // Remove company name from heading
  let remainder = heading;
  if (company) {
    const idx = heading.toLowerCase().indexOf(company.toLowerCase());
    if (idx !== -1) {
      remainder = heading.slice(idx + company.length).trim();
    }
  }

  // Strip leading verbs/prepositions
  remainder = remainder.replace(/^(raises?|raised|acquires?|acquired|launches?|launched|secures?|secured|signs?|signed|brings?|expands?|reports?|announces?|pushes?|filed|backed|agreed|closed|withheld|withholds?|scales?)\s+/i, '');

  const words = remainder
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0)
    .filter(w => !STOPWORDS.has(w.toLowerCase()))
    .filter(w => !/^\$?\d/.test(w)) // remove pure numbers/money
    .slice(0, 7);

  return words.join(' ') || remainder.split(/\s+/).slice(0, 5).join(' ');
}

/**
 * Extract all stories from a published report.
 * Also extracts from tl;dr bullet section as a secondary source.
 */
export function extractStories(markdown) {
  const lines = markdown.split('\n');
  const stories = [];

  // --- Extract from body sections (primary) ---
  const sections = findSectorSections(lines);

  for (let si = 0; si < sections.length; si++) {
    const startIdx = sections[si].lineIndex;
    const endIdx = si + 1 < sections.length
      ? sections[si + 1].lineIndex
      : lines.findIndex((l, i) => i > startIdx && /^Thank you for reading/i.test(l.trim())) || lines.length;

    const headings = extractStoryHeadings(lines, startIdx, endIdx === -1 ? lines.length : endIdx);

    for (const heading of headings) {
      const company = extractCompany(heading);
      const topic = extractTopic(heading, company);
      if (company && topic) {
        stories.push({ company, topic });
      }
    }
  }

  // --- Also extract from tl;dr bullets (catches stories only mentioned there) ---
  const tldrStart = lines.findIndex(l => /^tl;dr/i.test(l.trim()));
  const tldrEnd = lines.findIndex((l, i) => i > (tldrStart || 0) && /still hungry for more/i.test(l));

  if (tldrStart !== -1 && tldrEnd !== -1) {
    const bulletPattern = /^-\s+\[([^\]]+)\]\(https?:\/\/[^)]+\)/;
    for (let i = tldrStart; i < tldrEnd; i++) {
      const m = lines[i].trim().match(bulletPattern);
      if (m) {
        const bulletText = m[1].trim();
        const company = extractCompany(bulletText);
        const topic = extractTopic(bulletText, company);
        if (company && topic) {
          // Only add if not already covered by body extraction
          const isDupe = stories.some(s =>
            s.company.toLowerCase() === company.toLowerCase() ||
            keywordOverlap(s.topic, topic) >= 0.5
          );
          if (!isDupe) {
            stories.push({ company, topic });
          }
        }
      }
    }
  }

  return stories;
}

/**
 * Calculate keyword overlap ratio between two topic strings.
 */
function keywordOverlap(topic1, topic2) {
  const words1 = new Set(topic1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(topic2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (words1.size === 0 || words2.size === 0) return 0;
  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap / Math.max(words1.size, words2.size);
}

/**
 * Append extracted entries to config/off-limits.yaml under a week key.
 * Deduplicates against existing entries (company + topic keyword overlap).
 */
export function appendToOffLimits(entries, weekNumber) {
  const offLimitsPath = join(ROOT, 'config', 'off-limits.yaml');
  const existing = yaml.load(readFileSync(offLimitsPath, 'utf8')) || {};

  const weekKey = `week_${weekNumber}`;

  // Check for duplicates across ALL existing weeks
  const allExisting = [];
  for (const [, weekEntries] of Object.entries(existing)) {
    if (!Array.isArray(weekEntries)) continue;
    allExisting.push(...weekEntries);
  }

  const newEntries = [];
  for (const entry of entries) {
    const isDupe = allExisting.some(e => {
      if (!e.company) return false;
      const companyMatch = e.company.toLowerCase() === entry.company.toLowerCase();
      const topicMatch = keywordOverlap(e.topic || '', entry.topic || '') >= 0.5;
      return companyMatch && topicMatch;
    });
    if (!isDupe) {
      newEntries.push(entry);
    } else {
      log(`  Skipping duplicate: ${entry.company} - ${entry.topic}`);
    }
  }

  if (newEntries.length === 0) {
    log('No new entries to add (all duplicates).');
    return 0;
  }

  // Merge with any existing entries for this week
  if (!existing[weekKey]) {
    existing[weekKey] = [];
  }
  existing[weekKey].push(...newEntries);

  writeFileSync(offLimitsPath, yaml.dump(existing, { lineWidth: -1, noRefs: true }));
  return newEntries.length;
}

/**
 * Main entry point — parse published report, extract stories, append to off-limits.
 */
export async function runUpdateOffLimits(args = {}) {
  const reportPath = args.reportPath;
  if (!reportPath) {
    throw new Error('Usage: bun scripts/update-off-limits.js <published-report.md> [--week N] [--dry-run]');
  }

  log(`Reading published report: ${reportPath}`);
  const markdown = readFileSync(reportPath, 'utf8');

  const stories = extractStories(markdown);
  log(`Extracted ${stories.length} stories from report`);

  if (stories.length === 0) {
    warn('No stories extracted. Check report format.');
    return { extracted: 0, added: 0 };
  }

  // Determine week number
  let weekNumber = args.week;
  if (!weekNumber) {
    // Try to extract from filename: week-9.md
    const match = reportPath.match(/week-(\d+)/i);
    if (match) {
      weekNumber = parseInt(match[1], 10);
    } else {
      weekNumber = getISOWeekNumber(new Date().toISOString().slice(0, 10));
    }
  }

  log(`Target week: week_${weekNumber}`);
  console.log('');

  // Display extracted stories
  for (const story of stories) {
    console.log(`  ${story.company.padEnd(30)} ${story.topic}`);
  }
  console.log('');

  if (args.dryRun) {
    log('Dry run — not writing to off-limits.yaml');
    return { extracted: stories.length, added: 0, dryRun: true };
  }

  const added = appendToOffLimits(stories, weekNumber);
  ok(`Added ${added} new entries to config/off-limits.yaml under week_${weekNumber}`);

  return { extracted: stories.length, added };
}

// --- CLI entry point ---
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const args = { reportPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--week') { args.week = parseInt(argv[++i], 10); continue; }
    if (argv[i] === '--dry-run') { args.dryRun = true; continue; }
    if (!argv[i].startsWith('--')) args.reportPath = argv[i];
  }

  runUpdateOffLimits(args)
    .then(stats => {
      log(`Result: extracted=${stats.extracted} added=${stats.added}`);
      process.exit(0);
    })
    .catch(e => {
      console.error('Fatal error:', e);
      process.exit(1);
    });
}
