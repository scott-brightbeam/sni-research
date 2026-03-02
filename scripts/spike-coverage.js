#!/usr/bin/env bun
/**
 * spike-coverage.js — Phase 0 spike to validate Gemini + Google Search
 * grounding for coverage volume checks.
 *
 * Tests 5 stories from Week 9 with no artificial limits.
 * Inspects raw responses to evaluate:
 *   - Are article counts plausible?
 *   - Do source lists match the specific event?
 *   - Is confidence meaningful?
 */

import { callGeminiWithSearch, extractJSON } from './lib/multi-model.js';

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}] [spike]`, ...a);
const hr   = () => console.log('─'.repeat(80));

// ─── Test stories ────────────────────────────────────────────────────────────

const TEST_STORIES = [
  {
    label: '1. OpenAI $110B funding (General AI — expect HIGH coverage)',
    title: 'OpenAI announces $110 billion funding round with backing from Amazon, Nvidia, SoftBank',
    excerpt: 'OpenAI announced a $110 billion funding round — the largest private financing in history — with Amazon investing $50 billion, Nvidia $30 billion, and SoftBank $30 billion. The round values OpenAI at $730 billion pre-money.',
    date_range: { start: '2026-02-22', end: '2026-02-28' },
  },
  {
    label: '2. Anthropic-Pentagon dispute (General AI — expect HIGH coverage)',
    title: 'Anthropic to Pentagon: Autonomous weapons could hurt US troops and civilians',
    excerpt: 'Anthropic CEO Dario Amodei publicly refused the Pentagon\'s demand to remove guardrails on Claude for military use. Defense Secretary Pete Hegseth set a Friday deadline for Anthropic to comply, threatening supply chain risk designation.',
    date_range: { start: '2026-02-22', end: '2026-02-28' },
  },
  {
    label: '3. Salesforce SaaSpocalypse earnings (General AI — expect MEDIUM coverage)',
    title: 'Salesforce CEO Marc Benioff: This isn\'t our first SaaSpocalypse',
    excerpt: 'Salesforce reported Q4 revenue of $10.7 billion (+13% YoY) and full-year revenue of $41.5 billion. CEO Marc Benioff addressed SaaSpocalypse fears, arguing SaaS just got better with agents. Launched $50 billion share buyback.',
    date_range: { start: '2026-02-22', end: '2026-02-28' },
  },
  {
    label: '4. Axelera AI $250M raise (Manufacturing — expect MODERATE coverage)',
    title: 'Edge AI chip startup Axelera AI raises $250M+ funding round',
    excerpt: 'Axelera AI, a Netherlands-based edge AI chip startup, raised over $250 million in funding. The company develops AI accelerator chips for edge computing applications in manufacturing and industrial settings.',
    date_range: { start: '2026-02-22', end: '2026-02-28' },
  },
  {
    label: '5. Concirrus Inspire launch (Insurance — DROPPED as "niche" but WAS published)',
    title: 'Concirrus launches Inspire, an AI-native underwriting platform for specialty insurance',
    excerpt: 'Concirrus launched Inspire, an AI-native underwriting platform for the specialty insurance market. The platform integrates behavioural analytics and risk intelligence into underwriting workflows.',
    date_range: { start: '2026-02-16', end: '2026-02-22' },
  },
];

// ─── Coverage prompt ─────────────────────────────────────────────────────────

function buildCoveragePrompt(story) {
  return `How many distinct news articles were published about this specific event during ${story.date_range.start} to ${story.date_range.end}?

Event: ${story.title}
Key details: ${story.excerpt}

Search for news coverage of this specific event. Count all distinct articles you find — not opinion pieces or social media, but actual news articles or trade press reports.

Respond as JSON with these fields:
- total_count: the total number of distinct articles you found (count ALL of them)
- sources: list UP TO 10 of the most prominent articles (publication name, article title, URL if available)
- confidence: high/medium/low — how confident are you that these articles are about this SPECIFIC event (not just the general topic)
- notes: observations about the coverage pattern (breadth of outlets, geographic spread, whether coverage is mostly wire syndication vs original reporting)

{
  "total_count": number,
  "sources": [{ "publication": "", "title": "", "url": "" }],
  "confidence": "high|medium|low",
  "notes": ""
}`;
}

// ─── Run spike ───────────────────────────────────────────────────────────────

async function runSpike(only = null) {
  const label = only ? `stories ${[...only].join(', ')}` : '5 stories';
  log(`Starting coverage volume spike — ${label}, no limits`);
  hr();

  for (const story of TEST_STORIES) {
    const storyNum = parseInt(story.label);
    if (only && !only.has(storyNum)) continue;
    console.log(`\n${'═'.repeat(80)}`);
    log(story.label);
    hr();

    const prompt = buildCoveragePrompt(story);
    const tStart = Date.now();

    try {
      const result = await callGeminiWithSearch(prompt, { maxTokens: 6000 });
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);

      log(`Response in ${elapsed}s — ${result.raw.length} chars`);
      hr();

      // Print raw response
      console.log('\n--- RAW RESPONSE ---');
      console.log(result.raw);
      console.log('--- END RAW ---\n');

      // Try to parse JSON
      if (result.parsed) {
        console.log('--- PARSED JSON ---');
        console.log(JSON.stringify(result.parsed, null, 2));
        console.log(`\n  → Count: ${result.parsed.total_count}`);
        console.log(`  → Confidence: ${result.parsed.confidence}`);
        console.log(`  → Sources listed: ${result.parsed.sources?.length || 0}`);
      } else {
        // Try manual extraction
        console.log('--- JSON PARSE FAILED — trying manual extraction ---');
        try {
          const parsed = extractJSON(result.raw);
          console.log(JSON.stringify(parsed, null, 2));
        } catch (e) {
          console.log(`  Could not extract JSON: ${e.message}`);
        }
      }
    } catch (err) {
      const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
      console.error(`\n  ✗ FAILED after ${elapsed}s: ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(0, 3).join('\n'));
    }

    hr();
  }

  console.log(`\n${'═'.repeat(80)}`);
  log('Spike complete');
}

// ─── Entry ───────────────────────────────────────────────────────────────────

if (import.meta.main) {
  // Allow running specific stories by number: bun spike-coverage.js 1 2 4
  const args = process.argv.slice(2).map(Number).filter(n => n >= 1 && n <= 5);
  const only = args.length > 0 ? new Set(args) : null;
  runSpike(only).catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}

export { runSpike };
