import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const PUB_DIR = join(ROOT, 'output/published')

// Ensure clean state
beforeEach(() => {
  if (existsSync(PUB_DIR)) rmSync(PUB_DIR, { recursive: true, force: true })
  mkdirSync(PUB_DIR, { recursive: true })
})

afterAll(() => {
  if (existsSync(PUB_DIR)) rmSync(PUB_DIR, { recursive: true, force: true })
})

const { listPublished, getPublished, savePublished } = await import('./routes/published.js')

describe('listPublished', () => {
  it('returns empty array for empty directory', () => {
    const result = listPublished()
    expect(result).toEqual([])
  })

  it('returns sorted list of published newsletters', () => {
    writeFileSync(join(PUB_DIR, 'week-8.md'), '# Week 8')
    writeFileSync(join(PUB_DIR, 'week-8-meta.json'), JSON.stringify({ publishedDate: '2026-02-20', linkedinUrl: '' }))
    writeFileSync(join(PUB_DIR, 'week-10.md'), '# Week 10')
    writeFileSync(join(PUB_DIR, 'week-10-meta.json'), JSON.stringify({ publishedDate: '2026-03-06', linkedinUrl: 'https://linkedin.com/post/123' }))

    const result = listPublished()
    expect(result.length).toBe(2)
    expect(result[0].week).toBe('week-10')
    expect(result[1].week).toBe('week-8')
    expect(result[0].linkedinUrl).toBe('https://linkedin.com/post/123')
  })

  it('includes md files without meta', () => {
    writeFileSync(join(PUB_DIR, 'week-5.md'), '# Week 5')
    const result = listPublished()
    expect(result.length).toBe(1)
    expect(result[0].week).toBe('week-5')
  })
})

describe('getPublished', () => {
  it('returns null for missing week', () => {
    const result = getPublished('week-99')
    expect(result).toBeNull()
  })

  it('returns content and meta for existing week', () => {
    const content = '## Overview\n\nSome newsletter content\n\n## Biopharma\n\nBiopharma news'
    writeFileSync(join(PUB_DIR, 'week-10.md'), content)
    writeFileSync(join(PUB_DIR, 'week-10-meta.json'), JSON.stringify({
      publishedDate: '2026-03-06',
      linkedinUrl: 'https://linkedin.com/post/123',
    }))

    const result = getPublished('week-10')
    expect(result.content).toBe(content)
    expect(result.meta.publishedDate).toBe('2026-03-06')
    expect(result.meta.linkedinUrl).toBe('https://linkedin.com/post/123')
  })

  it('returns content without meta if meta missing', () => {
    writeFileSync(join(PUB_DIR, 'week-7.md'), '# Week 7')
    const result = getPublished('week-7')
    expect(result.content).toBe('# Week 7')
    expect(result.meta).toEqual({})
  })

  it('includes analysis if analysis file exists', () => {
    writeFileSync(join(PUB_DIR, 'week-10.md'), '# Content')
    writeFileSync(join(PUB_DIR, 'week-10-analysis.json'), JSON.stringify({ summary: 'Good structure' }))
    const result = getPublished('week-10')
    expect(result.analysis.summary).toBe('Good structure')
  })
})

describe('savePublished', () => {
  it('writes md and meta files', () => {
    const content = '## Overview\n\nNewsletter text here.\n\n## Biopharma\n\nBiopharma section.'
    savePublished('week-10', content, { linkedinUrl: 'https://linkedin.com/123' })

    expect(existsSync(join(PUB_DIR, 'week-10.md'))).toBe(true)
    expect(existsSync(join(PUB_DIR, 'week-10-meta.json'))).toBe(true)

    const savedContent = readFileSync(join(PUB_DIR, 'week-10.md'), 'utf-8')
    expect(savedContent).toBe(content)

    const meta = JSON.parse(readFileSync(join(PUB_DIR, 'week-10-meta.json'), 'utf-8'))
    expect(meta.linkedinUrl).toBe('https://linkedin.com/123')
    expect(meta.wordCount).toBeGreaterThan(0)
    expect(meta.sectionCount).toBe(2)
    expect(meta.sections.length).toBe(2)
    expect(meta.sections[0].heading).toBe('Overview')
    expect(typeof meta.savedAt).toBe('string')
  })

  it('rejects invalid week format', () => {
    expect(() => savePublished('invalid', 'content', {})).toThrow()
  })

  it('rejects empty content', () => {
    expect(() => savePublished('week-10', '', {})).toThrow()
  })

  it('computes section word counts', () => {
    const content = '## First\n\none two three\n\n## Second\n\nfour five six seven eight'
    savePublished('week-10', content, {})
    const meta = JSON.parse(readFileSync(join(PUB_DIR, 'week-10-meta.json'), 'utf-8'))
    expect(meta.sections[0].heading).toBe('First')
    expect(meta.sections[0].wordCount).toBe(3)
    expect(meta.sections[1].heading).toBe('Second')
    expect(meta.sections[1].wordCount).toBe(5)
  })
})
