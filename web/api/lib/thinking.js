/**
 * thinking.js — Extended-thinking helper for Anthropic messages.create calls.
 *
 * Extended thinking gives Opus dedicated reasoning tokens before it produces
 * output. For Scott's editorial workflow — where voice fidelity and rule
 * compliance matter more than speed — this substantially improves quality.
 * For non-Opus models (Sonnet, Haiku), thinking is not enabled because
 * (a) it isn't always supported and (b) the budget would be wasted.
 *
 * Usage:
 *   const extended = thinkingFor(modelId, { budget: 8000 })
 *   await client.messages.create({
 *     model: modelId,
 *     max_tokens: baseOutput + (extended.thinking?.budget_tokens || 0),
 *     ...extended,
 *     ...
 *   })
 */

/** Returns true if the model supports extended thinking. */
export function isExtendedThinkingCapable(modelId) {
  if (typeof modelId !== 'string') return false
  return modelId.startsWith('claude-opus-4')
}

/**
 * Build the extended-thinking config for a messages.create call.
 * Returns {} (nothing to spread) for models that don't support thinking,
 * so callers can safely `...thinkingFor(model)` unconditionally.
 *
 * For claude-opus-4-6 we use `type: 'adaptive'` — the model decides
 * how long to think. The older `type: 'enabled'` with an explicit
 * `budget_tokens` is DEPRECATED for this model (the SDK itself warns
 * about it) and was causing ECONNRESET from Anthropic's side when
 * combined with revision-style request shapes. Adaptive thinking
 * doesn't take a budget_tokens param.
 *
 * @param {string} modelId
 * @param {{ budget?: number }} [opts] - unused for adaptive, kept for API compat
 * @returns {{}|{thinking: {type: 'adaptive'}}}
 */
export function thinkingFor(modelId /*, _opts */) {
  if (!isExtendedThinkingCapable(modelId)) return {}
  return { thinking: { type: 'adaptive' } }
}

/**
 * Compute the max_tokens value needed to leave room for the model's
 * self-chosen thinking plus the desired output. When thinking is not
 * enabled, returns baseOutput unchanged. For adaptive thinking we
 * give the model a fixed headroom — the model self-regulates within it.
 *
 * @param {string} modelId
 * @param {number} baseOutput - tokens of response text the caller wants
 * @param {{ budget?: number }} [opts] - headroom to add when thinking is on
 */
export function maxTokensWithThinking(modelId, baseOutput, { budget = 8000 } = {}) {
  if (!isExtendedThinkingCapable(modelId)) return baseOutput
  return baseOutput + budget
}
