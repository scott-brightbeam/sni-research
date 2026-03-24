/**
 * editorial-multi-model.js — Multi-model client for the editorial intelligence pipeline
 *
 * Extends the existing multi-model.js (OpenAI + Gemini) with Anthropic Opus 4.6
 * support for the editorial pipeline's three-model architecture:
 *
 *   ANALYSE + DRAFT + REVISE → Opus 4.6 (primary creative/analytical model)
 *   CRITIQUE → Gemini 3.1 Pro + GPT-5.4 (independent critique pair)
 *   CHAT → Opus 4.6 (contextual editorial chat)
 *
 * Does NOT modify the existing multi-model.js. Imports its OpenAI/Gemini
 * functions and adds Anthropic alongside them.
 */

import Anthropic from '@anthropic-ai/sdk'
import { callModel, callBothModels, extractJSON, availableProviders, withConcurrency } from './multi-model.js'
import { withRetry, shouldRetryApiError } from './retry.js'
import { loadEnvKey } from './env.js'

const OPUS_MODEL = 'claude-opus-4-6'

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [editorial-model]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [editorial-model] ⚠`, ...a)

// ── Anthropic client (lazy init) ─────────────────────────

let _anthropic = null

function getAnthropicClient() {
  if (_anthropic) return _anthropic
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) return null
  _anthropic = new Anthropic({ apiKey: key, timeout: 90_000 }) // 90s — fail fast instead of hanging 3+ minutes on overloaded API
  return _anthropic
}

// ── Cost tracking ────────────────────────────────────────

let _sessionCosts = {
  opus: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  gemini: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  openai: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
}

// Pricing per 1k tokens (from editorial-sources.yaml)
const PRICING = {
  opus: { input: 0.015, output: 0.075 },
  gemini: { input: 0.00125, output: 0.01 },
  openai: { input: 0.0025, output: 0.01 },
}

function trackCost(provider, inputTokens, outputTokens) {
  const pricing = PRICING[provider]
  if (!pricing) return

  const bucket = _sessionCosts[provider]
  if (!bucket) return

  bucket.calls++
  bucket.inputTokens += inputTokens
  bucket.outputTokens += outputTokens
  bucket.cost += (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output
}

/**
 * Get cumulative session costs.
 * @returns {{ opus: CostBucket, gemini: CostBucket, openai: CostBucket, total: number }}
 */
export function getSessionCosts() {
  const total = _sessionCosts.opus.cost + _sessionCosts.gemini.cost + _sessionCosts.openai.cost
  return { ..._sessionCosts, total }
}

/**
 * Reset session cost tracking (call at start of each pipeline run).
 */
export function resetSessionCosts() {
  _sessionCosts = {
    opus: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    gemini: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
    openai: { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
  }
}

// ── Opus 4.6 call ────────────────────────────────────────

/**
 * Call Opus 4.6 with system prompt and user message.
 * Supports both JSON and raw text responses.
 *
 * @param {string} userMessage — the user/task prompt
 * @param {object} [opts]
 * @param {string} [opts.system] — system prompt
 * @param {number} [opts.maxTokens=8000]
 * @param {boolean} [opts.rawText=false] — skip JSON extraction
 * @param {number} [opts.temperature=0.7] — temperature (0-1)
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null, inputTokens: number, outputTokens: number }>}
 */
export async function callOpus(userMessage, opts = {}) {
  const client = getAnthropicClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')

  const maxTokens = opts.maxTokens || 8000
  const temperature = opts.temperature ?? 0.7

  const params = {
    model: OPUS_MODEL,
    max_tokens: maxTokens,
    temperature,
    messages: [{ role: 'user', content: userMessage }],
  }
  if (opts.system) {
    params.system = opts.system
  }

  const response = await withRetry(
    () => client.messages.create(params),
    { onRetry: (attempt, err) => warn(`Opus retry ${attempt}: ${err.message}`) }
  )

  const raw = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')

  if (!raw) throw new Error('Empty response from Opus 4.6')

  const inputTokens = response.usage?.input_tokens || 0
  const outputTokens = response.usage?.output_tokens || 0
  trackCost('opus', inputTokens, outputTokens)

  return {
    provider: 'anthropic',
    model: OPUS_MODEL,
    raw,
    parsed: opts.rawText ? null : extractJSON(raw),
    inputTokens,
    outputTokens,
  }
}

/**
 * Call Opus 4.6 with streaming response. Returns an async iterator of text chunks.
 *
 * @param {string} userMessage
 * @param {object} [opts]
 * @param {string} [opts.system] — system prompt
 * @param {number} [opts.maxTokens=8000]
 * @param {number} [opts.temperature=0.7]
 * @returns {Promise<AsyncGenerator<string>>}
 */
export async function callOpusStreaming(userMessage, opts = {}) {
  const client = getAnthropicClient()
  if (!client) throw new Error('ANTHROPIC_API_KEY not configured')

  const params = {
    model: OPUS_MODEL,
    max_tokens: opts.maxTokens || 8000,
    temperature: opts.temperature ?? 0.7,
    messages: [{ role: 'user', content: userMessage }],
  }
  if (opts.system) {
    params.system = opts.system
  }

  const stream = client.messages.stream(params)

  // Track costs from the final message event
  stream.on('finalMessage', (msg) => {
    const inputTokens = msg.usage?.input_tokens || 0
    const outputTokens = msg.usage?.output_tokens || 0
    trackCost('opus', inputTokens, outputTokens)
  })

  return stream
}

// ── Critique call (both models in parallel) ──────────────

/**
 * Call both critique models (Gemini + GPT) in parallel.
 * Used for the draft critique loop. Never throws — failed models
 * return error objects.
 *
 * @param {string} prompt — critique prompt
 * @param {object} [opts]
 * @param {string} [opts.system] — system prompt
 * @param {number} [opts.maxTokens=4000]
 * @returns {Promise<{ gemini: ModelResult, openai: ModelResult }>}
 */
export async function callCritiqueModels(prompt, opts = {}) {
  return callBothModels(prompt, { ...opts, rawText: true })
}

// ── Unified editorial call ───────────────────────────────

/**
 * Call any editorial model by role.
 *
 * @param {'analyse'|'draft'|'revise'|'critique-gemini'|'critique-gpt'|'chat'} role
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens]
 * @param {boolean} [opts.rawText]
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null }>}
 */
export async function callEditorialModel(role, prompt, opts = {}) {
  switch (role) {
    case 'analyse':
    case 'draft':
    case 'revise':
    case 'chat':
      return callOpus(prompt, opts)
    case 'critique-gemini':
      return callModel('gemini', prompt, { ...opts, rawText: true })
    case 'critique-gpt':
      return callModel('openai', prompt, { ...opts, rawText: true })
    default:
      throw new Error(`Unknown editorial model role: ${role}`)
  }
}

// ── Provider availability check ──────────────────────────

/**
 * Check which editorial API keys are available.
 * @returns {{ anthropic: boolean, openai: boolean, gemini: boolean }}
 */
export function availableEditorialProviders() {
  const base = availableProviders()
  return {
    anthropic: !!loadEnvKey('ANTHROPIC_API_KEY'),
    ...base,
  }
}

/**
 * Validate that all required providers are available for the editorial pipeline.
 * ANALYSE/DRAFT require Anthropic. CRITIQUE requires at least one of OpenAI/Gemini.
 *
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function validateProviders() {
  const providers = availableEditorialProviders()
  const missing = []

  if (!providers.anthropic) missing.push('ANTHROPIC_API_KEY (required for ANALYSE, DRAFT, CHAT)')
  if (!providers.openai && !providers.gemini) missing.push('OPENAI_API_KEY or GOOGLE_AI_API_KEY (at least one required for CRITIQUE)')

  return { ready: missing.length === 0, missing }
}

/**
 * Check only non-Anthropic providers (for critique-only and discover modes).
 * @param {'critique'|'discover'} stage
 * @returns {{ ready: boolean, missing: string[] }}
 */
export function validateNonAnthropicProviders(stage) {
  const providers = availableEditorialProviders()
  const missing = []
  if (stage === 'critique') {
    if (!providers.openai && !providers.gemini) missing.push('OPENAI_API_KEY or GOOGLE_AI_API_KEY')
  }
  if (stage === 'discover') {
    if (!providers.gemini) missing.push('GOOGLE_AI_API_KEY')
  }
  return { ready: missing.length === 0, missing }
}

// ── Re-exports from multi-model.js ───────────────────────

export { extractJSON, withConcurrency }
