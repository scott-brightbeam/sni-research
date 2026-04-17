import { describe, it, expect } from 'bun:test'
import {
  buildDraftAddendum,
  detectDraftOutput,
  extractDraftContent,
  buildAuditSystemPrompt,
  buildRevisionInstruction,
} from '../lib/draft-flow.js'

describe('buildDraftAddendum', () => {
  it('returns empty string when not in draft mode', () => {
    expect(buildDraftAddendum(false)).toBe('')
  })

  it('does NOT force "ONE complete draft" (regression guard — 17 Apr 2026 incident)', () => {
    const out = buildDraftAddendum(true)
    expect(out.toLowerCase()).not.toContain('one complete draft')
  })

  it('mentions THREE drafts as the default', () => {
    const out = buildDraftAddendum(true)
    expect(out.toLowerCase()).toMatch(/three drafts|three different|one of each format/)
  })

  it('requires an in-the-end-at-the-end closer', () => {
    const out = buildDraftAddendum(true)
    expect(out).toContain('in-the-end-at-the-end')
  })

  it('tells the model NOT to add preamble before the first draft', () => {
    const out = buildDraftAddendum(true)
    // Should tell the model to skip preamble / go straight into Draft 1
    expect(out.toLowerCase()).toMatch(/no preamble|straight into/)
  })

  it('explicitly tells the model to write drafts after tools (anti-stall guard)', () => {
    const out = buildDraftAddendum(true)
    // Regression guard: Sonnet 4 empirically stalled — ending the turn with
    // zero text after the tool-round budget. The addendum must include a
    // direct "WRITE THE DRAFTS" instruction.
    expect(out).toContain('WRITE THE DRAFTS')
    expect(out.toLowerCase()).toMatch(/do not end your turn|must contain the drafts/)
  })
})

describe('detectDraftOutput', () => {
  it('returns false when willAudit is false', () => {
    expect(detectDraftOutput('## DRAFT 1: News Decoder' + 'x'.repeat(400), { willAudit: false })).toBe(false)
  })

  it('returns false on short text', () => {
    expect(detectDraftOutput('## DRAFT 1: News Decoder', { willAudit: true })).toBe(false)
  })

  it('returns true on text containing in-the-end-at-the-end', () => {
    const text = 'Long text about something '.repeat(20) + ' So what is today\'s in-the-end-at-the-end? Something.'
    expect(detectDraftOutput(text, { willAudit: true })).toBe(true)
  })

  it('returns true on multi-draft header markers even without ITEATE', () => {
    const text = 'Something long '.repeat(30) + '\n\n## DRAFT 1: News Decoder\n\n**Title here**\n\nBody.'
    expect(detectDraftOutput(text, { willAudit: true })).toBe(true)
  })

  it('returns true on format-named markdown headers', () => {
    const text = 'Something long '.repeat(30) + '\n\n## News Decoder: The Price\n\nBody.'
    expect(detectDraftOutput(text, { willAudit: true })).toBe(true)
  })

  it('returns false on generic text even if long', () => {
    const text = 'This is a long conversation about the weather. '.repeat(20)
    expect(detectDraftOutput(text, { willAudit: true })).toBe(false)
  })
})

describe('extractDraftContent', () => {
  it('strips pre-draft tool narrative and keeps the draft headers onward', () => {
    const text = [
      "I'll start by gathering the source material for this post. Let me fetch the backlog item.",
      "Good, I have enough context. Let me now draft the three posts.",
      "---",
      "Here are three complete drafts, each in a different format.",
      "",
      "## DRAFT 1: News Decoder",
      "",
      "**The Price That Changes Everything**",
      "",
      "Body of draft one.",
    ].join('\n')

    const out = extractDraftContent(text)
    expect(out.startsWith('## DRAFT 1: News Decoder')).toBe(true)
    expect(out).not.toContain("I'll start by gathering")
    expect(out).not.toContain("Good, I have enough context")
  })

  it('handles FORMAT N markers', () => {
    const text = "Some preamble.\n\nMore preamble.\n\n## FORMAT 1: News Decoder\n\nBody."
    const out = extractDraftContent(text)
    expect(out.startsWith('## FORMAT 1: News Decoder')).toBe(true)
  })

  it('handles format-named headings without DRAFT/FORMAT prefix', () => {
    const text = "Let me fetch the source.\n\n## News Decoder\n\n**Title**\n\nBody."
    const out = extractDraftContent(text)
    expect(out.startsWith('## News Decoder')).toBe(true)
  })

  it('returns the original text when no draft markers are found', () => {
    const text = "This is a conversational reply with no drafts inside."
    expect(extractDraftContent(text)).toBe(text)
  })

  it('handles empty input', () => {
    expect(extractDraftContent('')).toBe('')
    expect(extractDraftContent(null)).toBe(null)
    expect(extractDraftContent(undefined)).toBe(undefined)
  })
})

describe('buildAuditSystemPrompt', () => {
  it('mentions multi-draft handling', () => {
    const out = buildAuditSystemPrompt()
    expect(out.toLowerCase()).toContain('multiple posts')
    expect(out.toLowerCase()).toContain('each one independently')
  })

  it('explicitly prohibits false contrasts', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('False contrast')
    expect(out.toLowerCase()).toContain('strictly prohibited')
  })

  it('guards against reductive fragments (the 17 Apr tone bug)', () => {
    const out = buildAuditSystemPrompt()
    expect(out.toLowerCase()).toContain('reductive short fragments')
  })

  it('embeds vocab section when provided', () => {
    const out = buildAuditSystemPrompt({ vocabSection: '\n\nScott prefers: "foo" (over "bar")' })
    expect(out).toContain('Scott prefers: "foo" (over "bar")')
  })
})

describe('buildRevisionInstruction', () => {
  it('preserves multiple drafts', () => {
    const out = buildRevisionInstruction('1. Fix false contrast')
    expect(out.toLowerCase()).toContain('preserve all of them')
    expect(out.toLowerCase()).toContain('do not collapse to a single draft')
  })

  it('prohibits preamble and inter-tool narrative in the output', () => {
    const out = buildRevisionInstruction('(corrections)')
    expect(out).toContain('Preamble')
    expect(out.toLowerCase()).toContain('inter-tool narrative')
  })

  it('includes the audit text verbatim', () => {
    const out = buildRevisionInstruction('1. Swap "leverage" for "use"')
    expect(out).toContain('1. Swap "leverage" for "use"')
  })
})
