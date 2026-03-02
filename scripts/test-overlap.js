#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { normaliseUrl } from './select.js';

const selectJson = JSON.parse(readFileSync('output/select-week-9.json', 'utf8'));
const pubWeek9 = readFileSync('output/published/week-9.md', 'utf8');

const urlPattern = /https?:\/\/[^\s)>"]+/g;
const pubUrls = [...new Set(pubWeek9.match(urlPattern) || [])].map(u => normaliseUrl(u));
const selectedUrls = selectJson.map(s => normaliseUrl(s.url));

const hits = pubUrls.filter(pu => selectedUrls.some(su => su === pu));
console.log(`Published URLs: ${pubUrls.length}`);
console.log(`Selected URLs: ${selectedUrls.length}`);
console.log(`Direct URL hits: ${hits.length}/${pubUrls.length} = ${(100 * hits.length / pubUrls.length).toFixed(1)}%`);

const union = new Set([...pubUrls, ...selectedUrls]);
const intersection = pubUrls.filter(pu => selectedUrls.includes(pu));
console.log(`Jaccard: ${(100 * intersection.length / union.size).toFixed(1)}%`);

// Show misses
const misses = pubUrls.filter(pu => !selectedUrls.includes(pu));
console.log(`\nMissed published URLs (${misses.length}):`);
for (const m of misses) console.log(`  ${m}`);

// Sector breakdown
const bySector = {};
for (const s of selectJson) {
  bySector[s.sector] = (bySector[s.sector] || 0) + 1;
}
console.log('\nSector breakdown:');
for (const [s, c] of Object.entries(bySector).sort()) console.log(`  ${s}: ${c}`);
