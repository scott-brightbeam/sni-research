#!/usr/bin/env bun
/**
 * Fix theme evidence URL gap in data/editorial/state.json.
 * Cross-references evidence items (which lack URLs) against analysisIndex entries (which have URLs).
 * Uses write-validate-swap pattern for safe writes.
 *
 * Usage: bun scripts/fix-evidence-urls.js [--dry-run]
 */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const DRY_RUN = process.argv.includes('--dry-run');
const STATE_PATH = join(import.meta.dir, '..', 'data', 'editorial', 'state.json');
const BACKUP_DIR = join(import.meta.dir, '..', 'data', 'editorial', 'backups');

// ── Parse evidence source strings ──────────────────────────────────

function parseEvidenceSource(src) {
  const result = { sourceName: null, date: null, episodeTitle: null, raw: src };
  if (!src) return result;

  // Pattern 1: "SourceName (DD Month YYYY)" or "SourceName (DD Month)"
  //   also handles "Source - Episode (DD Month YYYY)"
  let m = src.match(/^(.+?)\s*\((\d{1,2}\s+\w+(?:\s+\d{4})?)\)\s*$/);
  if (m) {
    const beforeParen = m[1].trim();
    result.date = m[2];
    const dashIdx = beforeParen.indexOf(' - ');
    if (dashIdx > -1) {
      result.sourceName = beforeParen.substring(0, dashIdx).trim();
      result.episodeTitle = beforeParen.substring(dashIdx + 3).trim();
    } else {
      result.sourceName = beforeParen;
    }
    return result;
  }

  // Pattern 2: "Source - Title (YYYY-MM-DD)"
  m = src.match(/^(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/);
  if (m) {
    const beforeParen = m[1].trim();
    result.date = m[2];
    const dashIdx = beforeParen.indexOf(' - ');
    if (dashIdx > -1) {
      result.sourceName = beforeParen.substring(0, dashIdx).trim();
      result.episodeTitle = beforeParen.substring(dashIdx + 3).trim();
    } else {
      result.sourceName = beforeParen;
    }
    return result;
  }

  // Pattern 3: "Topic (SourceName, MonthAbbrev YYYY)" e.g. "Goodfire interpretability (Cognitive Revolution, Mar 2026)"
  m = src.match(/^(.+?)\s*\(([^,]+),\s*(\w+\s+\d{4})\)\s*$/);
  if (m) {
    result.episodeTitle = m[1].trim();
    result.sourceName = m[2].trim();
    result.date = m[3];
    return result;
  }

  return result;
}

// ── Normalisation helpers ──────────────────────────────────────────

function normSource(s) {
  if (!s) return '';
  return s.toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')   // remove parentheticals
    .replace(/\s*with\s+.*/i, '')       // remove "with X"
    .replace(/\u2014.*$/i, '')           // remove em-dash suffixes
    .replace(/[^a-z0-9 ]/g, ' ')        // normalise punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, oct: 10, nov: 11, dec: 12
};

function normDate(d) {
  if (!d) return null;
  const s = d.trim();

  // ISO format "2026-03-14"
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { day: parseInt(m[3]), month: parseInt(m[2]) };

  // "16 March 2026" or "16 March"
  m = s.match(/^(\d{1,2})\s+(\w+)/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase()];
    if (mon) return { day: parseInt(m[1]), month: mon };
  }

  // "March 2026" or "Feb 2026" (month only, no day)
  m = s.match(/^(\w+)\s+\d{4}$/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon) return { day: null, month: mon };
  }

  return null;
}

function datesMatch(d1, d2) {
  if (!d1 || !d2) return false;
  if (d1.month !== d2.month) return false;
  if (d1.day !== null && d2.day !== null) return d1.day === d2.day;
  // Month-only date matches any day in that month
  return true;
}

// ── Source name matching ───────────────────────────────────────────

// Canonical analysis source name -> known short forms used in evidence
const SOURCE_ALIASES = new Map([
  ['ai daily brief', ['ai daily brief']],
  ['cognitive revolution', ['cognitive revolution', 'cognitive revolution ai scouting report']],
  ['exponential view podcast', ['exponential view podcast', 'ev podcast', 'azhar']],
  ['exponential view newsletter', ['exponential view newsletter', 'ev newsletter', 'ev newsletter azhar']],
  ['the a16z show', ['the a16z show', 'a16z', 'moore a16z', 'moore a16z top 100', 'helberg a16z']],
  ['no priors podcast', ['no priors podcast', 'no priors']],
  ['no priors', ['no priors podcast', 'no priors']],
  ['jim rutt show', ['jim rutt show', 'jim rutt']],
  ['jim rutt show worldviews series', ['jim rutt show', 'jim rutt', 'jim rutt pollock']],
  ['complex systems', ['complex systems', 'complex systems patio11']],
  ['moonshots', ['moonshots']],
  ['big technology', ['big technology', 'big technology podcast']],
  ['big technology podcast', ['big technology', 'big technology podcast']],
  ['lex fridman podcast', ['lex fridman podcast', 'lex fridman']],
  ['dwarkesh podcast', ['dwarkesh podcast', 'dwarkesh']],
  ['intelligence squared', ['intelligence squared']],
  ['one useful thing', ['one useful thing', 'mollick']],
]);

function sourcesMatch(evidenceSourceNorm, analysisSourceNorm) {
  if (!evidenceSourceNorm || !analysisSourceNorm) return false;

  // Direct match or containment
  if (evidenceSourceNorm === analysisSourceNorm) return true;
  if (analysisSourceNorm.includes(evidenceSourceNorm) && evidenceSourceNorm.length > 4) return true;
  if (evidenceSourceNorm.includes(analysisSourceNorm) && analysisSourceNorm.length > 4) return true;

  // Check aliases: does the analysis source have aliases that match the evidence source?
  for (const [canonical, aliases] of SOURCE_ALIASES) {
    const canonicalMatches = analysisSourceNorm.includes(canonical) || canonical.includes(analysisSourceNorm);
    if (canonicalMatches) {
      for (const alias of aliases) {
        if (evidenceSourceNorm.includes(alias) || alias.includes(evidenceSourceNorm)) return true;
        // Also check individual significant words (require at least 2 matching words to avoid false positives)
        const aliasWords = alias.split(' ').filter(w => w.length > 3);
        const evWords = evidenceSourceNorm.split(' ').filter(w => w.length > 3);
        if (aliasWords.length >= 2 && evWords.length >= 2 && aliasWords.every(aw => evWords.some(ew => ew.includes(aw) || aw.includes(ew)))) return true;
      }
    }
    // Reverse: evidence source matches an alias, check if analysis source matches canonical
    for (const alias of aliases) {
      if (evidenceSourceNorm.includes(alias) || alias.includes(evidenceSourceNorm)) {
        if (analysisSourceNorm.includes(canonical) || canonical.includes(analysisSourceNorm)) return true;
      }
    }
  }

  // Fallback: check if significant words overlap (require 2+ distinct shared words)
  const evWords = [...new Set(evidenceSourceNorm.split(' ').filter(w => w.length > 3))];
  const anWords = [...new Set(analysisSourceNorm.split(' ').filter(w => w.length > 3))];
  if (evWords.length >= 2 && anWords.length >= 2) {
    const overlap = evWords.filter(w => anWords.some(aw => aw === w));
    if (overlap.length >= 2) return true;
  }

  return false;
}

// ── Main matching logic ────────────────────────────────────────────

function findMatchingAnalysis(parsed, analysisEntries) {
  if (!parsed.sourceName && !parsed.episodeTitle) return null;

  const evDate = normDate(parsed.date);
  const evSourceNorm = normSource(parsed.sourceName);
  // For pattern 3, the source name is in a different position
  const evTitleNorm = normSource(parsed.episodeTitle);

  const candidates = [];

  for (const entry of analysisEntries) {
    if (!entry.url) continue;

    const entrySourceNorm = normSource(entry.source);
    const entryDate = normDate(entry.date);

    // Check source name match (try both source and title from evidence)
    const sourceMatch = sourcesMatch(evSourceNorm, entrySourceNorm) ||
                        (evTitleNorm && sourcesMatch(evTitleNorm, entrySourceNorm));

    if (!sourceMatch) continue;

    // Check date match
    if (evDate && entryDate && datesMatch(evDate, entryDate)) {
      candidates.push(entry);
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Multiple candidates — prefer exact source match
  const exact = candidates.find(c => normSource(c.source) === evSourceNorm);
  if (exact) return exact;

  // Otherwise take the first match
  return candidates[0];
}

// ── Execute ────────────────────────────────────────────────────────

console.log('Reading state.json...');
const rawJson = readFileSync(STATE_PATH, 'utf8');
const state = JSON.parse(rawJson);

const analysisEntries = Object.values(state.analysisIndex || {});
console.log(`Analysis index: ${analysisEntries.length} entries, ${analysisEntries.filter(e => e.url).length} with URLs`);

let totalEvidence = 0;
let alreadyHaveUrl = 0;
let fixed = 0;
let unfixed = 0;
const fixedDetails = [];
const unfixedDetails = [];

for (const [themeId, theme] of Object.entries(state.themeRegistry || {})) {
  for (const ev of (theme.evidence || [])) {
    totalEvidence++;
    if (ev.url) {
      alreadyHaveUrl++;
      continue;
    }

    const parsed = parseEvidenceSource(ev.source);
    const match = findMatchingAnalysis(parsed, analysisEntries);

    if (match) {
      fixed++;
      fixedDetails.push({
        theme: themeId,
        source: ev.source,
        url: match.url,
        matchedVia: `${match.source} / ${match.date}`
      });
      // Apply the fix
      if (!DRY_RUN) {
        ev.url = match.url;
      }
    } else {
      unfixed++;
      unfixedDetails.push({
        theme: themeId,
        source: ev.source,
        parsed: { sourceName: parsed.sourceName, date: parsed.date, episodeTitle: parsed.episodeTitle }
      });
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────

console.log('\n=== RESULTS ===');
console.log(`Total evidence items: ${totalEvidence}`);
console.log(`Already had URL: ${alreadyHaveUrl}`);
console.log(`Matched & fixed: ${fixed}`);
console.log(`Still unmatched: ${unfixed}`);
console.log(`New coverage: ${((alreadyHaveUrl + fixed) / totalEvidence * 100).toFixed(1)}% (was ${(alreadyHaveUrl / totalEvidence * 100).toFixed(1)}%)`);

console.log('\n── Fixed items ──');
for (const f of fixedDetails) {
  console.log(`  ${f.theme}: "${f.source}" => ${f.matchedVia}`);
}

console.log('\n── Unmatched items ──');
for (const u of unfixedDetails) {
  console.log(`  ${u.theme}: "${u.source}" (parsed: source="${u.parsed.sourceName}", date="${u.parsed.date}", title="${u.parsed.episodeTitle}")`);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] No files modified.');
  process.exit(0);
}

// ── Write-validate-swap ────────────────────────────────────────────

const tmpPath = STATE_PATH + '.tmp';
const newJson = JSON.stringify(state, null, 2);

console.log('\nWriting tmp file...');
writeFileSync(tmpPath, newJson);

// Validate by parsing back
console.log('Validating tmp file...');
const parsed = JSON.parse(readFileSync(tmpPath, 'utf8'));
const newEvidenceWithUrl = Object.values(parsed.themeRegistry || {})
  .flatMap(t => t.evidence || [])
  .filter(e => e.url).length;
console.log(`  Validation: ${newEvidenceWithUrl} evidence items now have URLs (expected ${alreadyHaveUrl + fixed})`);
if (newEvidenceWithUrl !== alreadyHaveUrl + fixed) {
  console.error('  VALIDATION FAILED — aborting');
  process.exit(1);
}

// Backup
if (!existsSync(BACKUP_DIR)) {
  mkdirSync(BACKUP_DIR, { recursive: true });
}
const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
const backupPath = join(BACKUP_DIR, `state-${ts}.json`);
console.log(`Backing up to ${backupPath}...`);
writeFileSync(backupPath, rawJson);

// Swap
console.log('Renaming tmp -> state.json...');
renameSync(tmpPath, STATE_PATH);

console.log('\nDone.');
