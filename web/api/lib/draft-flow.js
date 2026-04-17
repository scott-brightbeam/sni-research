/**
 * draft-flow.js — Pure helpers for the editorial-chat draft pipeline.
 *
 * Extracted from routes/editorial.js so the logic is unit-testable and
 * the streaming handler in the route stays focused on I/O.
 *
 * The pipeline is:
 *   1. Build the draft-mode system-prompt addendum (buildDraftAddendum)
 *   2. Generate the draft (streaming, possibly across tool rounds)
 *   3. Detect whether the accumulated text looks like a finished draft
 *      (detectDraftOutput) — including multi-draft outputs
 *   4. If it does, run an internal style audit + revision pass
 *   5. Otherwise, strip the tool-call narrative and stream what we have
 *      (extractDraftContent)
 */

// ── Draft-mode system-prompt addendum ────────────────────────
// Deliberately avoids "write ONE complete draft". The writing preferences
// file (data/editorial/writing-preferences.md) mandates THREE format
// options per first draft, and the UI (Editorial.jsx) hard-codes
// "Generate THREE complete drafts..." on backlog-triggered requests.
// Forcing ONE here caused the 17 Apr 2026 multi-draft regression.
export function buildDraftAddendum(isDraftMode) {
  if (!isDraftMode) return ''
  return [
    '',
    '',
    'IMPORTANT — draft mode:',
    '- Maximum 5 tool rounds to gather source material. Fetch the backlog item, analysis entries, reference posts and themes you need.',
    '- Then write the drafts the user requested. The writing preferences specify THREE different LinkedIn formats for a first draft unless the user asks for something else.',
    '- Every draft must include a complete `in-the-end-at-the-end` closer — a 1-3 sentence crystallisation, never a restatement.',
    '- Obey the prohibited-language list strictly. No false contrasts (\'Not X but Y\'), no pseudo-profundity, no hollow intensifiers.',
    '- Write the drafts immediately and directly. No preamble such as "I\'ll draft the posts now" or "Here are three drafts" — just produce them with clear format headers.',
  ].join('\n')
}

// ── Draft output detection ──────────────────────────────────
// Returns true when the accumulated text from the initial generation
// looks like a draft (single or multi) that warrants the style audit.
// Previously only checked for "in-the-end-at-the-end", which missed
// multi-draft outputs where the first draft hadn't reached its ITEATE
// by the time generation ended or truncated.
export function detectDraftOutput(text, { willAudit = true, minLength = 300 } = {}) {
  if (!willAudit) return false
  if (typeof text !== 'string' || text.length < minLength) return false
  const lower = text.toLowerCase()
  if (lower.includes('in-the-end-at-the-end')) return true
  // Multi-draft markers: "## DRAFT 1", "Draft 1:", "**Draft 1**",
  // "Format 1:", or a numbered heading with a format name after it.
  if (/(?:^|\n)\s*(?:#{1,3}\s*)?draft\s*\d\b|(?:^|\n)\s*(?:#{1,3}\s*)?format\s*\d\b/i.test(text)) return true
  // Markdown-style draft sections with common format names
  if (/(?:^|\n)\s*#{1,3}\s*(?:news\s*decoder|concept\s*contrast|quiet\s*observation|practitioner|behavioural|honest\s*confession)/i.test(text)) return true
  return false
}

// ── Draft extraction ─────────────────────────────────────────
// When the audit pass can't run (e.g. a short output that doesn't look
// like a draft but isn't empty either), the fallback path streams
// whatever we have to the user. This helper strips the model's
// inter-tool narrative ("I'll start by gathering the source material…",
// "Good, I have enough context. Let me now draft the posts.") so the
// user sees the content rather than the process. If no draft markers
// are found, return the text unchanged.
export function extractDraftContent(text) {
  if (typeof text !== 'string' || !text) return text

  // Search for the first clear draft-start marker. Order matters:
  // prefer the explicit DRAFT N heading, then FORMAT N, then a format-
  // named heading, then any top-level markdown heading.
  const candidates = [
    /(?:^|\n)#{1,3}\s*draft\s*\d\b[^\n]*\n/im,
    /(?:^|\n)#{1,3}\s*format\s*\d\b[^\n]*\n/im,
    /(?:^|\n)#{1,3}\s*(?:news\s*decoder|concept\s*contrast|quiet\s*observation|practitioner|behavioural\s*paradox|honest\s*confession)[^\n]*\n/im,
    // An opening bold-title line preceded by '---' is also a draft start
    /(?:^|\n)---\s*\n+\s*\*\*[^*\n]+\*\*/m,
  ]
  for (const re of candidates) {
    const match = text.match(re)
    if (match && match.index != null) {
      // Keep from the start of the matched line, not from match.index
      // (which may include a leading newline).
      const prefix = text.slice(0, match.index)
      const lastNewlineBefore = prefix.lastIndexOf('\n')
      const from = lastNewlineBefore === -1 ? 0 : lastNewlineBefore + 1
      return text.slice(from).trimStart()
    }
  }
  // No draft markers — return untouched.
  return text
}

// ── Audit prompt builder ────────────────────────────────────
// Multi-draft aware audit system prompt. Mentions "draft(s)" and
// reminds the auditor that the output may contain several drafts in
// different formats, each with its own opening and closer.
export function buildAuditSystemPrompt({ vocabSection = '' } = {}) {
  return [
    'You are a writing style auditor. Compare the draft(s) against the reference posts and rules below.',
    '',
    'The draft output may contain a SINGLE post or MULTIPLE posts in different LinkedIn formats (News Decoder, Concept Contrast, Quiet Observation, Practitioner\'s Take, Behavioural Paradox, Honest Confession). When multiple drafts are present, audit EACH one independently and report corrections per-draft.',
    '',
    'Return ONLY a numbered list of specific corrections. For each: quote the problematic text, state what rule it breaks, give the corrected replacement text.',
    '',
    'Check:',
    '- Prohibited words/patterns (leverage, utilise, robust, streamline, delve, ecosystem, unlock, harness, paradigm, etc.)',
    '- False contrast patterns (\'Not X but Y\', \'The question isn\'t X, it\'s Y\') — these are strictly prohibited',
    '- Pseudo-profundity (\'The key is...\', \'The reality is...\', \'At its core...\')',
    '- Hollow intensifiers (incredibly, fundamentally, truly, absolutely, deeply)',
    '- Single quotes (never double)',
    '- Opening-line concreteness (specific person/company/number/event, not abstract framing)',
    '- Sentence rhythm variation — guard against strings of reductive short fragments ("None of this is X. All of it is Y.")',
    '- ITEATE quality — each draft must CRYSTALLISE a fresh insight, not restate the argument',
    '- First-person Scott voice where appropriate — analytical, humane, observer tone, not strident or aggrieved',
    '- Evidence citation pattern: named source + specific figure + editorial interpretation',
    '- Hedging calibration — bold where confidence exists, hedged where it doesn\'t' + vocabSection,
  ].join('\n')
}

// ── Revision prompt builder ──────────────────────────────────
// Explicitly instructs the model to preserve ALL drafts if multiple
// are present, and to strip any pre-draft narrative.
export function buildRevisionInstruction(auditText) {
  return [
    'Apply ALL of these style corrections to the draft(s) above.',
    '',
    'If the input contained multiple drafts (News Decoder, Concept Contrast, etc.), preserve ALL of them in the output — do not collapse to a single draft. Each draft keeps its own format header and ITEATE closer.',
    '',
    'Output ONLY the polished draft(s). Do not include:',
    '- Preamble ("Here are the revised drafts...", "I\'ll apply the corrections...")',
    '- Inter-tool narrative ("Let me fetch...", "Good, I have enough...")',
    '- Audit notes, correction summaries, or meta-commentary',
    '- Anything that is not a published-ready draft',
    '',
    '## CORRECTIONS TO APPLY',
    '',
    auditText,
  ].join('\n')
}
