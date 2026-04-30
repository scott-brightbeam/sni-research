/**
 * editorial-principles.test.js — Unit tests for the shared principles
 * module. Asserts the canary phrases that every dependent prompt
 * assumes are present, plus deterministic behaviour of sector
 * detection and prompt composition.
 */

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
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
} from './editorial-principles.js'

const ROOT = resolve(import.meta.dir, '../..')

// ── Sector detection ──────────────────────────────────────

describe('SECTORS', () => {
  test('canonical order with general-ai first', () => {
    expect(SECTORS[0]).toBe('general-ai')
    expect(SECTORS).toContain('biopharma')
    expect(SECTORS).toContain('medtech')
    expect(SECTORS).toContain('manufacturing')
    expect(SECTORS).toContain('insurance')
    expect(SECTORS).toHaveLength(5)
  })
})

describe('SECTOR_PATTERNS', () => {
  test('a regex for every sector in SECTORS', () => {
    for (const s of SECTORS) {
      expect(SECTOR_PATTERNS[s]).toBeInstanceOf(RegExp)
    }
  })
})

describe('SECTOR_CEO_LABELS', () => {
  test('a label for every sector in SECTORS', () => {
    for (const s of SECTORS) {
      expect(typeof SECTOR_CEO_LABELS[s]).toBe('string')
      expect(SECTOR_CEO_LABELS[s].toLowerCase()).toContain('ceo')
    }
  })
})

describe('detectSectors', () => {
  test('defaults to general-ai for empty/null', () => {
    expect(detectSectors('')).toEqual(['general-ai'])
    expect(detectSectors(null)).toEqual(['general-ai'])
    expect(detectSectors(undefined)).toEqual(['general-ai'])
  })

  test('identifies biopharma from clinical-trial terms', () => {
    expect(detectSectors('Pfizer launched a Phase 3 clinical trial')).toContain('biopharma')
  })

  test('identifies manufacturing from industrial terms', () => {
    expect(detectSectors('Factory floor OEE on the assembly line')).toContain('manufacturing')
  })

  test('multi-sector returns in canonical order', () => {
    const sectors = detectSectors('Munich Re underwrites policies for Pfizer using Anthropic models')
    expect(sectors).toContain('insurance')
    expect(sectors).toContain('biopharma')
    expect(sectors).toContain('general-ai')
    const indices = sectors.map(s => SECTORS.indexOf(s))
    const sorted = [...indices].sort((a, b) => a - b)
    expect(indices).toEqual(sorted)
  })
})

// ── Evidence calibration ──────────────────────────────────

describe('buildEvidenceCalibrationSection', () => {
  const section = buildEvidenceCalibrationSection()

  test('mentions EVIDENCE CALIBRATION header', () => {
    expect(section).toContain('EVIDENCE CALIBRATION')
  })

  test('includes the attribution test', () => {
    expect(section).toContain('ATTRIBUTION TEST')
    expect(section.toLowerCase()).toContain('pseudonymous')
    expect(section.toLowerCase()).toContain('leave the podcast and podcaster out')
  })

  test('includes the voicing ladder', () => {
    expect(section).toContain('VOICING LADDER')
    expect(section.toLowerCase()).toContain('common-ground framing')
    expect(section.toLowerCase()).toContain('beyond three levels of inference')
    expect(section.toLowerCase()).toContain('cut')
  })

  test('declares source-document claims are not gospel', () => {
    expect(section).toContain('SOURCE-DOCUMENT CLAIMS ARE NOT GOSPEL')
    expect(section.toLowerCase()).toContain('attribution test and the voicing ladder')
  })

  test('enforces the ITEATE-earns-directness rule', () => {
    expect(section).toContain('ITEATE EARNS ITS DIRECTNESS')
    expect(section.toLowerCase()).toContain('multiple threads in the body converged')
  })

  test('caps quotes from non-attributable sources', () => {
    expect(section.toLowerCase()).toContain('direct quotes are rare')
    expect(section.toLowerCase()).toContain('paraphrased')
  })
})

// ── Must-catch patterns ───────────────────────────────────

describe('buildMustCatchPatternsSection', () => {
  const section = buildMustCatchPatternsSection()

  test('lists all 14 numbered patterns', () => {
    for (let i = 1; i <= 14; i++) {
      expect(section).toContain(`${i}.`)
    }
  })

  test('bans matters as word AND construct (#14)', () => {
    expect(section).toContain("'MATTERS' BAN")
    expect(section.toLowerCase()).toContain('do not fix this by substitution')
    expect(section.toLowerCase()).toContain('cut')
  })

  test('bans first-person narrator (#1)', () => {
    expect(section.toLowerCase()).toContain('first-person narrator')
    expect(section.toLowerCase()).toContain('i keep thinking')
  })

  test('bans podcast framing (#2)', () => {
    expect(section.toLowerCase()).toContain('podcast')
    expect(section.toLowerCase()).toContain('never foreground the medium')
  })

  test('bans false contrasts (#3)', () => {
    expect(section).toContain('FALSE CONTRASTS')
    expect(section).toContain("Not X but Y")
    expect(section.toLowerCase()).toContain("isn't just y")
  })

  test('bans forced tripling (#4)', () => {
    expect(section).toContain('FORCED TRIPLING')
    expect(section.toLowerCase()).toContain('three short clauses')
  })

  test('bans clickbait titles (#6)', () => {
    expect(section).toContain('CLICKBAIT TITLES')
    expect(section.toLowerCase()).toContain('the x nobody talks about')
  })

  test('bans hollow intensifiers (#8)', () => {
    expect(section.toLowerCase()).toContain('hollow intensifiers')
    expect(section.toLowerCase()).toContain('incredibly, fundamentally')
  })
})

// ── CEO empathy section ───────────────────────────────────

describe('buildCEOEmpathySection', () => {
  const section = buildCEOEmpathySection()

  test('teaches all four lenses', () => {
    expect(section).toContain('SYSTEMIC vs SPECIFIC')
    expect(section).toContain('CONTROL')
    expect(section).toContain('EMPATHY')
    expect(section).toContain('NAIVETY')
  })

  test('frames responsibility as systemic not specific', () => {
    expect(section.toLowerCase()).toContain('systemic, not specific')
    expect(section.toLowerCase()).toMatch(/incentives|markets|structural|capital allocation/)
  })

  test('flags criticism outside executive control', () => {
    expect(section.toLowerCase()).toMatch(/outside.*control|cannot.*change|inherit/)
    expect(section.toLowerCase()).toMatch(/regulatory|capital|geopolitics|macro/)
  })
})

// ── CEO critique prompt ───────────────────────────────────

describe('buildCEOCritiquePrompt', () => {
  test('addresses the model as the relevant industry CEO', () => {
    expect(buildCEOCritiquePrompt('biopharma')).toContain('CEO of a global pharmaceutical company')
    expect(buildCEOCritiquePrompt('manufacturing')).toContain('CEO of a global industrial manufacturer')
    expect(buildCEOCritiquePrompt('insurance')).toContain('CEO of a global insurance company')
    expect(buildCEOCritiquePrompt('medtech')).toContain('CEO of a global medical device manufacturer')
    expect(buildCEOCritiquePrompt('general-ai')).toContain('CEO of an AI-native technology company')
  })

  test('positions Brightbeam as wanting the CEO as a client', () => {
    const out = buildCEOCritiquePrompt('biopharma')
    expect(out).toContain('Brightbeam')
    expect(out.toLowerCase()).toContain('clients')
    expect(out.toLowerCase()).toContain('alienate')
  })

  test('embeds the empathy section verbatim', () => {
    const out = buildCEOCritiquePrompt('manufacturing')
    expect(out).toContain(buildCEOEmpathySection())
  })

  test('returns NO CHANGES marker for clean drafts', () => {
    expect(buildCEOCritiquePrompt('insurance')).toContain('NO CHANGES')
  })

  test('falls back gracefully for unknown sectors', () => {
    expect(buildCEOCritiquePrompt('aerospace')).toContain('CEO of a aerospace company')
  })
})

// ── CEO revision instruction ──────────────────────────────

describe('buildCEORevisionInstruction', () => {
  test('includes consolidated notes verbatim', () => {
    const notes = '### As CEO of a global pharmaceutical company:\n\n1. Note here.'
    expect(buildCEORevisionInstruction(notes)).toContain(notes)
  })

  test('preserves multi-draft format', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out.toLowerCase()).toContain('multi-draft preservation')
  })

  test('forbids re-introducing audit-banned patterns', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out).toContain('matters')
    expect(out.toLowerCase()).toContain('false contrast')
    expect(out.toLowerCase()).toContain('first-person narrator')
    expect(out.toLowerCase()).toContain('hollow intensifiers')
  })

  test('output must begin with ## Draft 1:', () => {
    const out = buildCEORevisionInstruction('(notes)')
    expect(out).toContain('## Draft 1:')
    expect(out.toLowerCase()).toMatch(/no preamble|do not narrate|nothing before/)
  })
})

// ── Prompt-drift canary ───────────────────────────────────
// The analyse prompt file on disk must stay in agreement with the
// shared principles module. If someone rewrites the module but
// forgets to update the prompt (or vice versa), these assertions
// catch it at test time — not months later in a Thursday sweep.

describe('config/prompts/editorial-analyse.v1.txt canary', () => {
  const promptPath = resolve(ROOT, 'config/prompts/editorial-analyse.v1.txt')
  let promptText = ''
  try { promptText = readFileSync(promptPath, 'utf-8') } catch { /* handled below */ }

  test('prompt file exists and is non-empty', () => {
    expect(promptText.length).toBeGreaterThan(500)
  })

  test('contains evidence calibration terms', () => {
    expect(promptText).toContain('EVIDENCE CALIBRATION')
    expect(promptText).toContain('ATTRIBUTION TEST')
    expect(promptText).toContain('VOICING LADDER')
    expect(promptText).toContain('SOURCE-DOCUMENT CLAIMS ARE NOT GOSPEL')
  })

  test('contains CEO empathy terms', () => {
    expect(promptText).toContain('CEO EMPATHY')
    expect(promptText).toContain('SYSTEMIC vs SPECIFIC')
    expect(promptText).toContain('CONTROL')
    expect(promptText).toContain('EMPATHY')
    expect(promptText).toContain('NAIVETY')
  })

  test('contains the matters ban and prohibited patterns', () => {
    expect(promptText.toLowerCase()).toContain("'matters'")
    expect(promptText.toLowerCase()).toContain('do not substitute')
    expect(promptText).toContain('PROHIBITED PATTERNS')
    expect(promptText.toLowerCase()).toContain('first-person narrator')
    expect(promptText.toLowerCase()).toContain('false contrasts')
    expect(promptText.toLowerCase()).toContain('hollow intensifiers')
    expect(promptText.toLowerCase()).toContain('clickbait titles')
  })

  test('the irony fix: prompt no longer contains "why it matters"', () => {
    // The previous version of this prompt (line 87) included
    // "why it matters" — the exact construct it's banning. This
    // test guards against regression to that state.
    expect(promptText.toLowerCase()).not.toContain('why it matters')
    expect(promptText.toLowerCase()).not.toContain('why this matters')
  })

  test('JSON schema block is preserved (downstream parser depends on it)', () => {
    expect(promptText).toContain('"analysisEntries"')
    expect(promptText).toContain('"themeUpdates"')
    expect(promptText).toContain('"crossConnections"')
    expect(promptText).toContain('"postCandidates"')
    expect(promptText).toContain('"storyReferences"')
  })
})
