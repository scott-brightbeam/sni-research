/**
 * multi-model.js — Shared multi-model client for SNI Research Tool
 *
 * Initialises OpenAI and Google Generative AI clients.
 * Provides a unified call interface with retry and JSON extraction.
 *
 * Used by discover.js and evaluate.js.
 */

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { withRetry } from './retry.js';
import { loadEnvKey } from './env.js';

const OPENAI_MODEL = 'gpt-5.2';
const GEMINI_MODEL = 'gemini-3.1-pro-preview';

const ts = () => new Date().toISOString().slice(11, 23);
const log  = (...a) => console.log(`[${ts()}] [multi-model]`, ...a);
const warn = (...a) => console.warn(`[${ts()}] [multi-model] ⚠`, ...a);

// ─── Client init (lazy — only created when first called) ─────────────────────

let _openai = null;
let _genai = null;

function getOpenAIClient() {
  if (_openai) return _openai;
  const key = loadEnvKey('OPENAI_API_KEY');
  if (!key) return null;
  _openai = new OpenAI({ apiKey: key });
  return _openai;
}

function getGeminiClient() {
  if (_genai) return _genai;
  const key = loadEnvKey('GOOGLE_AI_API_KEY');
  if (!key) return null;
  _genai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 300000 } });
  return _genai;
}

// ─── JSON extraction ─────────────────────────────────────────────────────────

/**
 * Extract the first JSON object from a text string.
 * Same pattern used in score.js, draft.js, review.js.
 * @param {string} text
 * @returns {object}
 */
export function extractJSON(text) {
  // Try strict match first: outermost balanced braces (non-greedy inner)
  // This avoids the greedy [\s\S]* swallowing markdown fences or trailing text
  let candidate = null;

  // Approach 1: Find the first '{' and its matching '}' by brace counting
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      if (depth === 0) {
        candidate = text.slice(start, i + 1);
        break;
      }
    }
  }

  if (!candidate) {
    // Fallback: greedy regex (original behaviour)
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    candidate = match[0];
  }

  try {
    return JSON.parse(candidate);
  } catch (e) {
    // If balanced-brace extraction failed, try greedy regex as last resort
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`JSON parse failed: ${e.message}`);
    return JSON.parse(match[0]);
  }
}

// ─── Provider calls ──────────────────────────────────────────────────────────

/**
 * Call OpenAI and return response.
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens=4000]
 * @param {boolean} [opts.rawText=false] — skip JSON extraction, return raw text
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null }>}
 */
async function callOpenAI(prompt, opts = {}) {
  const client = getOpenAIClient();
  if (!client) throw new Error('OPENAI_API_KEY not configured');

  const messages = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: prompt });

  const response = await withRetry(
    () => client.chat.completions.create({
      model: OPENAI_MODEL,
      max_completion_tokens: opts.maxTokens || 4000,
      messages,
    }),
    { onRetry: (attempt, err) => warn(`OpenAI retry ${attempt}: ${err.message}`) }
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Empty response from OpenAI');

  return {
    provider: 'openai',
    model: OPENAI_MODEL,
    raw,
    parsed: opts.rawText ? null : extractJSON(raw),
  };
}

/**
 * Call Google Gemini and return response.
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens=4000]
 * @param {boolean} [opts.rawText=false] — skip JSON extraction, return raw text
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null }>}
 */
async function callGemini(prompt, opts = {}) {
  const client = getGeminiClient();
  if (!client) throw new Error('GOOGLE_AI_API_KEY not configured');

  const config = {
    maxOutputTokens: opts.maxTokens || 4000,
  };
  // When expecting JSON output, tell Gemini to return structured JSON
  if (!opts.rawText) {
    config.responseMimeType = 'application/json';
  }
  if (opts.system) {
    config.systemInstruction = opts.system;
  }

  const response = await withRetry(
    () => client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config,
    }),
    { onRetry: (attempt, err) => warn(`Gemini retry ${attempt}: ${err.message}`) }
  );

  const raw = response.text;
  if (!raw) throw new Error('Empty response from Gemini');

  return {
    provider: 'gemini',
    model: GEMINI_MODEL,
    raw,
    parsed: opts.rawText ? null : extractJSON(raw),
  };
}

/**
 * Call Gemini with Google Search grounding enabled.
 * Used for coverage volume checks — Gemini searches the web to verify story reach.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens=8000]
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null }>}
 */
export async function callGeminiWithSearch(prompt, opts = {}) {
  const client = getGeminiClient();
  if (!client) throw new Error('GOOGLE_AI_API_KEY not configured');

  const config = {
    maxOutputTokens: opts.maxTokens || 8000,
    tools: [{ googleSearch: {} }],
  };
  if (opts.system) {
    config.systemInstruction = opts.system;
  }

  const response = await withRetry(
    () => client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config,
    }),
    { onRetry: (attempt, err) => warn(`Gemini+Search retry ${attempt}: ${err.message}`) }
  );

  const raw = response.text;
  if (!raw) throw new Error('Empty response from Gemini+Search');

  return {
    provider: 'gemini',
    model: GEMINI_MODEL,
    raw,
    parsed: (() => { try { return extractJSON(raw); } catch { return null; } })(),
  };
}

// ─── Concurrency utility ─────────────────────────────────────────────────────

/**
 * Run async tasks with a concurrency limit.
 * @param {number} limit — max parallel tasks
 * @param {Array<() => Promise>} tasks — array of async thunks
 * @returns {Promise<any[]>} — results in original order
 */
export async function withConcurrency(limit, tasks) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Call a single model. Returns parsed JSON by default, or raw text with opts.rawText.
 *
 * @param {'openai' | 'gemini'} provider
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens=4000]
 * @param {boolean} [opts.rawText=false] — skip JSON extraction, return raw text (parsed=null)
 * @returns {Promise<{ provider: string, model: string, raw: string, parsed: object|null }>}
 */
export async function callModel(provider, prompt, opts = {}) {
  if (provider === 'openai') return callOpenAI(prompt, opts);
  if (provider === 'gemini') return callGemini(prompt, opts);
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Call both models in parallel. Returns results keyed by provider.
 * Never throws — failed models return { provider, error, parsed: null }.
 *
 * @param {string} prompt
 * @param {object} [opts]
 * @param {string} [opts.system]
 * @param {number} [opts.maxTokens=4000]
 * @returns {Promise<{ openai: ModelResult, gemini: ModelResult }>}
 */
export async function callBothModels(prompt, opts = {}) {
  const providers = availableProviders();
  const calls = [];

  if (providers.openai) {
    calls.push(
      callOpenAI(prompt, opts)
        .then(r => ({ ...r, error: null }))
        .catch(err => {
          warn(`OpenAI call failed: ${err.message}`);
          return { provider: 'openai', model: OPENAI_MODEL, raw: null, parsed: null, error: err.message };
        })
    );
  } else {
    calls.push(Promise.resolve({
      provider: 'openai', model: OPENAI_MODEL, raw: null, parsed: null, error: 'OPENAI_API_KEY not configured',
    }));
  }

  if (providers.gemini) {
    calls.push(
      callGemini(prompt, opts)
        .then(r => ({ ...r, error: null }))
        .catch(err => {
          warn(`Gemini call failed: ${err.message}`);
          return { provider: 'gemini', model: GEMINI_MODEL, raw: null, parsed: null, error: err.message };
        })
    );
  } else {
    calls.push(Promise.resolve({
      provider: 'gemini', model: GEMINI_MODEL, raw: null, parsed: null, error: 'GOOGLE_AI_API_KEY not configured',
    }));
  }

  const [openaiResult, geminiResult] = await Promise.all(calls);
  return { openai: openaiResult, gemini: geminiResult };
}

/**
 * Check which API keys are available.
 * @returns {{ openai: boolean, gemini: boolean }}
 */
export function availableProviders() {
  return {
    openai: !!loadEnvKey('OPENAI_API_KEY'),
    gemini: !!loadEnvKey('GOOGLE_AI_API_KEY'),
  };
}
