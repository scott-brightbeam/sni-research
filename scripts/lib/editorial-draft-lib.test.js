/**
 * editorial-draft-lib.test.js — Tests for DRAFT pipeline business logic
 *
 * Pure function tests for draft extraction, section parsing, validation,
 * metrics calculation, critique merging, prompt rendering, and artifact building.
 */

import { describe, test, expect } from 'bun:test'
import {
  extractDraftMarkdown,
  parseDraftSections,
  validateDraftStructure,
  calculateDraftMetrics,
  mergeCritiques,
  renderCritiquePrompt,
  renderRevisionPrompt,
  buildDraftArtifact,
  NEWSLETTER_SECTIONS,
} from './editorial-draft-lib.js'

// ── extractDraftMarkdown ────────────────────────────────

describe('extractDraftMarkdown', () => {
  test('returns clean markdown unchanged', () => {
    const md = '## tl;dr\n\nThis week in AI...\n\n## AI & Technology\n\nSomething happened.'
    expect(extractDraftMarkdown(md)).toBe(md)
  })

  test('strips preamble text before first heading', () => {
    const raw = 'Here is the newsletter draft:\n\n## tl;dr\n\nThis week...'
    expect(extractDraftMarkdown(raw)).toBe('## tl;dr\n\nThis week...')
  })

  test('strips markdown code fences', () => {
    const raw = '```markdown\n## tl;dr\n\nThis week...\n```'
    expect(extractDraftMarkdown(raw)).toBe('## tl;dr\n\nThis week...')
  })

  test('strips code fences with language tag', () => {
    const raw = '```md\n## tl;dr\n\nContent here\n```'
    expect(extractDraftMarkdown(raw)).toBe('## tl;dr\n\nContent here')
  })

  test('returns empty string for empty input', () => {
    expect(extractDraftMarkdown('')).toBe('')
    expect(extractDraftMarkdown(null)).toBe('')
    expect(extractDraftMarkdown(undefined)).toBe('')
  })

  test('returns trimmed response when no headings found', () => {
    const raw = 'Just some plain text without any structure.'
    expect(extractDraftMarkdown(raw)).toBe(raw)
  })

  test('handles preamble with multiple paragraphs before heading', () => {
    const raw = "Here is the draft.\n\nI've structured it as follows.\n\n## tl;dr\n\nContent"
    expect(extractDraftMarkdown(raw)).toBe('## tl;dr\n\nContent')
  })

  test('preserves content after last section (no stripping postamble)', () => {
    const raw = '## tl;dr\n\nContent\n\n---\n\n*Published by SNI*'
    expect(extractDraftMarkdown(raw)).toBe(raw)
  })
})

// ── parseDraftSections ──────────────────────────────────

describe('parseDraftSections', () => {
  const fullDraft = [
    '## tl;dr',
    '',
    'This week the through-line is enterprise adoption.',
    '',
    '## AI & Technology',
    '',
    'Anthropic released Claude 4. This matters because enterprise teams can now delegate complex workflows.',
    '',
    '## Biopharma',
    '',
    'Drug discovery accelerated by AI tools.',
    '',
    '## Medtech',
    '',
    'Medical imaging gets smarter.',
    '',
    '## Manufacturing',
    '',
    'Robots on the factory floor.',
    '',
    '## Insurance',
    '',
    'Claims processing automation.',
    '',
    '## Podcast Analysis',
    '',
    'Three hosts converged on the delegation thesis.',
  ].join('\n')

  test('parses all seven sections from a complete draft', () => {
    const result = parseDraftSections(fullDraft)
    expect(result.sections.length).toBe(7)
    expect(result.unmatched.length).toBe(0)
    expect(result.sections[0].name).toBe('introduction')
    expect(result.sections[1].name).toBe('general-ai')
    expect(result.sections[6].name).toBe('podcast-analysis')
  })

  test('includes heading and content for each section', () => {
    const result = parseDraftSections(fullDraft)
    const intro = result.sections.find(s => s.name === 'introduction')
    expect(intro.heading).toBe('tl;dr')
    expect(intro.content).toContain('through-line')
    expect(intro.wordCount).toBeGreaterThan(0)
  })

  test('reports unmatched sections', () => {
    const draft = '## tl;dr\n\nIntro\n\n## Bonus Section\n\nExtra content'
    const result = parseDraftSections(draft)
    expect(result.sections.length).toBe(1)
    expect(result.unmatched).toContain('Bonus Section')
  })

  test('handles empty input', () => {
    const result = parseDraftSections('')
    expect(result.sections.length).toBe(0)
    expect(result.unmatched.length).toBe(0)
  })

  test('handles null input', () => {
    const result = parseDraftSections(null)
    expect(result.sections.length).toBe(0)
  })

  test('handles alternative heading names', () => {
    const draft = '## Summary\n\nIntro\n\n## Pharma\n\nDrug news'
    const result = parseDraftSections(draft)
    expect(result.sections[0].name).toBe('introduction')
    expect(result.sections[1].name).toBe('biopharma')
  })

  test('matching is case-insensitive', () => {
    const draft = '## TL;DR\n\nIntro\n\n## AI & TECHNOLOGY\n\nAI news'
    const result = parseDraftSections(draft)
    expect(result.sections[0].name).toBe('introduction')
    expect(result.sections[1].name).toBe('general-ai')
  })

  test('matches tl;dr with theme suffix (e.g. "tl;dr: Consolidation accelerates")', () => {
    const draft = '## tl;dr: Consolidation accelerates\n\nIntro with theme.\n\n## Insurance\n\nClaims AI.'
    const result = parseDraftSections(draft)
    expect(result.sections[0].name).toBe('introduction')
    expect(result.sections[0].heading).toBe('tl;dr: Consolidation accelerates')
  })

  test('calculates word count per section', () => {
    const draft = '## tl;dr\n\nOne two three four five'
    const result = parseDraftSections(draft)
    expect(result.sections[0].wordCount).toBe(5)
  })

  test('captures heading-only section with zero word count', () => {
    const draft = '## tl;dr\n\nIntro content\n\n## Insurance'
    const result = parseDraftSections(draft)
    expect(result.sections.length).toBe(2)
    expect(result.sections[1].name).toBe('insurance')
    expect(result.sections[1].wordCount).toBe(0)
    expect(result.sections[1].content).toBe('')
  })
})

// ── validateDraftStructure ──────────────────────────────

describe('validateDraftStructure', () => {
  function makeParsed(sectionNames) {
    return {
      sections: sectionNames.map(name => ({
        name,
        heading: name,
        content: 'Word '.repeat(60),
        wordCount: 60,
      })),
      unmatched: [],
    }
  }

  test('valid when all sections present', () => {
    const result = validateDraftStructure(makeParsed(NEWSLETTER_SECTIONS))
    expect(result.valid).toBe(true)
    expect(result.missing).toEqual([])
  })

  test('invalid when sections missing', () => {
    const result = validateDraftStructure(makeParsed(['introduction', 'general-ai']))
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('biopharma')
    expect(result.missing).toContain('insurance')
  })

  test('warns on sections under 50 words', () => {
    const parsed = makeParsed(NEWSLETTER_SECTIONS)
    parsed.sections[2].wordCount = 20
    parsed.sections[2].content = 'Short section'
    const result = validateDraftStructure(parsed)
    expect(result.valid).toBe(true) // still valid, just warns
    expect(result.warnings.some(w => w.includes('biopharma'))).toBe(true)
  })

  test('warns on total word count under 800', () => {
    const parsed = {
      sections: NEWSLETTER_SECTIONS.map(name => ({
        name,
        heading: name,
        content: 'Short',
        wordCount: 10,
      })),
      unmatched: [],
    }
    const result = validateDraftStructure(parsed)
    expect(result.warnings.some(w => w.includes('800'))).toBe(true)
  })

  test('warns on total word count over 3000', () => {
    const parsed = {
      sections: NEWSLETTER_SECTIONS.map(name => ({
        name,
        heading: name,
        content: 'Word '.repeat(500),
        wordCount: 500,
      })),
      unmatched: [],
    }
    const result = validateDraftStructure(parsed)
    expect(result.warnings.some(w => w.includes('3000'))).toBe(true)
  })

  test('handles empty sections array', () => {
    const result = validateDraftStructure({ sections: [], unmatched: [] })
    expect(result.valid).toBe(false)
    expect(result.missing.length).toBe(NEWSLETTER_SECTIONS.length)
  })
})

// ── calculateDraftMetrics ───────────────────────────────

describe('calculateDraftMetrics', () => {
  test('calculates metrics for a normal draft', () => {
    const md = '## tl;dr\n\n' + 'Word '.repeat(100) + '\n\n## AI & Technology\n\n' + 'Word '.repeat(200)
    const metrics = calculateDraftMetrics(md)
    expect(metrics.wordCount).toBeGreaterThan(295) // headings + words
    expect(metrics.sectionCount).toBe(2)
    expect(metrics.readingTimeMinutes).toBeGreaterThan(1)
    expect(metrics.sectionWordCounts['introduction']).toBe(100)
    expect(metrics.sectionWordCounts['general-ai']).toBe(200)
    expect(metrics.averageSectionWords).toBe(150)
  })

  test('returns zero metrics for empty input', () => {
    const metrics = calculateDraftMetrics('')
    expect(metrics.wordCount).toBe(0)
    expect(metrics.sectionCount).toBe(0)
    expect(metrics.readingTimeMinutes).toBe(0)
    expect(metrics.averageSectionWords).toBe(0)
  })

  test('returns zero metrics for null input', () => {
    const metrics = calculateDraftMetrics(null)
    expect(metrics.wordCount).toBe(0)
  })

  test('handles markdown with no recognised sections', () => {
    const md = 'Just some text with no headings at all.'
    const metrics = calculateDraftMetrics(md)
    expect(metrics.wordCount).toBe(8)
    expect(metrics.sectionCount).toBe(0)
    expect(metrics.sectionWordCounts).toEqual({})
  })
})

// ── mergeCritiques ──────────────────────────────────────

describe('mergeCritiques', () => {
  test('merges two successful critiques', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: '1. [STRUCTURE] Missing insurance section.', error: null },
      openai: { provider: 'openai', raw: '1. [VOICE] Prohibited word "leverage" found.', error: null },
    })
    expect(result.hasCritique).toBe(true)
    expect(result.merged).toContain('Missing insurance section')
    expect(result.merged).toContain('Prohibited word')
    expect(result.sources.length).toBe(2)
    expect(result.sources.every(s => s.available)).toBe(true)
  })

  test('uses single critique when one model fails', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: '1. Good critique point.', error: null },
      openai: { provider: 'openai', raw: null, error: 'API timeout' },
    })
    expect(result.hasCritique).toBe(true)
    expect(result.merged).toContain('Good critique point')
    expect(result.sources.find(s => s.provider === 'openai').available).toBe(false)
  })

  test('returns hasCritique false when both models fail', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: null, error: 'Key not configured' },
      openai: { provider: 'openai', raw: null, error: 'API error' },
    })
    expect(result.hasCritique).toBe(false)
    expect(result.merged).toBe('')
    expect(result.sources.every(s => !s.available)).toBe(true)
  })

  test('handles empty raw strings as unavailable', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: '', error: null },
      openai: { provider: 'openai', raw: '1. Critique.', error: null },
    })
    expect(result.hasCritique).toBe(true)
    expect(result.sources.find(s => s.provider === 'gemini').available).toBe(false)
  })

  test('handles whitespace-only raw as unavailable', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: '   \n  ', error: null },
      openai: { provider: 'openai', raw: null, error: 'err' },
    })
    expect(result.hasCritique).toBe(false)
  })

  test('returns empty result for null input', () => {
    const result = mergeCritiques(null)
    expect(result.hasCritique).toBe(false)
    expect(result.merged).toBe('')
    expect(result.sources).toEqual([])
  })

  test('returns empty result for undefined input', () => {
    const result = mergeCritiques(undefined)
    expect(result.hasCritique).toBe(false)
  })

  test('handles missing provider key gracefully', () => {
    const result = mergeCritiques({
      gemini: { provider: 'gemini', raw: 'Feedback.', error: null },
      // openai key missing entirely
    })
    expect(result.hasCritique).toBe(true)
    expect(result.merged).toContain('Feedback')
  })
})

// ── renderCritiquePrompt ────────────────────────────────

describe('renderCritiquePrompt', () => {
  const template = 'Review this draft:\n\n{draft}\n\nThemes: {themes}\nWeek: {week}\nSections: {sections}'

  test('replaces all placeholders', () => {
    const result = renderCritiquePrompt(template, '## tl;dr\n\nDraft content', {
      themes: ['T01', 'T03'],
      week: 12,
      sectionNames: ['introduction', 'general-ai'],
    })
    expect(result).toContain('Draft content')
    expect(result).toContain('T01, T03')
    expect(result).toContain('12')
    expect(result).toContain('introduction, general-ai')
  })

  test('handles missing opts with defaults', () => {
    const result = renderCritiquePrompt(template, 'Draft text', {})
    expect(result).toContain('Draft text')
    expect(result).toContain('Themes: (none)')
    expect(result).toContain('Week: (current)')
  })

  test('handles null opts', () => {
    const result = renderCritiquePrompt(template, 'Draft text')
    expect(result).toContain('Draft text')
  })

  test('handles empty themes array', () => {
    const result = renderCritiquePrompt(template, 'Draft', { themes: [] })
    expect(result).toContain('(none)')
  })

  test('returns empty string for null template', () => {
    expect(renderCritiquePrompt(null, 'Draft', {})).toBe('')
  })

  test('returns empty string for null draft', () => {
    expect(renderCritiquePrompt(template, null, {})).toBe('')
  })
})

// ── renderRevisionPrompt ────────────────────────────────

describe('renderRevisionPrompt', () => {
  const template = 'Original:\n\n{draft}\n\nCritique:\n\n{critique}\n\nWeek: {week}'

  test('replaces all placeholders', () => {
    const result = renderRevisionPrompt(template, 'Draft text', 'Critique feedback', { week: 12 })
    expect(result).toContain('Draft text')
    expect(result).toContain('Critique feedback')
    expect(result).toContain('12')
  })

  test('handles missing week', () => {
    const result = renderRevisionPrompt(template, 'Draft', 'Critique')
    expect(result).toContain('Week: (current)')
  })

  test('handles empty critique', () => {
    const result = renderRevisionPrompt(template, 'Draft', '')
    expect(result).toContain('Original:\n\nDraft')
    expect(result).toContain('Critique:\n\n')
  })

  test('returns empty string for null template', () => {
    expect(renderRevisionPrompt(null, 'Draft', 'Critique')).toBe('')
  })

  test('returns empty string for null draft', () => {
    expect(renderRevisionPrompt(template, null, 'Critique')).toBe('')
  })
})

// ── buildDraftArtifact ──────────────────────────────────

describe('buildDraftArtifact', () => {
  test('builds complete artifact from full data', () => {
    const artifact = buildDraftArtifact({
      initialDraft: '## tl;dr\n\nInitial',
      finalDraft: '## tl;dr\n\nRevised',
      critiques: {
        gemini: { raw: 'Gemini feedback', error: null },
        openai: { raw: 'GPT feedback', error: null },
        merged: 'Combined feedback',
      },
      metrics: {
        initial: { wordCount: 100, sectionCount: 1, readingTimeMinutes: 0.4, sectionWordCounts: {}, averageSectionWords: 100 },
        final: { wordCount: 120, sectionCount: 1, readingTimeMinutes: 0.5, sectionWordCounts: {}, averageSectionWords: 120 },
      },
      session: 16,
      timestamp: '2026-03-21T12:00:00.000Z',
      costs: { opus: { calls: 2, cost: 3.4 }, gemini: { calls: 1, cost: 0.1 }, openai: { calls: 1, cost: 0.1 }, total: 3.6 },
    })

    expect(artifact.version).toBe(1)
    expect(artifact.session).toBe(16)
    expect(artifact.initialDraft).toContain('Initial')
    expect(artifact.finalDraft).toContain('Revised')
    expect(artifact.critiques.merged).toContain('Combined')
    expect(artifact.metrics.initial.wordCount).toBe(100)
    expect(artifact.costs.total).toBe(3.6)
  })

  test('builds artifact with minimal data (skip-critique mode)', () => {
    const artifact = buildDraftArtifact({
      initialDraft: '## tl;dr\n\nDraft',
      finalDraft: '## tl;dr\n\nDraft',
      critiques: { gemini: null, openai: null, merged: '' },
      metrics: {
        initial: { wordCount: 50, sectionCount: 1, readingTimeMinutes: 0.2, sectionWordCounts: {}, averageSectionWords: 50 },
        final: { wordCount: 50, sectionCount: 1, readingTimeMinutes: 0.2, sectionWordCounts: {}, averageSectionWords: 50 },
      },
      session: 16,
      timestamp: '2026-03-21T12:00:00.000Z',
      costs: { opus: { calls: 1, cost: 1.5 }, gemini: { calls: 0, cost: 0 }, openai: { calls: 0, cost: 0 }, total: 1.5 },
    })

    expect(artifact.version).toBe(1)
    expect(artifact.initialDraft).toBe(artifact.finalDraft)
    expect(artifact.critiques.merged).toBe('')
  })

  test('includes timestamp and session in output', () => {
    const artifact = buildDraftArtifact({
      initialDraft: 'draft',
      finalDraft: 'draft',
      critiques: { gemini: null, openai: null, merged: '' },
      metrics: { initial: {}, final: {} },
      session: 42,
      timestamp: '2026-03-21T15:30:00.000Z',
      costs: { total: 0 },
    })
    expect(artifact.session).toBe(42)
    expect(artifact.timestamp).toBe('2026-03-21T15:30:00.000Z')
  })
})
