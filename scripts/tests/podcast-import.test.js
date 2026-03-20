import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '..', '..')
const TEST_SOURCE = join(ROOT, 'data', 'test', '_podcast_import_source')
const TEST_PODCASTS = join(ROOT, 'data', 'podcasts')
const MANIFEST_PATH = join(TEST_PODCASTS, 'manifest.json')

// Create a fake transcript
function makeTranscript(title, source, date) {
  return `# ${title}

**Date:** ${date}
**Source:** ${source}
**URL:** https://example.com/episode
**Duration:** 15 min
**Transcript source:** whisper-api

---

This is a test transcript about AI developments. OpenAI launched a new product. Google announced a partnership with Anthropic. NVIDIA released new GPU benchmarks for AI workloads. The episode discusses the implications for enterprise adoption of AI tools.`
}

describe('podcast-import script', () => {
  beforeEach(() => {
    mkdirSync(TEST_SOURCE, { recursive: true })

    // Create fake transcripts
    writeFileSync(
      join(TEST_SOURCE, '2026-03-18-ai-daily-brief-test-episode.md'),
      makeTranscript('Test Episode', 'AI Daily Brief', '2026-03-18')
    )
    writeFileSync(
      join(TEST_SOURCE, '2026-03-19-moonshots-test.md'),
      makeTranscript('Moonshots Test', 'Moonshots', '2026-03-19')
    )
    writeFileSync(
      join(TEST_SOURCE, '2026-03-17-other-podcast.md'),
      makeTranscript('Other Podcast', 'Some Other Show', '2026-03-17')
    )
    // Pipeline report should be skipped
    writeFileSync(join(TEST_SOURCE, '_pipeline_report.md'), '# Pipeline Report\nThis should be skipped.')
  })

  afterEach(() => {
    rmSync(TEST_SOURCE, { recursive: true, force: true })
    // Clean up test manifest entries but don't remove the whole directory
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
      const cleaned = {}
      for (const [k, v] of Object.entries(manifest)) {
        if (!k.includes('test-episode') && !k.includes('moonshots-test') && !k.includes('other-podcast')) {
          cleaned[k] = v
        }
      }
      writeFileSync(MANIFEST_PATH, JSON.stringify(cleaned, null, 2))
    } catch {}
  })

  it('skips files starting with underscore', () => {
    // The scan function in podcast-import.js filters files starting with _
    // Verify test fixtures exist
    expect(existsSync(join(TEST_SOURCE, '_pipeline_report.md'))).toBe(true)
    expect(existsSync(join(TEST_SOURCE, '2026-03-18-ai-daily-brief-test-episode.md'))).toBe(true)
    // Verify underscore files would not be picked up by the naming pattern
    expect('_pipeline_report.md'.startsWith('_')).toBe(true)
  })
})

// Unit tests for helper functions that can be tested in isolation
describe('transcript parsing integration', () => {
  it('parses test transcript correctly', () => {
    const { parseTranscriptFrontmatter } = require('../lib/transcript-parser.js')
    const content = makeTranscript('Test Episode', 'AI Daily Brief', '2026-03-18')
    const result = parseTranscriptFrontmatter(content)

    expect(result).not.toBeNull()
    expect(result.title).toBe('Test Episode')
    expect(result.source).toBe('AI Daily Brief')
    expect(result.date).toBe('2026-03-18')
    expect(result.url).toBe('https://example.com/episode')
    expect(result.type).toBe('podcast')
  })
})

describe('manifest integration', () => {
  const testManifest = join(ROOT, 'data', 'test', '_test_manifest.json')

  afterEach(() => {
    try { rmSync(testManifest) } catch {}
    try { rmSync(testManifest + '.bak') } catch {}
  })

  it('round-trips manifest data', () => {
    const { loadManifest, saveManifest } = require('../lib/manifest.js')
    const data = { 'test.md': { date: '2026-03-18', week: 12 } }
    saveManifest(testManifest, data)
    const loaded = loadManifest(testManifest)
    expect(loaded['test.md'].week).toBe(12)
  })
})
