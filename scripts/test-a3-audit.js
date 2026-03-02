#!/usr/bin/env bun
import { readFileSync } from 'fs';

const audit = JSON.parse(readFileSync('output/select-audit-week-9.json', 'utf8'));

// Check coverage for the Register story
const coverage = audit.general_ai?.coverage || [];
const regCov = coverage.find(c => c.url && c.url.includes('theregister'));
console.log('Register coverage:', regCov ? JSON.stringify(regCov, null, 2) : 'NOT FOUND');

// Show A3 final selection
const final = audit.general_ai?.final_selected || [];
console.log(`\nA3 final General AI selection (${final.length} stories):`);
for (const s of final) {
  console.log(`  [${s.combined_score || s.score || '?'}] ${(s.url || '').slice(0, 80)}`);
}

// Show what was in top 20 but NOT in final
const top20 = audit.general_ai?.top_20_urls || [];
const finalUrls = new Set(final.map(s => s.url));
const dropped = top20.filter(u => !finalUrls.has(u));
console.log(`\nDropped from top 20 → A3 (${dropped.length}):`);
const a1 = audit.general_ai?.opus_scores || [];
for (const u of dropped) {
  const a1Entry = a1.find(s => s.url === u);
  const covEntry = coverage.find(c => c.url === u);
  console.log(`  [score:${a1Entry?.score || '?'} cov:${covEntry?.total_count || '?'}] ${u.slice(0, 80)}`);
}
