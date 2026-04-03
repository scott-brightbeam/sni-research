import { describe, it, expect } from 'bun:test'
import { parseDraftSections } from '../lib/draft-parser.js'

describe('draft-parser (web/api/lib copy)', () => {
  it('parses H3 sections', () => {
    const md = `### Story One\nFirst paragraph.\n\n### Story Two\nSecond paragraph.`
    const sections = parseDraftSections(md)
    expect(sections).toHaveLength(2)
    expect(sections[0].heading).toBe('Story One')
    expect(sections[0].body).toBe('First paragraph.')
    expect(sections[1].heading).toBe('Story Two')
  })

  it('extracts URLs from bare links', () => {
    const md = `[Big Story](https://example.com/article)\nSome commentary.`
    const sections = parseDraftSections(md)
    expect(sections).toHaveLength(1)
    expect(sections[0].urls).toContain('https://example.com/article')
  })

  it('detects container sections', () => {
    const md = `## In Biopharma\n### Drug Discovery\nSome text.`
    const sections = parseDraftSections(md)
    expect(sections).toHaveLength(1)
    expect(sections[0].container).toBe('Biopharma')
  })

  it('returns empty array for empty input', () => {
    expect(parseDraftSections('')).toEqual([])
    expect(parseDraftSections('  ')).toEqual([])
  })

  it('extracts inline URLs from body text', () => {
    const md = `### Story\nRead more at (https://example.com/1) and (https://example.com/2).`
    const sections = parseDraftSections(md)
    expect(sections[0].urls).toContain('https://example.com/1')
    expect(sections[0].urls).toContain('https://example.com/2')
  })
})
