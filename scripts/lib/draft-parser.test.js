import { describe, it, expect } from 'bun:test'
import { parseDraftSections } from './draft-parser.js'

const SAMPLE_DRAFT = `## AI

[OpenAI raised $110bn at a $300bn valuation](https://example.com/openai)

This was the biggest funding round in AI history, dwarfing previous records.

[Google DeepMind's new protein model](https://example.com/deepmind)

Researchers unveiled AlphaFold 3 with significant improvements.

## In Biopharma

### Recursion expands AI drug discovery platform

Recursion announced a major expansion of its AI-driven drug discovery capabilities.

### Insilico Medicine reaches Phase II trials

Insilico's AI-discovered drug candidate entered Phase II clinical trials.

## But what set podcast tongues a-wagging?

### AI agents replacing junior analysts

Several podcast hosts discussed the growing trend of AI agents in financial analysis.
`

describe('parseDraftSections', () => {
  it('extracts story entries from bare markdown links', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const openai = sections.find(s => s.heading.includes('OpenAI'))
    expect(openai).toBeDefined()
    expect(openai.heading).toBe('OpenAI raised $110bn at a $300bn valuation')
    expect(openai.urls).toContain('https://example.com/openai')
    expect(openai.body).toContain('biggest funding round')
    expect(openai.container).toBe('AI')
  })

  it('extracts story entries from H3 headings', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const recursion = sections.find(s => s.heading.includes('Recursion'))
    expect(recursion).toBeDefined()
    expect(recursion.container).toBe('Biopharma')
  })

  it('does not include container headers as story entries', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const containers = sections.filter(s => s.heading === 'AI' || s.heading === 'In Biopharma')
    expect(containers.length).toBe(0)
  })

  it('assigns podcast container correctly', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    const podcast = sections.find(s => s.heading.includes('AI agents'))
    expect(podcast).toBeDefined()
    expect(podcast.container).toContain('podcast')
  })

  it('returns array of {heading, body, urls, container} objects', () => {
    const sections = parseDraftSections(SAMPLE_DRAFT)
    expect(sections.length).toBeGreaterThan(0)
    for (const s of sections) {
      expect(s).toHaveProperty('heading')
      expect(s).toHaveProperty('body')
      expect(s).toHaveProperty('urls')
      expect(s).toHaveProperty('container')
      expect(Array.isArray(s.urls)).toBe(true)
    }
  })

  it('handles empty draft', () => {
    expect(parseDraftSections('')).toEqual([])
  })
})
