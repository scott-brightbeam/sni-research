#!/usr/bin/env bun
/**
 * test-final-selection.js — One-off test of final selection prompt
 * against the 44 stories from the previous pipeline run.
 */

import { readFileSync, writeFileSync } from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { loadPrompt, renderPrompt, countTokens } from './lib/prompt.js';
import { loadEnvKey } from './lib/env.js';
import { withRetry } from './lib/retry.js';
import { getWeekWindow } from './lib/week.js';
import { loadArticlesForSelection, normaliseUrl } from './select.js';

// Load existing pipeline output
const selectJson = JSON.parse(readFileSync('output/select-week-9.json', 'utf8'));
const audit = JSON.parse(readFileSync('output/select-audit-week-9.json', 'utf8'));

// Load articles the same way the pipeline does
const dateWindow = getWeekWindow(9, 2026);
const { articleIndex } = loadArticlesForSelection(dateWindow);

// Build score lookups
const opusScoreMap = new Map();
for (const s of (audit.general_ai.opus_scores || [])) {
  opusScoreMap.set(normaliseUrl(s.url), s);
}
const coverageMap = new Map();
for (const c of (audit.general_ai.coverage || [])) {
  coverageMap.set(normaliseUrl(c.url), c);
}
const gptScoreMap = new Map();
const gptScores = audit.verticals.gpt_scores || {};
for (const [sector, items] of Object.entries(gptScores)) {
  for (const s of (items || [])) {
    gptScoreMap.set(normaliseUrl(s.url), s);
  }
}
const geminiScoreMap = new Map();
const geminiScores = audit.verticals.gemini_scores || {};
for (const [sector, items] of Object.entries(geminiScores)) {
  for (const s of (items || [])) {
    geminiScoreMap.set(normaliseUrl(s.url), s);
  }
}

// Enrich the 44 stories with all available scores
const enriched = selectJson.map(story => {
  const norm = normaliseUrl(story.url);
  const article = articleIndex.get(norm);
  const opusScore = opusScoreMap.get(norm);
  const coverage = coverageMap.get(norm);
  const gptScore = gptScoreMap.get(norm);
  const geminiScore = geminiScoreMap.get(norm);

  // For verticals, get opus_final score from B3
  let verticalScore = null;
  for (const sector of ['biopharma', 'medtech', 'manufacturing', 'insurance']) {
    const items = audit.verticals[sector]?.opus_final || [];
    const match = items.find(i => normaliseUrl(i.url) === norm);
    if (match) { verticalScore = match; break; }
  }

  return {
    ...story,
    excerpt: article?.excerpt || '(no excerpt)',
    score: opusScore?.score ?? verticalScore?.final_score ?? story.score,
    reasoning: story.reasoning || opusScore?.reasoning || verticalScore?.rationale || '',
    coverageCount: coverage?.total_count ?? null,
    gptScore: gptScore?.score ?? null,
    geminiScore: geminiScore?.score ?? null,
  };
});

console.log(`Enriched: ${enriched.length} stories`);
console.log(`  With Opus score: ${enriched.filter(s => s.score != null).length}`);
console.log(`  With coverage: ${enriched.filter(s => s.coverageCount != null).length}`);
console.log(`  With GPT score: ${enriched.filter(s => s.gptScore != null).length}`);

// Load published reference (week 8 — same as pipeline uses)
const pubRef = { week: 8, text: readFileSync('output/published/week-8.md', 'utf8') };

// Build prompt using the new template
const { template } = loadPrompt('select-final-shortlist');
const poolLines = [];
for (const a of enriched) {
  poolLines.push(`### ${a.title}`);
  poolLines.push(`Sector: ${a.sector} | Source: ${a.source} | ${a.date_published}`);
  poolLines.push(`URL: ${a.url}`);
  const scoreParts = [];
  if (a.score != null) scoreParts.push(`Opus: ${a.score}`);
  if (a.gptScore != null) scoreParts.push(`GPT: ${a.gptScore}`);
  if (a.geminiScore != null) scoreParts.push(`Gemini: ${a.geminiScore}`);
  if (a.coverageCount != null) scoreParts.push(`Coverage: ${a.coverageCount} articles`);
  poolLines.push(`Scores: ${scoreParts.join(' | ') || 'N/A'}`);
  if (a.reasoning) poolLines.push(`Reasoning: ${a.reasoning}`);
  poolLines.push(`Excerpt: ${a.excerpt}`);
  poolLines.push('');
}

const prompt = renderPrompt(template, {
  published_reference: pubRef.text,
  story_pool: poolLines.join('\n'),
});

console.log(`Prompt: ~${Math.round(countTokens(prompt) / 1000)}K tokens`);

// Call Opus
const { template: systemPrompt } = loadPrompt('select-system');
const apiKey = loadEnvKey('ANTHROPIC_API_KEY');
const client = new Anthropic({ apiKey, timeout: 600000 });

console.log('Calling Opus for final selection...');
const start = Date.now();

const response = await withRetry(() => client.messages.create({
  model: 'claude-opus-4-6',
  max_tokens: 8000,
  system: systemPrompt,
  messages: [{ role: 'user', content: prompt }],
}), { maxAttempts: 3 });

const text = response.content[0].text;
const elapsed = ((Date.now() - start) / 1000).toFixed(1);
console.log(`Done in ${elapsed}s (${response.stop_reason})`);

writeFileSync('output/select-debug-final-test.txt', text);

// Parse shortlist
const urlPattern = /https?:\/\/[^\s|)>"\]]+/g;
const shortlistMatch = text.match(/---SHORTLIST---([\s\S]*?)---END SHORTLIST---/);
if (!shortlistMatch) {
  console.log('ERROR: No ---SHORTLIST--- block found');
  console.log(text.slice(0, 500));
  process.exit(1);
}

const urls = [...new Set(shortlistMatch[1].match(urlPattern) || [])];
console.log(`\nSelected: ${urls.length} stories`);

// Compare vs published week 9
const pubWeek9 = readFileSync('output/published/week-9.md', 'utf8');
const pubUrls = [...new Set(pubWeek9.match(urlPattern) || [])].map(u => normaliseUrl(u));
const selectedNorm = urls.map(u => normaliseUrl(u));

const hits = pubUrls.filter(pu => selectedNorm.some(su => su === pu));
console.log(`Published URLs: ${pubUrls.length}`);
console.log(`Direct URL hits: ${hits.length}/${pubUrls.length} = ${(100 * hits.length / pubUrls.length).toFixed(1)}%`);

const union = new Set([...pubUrls, ...selectedNorm]);
const intersection = pubUrls.filter(pu => selectedNorm.includes(pu));
console.log(`Jaccard: ${(100 * intersection.length / union.size).toFixed(1)}%`);

// Sector breakdown
const bySector = {};
for (const u of urls) {
  const norm = normaliseUrl(u);
  const a = enriched.find(e => normaliseUrl(e.url) === norm);
  const sector = a?.sector || 'unknown';
  bySector[sector] = (bySector[sector] || 0) + 1;
}
console.log('\nSector breakdown:');
for (const [s, c] of Object.entries(bySector).sort()) {
  console.log(`  ${s}: ${c}`);
}

// Show misses
const misses = pubUrls.filter(pu => !selectedNorm.includes(pu));
if (misses.length > 0) {
  console.log('\nMissed published URLs:');
  for (const m of misses) console.log(`  ${m}`);
}

// Show what was cut
const kept = new Set(selectedNorm);
const cut = enriched.filter(e => !kept.has(normaliseUrl(e.url)));
console.log(`\nCut: ${cut.length} stories`);
for (const c of cut) {
  console.log(`  [${c.sector}] ${c.title} (score: ${c.score ?? '?'})`);
}
