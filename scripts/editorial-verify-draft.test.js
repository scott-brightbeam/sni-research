/**
 * Tests for editorial-verify-draft.js
 * Run: bun test scripts/editorial-verify-draft.test.js
 */

import { describe, it, expect } from 'bun:test'
import {
  normaliseUrl,
  urlsMatch,
  extractLinks,
  classifyLinks,
  extractPodcastSection,
  checkStructure,
  checkPodcastBlocklist,
  loadPodcastBlocklist,
} from './editorial-verify-draft.js'

// ── normaliseUrl ────────────────────────────────────────

describe('normaliseUrl', () => {
  it('lowercases host and drops www', () => {
    expect(normaliseUrl('https://WWW.Example.com/path')).toBe('https://example.com/path')
  })

  it('forces https', () => {
    expect(normaliseUrl('http://example.com/path')).toBe('https://example.com/path')
  })

  it('drops fragment', () => {
    expect(normaliseUrl('https://example.com/path#section')).toBe('https://example.com/path')
  })

  it('strips tracking params', () => {
    expect(normaliseUrl('https://example.com/path?utm_source=sni&id=123')).toBe('https://example.com/path?id=123')
  })

  it('keeps non-tracking query params', () => {
    expect(normaliseUrl('https://example.com/p?id=123')).toBe('https://example.com/p?id=123')
  })

  it('drops trailing slash except on root', () => {
    expect(normaliseUrl('https://example.com/path/')).toBe('https://example.com/path')
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com/')
  })

  it('collapses multiple slashes in path', () => {
    expect(normaliseUrl('https://example.com//path///sub')).toBe('https://example.com/path/sub')
  })

  it('decodes then re-encodes the path consistently', () => {
    // decodeURI is used internally but URL.toString() re-encodes; the goal is
    // that the same URL normalises to the same string, regardless of whether
    // the input was percent-encoded or not.
    const a = normaliseUrl('https://example.com/path%20with%20space')
    const b = normaliseUrl('https://example.com/path with space')
    expect(a).toBe(b)
  })

  it('handles invalid URLs by returning trimmed input', () => {
    expect(normaliseUrl('not a url')).toBe('not a url')
    expect(normaliseUrl('  https://example.com/  ')).toBe('https://example.com/')
  })
})

// ── urlsMatch ───────────────────────────────────────────

describe('urlsMatch', () => {
  it('matches exact URLs', () => {
    expect(urlsMatch('https://example.com/path', 'https://example.com/path')).toBe(true)
  })

  it('matches after normalisation (www, https, trailing slash)', () => {
    expect(urlsMatch('http://www.example.com/path/', 'https://example.com/path')).toBe(true)
  })

  it('matches a16z simplecast slug truncation (draft strips tracking)', () => {
    // This is the CRITICAL case from Week 15 — editors strip tracking slugs
    expect(urlsMatch(
      'https://a16z.simplecast.com/episodes/marc-andreessen-on-ai-winters-and-agent-breakthroughs',
      'https://a16z.simplecast.com/episodes/marc-andreessen-on-ai-winters-and-agent-breakthroughs-fsdC0VvN'
    )).toBe(true)
  })

  it('matches exponentialview ev-568 when draft adds descriptive tail', () => {
    expect(urlsMatch(
      'https://www.exponentialview.co/p/ev-568-the-compute-stampede',
      'https://www.exponentialview.co/p/ev-568'
    )).toBe(true)
  })

  it('matches cognitiverevolution flat slug when digest has longer slug', () => {
    expect(urlsMatch(
      'https://www.cognitiverevolution.ai/training-the-ais-eyes-how-roboflow-is-making-the-real-world-programmable/',
      'https://www.cognitiverevolution.ai/training-the-ais-eyes-how-roboflow-is-making-the-real-world-programmable-with-ceo-joseph-nelson/'
    )).toBe(true)
  })

  it('matches bigtechnology prefix when draft has shorter slug', () => {
    expect(urlsMatch(
      'https://www.bigtechnology.com/p/more-openai-executive-drama-is-siri',
      'https://www.bigtechnology.com/p/more-openai-executive-drama-is-siri-seriously-broken-meta-s'
    )).toBe(true)
  })

  it('REJECTS bare homepages even when origins match', () => {
    expect(urlsMatch('https://anthropic.com/', 'https://anthropic.com/news/article-42')).toBe(false)
  })

  it('REJECTS different origins', () => {
    expect(urlsMatch('https://a.com/path', 'https://b.com/path')).toBe(false)
  })

  it('REJECTS different first path segments', () => {
    expect(urlsMatch('https://example.com/blog/story-a', 'https://example.com/news/story-a')).toBe(false)
  })

  it('REJECTS when slug extension is not hyphen-separated', () => {
    // Prevent matching /foo and /foobar (where 'bar' is not a tracking suffix)
    expect(urlsMatch('https://example.com/blog/foo', 'https://example.com/blog/foobar')).toBe(false)
  })

  it('REJECTS too-short slug prefix (avoid false matches)', () => {
    // /p/e and /p/ev-568 — prefix 'e' too short
    expect(urlsMatch('https://example.com/p/e', 'https://example.com/p/ev-568')).toBe(false)
  })

  it('REJECTS single-segment homepage-like paths', () => {
    expect(urlsMatch('https://example.com/about', 'https://example.com/about-us')).toBe(false)
  })
})

// ── extractLinks ────────────────────────────────────────

describe('extractLinks', () => {
  it('extracts markdown links with line numbers', () => {
    const md = 'Line one\n[text](https://example.com) on line 2\nAnd [another](https://b.com) on line 3'
    const links = extractLinks(md)
    expect(links).toHaveLength(2)
    expect(links[0]).toEqual({ anchorText: 'text', url: 'https://example.com', line: 2 })
    expect(links[1]).toEqual({ anchorText: 'another', url: 'https://b.com', line: 3 })
  })

  it('handles multiple links on same line', () => {
    const md = '[a](https://a.com) and [b](https://b.com)'
    const links = extractLinks(md)
    expect(links).toHaveLength(2)
  })

  it('handles only http/https URLs', () => {
    const md = '[rel](../relative) [ftp](ftp://server) [http](http://a.com)'
    const links = extractLinks(md)
    expect(links).toHaveLength(1)
    expect(links[0].url).toBe('http://a.com')
  })
})

// ── classifyLinks ──────────────────────────────────────

describe('classifyLinks', () => {
  const sampleDraft = `# SNI: Week 15

Welcome to all the AI news that matters this week – across sectors.

## tl;dr: Test theme

Some [tldr claim](https://a.com) about things.

Here's everything else worth reading this week:

### AI & tech:
- [Story](https://b.com): a one-liner

## But what set podcast tongues a-wagging?

Some [host on show](https://c.com) content.

Thank you for reading this week's report.`

  it('classifies links by section', () => {
    const links = extractLinks(sampleDraft)
    const classified = classifyLinks(sampleDraft, links)
    expect(classified.find(l => l.url === 'https://a.com').section).toBe('tldr')
    expect(classified.find(l => l.url === 'https://b.com').section).toBe('sector')
    expect(classified.find(l => l.url === 'https://c.com').section).toBe('podcast')
  })
})

// ── extractPodcastSection ─────────────────────────────

describe('extractPodcastSection', () => {
  it('extracts text between podcast heading and closing line', () => {
    const md = `## tl;dr:\nstuff\n\n## But what set podcast tongues a-wagging?\n\npodcast content\n\nThank you for reading`
    const section = extractPodcastSection(md)
    expect(section).toContain('podcast content')
    expect(section).not.toContain('stuff')
  })

  it('returns empty string when heading is missing', () => {
    const md = '## tl;dr:\n\nstuff\n\nThank you for reading'
    expect(extractPodcastSection(md)).toBe('')
  })
})

// ── checkStructure ────────────────────────────────────

describe('checkStructure', () => {
  const validDraft = `# SNI: Week 15
Welcome to all the AI news that matters this week – across tech, biopharma, medtech, advanced manufacturing and insurance. The wins, the fails and the somewhere in-betweens.

## tl;dr: Test theme

${'word '.repeat(1100)}

Here's everything else worth reading this week:

### AI & tech:
- [Story one](https://a.com): a one-liner about a thing.
- [Story two](https://b.com): another one-liner.
- [Story three](https://c.com): a third one.

### Biopharma:
- [Story A](https://d.com): biopharma thing.
- [Story B](https://e.com): another biopharma thing.
- [Story C](https://f.com): third biopharma thing.

### Medtech:
- [Story A](https://g.com): medtech thing.
- [Story B](https://h.com): another medtech thing.
- [Story C](https://i.com): third medtech thing.

### Advanced manufacturing:
- [Story A](https://j.com): manufacturing thing.
- [Story B](https://k.com): another manufacturing thing.
- [Story C](https://l.com): third manufacturing thing.

### Insurance:
- [Story A](https://m.com): insurance thing.
- [Story B](https://n.com): another insurance thing.
- [Story C](https://o.com): third insurance thing.

## But what set podcast tongues a-wagging?

${'word '.repeat(300)}

Thank you for reading this week's report. Come back next week.`

  it('passes a well-formed draft', () => {
    const violations = checkStructure(validDraft)
    const fails = violations.filter(v => v.severity === 'fail')
    expect(fails).toHaveLength(0)
  })

  it('fails when title line is missing', () => {
    const draft = validDraft.replace('# SNI: Week 15', 'No title')
    const violations = checkStructure(draft)
    expect(violations.some(v => v.message.includes('title line'))).toBe(true)
  })

  it('fails when tl;dr heading is missing', () => {
    const draft = validDraft.replace('## tl;dr: Test theme', 'random text')
    const violations = checkStructure(draft)
    expect(violations.some(v => v.message.includes('tl;dr'))).toBe(true)
  })

  it('fails when a sector has fewer than 3 bullets', () => {
    const draft = validDraft.replace(
      '### Insurance:\n- [Story A](https://m.com): insurance thing.\n- [Story B](https://n.com): another insurance thing.\n- [Story C](https://o.com): third insurance thing.',
      '### Insurance:\n- [Only one](https://m.com): insurance thing.'
    )
    const violations = checkStructure(draft)
    expect(violations.some(v => v.message.includes('Insurance') && v.message.includes('bullets'))).toBe(true)
  })

  it('fails when a bullet has no linked headline', () => {
    const draft = validDraft.replace(
      '- [Story one](https://a.com): a one-liner about a thing.',
      '- Unlinked headline text'
    )
    const violations = checkStructure(draft)
    expect(violations.some(v => v.message.includes('without linked headlines'))).toBe(true)
  })

  it('fails when word count is too low', () => {
    const draft = '# SNI: Week 15\nWelcome across sectors.\n\n## tl;dr: t\n\nShort.\n\nHere\'s everything else worth reading this week:\n\n### AI & tech:\n- [a](https://a.com): x\n\nThank you for reading'
    const violations = checkStructure(draft)
    expect(violations.some(v => v.message.includes('Word count'))).toBe(true)
  })
})

// ── checkPodcastBlocklist ─────────────────────────────

describe('checkPodcastBlocklist', () => {
  const blocklist = {
    names: ['The AI Exchange', 'Stratechery podcast', 'Sinica Podcast'],
    pairs: [
      { host: 'Gary Marcus', podcast: 'The AI Exchange' },
      { host: 'Ben Thompson', podcast: 'Stratechery' },
    ],
  }

  it('detects blocked podcast names from Week 15 hallucinations', () => {
    const draft = '... Gary Marcus on The AI Exchange argued ...'
    const violations = checkPodcastBlocklist(draft, blocklist)
    expect(violations.length).toBeGreaterThan(0)
    expect(violations.some(v => v.message.includes('The AI Exchange'))).toBe(true)
  })

  it('detects Sinica Podcast', () => {
    const draft = '... as Sinica Podcast reported ...'
    const violations = checkPodcastBlocklist(draft, blocklist)
    expect(violations.some(v => v.message.includes('Sinica Podcast'))).toBe(true)
  })

  it('passes clean draft', () => {
    const draft = '... Marc Andreessen on the a16z podcast discussed ...'
    const violations = checkPodcastBlocklist(draft, blocklist)
    expect(violations).toHaveLength(0)
  })

  it('detects blocked host/podcast pairs', () => {
    const draft = 'Ben Thompson at Stratechery argued that...'
    const violations = checkPodcastBlocklist(draft, blocklist)
    expect(violations.some(v => v.message.includes('Ben Thompson'))).toBe(true)
  })
})

// ── loadPodcastBlocklist (integration) ────────────────

describe('loadPodcastBlocklist', () => {
  it('loads the project blocklist file', () => {
    const bl = loadPodcastBlocklist()
    expect(bl).toHaveProperty('names')
    expect(bl).toHaveProperty('pairs')
    // Seeded names from the Week 15 incident
    expect(bl.names).toContain('The AI Exchange')
    expect(bl.names).toContain('Stratechery podcast')
  })
})

// ── HTTP liveness check (integration) ────────────────

describe('checkUrlLive', () => {
  // Skip these tests if NO_NETWORK is set (for CI environments without internet)
  const skipNetwork = process.env.NO_NETWORK === '1'

  it.skipIf(skipNetwork)('returns ok for a known-good URL', async () => {
    const { checkUrlLive } = await import('./editorial-verify-draft.js')
    const result = await checkUrlLive('https://example.com/')
    expect(result.ok).toBe(true)
    expect(result.status).toBeGreaterThanOrEqual(200)
    expect(result.status).toBeLessThan(400)
  }, 15000)

  it.skipIf(skipNetwork)('returns not-ok for a 404 URL', async () => {
    const { checkUrlLive } = await import('./editorial-verify-draft.js')
    const result = await checkUrlLive('https://www.bigtechnology.com/p/definitely-does-not-exist-404-test-url-99999')
    expect(result.ok).toBe(false)
  }, 15000)

  it.skipIf(skipNetwork)('returns not-ok on timeout', async () => {
    const { checkUrlLive } = await import('./editorial-verify-draft.js')
    // Use an unroutable address to force timeout
    const result = await checkUrlLive('https://10.255.255.1/', 1000)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  }, 10000)
})
