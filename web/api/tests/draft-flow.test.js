import { describe, it, expect } from 'bun:test'
import {
  buildDraftAddendum,
  detectDraftOutput,
  extractDraftContent,
  buildAuditSystemPrompt,
  buildRevisionInstruction,
  detectSectors,
  buildCEOCritiquePrompt,
  buildCEORevisionInstruction,
  SECTORS,
  SECTOR_CEO_LABELS,
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

  it('explicitly prohibits false contrasts (all variants)', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('FALSE CONTRASTS')
    expect(out).toContain("Not X but Y")
    expect(out.toLowerCase()).toContain("isn't just y")
  })

  it('explicitly flags forced tripling', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('FORCED TRIPLING')
    expect(out.toLowerCase()).toContain('three short clauses')
  })

  it('explicitly flags clickbait titles', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('CLICKBAIT TITLES')
    expect(out.toLowerCase()).toContain('the x nobody talks about')
  })

  it('enforces the attribution test (regression — pseudonymous sources must fail)', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('ATTRIBUTION TEST')
    expect(out.toLowerCase()).toContain('pseudonymous')
    expect(out.toLowerCase()).toContain('podcast')
    expect(out.toLowerCase()).toContain('leave the podcast and podcaster')
  })

  it('enforces the voicing ladder for evidence calibration', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('VOICING LADDER')
    expect(out.toLowerCase()).toContain('common-ground framing')
    expect(out.toLowerCase()).toContain('beyond three levels of inference')
    expect(out.toLowerCase()).toContain('cut')
  })

  it('treats source-document claims as not-automatically-true', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('SOURCE-DOCUMENT CLAIMS ARE NOT GOSPEL')
    expect(out.toLowerCase()).toContain('subject to the attribution test')
  })

  it('enforces ITEATE-earns-directness rule', () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain('ITEATE EARNS ITS DIRECTNESS')
    expect(out.toLowerCase()).toContain('multiple threads in the body converged')
  })

  it('caps quotes from non-attributable sources', () => {
    const out = buildAuditSystemPrompt()
    expect(out.toLowerCase()).toContain('direct quotes are rare')
    expect(out.toLowerCase()).toContain('paraphrased')
  })

  it("bans the word 'matters' AND the construct (no-substitution rule)", () => {
    const out = buildAuditSystemPrompt()
    expect(out).toContain("'MATTERS' BAN")
    expect(out.toLowerCase()).toContain('do not fix this by substitution')
    expect(out.toLowerCase()).toContain('cut')
  })
})

describe("buildRevisionInstruction — 'matters' verification", () => {
  it("includes 'matters' in the verify-before-returning checklist", () => {
    const out = buildRevisionInstruction('(corrections)')
    expect(out.toLowerCase()).toContain('"matters"')
    expect(out.toLowerCase()).toMatch(/cut the sentence|restructure/)
  })

  it('guards against reductive fragments (the 17 Apr tone bug)', () => {
    const out = buildAuditSystemPrompt()
    expect(out.toLowerCase()).toContain('reductive fragment chains')
  })

  it('guards against first-person narrator patterns (the voice bug)', () => {
    const out = buildAuditSystemPrompt()
    // Regression guard: the model kept producing "I keep thinking about..."
    // and similar first-person narrator patterns that appear nowhere in
    // Scott's canon. Audit must flag these every time.
    expect(out).toContain('First-person narrator')
    expect(out.toLowerCase()).toContain('i keep thinking')
  })

  it('guards against podcast-framing citations (the source bug)', () => {
    const out = buildAuditSystemPrompt()
    // Regression guard: drafts kept saying "on the a16z podcast this week,
    // signüll put the fix in concrete terms" — Scott never frames sources
    // that way.
    expect(out.toLowerCase()).toContain('podcast')
    expect(out.toLowerCase()).toContain('never foreground the medium')
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
    expect(out.toLowerCase()).toContain('multi-draft preservation')
  })

  it('includes a verification pass for prohibited patterns', () => {
    const out = buildRevisionInstruction('1. Fix false contrast')
    expect(out).toContain('VERIFY before returning')
    // Must list the specific patterns that were slipping through
    expect(out.toLowerCase()).toContain("not x but y")
    expect(out.toLowerCase()).toContain("x, not y")
    expect(out.toLowerCase()).toContain('clickbait titles')
  })

  it('prohibits preamble and inter-tool narrative in the output', () => {
    const out = buildRevisionInstruction('(corrections)')
    // Either the literal word "Preamble" or its concept must be present
    expect(out.toLowerCase()).toMatch(/preamble|narrate|begin with/)
    expect(out.toLowerCase()).toContain('inter-tool narrative')
  })

  it('includes the audit text verbatim', () => {
    const out = buildRevisionInstruction('1. Swap "leverage" for "use"')
    expect(out).toContain('1. Swap "leverage" for "use"')
  })
})

describe('detectSectors', () => {
  it('returns general-ai when no sector signal is present', () => {
    expect(detectSectors('A short observation about productivity at work.')).toEqual(['general-ai'])
  })

  it('returns general-ai for empty/null/undefined input', () => {
    expect(detectSectors('')).toEqual(['general-ai'])
    expect(detectSectors(null)).toEqual(['general-ai'])
    expect(detectSectors(undefined)).toEqual(['general-ai'])
  })

  it('detects biopharma from drug/clinical/pharma terms', () => {
    expect(detectSectors('Pfizer announced Phase 3 trial results for its oncology pipeline.')).toContain('biopharma')
    expect(detectSectors('Drug discovery costs continue to climb across pharmaceutical companies.')).toContain('biopharma')
  })

  it('detects medtech from medical-device terms', () => {
    expect(detectSectors('Medtronic secured FDA 510(k) clearance for the new cardiac monitor.')).toContain('medtech')
    expect(detectSectors('Hospital workflow integration for surgical robots remains complex.')).toContain('medtech')
  })

  it('detects manufacturing from industrial terms', () => {
    expect(detectSectors('Industry 4.0 adoption on the plant floor lifted OEE figures.')).toContain('manufacturing')
    expect(detectSectors('Foxconn restructured its supply chain for assembly line throughput.')).toContain('manufacturing')
  })

  it('detects insurance from underwriting/actuarial terms', () => {
    expect(detectSectors('Munich Re tightened its underwriting criteria after the loss ratio jumped.')).toContain('insurance')
    expect(detectSectors('Lloyds market reinsurers face actuarial pressure on cat models.')).toContain('insurance')
  })

  it('detects general-ai when only frontier-model terms are present', () => {
    expect(detectSectors('Anthropic released a new frontier model with a longer context window.')).toContain('general-ai')
  })

  it('detects multiple sectors when a draft spans them', () => {
    const text = 'Pfizer is using Anthropic frontier models for clinical trial design.'
    const sectors = detectSectors(text)
    expect(sectors).toContain('biopharma')
    expect(sectors).toContain('general-ai')
  })

  it('returns sectors in canonical order matching SECTORS', () => {
    const text = 'Munich Re collaborated with Medtronic and Pfizer on a foundation model project.'
    const sectors = detectSectors(text)
    const indices = sectors.map(s => SECTORS.indexOf(s))
    const sorted = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sorted)
  })
})

describe('SECTOR_CEO_LABELS', () => {
  it('has a label for every sector in SECTORS', () => {
    for (const s of SECTORS) {
      expect(typeof SECTOR_CEO_LABELS[s]).toBe('string')
      expect(SECTOR_CEO_LABELS[s].length).toBeGreaterThan(10)
      expect(SECTOR_CEO_LABELS[s].toLowerCase()).toContain('ceo')
    }
  })
})

describe('buildCEOCritiquePrompt', () => {
  it('addresses the model as the relevant industry CEO', () => {
    expect(buildCEOCritiquePrompt('biopharma')).toContain('CEO of a global pharmaceutical company')
    expect(buildCEOCritiquePrompt('manufacturing')).toContain('CEO of a global industrial manufacturer')
    expect(buildCEOCritiquePrompt('insurance')).toContain('CEO of a global insurance company')
    expect(buildCEOCritiquePrompt('medtech')).toContain('CEO of a global medical device manufacturer')
    expect(buildCEOCritiquePrompt('general-ai')).toContain('CEO of an AI-native technology company')
  })

  it('positions Brightbeam as wanting the CEO as a client', () => {
    const out = buildCEOCritiquePrompt('biopharma')
    expect(out).toContain('Brightbeam')
    expect(out.toLowerCase()).toMatch(/clients|client/)
    expect(out.toLowerCase()).toContain('alienate')
  })

  it('teaches all four lenses (systemic, control, empathy, naivety)', () => {
    const out = buildCEOCritiquePrompt('manufacturing')
    expect(out).toContain('SYSTEMIC vs SPECIFIC')
    expect(out).toContain('CONTROL')
    expect(out).toContain('EMPATHY')
    expect(out).toContain('NAIVETY')
  })

  it('frames responsibility as systemic, not specific', () => {
    const out = buildCEOCritiquePrompt('insurance')
    expect(out.toLowerCase()).toContain('systemic')
    expect(out.toLowerCase()).toContain('specific')
    expect(out.toLowerCase()).toMatch(/incentives|markets|structural|capital allocation/)
  })

  it('flags criticism of things outside executive control', () => {
    const out = buildCEOCritiquePrompt('medtech')
    expect(out.toLowerCase()).toMatch(/outside.*control|cannot.*change|inherit/)
    expect(out.toLowerCase()).toMatch(/regulatory|capital|geopolitics|macro/)
  })

  it('asks for specific corrections (quote + lens + replacement)', () => {
    const out = buildCEOCritiquePrompt('general-ai')
    expect(out.toUpperCase()).toContain('QUOTE')
    expect(out.toUpperCase()).toContain('PROPOSE')
  })

  it('returns NO CHANGES when nothing to flag', () => {
    const out = buildCEOCritiquePrompt('biopharma')
    expect(out).toContain('NO CHANGES')
  })

  it('falls back gracefully for unknown sector', () => {
    const out = buildCEOCritiquePrompt('aerospace')
    expect(out).toContain('CEO of a aerospace company')
  })
})

describe('buildCEORevisionInstruction', () => {
  it('includes the consolidated notes verbatim', () => {
    const notes = '### As CEO of a global pharmaceutical company:\n\n1. QUOTE: "the industry is finally waking up". This is patronising.'
    const out = buildCEORevisionInstruction(notes)
    expect(out).toContain(notes)
  })

  it('preserves multi-draft format', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out.toLowerCase()).toContain('multi-draft preservation')
    expect(out.toLowerCase()).toContain('preserve all of them')
  })

  it('forbids re-introducing the patterns the style audit just removed', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out).toContain('matters')
    expect(out.toLowerCase()).toContain('false contrast')
    expect(out.toLowerCase()).toContain('first-person narrator')
    expect(out.toLowerCase()).toContain('hollow intensifiers')
  })

  it('demands clean output beginning with `## Draft 1:`', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out).toContain('## Draft 1:')
    expect(out.toLowerCase()).toMatch(/no preamble|do not narrate|nothing before/)
  })

  it('frames the corrections as protecting the client relationship', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out.toLowerCase()).toContain('brightbeam')
    expect(out.toLowerCase()).toContain('clients')
  })
})
