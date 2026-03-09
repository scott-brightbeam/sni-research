export const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { inputPerMTok: 3, outputPerMTok: 15 },
  'claude-opus-4-6':           { inputPerMTok: 5, outputPerMTok: 25 },
}

export const MODELS = Object.keys(MODEL_PRICING)
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

export function estimateCost(model, inputTokens, outputTokens) {
  const p = MODEL_PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.inputPerMTok + (outputTokens / 1_000_000) * p.outputPerMTok
}

export function formatCost(cost) {
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}
