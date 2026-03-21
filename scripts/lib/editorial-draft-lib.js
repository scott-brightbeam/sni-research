/**
 * editorial-draft-lib.js — Pure business logic for the DRAFT pipeline
 *
 * Testable functions for draft extraction, section parsing, validation,
 * metrics calculation, critique merging, prompt rendering, and artifact building.
 *
 * No side effects (no file I/O, no network) — those live in editorial-draft.js.
 */

// ── Newsletter section constants ─────────────────────────

export const NEWSLETTER_SECTIONS = [
  'introduction',
  'general-ai',
  'biopharma',
  'medtech',
  'manufacturing',
  'insurance',
  'podcast-analysis',
]

/** Map alternative headings to canonical section names */
const SECTION_ALIASES = {
  'introduction': ['tl;dr', 'tldr', 'introduction', 'summary', 'this week'],
  'general-ai': ['ai & technology', 'ai and technology', 'general ai', 'ai & tech', 'ai and tech'],
  'biopharma': ['biopharma', 'bio pharma', 'pharma', 'biopharma ai'],
  'medtech': ['medtech', 'med tech', 'medical technology', 'medtech ai'],
  'manufacturing': ['manufacturing', 'manufacturing ai'],
  'insurance': ['insurance', 'insurance ai'],
  'podcast-analysis': ['podcast analysis', 'podcast', 'podcasts', 'podcast insights'],
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Match a heading string to a canonical section name.
 * @param {string} heading
 * @returns {string|null}
 */
function matchSectionName(heading) {
  const normalised = heading.toLowerCase().trim()
  for (const [name, aliases] of Object.entries(SECTION_ALIASES)) {
    if (aliases.some(alias => normalised === alias)) {
      return name
    }
  }
  return null
}

/**
 * Count words in a string (split on whitespace).
 * @param {string} text
 * @returns {number}
 */
function countWords(text) {
  if (!text || !text.trim()) return 0
  return text.trim().split(/\s+/).length
}

// ── Draft extraction ─────────────────────────────────────

/**
 * Extract clean markdown from Opus response text.
 * Strips preamble, code fences, and other wrapping.
 *
 * @param {string|null|undefined} rawResponse
 * @returns {string}
 */
export function extractDraftMarkdown(rawResponse) {
  if (!rawResponse || typeof rawResponse !== 'string') return ''

  let text = rawResponse

  // Strip markdown code fences (```markdown, ```md, or bare ```)
  const fenceMatch = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/m)
  if (fenceMatch) {
    text = fenceMatch[1]
  }

  // Strip preamble: everything before the first ## heading
  const headingIndex = text.search(/^##\s/m)
  if (headingIndex > 0) {
    text = text.slice(headingIndex)
  }

  return text.trim()
}

// ── Section parsing ──────────────────────────────────────

/**
 * Parse newsletter markdown into labelled sections.
 *
 * @param {string|null|undefined} markdown
 * @returns {{ sections: Array<{ name: string, heading: string, content: string, wordCount: number }>, unmatched: string[] }}
 */
export function parseDraftSections(markdown) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return { sections: [], unmatched: [] }
  }

  const sections = []
  const unmatched = []

  // Split by ## headings
  const parts = markdown.split(/^## /m)

  for (const part of parts) {
    if (!part.trim()) continue

    const newlineIndex = part.indexOf('\n')
    if (newlineIndex === -1) continue

    const heading = part.slice(0, newlineIndex).trim()
    const content = part.slice(newlineIndex + 1).trim()

    const sectionName = matchSectionName(heading)
    if (sectionName) {
      sections.push({
        name: sectionName,
        heading,
        content,
        wordCount: countWords(content),
      })
    } else {
      unmatched.push(heading)
    }
  }

  return { sections, unmatched }
}

// ── Validation ───────────────────────────────────────────

/**
 * Validate that a draft has all required sections.
 *
 * @param {{ sections: Array<{ name: string, wordCount: number }>, unmatched: string[] }} parsed
 * @returns {{ valid: boolean, missing: string[], warnings: string[] }}
 */
export function validateDraftStructure(parsed) {
  const present = new Set(parsed.sections.map(s => s.name))
  const missing = NEWSLETTER_SECTIONS.filter(name => !present.has(name))
  const warnings = []

  // Check for short sections
  for (const section of parsed.sections) {
    if (section.wordCount < 50) {
      warnings.push(`Section '${section.name}' is under 50 words (${section.wordCount})`)
    }
  }

  // Check total word count
  const totalWords = parsed.sections.reduce((sum, s) => sum + s.wordCount, 0)
  if (totalWords < 800) {
    warnings.push(`Total word count ${totalWords} is under 800 — draft may be too brief`)
  }
  if (totalWords > 3000) {
    warnings.push(`Total word count ${totalWords} is over 3000 — draft may be too long`)
  }

  return { valid: missing.length === 0, missing, warnings }
}

// ── Metrics ──────────────────────────────────────────────

/**
 * Calculate quality metrics for a draft.
 *
 * @param {string|null|undefined} markdown
 * @returns {{ wordCount: number, sectionCount: number, readingTimeMinutes: number, sectionWordCounts: Record<string, number>, averageSectionWords: number }}
 */
export function calculateDraftMetrics(markdown) {
  if (!markdown || typeof markdown !== 'string' || !markdown.trim()) {
    return { wordCount: 0, sectionCount: 0, readingTimeMinutes: 0, sectionWordCounts: {}, averageSectionWords: 0 }
  }

  const wordCount = countWords(markdown)
  const parsed = parseDraftSections(markdown)
  const sectionCount = parsed.sections.length

  const sectionWordCounts = {}
  for (const section of parsed.sections) {
    sectionWordCounts[section.name] = section.wordCount
  }

  const totalSectionWords = parsed.sections.reduce((sum, s) => sum + s.wordCount, 0)
  const averageSectionWords = sectionCount > 0 ? Math.round(totalSectionWords / sectionCount) : 0

  return {
    wordCount,
    sectionCount,
    readingTimeMinutes: Math.round((wordCount / 250) * 10) / 10,
    sectionWordCounts,
    averageSectionWords,
  }
}

// ── Critique merging ─────────────────────────────────────

/**
 * Merge critique responses from two models into unified feedback.
 * Accepts the return shape of callCritiqueModels() directly.
 *
 * @param {{ gemini: { provider: string, raw: string|null, error: string|null }, openai: { provider: string, raw: string|null, error: string|null } }} critiqueResults
 * @returns {{ merged: string, sources: Array<{ provider: string, available: boolean }>, hasCritique: boolean }}
 */
export function mergeCritiques(critiqueResults) {
  const entries = [critiqueResults.gemini, critiqueResults.openai]
  const sources = []
  const parts = []

  for (const entry of entries) {
    const available = !!(entry.raw && entry.raw.trim())
    sources.push({ provider: entry.provider, available })

    if (available) {
      const label = entry.provider === 'gemini' ? 'Gemini' : 'GPT'
      parts.push(`## ${label} critique\n\n${entry.raw.trim()}`)
    }
  }

  const hasCritique = parts.length > 0
  const merged = parts.join('\n\n')

  return { merged, sources, hasCritique }
}

// ── Prompt rendering ─────────────────────────────────────

/**
 * Render a pre-loaded critique prompt template with draft content.
 *
 * @param {string} template — pre-loaded template text from orchestrator
 * @param {string} draft — draft markdown
 * @param {object} [opts]
 * @param {string[]} [opts.themes] — active theme names
 * @param {number} [opts.week] — editorial week number
 * @param {string[]} [opts.sectionNames] — section names found in draft
 * @returns {string}
 */
export function renderCritiquePrompt(template, draft, opts = {}) {
  const themes = opts?.themes?.length ? opts.themes.join(', ') : '(none)'
  const week = opts?.week != null ? String(opts.week) : '(current)'
  const sections = opts?.sectionNames?.length ? opts.sectionNames.join(', ') : '(all)'

  return template
    .replaceAll('{draft}', draft)
    .replaceAll('{themes}', themes)
    .replaceAll('{week}', week)
    .replaceAll('{sections}', sections)
}

/**
 * Render a pre-loaded revision prompt template with draft and critique.
 *
 * @param {string} template — pre-loaded template text from orchestrator
 * @param {string} draft — draft markdown
 * @param {string} mergedCritique — merged critique text
 * @param {object} [opts]
 * @param {number} [opts.week] — editorial week number
 * @returns {string}
 */
export function renderRevisionPrompt(template, draft, mergedCritique, opts = {}) {
  const week = opts?.week != null ? String(opts.week) : '(current)'

  return template
    .replaceAll('{draft}', draft)
    .replaceAll('{critique}', mergedCritique)
    .replaceAll('{week}', week)
}

// ── Artifact building ────────────────────────────────────

/**
 * Assemble the complete draft output artifact.
 *
 * @param {object} data
 * @returns {object} — JSON-serialisable artifact
 */
export function buildDraftArtifact(data) {
  return {
    version: 1,
    session: data.session,
    timestamp: data.timestamp,
    initialDraft: data.initialDraft,
    finalDraft: data.finalDraft,
    critiques: data.critiques,
    metrics: data.metrics,
    costs: data.costs,
  }
}
