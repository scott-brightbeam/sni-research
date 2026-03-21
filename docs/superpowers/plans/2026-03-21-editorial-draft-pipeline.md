# Editorial DRAFT Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the DRAFT pipeline that generates the weekly SNI newsletter via Opus generate → Gemini+GPT critique → Opus revise.

**Architecture:** Pure business logic in `editorial-draft-lib.js` (no I/O), orchestration in `editorial-draft.js` (CLI, LLM calls, file I/O). Prompt templates in `config/prompts/`. Web API route for reading draft artifacts.

**Tech Stack:** Bun 1.3.9, ES modules, `bun:test`, Anthropic SDK, Google GenAI SDK, OpenAI SDK.

**Spec:** `docs/superpowers/specs/2026-03-21-editorial-draft-pipeline-design.md`

---

## File structure

| File | Action | Responsibility |
|------|--------|----------------|
| `config/prompts/editorial-draft.v1.txt` | Create | Draft generation instructions for Opus |
| `config/prompts/editorial-critique.v1.txt` | Create | Critique instructions for Gemini + GPT |
| `config/prompts/editorial-revise.v1.txt` | Create | Revision instructions for Opus |
| `scripts/lib/editorial-draft-lib.js` | Create | Pure business logic (8 exported functions) |
| `scripts/lib/editorial-draft-lib.test.js` | Create | Tests for all pure functions |
| `scripts/editorial-draft.js` | Create | Orchestrator (CLI, I/O, LLM calls) |
| `web/api/routes/editorial.js` | Modify | Add `getEditorialDraft()` |
| `web/api/server.js` | Modify | Add route for `/api/editorial/draft` |
| `web/api/tests/editorial.test.js` | Modify | Add tests for draft endpoint |

---

### Task 1: Create prompt templates

**Files:**
- Create: `config/prompts/editorial-draft.v1.txt`
- Create: `config/prompts/editorial-critique.v1.txt`
- Create: `config/prompts/editorial-revise.v1.txt`

These are config files (not code), so no TDD needed. They use `{placeholder}` syntax compatible with `loadAndRenderPrompt()`.

- [ ] **Step 1: Create editorial-draft.v1.txt**

```text
Produce a complete newsletter draft for Second Nature Intelligence (SNI), Week {week}.

OUTPUT FORMAT: Output ONLY the newsletter markdown. No preamble, no code fences, no 'Here is the draft' — start directly with the first heading.

STRUCTURE (use ## headings exactly as shown):

## tl;dr

A two to three paragraph introduction that identifies this week's through-line by synthesising across ALL sections below. Do not summarise individual sections — find the connecting thread. What shift, tension or pattern links the AI news, the sector developments and the podcast analysis this week?

## AI & Technology

The primary section covering general AI developments. Draw from analysis entries tagged with general-ai themes. Lead with the most significant development. Each item should explain what happened AND why it matters for enterprise AI adoption. Three to five items, each one to two paragraphs.

## Biopharma

AI developments in pharmaceutical and biotech. Draw from analysis entries tagged with biopharma themes. Two to four items. If insufficient material, note 'Quiet week for biopharma AI' and highlight one relevant cross-sector development.

## Medtech

AI in medical technology and healthcare delivery. Draw from analysis entries tagged with medtech themes. Two to four items. Same approach as biopharma if material is thin.

## Manufacturing

AI in manufacturing, robotics, supply chain. Draw from analysis entries tagged with manufacturing themes. Two to four items.

## Insurance

AI in insurance, risk, compliance. Draw from analysis entries tagged with insurance themes. Two to four items.

## Podcast Analysis

This section synthesises insights from podcast sources in the analysis index. Do NOT recap individual episodes. Instead:
- Identify cross-episode themes (what are multiple hosts/guests converging on?)
- Surface tensions or contradictions between different podcast perspectives
- Extract the most actionable insights for enterprise leaders
- Name specific data points, quotes or examples from the analysis entries

Look for analysis entries where the source matches known podcast names (AI Daily Brief, Cognitive Revolution, Moonshots, No Priors, Big Technology, etc.).

STYLE RULES:
- Follow all writing style rules from the editorial prompt (UK English, spaced en-dashes, single quotes, active voice, no prohibited language)
- Evidence before labels — show the data point, then explain what it means
- Be analytical, not descriptive — explain mechanisms, tensions and implications
- Every section must contain at least one specific data point, quote or named example
- Cross-reference between sections where themes connect
```

- [ ] **Step 2: Create editorial-critique.v1.txt**

```text
You are reviewing a draft newsletter for Second Nature Intelligence (SNI), a weekly AI newsletter targeting senior enterprise leaders.

Here is the draft to critique:

---
{draft}
---

The newsletter covers these themes: {themes}

Expected sections: {sections}

Evaluate this draft against these criteria. For each issue found, specify the section and provide a concrete suggestion for improvement.

1. STRUCTURE — Are all expected sections present? Is the flow logical? Does the tl;dr introduction synthesise across sections rather than summarising them?

2. VOICE — Does it match the editorial voice: analytical, evidence-driven, practitioner perspective? Check for prohibited language: 'leverage', 'robust', 'landscape', 'game-changer', 'paradigm shift', 'delve', 'ecosystem', false contrast ('Not X but Y'), rhetorical question + immediate answer, signposting overkill.

3. ANALYSIS QUALITY — Does each item explain WHY something matters, not just WHAT happened? Is there evidence before labels? Are claims specific (named sources, data points, examples) rather than generic?

4. SYNTHESIS — Does the tl;dr connect themes across sections? Are there missed cross-references between sectors?

5. PODCAST SECTION — Is this analytical synthesis across episodes, or individual episode recaps? Does it surface cross-podcast tensions and convergences?

6. ACCURACY — Are there unsupported claims? Misattributed quotes? Fabricated statistics?

7. COMPLETENESS — Given the analysis entries provided as context, has important material been overlooked?

Format your response as numbered critique points:

1. [SECTION: section name] [SEVERITY: high/medium/low] Issue description. Suggested fix.
2. ...
```

- [ ] **Step 3: Create editorial-revise.v1.txt**

```text
You are revising a newsletter draft based on critique feedback from two independent reviewers.

Here is the original draft:

---
{draft}
---

Here is the merged critique:

---
{critique}
---

REVISION INSTRUCTIONS:
- Apply critique feedback selectively. Not all feedback is correct — use editorial judgement.
- Prioritise high-severity issues. Medium issues if they genuinely improve the draft.
- Maintain the editorial voice throughout. Do not introduce prohibited language during revision.
- Preserve what works. Fix what does not. Do not rewrite sections that received no criticism.
- If a critique point asks for information you do not have, note it as '[Editorial note: verify X]' rather than fabricating.

OUTPUT FORMAT: Output ONLY the revised newsletter markdown. No preamble, no code fences, no explanation of changes — start directly with the first heading.
```

- [ ] **Step 4: Commit**

```bash
git add config/prompts/editorial-draft.v1.txt config/prompts/editorial-critique.v1.txt config/prompts/editorial-revise.v1.txt
git commit -m "Add prompt templates for DRAFT pipeline (generate, critique, revise)"
```

---

### Task 2: TDD extractDraftMarkdown

**Files:**
- Create: `scripts/lib/editorial-draft-lib.test.js`
- Create: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests for extractDraftMarkdown**

```javascript
/**
 * editorial-draft-lib.test.js — Tests for DRAFT pipeline business logic
 *
 * Pure function tests for draft extraction, section parsing, validation,
 * metrics, critique merging, prompt rendering, and artifact building.
 */

import { describe, test, expect } from 'bun:test'
import { extractDraftMarkdown } from './editorial-draft-lib.js'

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

  test('preserves postamble after last section', () => {
    const raw = '## tl;dr\n\nContent\n\n---\n\n*Published by SNI*'
    expect(extractDraftMarkdown(raw)).toBe(raw)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

Expected: FAIL — module `./editorial-draft-lib.js` not found or `extractDraftMarkdown` not exported.

- [ ] **Step 3: Implement extractDraftMarkdown**

Create `scripts/lib/editorial-draft-lib.js`:

```javascript
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

// ── Draft extraction ─────────────────────────────────────

/**
 * Extract clean markdown from Opus response text.
 * Strips preamble, code fences, and other wrapping.
 *
 * @param {string|null|undefined} rawResponse
 * @returns {string} — clean markdown
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add extractDraftMarkdown with tests (DRAFT pipeline TDD step 1)"
```

---

### Task 3: TDD parseDraftSections

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests for parseDraftSections**

Add to test file:

```javascript
import { extractDraftMarkdown, parseDraftSections } from './editorial-draft-lib.js'

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
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

Expected: parseDraftSections tests fail.

- [ ] **Step 3: Implement parseDraftSections**

Add to `editorial-draft-lib.js`:

```javascript
/**
 * Match a heading string to a canonical section name.
 * @param {string} heading
 * @returns {string|null} — canonical section name or null
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

/**
 * Parse newsletter markdown into labelled sections.
 *
 * @param {string} markdown
 * @returns {{ sections: Array<{ name: string, heading: string, content: string, wordCount: number }>, unmatched: string[] }}
 */
export function parseDraftSections(markdown) {
  if (!markdown || !markdown.trim()) {
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add parseDraftSections with tests (DRAFT pipeline TDD step 2)"
```

---

### Task 4: TDD validateDraftStructure

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { extractDraftMarkdown, parseDraftSections, validateDraftStructure, NEWSLETTER_SECTIONS } from './editorial-draft-lib.js'

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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

- [ ] **Step 3: Implement validateDraftStructure**

```javascript
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

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test scripts/lib/editorial-draft-lib.test.js
```

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add validateDraftStructure with tests (DRAFT pipeline TDD step 3)"
```

---

### Task 5: TDD calculateDraftMetrics

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { ..., calculateDraftMetrics } from './editorial-draft-lib.js'

describe('calculateDraftMetrics', () => {
  test('calculates metrics for a normal draft', () => {
    const md = '## tl;dr\n\n' + 'Word '.repeat(100) + '\n\n## AI & Technology\n\n' + 'Word '.repeat(200)
    const metrics = calculateDraftMetrics(md)
    expect(metrics.wordCount).toBe(300)
    expect(metrics.sectionCount).toBe(2)
    expect(metrics.readingTimeMinutes).toBeCloseTo(1.2, 1)
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

  test('handles markdown with no recognised sections', () => {
    const md = 'Just some text with no headings.'
    const metrics = calculateDraftMetrics(md)
    expect(metrics.wordCount).toBe(7)
    expect(metrics.sectionCount).toBe(0)
    expect(metrics.sectionWordCounts).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement calculateDraftMetrics**

```javascript
/**
 * Calculate quality metrics for a draft.
 *
 * @param {string} markdown
 * @returns {{ wordCount: number, sectionCount: number, readingTimeMinutes: number, sectionWordCounts: Record<string, number>, averageSectionWords: number }}
 */
export function calculateDraftMetrics(markdown) {
  if (!markdown || !markdown.trim()) {
    return { wordCount: 0, sectionCount: 0, readingTimeMinutes: 0, sectionWordCounts: {}, averageSectionWords: 0 }
  }

  const wordCount = countWords(markdown)
  const parsed = parseDraftSections(markdown)
  const sectionCount = parsed.sections.length

  const sectionWordCounts = {}
  for (const section of parsed.sections) {
    sectionWordCounts[section.name] = section.wordCount
  }

  const averageSectionWords = sectionCount > 0
    ? Math.round(parsed.sections.reduce((sum, s) => sum + s.wordCount, 0) / sectionCount)
    : 0

  return {
    wordCount,
    sectionCount,
    readingTimeMinutes: Math.round((wordCount / 250) * 10) / 10,
    sectionWordCounts,
    averageSectionWords,
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add calculateDraftMetrics with tests (DRAFT pipeline TDD step 4)"
```

---

### Task 6: TDD mergeCritiques

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { ..., mergeCritiques } from './editorial-draft-lib.js'

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
})
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement mergeCritiques**

```javascript
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
```

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add mergeCritiques with tests (DRAFT pipeline TDD step 5)"
```

---

### Task 7: TDD renderCritiquePrompt and renderRevisionPrompt

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { ..., renderCritiquePrompt, renderRevisionPrompt } from './editorial-draft-lib.js'

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
})

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
})
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement renderCritiquePrompt and renderRevisionPrompt**

```javascript
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
```

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add renderCritiquePrompt and renderRevisionPrompt with tests (DRAFT pipeline TDD step 6)"
```

---

### Task 8: TDD buildDraftArtifact

**Files:**
- Modify: `scripts/lib/editorial-draft-lib.test.js`
- Modify: `scripts/lib/editorial-draft-lib.js`

- [ ] **Step 1: Write failing tests**

```javascript
import { ..., buildDraftArtifact } from './editorial-draft-lib.js'

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
})
```

- [ ] **Step 2: Run tests — verify they fail**

- [ ] **Step 3: Implement buildDraftArtifact**

```javascript
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
```

- [ ] **Step 4: Run tests — verify they pass**

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/editorial-draft-lib.js scripts/lib/editorial-draft-lib.test.js
git commit -m "Add buildDraftArtifact with tests (DRAFT pipeline TDD step 7)"
```

---

### Task 9: Build orchestrator

**Files:**
- Create: `scripts/editorial-draft.js`

This is the orchestration script with CLI, I/O, LLM calls, lock files. Not TDD (side effects and LLM calls), but structured following the ANALYSE and DISCOVER orchestrator patterns.

- [ ] **Step 1: Create editorial-draft.js**

Create the full orchestrator at `scripts/editorial-draft.js`. Key sections:

1. **Imports** — from editorial-state, editorial-context, editorial-multi-model, editorial-draft-lib, prompt-loader
2. **CLI parsing** — `--week N`, `--session N`, `--dry-run`, `--skip-critique`, `--force`
3. **Lock file functions** — `acquireLock()`, `updateLock()`, `releaseLock()` (copy pattern from editorial-discover.js)
4. **Week resolution** — ISO 8601 week from current date if not specified
5. **Session resolution** — `state.counters.nextSession - 1` if not specified
6. **Draft existence check** — scan `data/editorial/drafts/` for matching session
7. **Main flow** — the 18-step flow from the spec
8. **Cost logging** — same pattern as editorial-analyse.js

Reference files:
- `scripts/editorial-discover.js` lines 1-60 (lock pattern)
- `scripts/editorial-analyse.js` lines 268-321 (cost logging)
- `scripts/lib/editorial-context.js` lines 232-294 (buildDraftContext)

```javascript
#!/usr/bin/env bun
/**
 * editorial-draft.js — DRAFT stage of the editorial intelligence pipeline
 *
 * Generates the weekly SNI newsletter via a three-model flow:
 *   1. Opus 4.6 generates the initial draft
 *   2. Gemini 3.1 Pro + GPT-5.4 critique in parallel
 *   3. Opus 4.6 revises based on merged critique
 *
 * Usage:
 *   bun scripts/editorial-draft.js                   # Generate draft for current week
 *   bun scripts/editorial-draft.js --week N          # Generate for specific week
 *   bun scripts/editorial-draft.js --session N       # Use specific session number
 *   bun scripts/editorial-draft.js --dry-run         # Show context stats, no LLM calls
 *   bun scripts/editorial-draft.js --skip-critique   # Generate only, skip critique/revise
 *   bun scripts/editorial-draft.js --force           # Overwrite existing draft
 *
 * Reads:  data/editorial/state.json, config/prompts/editorial-*.txt,
 *         config/editorial-sources.yaml
 * Writes: data/editorial/drafts/draft-session-{N}-*.md,
 *         data/editorial/drafts/critique-session-{N}.json,
 *         data/editorial/drafts/metrics-session-{N}.json,
 *         data/editorial/cost-log.json, data/editorial/activity.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import {
  loadState,
  logActivity,
} from './lib/editorial-state.js'
import { buildDraftContext, buildSystemPrompt } from './lib/editorial-context.js'
import {
  callOpus,
  callCritiqueModels,
  getSessionCosts,
  resetSessionCosts,
  validateProviders,
} from './lib/editorial-multi-model.js'
import {
  extractDraftMarkdown,
  parseDraftSections,
  validateDraftStructure,
  calculateDraftMetrics,
  mergeCritiques,
  renderCritiquePrompt,
  renderRevisionPrompt,
  buildDraftArtifact,
} from './lib/editorial-draft-lib.js'

const ROOT = resolve(import.meta.dir, '..')
const EDITORIAL_DIR = join(ROOT, 'data/editorial')
const DRAFTS_DIR = join(EDITORIAL_DIR, 'drafts')
const LOCK_PATH = join(EDITORIAL_DIR, '.draft.lock')
const LOCK_STALE_MS = 30 * 60 * 1000 // 30 minutes

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [draft]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [draft] ⚠`, ...a)
const err  = (...a) => console.error(`[${ts()}] [draft] ✗`, ...a)

// ... (full implementation follows the spec's 18-step flow)
// See editorial-discover.js for lock pattern, editorial-analyse.js for cost logging
```

The full implementation should be approximately 350-450 lines, following the patterns established in the ANALYSE and DISCOVER orchestrators. The agent implementing this task should read the spec and both reference orchestrators in full.

- [ ] **Step 2: Verify no syntax errors**

```bash
bun --print "import './scripts/editorial-draft.js'" 2>&1 | head -5
```

Note: this will likely fail due to missing API keys or state, but should not have syntax/import errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/editorial-draft.js
git commit -m "Add editorial-draft.js orchestrator (DRAFT pipeline)"
```

---

### Task 10: Add web API route for editorial draft

**Files:**
- Modify: `web/api/routes/editorial.js`
- Modify: `web/api/server.js`
- Modify: `web/api/tests/editorial.test.js`

- [ ] **Step 1: Write failing tests**

Add to `web/api/tests/editorial.test.js`:

```javascript
import { getEditorialDraft } from '../routes/editorial.js'

describe('getEditorialDraft', () => {
  test('returns null for non-existent session', async () => {
    const result = await getEditorialDraft({ session: 999 })
    expect(result.draft).toBeNull()
  })

  test('returns null when no drafts exist', async () => {
    const result = await getEditorialDraft({})
    expect(result.session).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test web/api/tests/editorial.test.js
```

- [ ] **Step 3: Implement getEditorialDraft**

Add to `web/api/routes/editorial.js`:

```javascript
// ── GET /api/editorial/draft ────────────────────────────

export async function getEditorialDraft({ session } = {}) {
  const draftsDir = join(EDITORIAL_DIR, 'drafts')
  if (!existsSync(draftsDir)) return { session: null, draft: null, critique: null, metrics: null }

  let sessionNum = session ? parseInt(session, 10) : null

  // Find latest session if not specified
  if (sessionNum == null) {
    const files = readdirSync(draftsDir)
      .filter(f => /^draft-session-\d+-final\.md$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)[0], 10)
        const numB = parseInt(b.match(/\d+/)[0], 10)
        return numA - numB
      })
    if (files.length === 0) return { session: null, draft: null, critique: null, metrics: null }
    const latest = files[files.length - 1]
    sessionNum = parseInt(latest.match(/\d+/)[0], 10)
  }

  const draftPath = join(draftsDir, `draft-session-${sessionNum}-final.md`)
  const critiquePath = join(draftsDir, `critique-session-${sessionNum}.json`)
  const metricsPath = join(draftsDir, `metrics-session-${sessionNum}.json`)

  const draft = existsSync(draftPath) ? readFileSync(draftPath, 'utf-8') : null
  const critique = readJSON(critiquePath)
  const metrics = readJSON(metricsPath)

  return { session: sessionNum, draft, critique, metrics }
}
```

Add route to `web/api/server.js`:

```javascript
if (path === '/api/editorial/draft' && req.method === 'GET') {
  const result = await getEditorialDraft({ session: url.searchParams.get('session') })
  return Response.json(result)
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test web/api/tests/editorial.test.js
```

- [ ] **Step 5: Run full test suite**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test
```

Expected: all tests pass (existing + new).

- [ ] **Step 6: Commit**

```bash
git add web/api/routes/editorial.js web/api/server.js web/api/tests/editorial.test.js
git commit -m "Add web API route for editorial draft (GET /api/editorial/draft)"
```

---

### Task 11: Final verification and code review

- [ ] **Step 1: Run complete test suite**

```bash
cd /Users/scott/Projects/sni-research-v2 && bun test
```

All tests must pass. Record counts.

- [ ] **Step 2: Verify dry-run works**

```bash
bun scripts/editorial-draft.js --dry-run
```

Should show context stats without making LLM calls (or exit gracefully if state.json is missing).

- [ ] **Step 3: Verify file structure**

```bash
ls -la config/prompts/editorial-*.txt
ls -la scripts/editorial-draft.js
ls -la scripts/lib/editorial-draft-lib.js
ls -la scripts/lib/editorial-draft-lib.test.js
```

- [ ] **Step 4: Code review**

Dispatch code review agents to verify:
- Pure lib has no I/O (no `readFileSync`, no `writeFileSync`)
- Orchestrator follows ANALYSE/DISCOVER patterns
- Error handling covers all abort paths
- Lock file mechanism matches DISCOVER
- Cost logging matches ANALYSE pattern
- All new exports are tested

- [ ] **Step 5: Final commit**

If any review fixes were needed, commit them.
