import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import { loadAndRenderPrompt } from './prompt-loader.js'

const ROOT = join(import.meta.dir, '..', '..')
const THRESHOLDS_PATH = join(ROOT, 'config', 'prompts', 'thresholds.yaml')

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','in','on','at','to','for','of',
  'and','or','but','with','by','from','as','it','its','this','that',
  'has','have','had','be','been','will','would','could','should',
  'not','no','do','does','did','can','may','might','shall'
])

/**
 * Tokenise text: lowercase, strip non-alphanumeric, remove stop words.
 */
function tokenise(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

/**
 * Tier 1: normalised token overlap between two texts (Jaccard similarity).
 * @param {string} textA
 * @param {string} textB
 * @returns {number} Similarity score 0.0–1.0
 */
export function textSimilarity(textA, textB) {
  const a = new Set(tokenise(textA))
  const b = new Set(tokenise(textB))
  if (a.size === 0 && b.size === 0) return 0
  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * Load thresholds from config/prompts/thresholds.yaml.
 * @returns {{ tier1: number, tier2: number }}
 */
export function loadThresholds() {
  const raw = readFileSync(THRESHOLDS_PATH, 'utf8')
  const config = yaml.load(raw)
  return {
    tier1: config.tier1_similarity,
    tier2: config.tier2_confidence
  }
}

/**
 * Tier 2: LLM-based content matching.
 * @param {string} contentA
 * @param {string} contentB
 * @param {object} options — { client, model }
 * @returns {Promise<{sameStory: boolean, confidence: number, explanation: string}>}
 */
export async function contentMatch(contentA, contentB, options) {
  const { client, model } = options
  const prompt = loadAndRenderPrompt('content-match.v1', {
    story_a: contentA,
    story_b: contentB
  })

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }]
  })

  const text = response.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    const retry = await client.messages.create({
      model,
      max_tokens: 512,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: text },
        { role: 'user', content: 'Your response was not valid JSON. Please return ONLY a JSON object with no other text.' }
      ]
    })
    return JSON.parse(retry.content[0].text)
  }
}

/**
 * Full two-tier dedup check against a corpus.
 * @param {object} candidate — { headline, content }
 * @param {Array<object>} corpus — [{ headline, content, metadata }]
 * @param {object} [options] — { client, model, thresholds }
 * @returns {Promise<{matched: boolean, matchedItem: object|null, tier: 1|2, confidence: number, explanation: string}>}
 */
export async function checkDuplicate(candidate, corpus, options = {}) {
  const thresholds = options.thresholds || loadThresholds()
  const candidateText = `${candidate.headline}\n${candidate.content}`

  // Tier 1: find candidates above threshold
  const tier1Candidates = []
  for (const item of corpus) {
    const itemText = `${item.headline}\n${item.content}`
    const similarity = textSimilarity(candidateText, itemText)
    if (similarity >= thresholds.tier1) {
      tier1Candidates.push({ item, similarity })
    }
  }

  if (tier1Candidates.length === 0) {
    return { matched: false, matchedItem: null, tier: 1, confidence: 0, explanation: 'No Tier 1 candidates above threshold' }
  }

  // Sort by similarity descending, check top candidates via Tier 2
  tier1Candidates.sort((a, b) => b.similarity - a.similarity)

  for (const { item, similarity } of tier1Candidates) {
    if (!options.client) {
      return { matched: true, matchedItem: item, tier: 1, confidence: similarity, explanation: 'Tier 1 match (no LLM client for Tier 2)' }
    }

    const result = await contentMatch(candidateText, `${item.headline}\n${item.content}`, {
      client: options.client,
      model: options.model || 'claude-sonnet-4-20250514'
    })

    if (result.sameStory && result.confidence >= thresholds.tier2) {
      return { matched: true, matchedItem: item, tier: 2, confidence: result.confidence, explanation: result.explanation }
    }
  }

  return { matched: false, matchedItem: null, tier: 2, confidence: 0, explanation: 'No Tier 2 matches confirmed' }
}
