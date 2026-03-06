/**
 * categorise.js - Sector assignment for SNI Research Tool
 *
 * Assigns a primary sector to an article based on keyword matching.
 * Primary sector only - no cross-posting.
 * Cast wide net: over-inclusion is better than missing relevant stories.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config', 'sectors.yaml');

let sectorsConfig = null;

function loadSectors() {
  if (!sectorsConfig) {
    sectorsConfig = yaml.load(readFileSync(configPath, 'utf8'));
  }
  return sectorsConfig.sectors;
}

/**
 * Check if text contains any of the given terms (case-insensitive).
 */
function containsAny(text, terms) {
  const lower = text.toLowerCase();
  return terms.some(term => {
    const t = term.toLowerCase();
    // Short terms (<=3 chars like "AI") need word-boundary matching
    // to avoid substring false positives (e.g. "AI" inside "email", "detail")
    if (t.length <= 3) {
      const regex = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    }
    return lower.includes(t);
  });
}

/**
 * Count boost term matches.
 */
function countBoosts(text, terms) {
  const lower = text.toLowerCase();
  return terms.filter(term => {
    const t = term.toLowerCase();
    if (t.length <= 3) {
      const regex = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(text);
    }
    return lower.includes(t);
  }).length;
}

/**
 * Score an article against a sector definition.
 * Returns { matches: boolean, boostScore: number }
 */
function scoreSector(text, sectorDef) {
  // Must match at least one from each required group
  const group1Match = containsAny(text, sectorDef.required_any_group_1);
  const group2Match = containsAny(text, sectorDef.required_any_group_2);

  if (!group1Match || !group2Match) {
    return { matches: false, boostScore: 0 };
  }

  const boostScore = countBoosts(text, sectorDef.boost || []);
  return { matches: true, boostScore };
}

/**
 * Assign primary sector to an article.
 * Priority: sectors are checked in order (biopharma, medtech, manufacturing, insurance)
 * with boost scores as tiebreakers. General is the fallback.
 *
 * @param {string} title - Article title
 * @param {string} text - Article full text or snippet
 * @param {string} sourceSector - Hint from RSS feed source (optional)
 * @returns {string} Sector name or 'general'
 */
export function assignSector(title, text, sourceSector = null) {
  const sectors = loadSectors();
  const fullText = `${title} ${text}`;
  // Default scan window: title + first 800 chars. AI keyword must appear
  // prominently, not buried in boilerplate deep in the article.
  // Sectors with scan_chars override get a wider window (e.g. biopharma,
  // insurance — their trade press often buries the AI angle below the fold).
  const DEFAULT_SCAN_CHARS = 800;

  // Sector priority order (general is last/fallback)
  const sectorOrder = ['biopharma', 'medtech', 'manufacturing', 'insurance'];

  // If source is from a known sector RSS feed and it matches, prefer that sector
  if (sourceSector && sourceSector !== 'general' && sourceSector !== 'cross_sector') {
    const sectorDef = sectors[sourceSector];
    if (sectorDef) {
      const chars = sectorDef.scan_chars || DEFAULT_SCAN_CHARS;
      const result = scoreSector(fullText.slice(0, chars), sectorDef);
      if (result.matches) return sourceSector;
    }
  }

  // Score all sectors.
  // scan_chars override only applies when the article came from that sector's
  // own RSS feed (sourceSector hint). For cross-sector / Brave / no-hint articles,
  // always use DEFAULT_SCAN_CHARS to prevent false positives from incidental
  // sector mentions deep in general-interest articles.
  const scores = {};
  for (const sectorName of sectorOrder) {
    const sectorDef = sectors[sectorName];
    if (!sectorDef) continue;
    const chars = (sourceSector === sectorName && sectorDef.scan_chars)
      ? sectorDef.scan_chars
      : DEFAULT_SCAN_CHARS;
    scores[sectorName] = scoreSector(fullText.slice(0, chars), sectorDef);
  }

  // Find best matching sector (most boost score wins, then first in priority order)
  let bestSector = null;
  let bestBoost = -1;
  for (const sectorName of sectorOrder) {
    const score = scores[sectorName];
    if (score.matches && score.boostScore > bestBoost) {
      bestSector = sectorName;
      bestBoost = score.boostScore;
    }
  }

  if (bestSector) return bestSector;

  // Check general AI keywords
  const generalDef = sectors['general'];
  if (generalDef) {
    const chars = generalDef.scan_chars || DEFAULT_SCAN_CHARS;
    const result = scoreSector(fullText.slice(0, chars), generalDef);
    if (result.matches) return 'general';
  }

  return null; // No sector match - article should be skipped
}

/**
 * Check article against off-limits list.
 * @param {string} title - Article title
 * @param {string} text - Article text
 * @param {object} offLimits - Off-limits config object { week_N: [{company, topic}] }
 * @returns {{ blocked: boolean, reason: string|null }}
 */
export function checkOffLimits(title, text, offLimits) {
  // Check title + first 500 chars only - prevents source attributions like
  // '© PYMNTS' or 'via Reuters' deep in article bodies triggering false positives.
  const searchText = `${title} ${text}`.toLowerCase().slice(0, 500);

  for (const [week, entries] of Object.entries(offLimits)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const company = entry.company?.toLowerCase();
      const topic = entry.topic?.toLowerCase();

      if (!company && !topic) continue;

      // Company must appear AND at least one topic keyword must appear
      const companyMatch = company && searchText.includes(company);
      if (!companyMatch) continue;

      // Check topic keywords (split by spaces, check if most appear)
      if (topic) {
        const topicWords = topic.split(' ').filter(w => w.length > 3);
        const topicMatches = topicWords.filter(w => searchText.includes(w)).length;
        if (topicMatches >= Math.max(1, Math.floor(topicWords.length * 0.5))) {
          return {
            blocked: true,
            reason: `${week}: ${entry.company} - ${entry.topic}`,
          };
        }
      }
    }
  }

  return { blocked: false, reason: null };
}
