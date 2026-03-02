#!/usr/bin/env bun
import { readFileSync } from 'fs';
import { normaliseUrl } from './select.js';

const selectJson = JSON.parse(readFileSync('output/select-week-9.json', 'utf8'));
const finalText = readFileSync('output/select-debug-final-test.txt', 'utf8');

// Parse what the final selection kept
const urlPattern = /https?:\/\/[^\s|)>"\]]+/g;
const shortlistMatch = finalText.match(/---SHORTLIST---([\s\S]*?)---END SHORTLIST---/);
const selectedUrls = new Set(
  (shortlistMatch[1].match(urlPattern) || []).map(u => normaliseUrl(u))
);

const sectors = ['biopharma', 'medtech', 'manufacturing', 'insurance'];
for (const sector of sectors) {
  const stories = selectJson.filter(s => s.sector === sector);
  const kept = stories.filter(s => selectedUrls.has(normaliseUrl(s.url)));
  const cut = stories.filter(s => !selectedUrls.has(normaliseUrl(s.url)));

  console.log(`═══ ${sector.toUpperCase()} (${kept.length} kept, ${cut.length} cut) ═══`);
  console.log('');
  console.log('KEPT:');
  for (const s of kept) {
    console.log(`  [${s.score || '?'}] ${s.title.slice(0, 80)}`);
  }
  if (cut.length > 0) {
    console.log('CUT:');
    for (const s of cut) {
      console.log(`  [${s.score || '?'}] ${s.title.slice(0, 80)}`);
    }
  }
  console.log('');
}

// General AI
const general = selectJson.filter(s => s.sector === 'general');
const gKept = general.filter(s => selectedUrls.has(normaliseUrl(s.url)));
const gCut = general.filter(s => !selectedUrls.has(normaliseUrl(s.url)));
console.log(`═══ GENERAL AI (${gKept.length} kept, ${gCut.length} cut) ═══`);
console.log('');
console.log('KEPT:');
for (const s of gKept) {
  console.log(`  [${s.score || '?'}] ${s.title.slice(0, 80)}`);
}
if (gCut.length > 0) {
  console.log('CUT:');
  for (const s of gCut) {
    console.log(`  [${s.score || '?'}] ${s.title.slice(0, 80)}`);
  }
}
