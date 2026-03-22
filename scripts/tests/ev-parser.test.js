import { describe, it, expect } from 'bun:test'
import { extractUrls, filterUrls, classifySector } from '../lib/ev-parser.js'

describe('extractUrls', () => {
  it('extracts HTTP URLs from text', () => {
    const text = 'Check out https://example.com/article and http://other.com/page for details.'
    const urls = extractUrls(text)
    expect(urls).toContain('https://example.com/article')
    expect(urls).toContain('http://other.com/page')
  })

  it('ignores mailto links', () => {
    const urls = extractUrls('Contact mailto:user@example.com or visit https://example.com')
    expect(urls).not.toContain('mailto:user@example.com')
    expect(urls).toContain('https://example.com')
  })

  it('deduplicates URLs', () => {
    const text = 'Visit https://example.com and again https://example.com'
    const urls = extractUrls(text)
    expect(urls.length).toBe(1)
  })
})

describe('filterUrls', () => {
  it('removes excluded domains', () => {
    const urls = ['https://twitter.com/user', 'https://example.com/article', 'https://exponentialview.co/post']
    const filtered = filterUrls(urls)
    expect(filtered).toEqual(['https://example.com/article'])
  })

  it('removes anchor-only and image URLs', () => {
    const urls = ['#section', 'https://example.com/photo.jpg', 'https://example.com/article']
    const filtered = filterUrls(urls)
    expect(filtered).toEqual(['https://example.com/article'])
  })
})

describe('classifySector', () => {
  it('classifies pharma content as biopharma', () => {
    const sector = classifySector('New drug discovery using AI in pharmaceutical research and clinical trials')
    expect(sector).toBe('biopharma')
  })

  it('defaults to general for ambiguous content', () => {
    const sector = classifySector('Interesting developments in artificial intelligence')
    expect(sector).toBe('general')
  })
})
