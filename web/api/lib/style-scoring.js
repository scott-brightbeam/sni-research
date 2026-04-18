/**
 * style-scoring.js — Score a draft against Scott's published-corpus baseline.
 *
 * Fast, deterministic analysis (no LLM call). Compares word count,
 * sentence-length distribution, prohibited-word count, ITEATE presence,
 * opening-line type, and quote-mark style against baseline norms.
 *
 * The baseline below is computed from the 17 published articles/series
 * posts (Apr 2026 corpus). Regenerate when the corpus grows significantly.
 */

// Baseline computed from 17 article+series posts on 2026-04-16
export const CORPUS_BASELINE = {
  word_count_avg: 655,
  word_count_min: 118,
  word_count_max: 2138,
  sentence_word_avg: 13.4,
  sentence_short_pct: 20.5, // sentences ≤5 words
  sentence_long_pct: 11,    // sentences ≥25 words
}

// Prohibited terms from writing-preferences.md + vocabulary fingerprint
const PROHIBITED = [
  'leverage', 'utilise', 'utilize', 'robust', 'streamline', 'delve',
  'landscape', 'ecosystem', 'unlock', 'harness', 'paradigm', 'synergy',
  'game-changer', 'low-hanging fruit', 'move the needle', 'circle back',
  'best-in-class', 'north star', 'paradigm shift', 'incredibly',
  'extremely', 'truly', 'absolutely', 'fundamentally', 'highly',
  'deeply', 'vastly', 'actually',
]

// False-contrast patterns (case-insensitive regexes)
const FALSE_CONTRAST_PATTERNS = [
  /\bnot\s+\w+[^.!?]*\bbut\s+\w+/i,
  /\bthe question isn't\s+\w+/i,
  /\bisn't just\s+\w+[^.!?]*\bit's\s+\w+/i,
]

// Pseudo-profundity
const PSEUDO_PATTERNS = [
  /\bthe key is\b/i,
  /\bthe secret is\b/i,
  /\bthe reality is\b/i,
  /\bat its core\b/i,
]

function countMatches(text, pattern) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(`\\b${pattern}\\b`, 'gi')
  return (text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || []).length
}

/**
 * Score a draft and return a structured report.
 * @param {string} draft — the full draft text
 * @returns {object} scorecard
 */
export function scoreDraft(draft) {
  const text = draft || ''
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
  const sentenceLengths = sentences.map(s => s.split(/\s+/).filter(Boolean).length)
  const avgSentenceLen = sentenceLengths.length
    ? +(sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length).toFixed(1)
    : 0
  const shortPct = sentenceLengths.length
    ? +(100 * sentenceLengths.filter(n => n <= 5).length / sentenceLengths.length).toFixed(1)
    : 0
  const longPct = sentenceLengths.length
    ? +(100 * sentenceLengths.filter(n => n >= 25).length / sentenceLengths.length).toFixed(1)
    : 0

  // Prohibited words
  const prohibitedHits = []
  const lowerText = text.toLowerCase()
  for (const word of PROHIBITED) {
    const re = new RegExp(`\\b${word.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'gi')
    const matches = lowerText.match(re)
    if (matches) prohibitedHits.push({ term: word, count: matches.length })
  }

  // False-contrast patterns
  const falseContrastHits = FALSE_CONTRAST_PATTERNS
    .map(p => (text.match(new RegExp(p.source, p.flags + 'g')) || []).length)
    .reduce((a, b) => a + b, 0)

  // Pseudo-profundity
  const pseudoHits = PSEUDO_PATTERNS
    .map(p => (text.match(new RegExp(p.source, p.flags + 'g')) || []).length)
    .reduce((a, b) => a + b, 0)

  // Quote marks — double vs single
  const doubleQuoteCount = (text.match(/"/g) || []).length
  const curlyDoubleCount = (text.match(/[\u201C\u201D]/g) || []).length
  const doubleQuotesUsed = doubleQuoteCount + curlyDoubleCount

  // ITEATE marker
  const hasIteate = /in-the-end-at-the-end/i.test(text)

  // Opening line
  const firstSentence = sentences[0] || ''
  const firstSentenceLen = firstSentence.split(/\s+/).filter(Boolean).length
  const hasConcreteOpening = /\d|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)/.test(firstSentence.slice(0, 100))

  // Voice: first-person narrator (PROHIBITED) vs Brightbeam "we" (allowed).
  // The canon analysis (24 published posts) shows zero short-form first-person
  // narrator. "I", "my", "me" should never appear; "we", "our" are allowed
  // for Brightbeam collective voice. The previous penalty for "no first-person
  // voice" was actively wrong — it rewarded exactly what writing-preferences.md
  // bans. Now penalises solo-narrator usage instead.
  const soloNarratorHits = (text.match(/\b(I|my|me)\b/g) || []).length

  // Style-match score (0-100)
  // Penalties: prohibited words, false contrast, pseudo, double quotes, missing iteate,
  //            weak opening, solo-narrator usage, extreme sentence uniformity
  let score = 100
  const penalties = []
  for (const h of prohibitedHits) { score -= 5 * h.count; penalties.push(`"${h.term}" (${h.count}x): −${5*h.count}`) }
  if (falseContrastHits > 0) { score -= 8 * falseContrastHits; penalties.push(`false contrast (${falseContrastHits}x): −${8*falseContrastHits}`) }
  if (pseudoHits > 0) { score -= 6 * pseudoHits; penalties.push(`pseudo-profundity (${pseudoHits}x): −${6*pseudoHits}`) }
  if (doubleQuotesUsed > 0) { score -= 3; penalties.push(`double quotes used: −3`) }
  if (!hasIteate && wordCount > 200) { score -= 10; penalties.push(`missing ITEATE: −10`) }
  if (!hasConcreteOpening) { score -= 8; penalties.push(`opening not concrete: −8`) }
  if (soloNarratorHits > 0) { score -= 8 * soloNarratorHits; penalties.push(`solo-narrator I/my/me (${soloNarratorHits}x): −${8*soloNarratorHits}`) }
  if (shortPct < 5 && wordCount > 100) { score -= 5; penalties.push(`sentence rhythm too uniform: −5`) }

  score = Math.max(0, Math.min(100, score))

  return {
    wordCount,
    baseline_word_count_avg: CORPUS_BASELINE.word_count_avg,
    sentenceCount: sentences.length,
    avgSentenceLen,
    baseline_sentence_word_avg: CORPUS_BASELINE.sentence_word_avg,
    shortSentencePct: shortPct,
    baseline_short_pct: CORPUS_BASELINE.sentence_short_pct,
    longSentencePct: longPct,
    baseline_long_pct: CORPUS_BASELINE.sentence_long_pct,
    prohibitedHits,
    falseContrastHits,
    pseudoHits,
    doubleQuotesUsed,
    hasIteate,
    hasConcreteOpening,
    firstSentence: firstSentence.slice(0, 120),
    firstSentenceLen,
    soloNarratorHits,
    score,
    penalties,
  }
}
