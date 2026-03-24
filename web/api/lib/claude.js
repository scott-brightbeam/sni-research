import Anthropic from '@anthropic-ai/sdk'
import { loadEnvKey } from './env.js'

let _client = null

export function getClient() {
  if (_client) return _client
  const key = loadEnvKey('ANTHROPIC_API_KEY')
  if (!key) return null  // Anthropic API removed 2026-03-23; Claude Code handles all LLM work now
  _client = new Anthropic({ apiKey: key })
  return _client
}
