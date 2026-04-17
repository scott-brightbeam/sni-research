#!/usr/bin/env bun
/**
 * refresh-vocabulary-fingerprint.js — Regenerate the vocabulary
 * fingerprint from the current published_posts corpus. Safe to run
 * daily or after Scott publishes a new post.
 *
 * Preserves learned_rules (those come from real editorial edits and
 * should accumulate independently of the corpus analysis). Refreshes:
 *  - signature_terms (frequency-based)
 *  - convention_breaks
 *  - avoided_terms
 *  - distinctive_constructions
 *  - opening_patterns
 *  - evidence_examples
 *  - category_voice (rule-based per category)
 *
 * Usage: bun scripts/refresh-vocabulary-fingerprint.js
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getDb } from '../web/api/lib/db.js'
import { getClient } from '../web/api/lib/claude.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const FINGERPRINT_PATH = join(ROOT, 'data/editorial/vocabulary-fingerprint.json')

async function main() {
  const db = await getDb()

  // Load all published posts
  const r = await db.execute(`SELECT id, title, slug, category, body, word_count
                              FROM published_posts
                              WHERE category IN ('article', 'series')
                              ORDER BY date_published DESC`)
  const posts = r.rows
  console.log(`Analysing ${posts.length} posts...`)

  if (posts.length === 0) {
    console.log('No posts to analyse. Exiting.')
    return
  }

  // Preserve existing learned_rules
  let existing = {}
  if (existsSync(FINGERPRINT_PATH)) {
    try { existing = JSON.parse(readFileSync(FINGERPRINT_PATH, 'utf-8')) } catch {}
  }
  const preservedLearnedRules = existing.learned_rules || []

  // Extract evidence examples (sentences with named entity + specific figure)
  const evidenceExamples = []
  for (const post of posts) {
    if (!post.body) continue
    const sentences = post.body.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      const hasName = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/.test(s)
      const hasData = /\d+[%$BbMm]|\$\d|per cent|\d+\s+(?:billion|million|trillion)/.test(s)
      if (hasName && hasData && s.length > 40 && s.length < 260) {
        evidenceExamples.push({ sentence: s.trim(), post: post.title.substring(0, 40) })
      }
    }
  }

  // Extract opening lines
  const openingsByType = { 'concrete-noun-hook': [], 'question-hook': [], 'claim-to-contradict': [] }
  for (const post of posts) {
    if (!post.body) continue
    const firstSentence = post.body.split(/(?<=[.!?])\s+/)[0] || ''
    if (!firstSentence) continue
    if (firstSentence.endsWith('?')) {
      openingsByType['question-hook'].push(firstSentence)
    } else if (/^[A-Z][a-z]+/.test(firstSentence) && (/\$\d|\d+\s+(?:billion|million|investors|companies)/.test(firstSentence) || /^An? [A-Z]/.test(firstSentence))) {
      openingsByType['concrete-noun-hook'].push(firstSentence)
    } else {
      openingsByType['claim-to-contradict'].push(firstSentence)
    }
  }

  // Use LLM to regenerate signature terms, convention breaks, constructions
  // (these require semantic judgment, not just statistics)
  const client = getClient()
  let llmAnalysis = null
  if (client) {
    try {
      const sample = posts.slice(0, 12).map(p => `### ${p.title}\n\n${(p.body || '').slice(0, 2000)}`).join('\n\n---\n\n')

      const res = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: `You are analysing Scott Wilkinson's published writing to extract his vocabulary fingerprint. Return ONLY a JSON object of this shape:
{
  "signature_terms": [
    { "term": "string", "alternative": "what others say instead", "context": "when Scott uses it", "frequency": number }
  ],
  "convention_breaks": [
    { "pattern": "description of where Scott departs from standard business writing" }
  ],
  "avoided_terms": ["string", ...],
  "distinctive_constructions": [
    { "pattern": "sentence shape Scott favours", "examples": ["..."] }
  ]
}

Rules:
- signature_terms: 15-25 distinctive word/phrase choices. "digital intelligence" not "AI", "moat" not "competitive advantage". NOT generic business terms.
- convention_breaks: 5-10 places where Scott deliberately defies standard writing (contractions in formal, sentence fragments for punch, 'But' never 'However', etc.)
- avoided_terms: 20-40 words Scott COULD use but doesn't (beyond prohibited list)
- distinctive_constructions: 5-10 sentence shapes unique to Scott

Return valid JSON only. No markdown fences.`,
        messages: [{ role: 'user', content: `Analyse these posts:\n\n${sample}` }],
      })
      const txt = (res.content?.[0]?.text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      llmAnalysis = JSON.parse(txt)
      console.log(`LLM extracted: ${llmAnalysis.signature_terms?.length || 0} signature terms, ${llmAnalysis.convention_breaks?.length || 0} convention breaks`)
    } catch (err) {
      console.error('LLM analysis failed:', err.message)
      console.log('Keeping existing signature_terms from previous fingerprint.')
      llmAnalysis = {
        signature_terms: existing.signature_terms || [],
        convention_breaks: existing.convention_breaks || [],
        avoided_terms: existing.avoided_terms || [],
        distinctive_constructions: existing.distinctive_constructions || [],
      }
    }
  }

  // Build opening patterns summary
  const openingPatterns = [
    {
      type: 'concrete-noun-hook',
      description: 'Opens with a specific person, company, dollar figure, or event. The reader sees a scene before they see an argument.',
      examples: openingsByType['concrete-noun-hook'].slice(0, 4),
      frequency: openingsByType['concrete-noun-hook'].length,
    },
    {
      type: 'question-hook',
      description: 'Opens with a direct question that challenges an assumption.',
      examples: openingsByType['question-hook'].slice(0, 4),
      frequency: openingsByType['question-hook'].length,
    },
    {
      type: 'claim-to-contradict',
      description: 'Opens with a bold claim that the rest of the post will complicate or invert.',
      examples: openingsByType['claim-to-contradict'].slice(0, 4),
      frequency: openingsByType['claim-to-contradict'].length,
    },
  ].filter(p => p.frequency > 0)

  // Assemble final fingerprint
  const fingerprint = {
    signature_terms: llmAnalysis?.signature_terms || existing.signature_terms || [],
    convention_breaks: llmAnalysis?.convention_breaks || existing.convention_breaks || [],
    avoided_terms: llmAnalysis?.avoided_terms || existing.avoided_terms || [],
    distinctive_constructions: llmAnalysis?.distinctive_constructions || existing.distinctive_constructions || [],
    opening_patterns: openingPatterns,
    citation_pattern: 'Named source (person or institution) followed by specific figure (percentage, dollar amount, or multiplier) followed by editorial interpretation of what that figure means. Never raw data without context. Never interpretation without evidence. The three-beat pattern is: WHO found WHAT, and HERE IS WHY IT MATTERS.',
    evidence_examples: pickDiverseEvidenceExamples(evidenceExamples, 8),
    category_voice: existing.category_voice || {
      article: 'Single argument developed across 300-2000 words. One thesis, built paragraph by paragraph with evidence. Opening is always concrete (noun, data, or character). Ends with ITEATE.',
      newsletter: 'Dense, compressed editorial. Multiple stories per section. tl;dr is analytical prose (FT column style), not summary. Sector bullets give context, not just headlines. Every bullet has editorial interpretation after the colon.',
      series: 'Pedagogical but not patronising. Builds a framework across parts. Uses subheads. More explicit signposting than articles. Brightbeam methodology is the through-line.',
    },
    // Preserve learned_rules — they come from edit diffs, not corpus analysis
    learned_rules: preservedLearnedRules,
    generated_at: new Date().toISOString(),
    source_post_count: posts.length,
  }

  writeFileSync(FINGERPRINT_PATH, JSON.stringify(fingerprint, null, 2))
  console.log(`\nFingerprint written to ${FINGERPRINT_PATH}`)
  console.log(`  ${fingerprint.signature_terms.length} signature terms`)
  console.log(`  ${fingerprint.convention_breaks.length} convention breaks`)
  console.log(`  ${fingerprint.avoided_terms.length} avoided terms`)
  console.log(`  ${fingerprint.distinctive_constructions.length} distinctive constructions`)
  console.log(`  ${fingerprint.opening_patterns.length} opening patterns`)
  console.log(`  ${fingerprint.evidence_examples.length} evidence examples`)
  console.log(`  ${fingerprint.learned_rules.length} learned rules (preserved)`)

  process.exit(0)
}

/** Pick evidence examples with diverse patterns */
function pickDiverseEvidenceExamples(all, n) {
  // Prefer variety: different post sources, different sentence shapes
  const seen = new Set()
  const picked = []
  for (const e of all) {
    if (seen.has(e.post)) continue
    seen.add(e.post)
    picked.push({ sentence: e.sentence, pattern: describePattern(e.sentence) })
    if (picked.length >= n) break
  }
  return picked
}

function describePattern(s) {
  if (/(\d+(?:,\d+)?)\s+(?:billion|million|investors|companies|workforce|firms)/.test(s)) return 'Named figure + specific quantity + editorial framing'
  if (/\d+%/.test(s) && /(?:only|just|barely)/i.test(s)) return 'Percentage with editorial emphasis word'
  if (/[A-Z][a-z]+\s+[A-Z][a-z]+/.test(s) && /\d/.test(s)) return 'Named person + specific data point'
  if (/\bthey\b|\bhe\b|\bshe\b/.test(s) && /(?:never|couldn't|failed|reached)/.test(s)) return 'Subject + outcome verb'
  return 'Named source + specific metric'
}

await main()
