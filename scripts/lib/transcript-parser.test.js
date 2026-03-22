import { describe, it, expect } from 'bun:test'
import { parseTranscriptFrontmatter } from './transcript-parser.js'

const FULL_FRONTMATTER = `# How to Use Agent Skills

**Date:** 2026-03-18
**Source:** AI Daily Brief
**URL:** https://www.youtube.com/watch?v=abc123
**Duration:** 27 min
**Transcript source:** whisper-api (gpt-4o-mini-transcribe)

---

This is the transcript body...`

const NO_URL = `# Episode Title

**Date:** 2026-03-19
**Source:** Moonshots
**Duration:** 45 min
**Transcript source:** whisper-api

---

Body text here.`

const NEWSLETTER = `# EV Newsletter Issue 42

**Date:** 2026-03-18
**Source:** EV Newsletter
**Duration:** 10 min
**Transcript source:** newsletter

---

Newsletter content...`

const ON_DEMAND = `# Re-transcribed Episode

**Date:** 2026-03-18
**Source:** On-demand request
**Duration:** 30 min
**Transcript source:** whisper-api

---

Body...`

describe('parseTranscriptFrontmatter', () => {
  it('extracts all fields from complete frontmatter', () => {
    const result = parseTranscriptFrontmatter(FULL_FRONTMATTER)
    expect(result.title).toBe('How to Use Agent Skills')
    expect(result.date).toBe('2026-03-18')
    expect(result.source).toBe('AI Daily Brief')
    expect(result.url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(result.duration).toBe('27 min')
    expect(result.transcriptSource).toBe('whisper-api (gpt-4o-mini-transcribe)')
  })

  it('handles missing URL gracefully', () => {
    const result = parseTranscriptFrontmatter(NO_URL)
    expect(result.title).toBe('Episode Title')
    expect(result.url).toBeNull()
  })

  it('detects newsletter type', () => {
    const result = parseTranscriptFrontmatter(NEWSLETTER)
    expect(result.type).toBe('newsletter')
  })

  it('detects on-demand source', () => {
    const result = parseTranscriptFrontmatter(ON_DEMAND)
    expect(result.isOnDemand).toBe(true)
  })

  it('extracts body text after separator', () => {
    const result = parseTranscriptFrontmatter(FULL_FRONTMATTER)
    expect(result.body).toContain('This is the transcript body')
  })

  it('returns null for missing Date field', () => {
    const noDate = `# Title\n**Source:** Something\n---\nBody`
    const result = parseTranscriptFrontmatter(noDate)
    expect(result).toBeNull()
  })

  it('validates date is ISO format', () => {
    const badDate = `# Title\n**Date:** March 18\n**Source:** Something\n---\nBody`
    const result = parseTranscriptFrontmatter(badDate)
    expect(result).toBeNull()
  })

  it('warns on suspiciously short transcript', () => {
    const short = `# Long Episode\n**Date:** 2026-03-18\n**Source:** Test\n**Duration:** 47 min\n---\nShort.`
    const result = parseTranscriptFrontmatter(short)
    expect(result.warnings.some(w => w.includes('Suspiciously short'))).toBe(true)
  })
})
