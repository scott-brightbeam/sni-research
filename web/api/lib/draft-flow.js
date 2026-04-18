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
 *
 * Principle definitions (evidence calibration, must-catch patterns,
 * CEO empathy, sector detection) live in scripts/lib/editorial-principles.js
 * — a shared module consumed by both the drafting pipeline here and the
 * upstream analyse + audit pipeline in scripts/. This module re-exports
 * them so the existing callers here continue to work unchanged.
 */

import {
  SECTORS,
  SECTOR_PATTERNS,
  SECTOR_CEO_LABELS,
  detectSectors,
  buildEvidenceCalibrationSection,
  buildMustCatchPatternsSection,
  buildCEOEmpathySection,
  buildCEOCritiquePrompt,
  buildCEORevisionInstruction,
} from '../../../scripts/lib/editorial-principles.js'

export {
  SECTORS,
  SECTOR_PATTERNS,
  SECTOR_CEO_LABELS,
  detectSectors,
  buildEvidenceCalibrationSection,
  buildMustCatchPatternsSection,
  buildCEOEmpathySection,
  buildCEOCritiquePrompt,
  buildCEORevisionInstruction,
}

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
    'IMPORTANT — draft mode. Follow this exact workflow:',
    '',
    'STEP 1 — Gather source material via tools (up to 6 tool rounds).',
    '  Fetch: the backlog item (get_backlog_item), the source analysis entry (get_analysis_entry), at least 2 reference posts in candidate formats (search_published_posts + get_published_post). Stop calling tools as soon as you have enough to draft.',
    '',
    'STEP 2 — WRITE THE DRAFTS. This is the primary deliverable.',
    '  Once you stop calling tools, your next response MUST contain the drafts. Do NOT end your turn without producing them. Do NOT say "I have what I need" — just start writing.',
    '',
    'FORMAT — Three drafts, one of each format, chosen from:',
    '  1. News Decoder — current event → deeper signal',
    '  2. Concept Contrast — stark before/after comparison',
    '  3. Quiet Observation — smaller, sharper insight others miss',
    '  4. Practitioner\'s Take — how Scott actually does the thing',
    '  5. Behavioural Paradox — surprising contradiction → psychology → framework',
    '  6. Honest Confession — genuine mistake or evolution in thinking',
    '',
    'STRUCTURE — Each draft MUST have:',
    '  - Header: `## Draft 1: News Decoder` (or the chosen format)',
    '  - Bold title line: `**The Title Here**`',
    '  - Body (200-400 words, UK English, Scott\'s analytical observer voice)',
    '  - ITEATE closer starting with "So what\'s today\'s in-the-end-at-the-end?" — 1-3 sentences that crystallise, never restate',
    '',
    'VOICE — critical, and the place drafts most often break:',
    '  - Third-person analytical, NOT first-person confessional. Scott is not the subject of his own posts.',
    '  - NEVER write: "I keep thinking", "I see this in my clients", "I think more importantly", "From my experience", "What I find interesting" — none of these appear in Scott\'s canon.',
    '  - "We" is fine and expected for Brightbeam collective voice: "At Brightbeam we...", "Yesterday we wrote...", "We expect that...".',
    '  - Cite sources briefly and factually. "Research from Anthropic suggests X" ✓. "Chamath Palihapitiya\'s post pulled 1.2m views" ✓. "On the [X] podcast this week, [person] said Y" ✗. Never foreground the medium.',
    '',
    'STYLE — Obey the prohibited-language list strictly:',
    '  No false contrasts (\'Not X but Y\'), no pseudo-profundity (\'The reality is...\'), no hollow intensifiers (actually, incredibly, fundamentally), no reductive fragment chains (\'None of this. All of it.\'), no aggrieved framing (\'deserves more attention\', \'the industry keeps missing\'). Scott\'s voice is analytical and humane, not strident or confessional.',
    '',
    'OUTPUT — Go straight into `## Draft 1:` once tools are done. No preamble like "Here are three drafts" or "I\'ll now draft" — just the drafts, back-to-back.',
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

  // Search for the first draft-start marker. Markers may appear mid-line
  // (streamed tool narrative concatenated with the first heading, no
  // intervening newline) so we DON'T anchor to line-start. Order matters:
  // prefer the explicit DRAFT N heading, then FORMAT N, then a format-
  // named heading, then an opening bold-title after a --- rule.
  const candidates = [
    /#{1,3}\s*draft\s*\d\b/i,
    /#{1,3}\s*format\s*\d\b/i,
    /#{1,3}\s*(?:news\s*decoder|concept\s*contrast|quiet\s*observation|practitioner|behavioural\s*paradox|honest\s*confession)/i,
    /---\s*\n+\s*\*\*[^*\n]+\*\*/,
  ]
  let bestIdx = -1
  for (const re of candidates) {
    const match = text.match(re)
    if (match && match.index != null) {
      if (bestIdx === -1 || match.index < bestIdx) bestIdx = match.index
    }
  }
  if (bestIdx === -1) return text

  // Back up to the closest preceding newline so headings render on their
  // own line in the stream. If there's no newline before the match,
  // prepend two newlines so downstream renderers see a clean boundary.
  const prefix = text.slice(0, bestIdx)
  const lastNewlineBefore = prefix.lastIndexOf('\n')
  if (lastNewlineBefore === -1) {
    return '\n\n' + text.slice(bestIdx).trimStart()
  }
  return text.slice(lastNewlineBefore + 1).trimStart()
}

// ── Audit prompt builder ────────────────────────────────────
// Multi-draft aware audit system prompt. Mentions "draft(s)" and
// reminds the auditor that the output may contain several drafts in
// different formats, each with its own opening and closer. Composes
// its two principled sections (evidence calibration, must-catch
// patterns) from scripts/lib/editorial-principles.js so that every
// pipeline — drafting here, upstream analyse, upstream audit — sees
// the same rules.
export function buildAuditSystemPrompt({ vocabSection = '' } = {}) {
  return [
    'You are a writing style auditor. Compare the draft(s) against the reference posts and rules below. Be ruthless — false positives are better than missed patterns.',
    '',
    'The draft output may contain a SINGLE post or MULTIPLE posts in different LinkedIn formats (News Decoder, Concept Contrast, Quiet Observation, Practitioner\'s Take, Behavioural Paradox, Honest Confession). When multiple drafts are present, audit EACH one independently and report corrections per-draft.',
    '',
    'Return ONLY a numbered list of specific corrections. For each: quote the problematic text, state what rule it breaks, give the corrected replacement text.',
    '',
    buildEvidenceCalibrationSection(),
    '',
    buildMustCatchPatternsSection(),
    '',
    'ALSO CHECK:',
    '- Prohibited vocabulary (leverage, utilise, robust, streamline, delve, ecosystem, unlock, harness, paradigm, etc.)',
    '- Single quotes only (never double)',
    '- Opening-line concreteness — specific person/company/number/event, not abstract framing',
    '- ITEATE quality — each draft must CRYSTALLISE a fresh insight, not restate the argument',
    '- Evidence citation pattern: named source + specific figure + editorial interpretation',
    '- Brightbeam "we" voice is allowed and expected for collective positioning lines (\'At Brightbeam we...\', \'We expect that...\'). Solo \'I\' narrator is NOT.' + vocabSection,
  ].join('\n')
}

// ── Revision prompt builder ──────────────────────────────────
// Explicitly instructs the model to preserve ALL drafts if multiple
// are present, and to strip any pre-draft narrative.
export function buildRevisionInstruction(auditText) {
  return [
    'Apply every correction in the list below to the draft(s) above. Do not skip any.',
    '',
    'MULTI-DRAFT PRESERVATION: if the input contains multiple drafts, preserve ALL of them. Each draft keeps its own format header, bold title, body, and ITEATE closer.',
    '',
    'HOW TO APPLY each correction:',
    '- Locate the exact quoted text in the draft.',
    '- Apply the correction. If the correction is a simple word swap, swap. If the correction requires RESTRUCTURING (false contrasts, forced tripling, clickbait titles cannot be fixed by word swaps — they need sentence-level rewriting), restructure.',
    '- If applying one correction causes another violation, fix that too.',
    '',
    'VERIFY before returning. Scan your output and confirm it contains NONE of these patterns. If any survive, rewrite:',
    '- \'Not X but Y\' (including \'not from X but Y\', \'not for X but Y\', \'rather than X, Y\', \'not through X but Y\')',
    '- \'X, not Y\' as a punchy closer (e.g. \'the constraint is ambition, not capability\')',
    '- \'isn\'t X, it\'s Y\' / \'isn\'t X. It\'s Y.\' / \'wasn\'t X but Y\' / \'doesn\'t X. It Y.\'',
    '- \'X isn\'t just Y — it\'s Z\' / \'not only X but Y\' / \'X, but it\'s also Y\'',
    '- Any three short clauses in a row (\'The tools exist. The demand exists. The ROI is measurable.\')',
    '- Any three short noun phrases as sentences (\'Better stories. More inclusive language. Broader access.\')',
    '- Clickbait titles: \'The X Nobody Talks About\', \'That\'s the Y\', \'Here\'s why X\', \'The X Problem (And the Fix)\'',
    '- Foregrounded podcast/medium framing (\'on the [X] podcast\', \'on [show] this week\')',
    '- First-person narrator (\'I keep thinking\', \'I see this\', \'from my experience\')',
    '- Hollow intensifiers: actually, incredibly, truly, fundamentally, deeply',
    '- The word "matters" anywhere — and the construct it creates ("X matters because Y", "This matters for…", "What matters is…"). Do not substitute "is significant" / "is important" / "is worth noting" — same pattern. CUT the sentence (it\'s usually padding) or restructure so the consequence is shown, not asserted.',
    '',
    'If the ITEATE closer uses any of these patterns, rewrite it. The ITEATE is the final impression; it must be clean.',
    '',
    'CRITICAL — output format. Your output is streamed directly to the user as the polished response. Begin with the literal characters `## Draft 1:` and nothing before. Do NOT:',
    '- Narrate your evaluation process (\'Now I have the full picture...\', \'The source fails the attribution test...\', \'Let me apply the corrections precisely...\')',
    '- Acknowledge the corrections list (\'I\'ve applied all 20 corrections...\', \'Here are the revised drafts...\')',
    '- Add any preamble, transition text, or meta-commentary before the first draft header',
    '- Include audit notes, correction explanations, or post-draft commentary',
    '- Inter-tool narrative (\'Let me fetch...\', \'Good, I have enough...\')',
    '',
    'The user reads exactly what you write. Anything before `## Draft 1:` becomes garbage in their UI. Start with the draft header. End after the last draft\'s ITEATE.',
    '',
    '## CORRECTIONS TO APPLY',
    '',
    auditText,
  ].join('\n')
}
