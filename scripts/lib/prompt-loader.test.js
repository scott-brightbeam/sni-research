import { describe, it, expect } from 'bun:test'
import { loadAndRenderPrompt } from './prompt-loader.js'

describe('loadAndRenderPrompt', () => {
  it('loads a prompt and replaces placeholders', () => {
    const result = loadAndRenderPrompt('story-extract.v1', { transcript: 'TEST_TRANSCRIPT' })
    expect(result).toContain('TEST_TRANSCRIPT')
    expect(result).not.toContain('{transcript}')
    expect(result).toContain('You are a news analyst')
  })

  it('replaces multiple placeholders', () => {
    const result = loadAndRenderPrompt('content-match.v1', {
      story_a: 'STORY_A_TEXT',
      story_b: 'STORY_B_TEXT'
    })
    expect(result).toContain('STORY_A_TEXT')
    expect(result).toContain('STORY_B_TEXT')
    expect(result).not.toContain('{story_a}')
    expect(result).not.toContain('{story_b}')
  })

  it('throws on missing prompt file', () => {
    expect(() => loadAndRenderPrompt('nonexistent', {})).toThrow()
  })
})
