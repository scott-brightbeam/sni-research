import { describe, it, expect } from 'bun:test'
import { buildArticleContext, estimateTokens, trimHistory } from './lib/context.js'

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    const text = 'a'.repeat(400)
    expect(estimateTokens(text)).toBe(100)
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })
})

describe('buildArticleContext', () => {
  it('returns a string with article summaries', () => {
    const articles = [
      { title: 'Test Article', source: 'Test Source', sector: 'general', date_published: '2026-03-03', snippet: 'A short snippet about AI.', score: 90 },
      { title: 'Another One', source: 'Source 2', sector: 'biopharma', date_published: '2026-03-02', snippet: 'Biopharma news snippet.', score: 50 },
    ]
    const result = buildArticleContext(articles, 30)
    expect(result).toContain('Test Article')
    expect(result).toContain('Another One')
  })

  it('includes full snippets for top N articles', () => {
    const articles = Array.from({ length: 5 }, (_, i) => ({
      title: `Article ${i}`, source: `Src ${i}`, sector: 'general',
      date_published: '2026-03-03', snippet: `Full snippet for article ${i}.`, score: 100 - i * 10,
    }))
    const result = buildArticleContext(articles, 2)
    // Top 2 should have full snippet
    expect(result).toContain('Full snippet for article 0')
    expect(result).toContain('Full snippet for article 1')
    // Rest should NOT have full snippet
    expect(result).not.toContain('Full snippet for article 2')
  })
})

describe('trimHistory', () => {
  it('returns all messages when under budget', () => {
    const msgs = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]
    const result = trimHistory(msgs, 10000)
    expect(result).toHaveLength(2)
  })

  it('trims oldest messages when over budget', () => {
    const msgs = [
      { role: 'user', content: 'a'.repeat(4000) },    // ~1000 tokens
      { role: 'assistant', content: 'b'.repeat(4000) }, // ~1000 tokens
      { role: 'user', content: 'c'.repeat(4000) },      // ~1000 tokens
      { role: 'assistant', content: 'd'.repeat(4000) },  // ~1000 tokens
    ]
    const result = trimHistory(msgs, 2500)
    // Should keep the most recent messages that fit
    expect(result.length).toBeLessThan(4)
    expect(result[result.length - 1].content).toBe('d'.repeat(4000))
  })

  it('always keeps at least the last message', () => {
    const msgs = [{ role: 'user', content: 'a'.repeat(40000) }]
    const result = trimHistory(msgs, 100)
    expect(result).toHaveLength(1)
  })
})
