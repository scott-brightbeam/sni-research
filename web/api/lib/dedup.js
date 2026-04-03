import { readFileSync } from 'fs'
import { join } from 'path'
import yaml from 'js-yaml'
import config from './config.js'

const THRESHOLDS_PATH = join(config.ROOT, 'config', 'prompts', 'thresholds.yaml')
const PROMPTS_DIR = join(config.ROOT, 'config', 'prompts')

const STOP_WORDS = new Set([
  'the','a','an','is','are','was','were','in','on','at','to','for','of',
  'and','or','but','with','by','from','as','it','its','this','that',
  'has','have','had','be','been','will','would','could','should',
  'not','no','do','does','did','can','may','might','shall'
])

/**
 * Load and render a prompt template from config/prompts/.
 * Reads config/prompts/<name>.txt, performs {key} → value replacement.
 */
function loadAndRenderPrompt(name, vars) {
  let prompt = readFileSync(join(PROMPTS_DIR, `${name}.txt`), 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{${key}}`, value)
  }
  return prompt
}

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
  const cfg = yaml.load(raw)
  return {
    tier1: cfg.tier1_similarity,
    tier2: cfg.tier2_confidence
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
