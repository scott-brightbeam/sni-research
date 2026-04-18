import Anthropic from '@anthropic-ai/sdk'
import { loadEnvKey } from './env.js'

let _client = null

/**
 * Returns the singleton Anthropic SDK client.
 *
 * maxRetries: 0 — the SDK would otherwise retry network errors up to
 * 2 times by default. On ECONNRESET or a partial-stream failure that
 * means 3 attempts per logical call, silently multiplying token spend.
 * We'd rather a transient blip surface immediately so we can see it
 * in logs and decide whether to re-run, than have the cost triple
 * without notice. If retry-on-transient is ever needed, wire it at
 * the call site, not globally.
 */
export function getClient() {
  if (_client) return _client
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) return null
  _client = new Anthropic({ apiKey: key, maxRetries: 0 })
  return _client
}
