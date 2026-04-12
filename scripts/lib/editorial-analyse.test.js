/**
 * editorial-analyse.test.js — Tests for the ANALYSE pipeline business logic
 *
 * Tests the pure-function business logic extracted from the pipeline:
 *   - Source metadata extraction from filenames
 *   - Deduplication (skip already-processed transcripts)
 *   - Response application (mapping Opus JSON → state mutations)
 *   - Story reference collection
 *
 * Does NOT test API calls (those require real keys).
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import {
  extractSourceMeta,
  isAlreadyProcessed,
  applyAnalysisResponse,
  collectStoryReferences,
  loadSourcesConfig,
} from './editorial-analyse-lib.js'

// ── Test fixtures ─────────────────────────────────────────

function makeTestState() {
  return {
    counters: { nextSession: 16, nextDocument: 138, nextPost: 92 },
    analysisIndex: {
      '135': {
        title: 'How Anthropic Mapped 28,000 Agent Skills',
        source: 'AI Daily Brief',
        host: 'Nathaniel Whittemore',
        date: '2026-03-10',
        session: 15,
        tier: 1,
        status: 'active',
        themes: ['T01', 'T03'],
        summary: 'Test summary',
        keyThemes: 'Agent skills, workforce',
        postPotential: 'high',
      },
      '136': {
        title: 'The Regulation Paradox',
        source: 'Cognitive Revolution',
        host: 'Nathan Labenz',
        date: '2026-03-12',
        session: 15,
        tier: 1,
        status: 'active',
        themes: ['T05'],
        summary: 'Test summary',
        keyThemes: 'Regulation',
        postPotential: 'medium',
      },
    },
    themeRegistry: {
      T01: {
        name: 'Enterprise AI Diffusion Gap',
        created: 'Session 6',
        lastUpdated: 'Session 15',
        documentCount: 12,
        evidence: [
          { session: 15, source: 'AI Daily Brief (2026-03-10)', content: 'Test evidence' },
        ],
        crossConnections: [],
      },
      T03: {
        name: 'Workforce Reconfiguration',
        created: 'Session 6',
        lastUpdated: 'Session 14',
        documentCount: 8,
        evidence: [],
        crossConnections: [],
      },
      T05: {
        name: 'Regulatory Friction',
        created: 'Session 7',
        lastUpdated: 'Session 15',
        documentCount: 5,
        evidence: [],
        crossConnections: [],
      },
    },
    postBacklog: {
      '89': {
        title: 'The Delegation Cost Thesis',
        status: 'approved',
        session: 14,
        priority: 'high',
      },
      '90': {
        title: 'Why Compliance Teams Love AI',
        status: 'suggested',
        session: 15,
        priority: 'medium',
      },
    },
    decisionLog: [],
    permanentPreferences: [],
    corpusStats: {},
  }
}

function makeSources() {
  return {
    'ai-daily-brief': {
      name: 'AI Daily Brief',
      host: 'Nathaniel Whittemore',
      tier: 1,
      trust: true,
    },
    'cognitive-revolution': {
      name: 'Cognitive Revolution',
      host: 'Nathan Labenz',
      tier: 1,
      trust: true,
    },
    'moonshots': {
      name: 'Moonshots',
      host: 'Peter Diamandis',
      tier: 1,
      trust: true,
    },
    'no-priors': {
      name: 'No Priors',
      host: 'Sarah Guo, Elad Gil',
      tier: 1,
      trust: true,
    },
    'rachman-review': {
      name: 'Rachman Review',
      host: 'Gideon Rachman',
      tier: 2,
      trust: false,
    },
  }
}

// ── extractSourceMeta ─────────────────────────────────────

describe('extractSourceMeta', () => {
  const sources = makeSources()

  test('matches known source from filename prefix', () => {
    const meta = extractSourceMeta('AI Daily Brief - 2026-03-15 - Big AI News.txt', sources)
    expect(meta.sourceKey).toBe('ai-daily-brief')
    expect(meta.sourceName).toBe('AI Daily Brief')
    expect(meta.host).toBe('Nathaniel Whittemore')
    expect(meta.tier).toBe(1)
  })

  test('matches source with different casing', () => {
    const meta = extractSourceMeta('ai daily brief - 2026-03-15.txt', sources)
    expect(meta.sourceKey).toBe('ai-daily-brief')
  })

  test('extracts date from filename with YYYY-MM-DD pattern', () => {
    const meta = extractSourceMeta('AI Daily Brief - 2026-03-15 - Title.txt', sources)
    expect(meta.date).toBe('2026-03-15')
  })

  test('extracts episode title from filename', () => {
    const meta = extractSourceMeta('Cognitive Revolution - 2026-03-12 - The Regulation Paradox.txt', sources)
    expect(meta.episode).toBe('The Regulation Paradox')
  })

  test('handles filename without date', () => {
    const meta = extractSourceMeta('Moonshots - Space Economy Deep Dive.txt', sources)
    expect(meta.sourceKey).toBe('moonshots')
    expect(meta.date).toBeNull()
    expect(meta.episode).toBe('Space Economy Deep Dive')
  })

  test('returns unknown source for unrecognised filename', () => {
    const meta = extractSourceMeta('Random Podcast - 2026-03-15.txt', sources)
    expect(meta.sourceKey).toBeNull()
    expect(meta.sourceName).toBeNull()
  })

  test('handles multi-word source names with hyphens', () => {
    const meta = extractSourceMeta('No Priors - 2026-03-10 - AI Investment Trends.txt', sources)
    expect(meta.sourceKey).toBe('no-priors')
    expect(meta.sourceName).toBe('No Priors')
  })

  test('handles filename with only source name', () => {
    const meta = extractSourceMeta('Moonshots.txt', sources)
    expect(meta.sourceKey).toBe('moonshots')
    expect(meta.episode).toBeNull()
  })
})

// ── isAlreadyProcessed ────────────────────────────────────

describe('isAlreadyProcessed', () => {
  test('returns true when title+source match exists in analysisIndex', () => {
    const state = makeTestState()
    expect(isAlreadyProcessed({
      episode: 'How Anthropic Mapped 28,000 Agent Skills',
      sourceName: 'AI Daily Brief',
    }, state)).toBe(true)
  })

  test('returns false when title does not match', () => {
    const state = makeTestState()
    expect(isAlreadyProcessed({
      episode: 'Completely New Episode',
      sourceName: 'AI Daily Brief',
    }, state)).toBe(false)
  })

  test('returns false when source does not match', () => {
    const state = makeTestState()
    expect(isAlreadyProcessed({
      episode: 'How Anthropic Mapped 28,000 Agent Skills',
      sourceName: 'Cognitive Revolution',
    }, state)).toBe(false)
  })

  test('returns false when episode is null', () => {
    const state = makeTestState()
    expect(isAlreadyProcessed({
      episode: null,
      sourceName: 'AI Daily Brief',
    }, state)).toBe(false)
  })

  test('uses case-insensitive matching', () => {
    const state = makeTestState()
    expect(isAlreadyProcessed({
      episode: 'how anthropic mapped 28,000 agent skills',
      sourceName: 'AI Daily Brief',
    }, state)).toBe(true)
  })
})

// ── applyAnalysisResponse ─────────────────────────────────

describe('applyAnalysisResponse', () => {
  let state

  beforeEach(() => {
    state = makeTestState()
  })

  test('adds analysis entries and increments nextDocument', () => {
    const response = {
      analysisEntries: [
        {
          title: 'Why AI Agents Need Guardrails',
          source: 'No Priors',
          host: 'Sarah Guo, Elad Gil',
          participants: 'Dario Amodei',
          date: '2026-03-18',
          tier: 1,
          themes: ['T01', 'T05'],
          summary: 'Deep dive into agent safety requirements.',
          keyThemes: 'Agent safety, guardrails, enterprise risk',
          postPotential: 'high',
          postPotentialReasoning: 'Novel safety framework with specific metrics.',
        },
      ],
      themeUpdates: [],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.entriesAdded).toBe(1)
    expect(state.counters.nextDocument).toBe(139)
    expect(state.analysisIndex['138']).toBeDefined()
    expect(state.analysisIndex['138'].title).toBe('Why AI Agents Need Guardrails')
    expect(state.analysisIndex['138'].themes).toEqual(['T01', 'T05'])
  })

  test('adds theme evidence for existing themes', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [
        {
          action: 'add_evidence',
          themeCode: 'T03',
          evidence: {
            source: 'No Priors (2026-03-18)',
            content: 'Amodei: 60% of Anthropic customer deployments now involve agent-to-agent delegation.',
          },
        },
      ],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.evidenceAdded).toBe(1)
    expect(state.themeRegistry.T03.evidence).toHaveLength(1)
    expect(state.themeRegistry.T03.evidence[0].content).toContain('60%')
  })

  test('creates new themes', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [
        {
          action: 'new_theme',
          themeCode: 'T27',
          name: 'Agent-to-Agent Delegation Costs',
          evidence: {
            source: 'No Priors (2026-03-18)',
            content: 'First evidence for delegation cost pattern.',
          },
          reasoning: 'Distinct from T01 — focuses on inter-agent economics, not human-AI gap.',
        },
      ],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.themesCreated).toBe(1)
    expect(state.themeRegistry.T27).toBeDefined()
    expect(state.themeRegistry.T27.name).toBe('Agent-to-Agent Delegation Costs')
  })

  test('adds cross-connections between themes', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [],
      crossConnections: [
        {
          fromTheme: 'T01',
          toTheme: 'T05',
          reasoning: 'Enterprise diffusion gap is partly caused by regulatory friction.',
        },
      ],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.connectionsAdded).toBe(1)
    expect(state.themeRegistry.T01.crossConnections).toHaveLength(1)
    expect(state.themeRegistry.T01.crossConnections[0].theme).toBe('T05')
  })

  test('adds post candidates and increments nextPost', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [],
      crossConnections: [],
      postCandidates: [
        {
          title: 'The Agent Delegation Tax — Why 60% Isn\'t Enough',
          coreArgument: 'Most enterprise agent deployments still require human oversight at key decision points.',
          format: 'concept-contrast',
          sourceDocuments: [],
          freshness: 'very-timely',
          priority: 'high',
          notes: 'Amodei quote is strong lead. Contrast with Microsoft deployment data.',
        },
      ],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.postsAdded).toBe(1)
    expect(state.counters.nextPost).toBe(93)
    expect(state.postBacklog['92']).toBeDefined()
    expect(state.postBacklog['92'].title).toBe('The Agent Delegation Tax — Why 60% Isn\'t Enough')
    expect(state.postBacklog['92'].status).toBe('suggested')
  })

  test('collects story references without mutating state', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [
        {
          headline: 'Anthropic releases Claude 4 agent API',
          detail: 'Full agent delegation API with structured output.',
          url: 'https://anthropic.com/news/agent-api',
          type: 'product-launch',
          sector: 'general-ai',
        },
      ],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.storiesCollected).toBe(1)
    expect(result.storyReferences).toHaveLength(1)
    expect(result.storyReferences[0].headline).toBe('Anthropic releases Claude 4 agent API')
  })

  test('handles empty response gracefully', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.entriesAdded).toBe(0)
    expect(result.evidenceAdded).toBe(0)
    expect(result.themesCreated).toBe(0)
    expect(result.connectionsAdded).toBe(0)
    expect(result.postsAdded).toBe(0)
    expect(result.storiesCollected).toBe(0)
  })

  test('handles missing response sections gracefully', () => {
    const response = { analysisEntries: [] }

    const result = applyAnalysisResponse(response, state)
    expect(result.entriesAdded).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  test('skips invalid theme evidence (non-existent theme) and records error', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [
        {
          action: 'add_evidence',
          themeCode: 'T99',
          evidence: { source: 'Test', content: 'Evidence for non-existent theme' },
        },
      ],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.evidenceAdded).toBe(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('T99')
  })

  test('skips invalid cross-connection and records error', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [],
      crossConnections: [
        { fromTheme: 'T01', toTheme: 'T99', reasoning: 'Invalid' },
      ],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.connectionsAdded).toBe(0)
    expect(result.errors).toHaveLength(1)
  })

  test('processes multiple entries in a single response', () => {
    const response = {
      analysisEntries: [
        {
          title: 'Episode A',
          source: 'AI Daily Brief',
          tier: 1,
          themes: ['T01'],
          summary: 'Summary A',
        },
      ],
      themeUpdates: [
        {
          action: 'add_evidence',
          themeCode: 'T01',
          evidence: { source: 'Test', content: 'New evidence' },
        },
        {
          action: 'new_theme',
          themeCode: 'T27',
          name: 'New Theme',
          evidence: { source: 'Test', content: 'First evidence' },
        },
      ],
      crossConnections: [
        { fromTheme: 'T01', toTheme: 'T03', reasoning: 'Connected' },
      ],
      postCandidates: [
        {
          title: 'Post Idea',
          coreArgument: 'Core argument here.',
          priority: 'high',
        },
      ],
      storyReferences: [
        { headline: 'Story 1', type: 'product-launch', sector: 'general-ai' },
        { headline: 'Story 2', type: 'funding', sector: 'biopharma' },
      ],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.entriesAdded).toBe(1)
    expect(result.evidenceAdded).toBe(1)
    expect(result.themesCreated).toBe(1)
    expect(result.connectionsAdded).toBe(1)
    expect(result.postsAdded).toBe(1)
    expect(result.storiesCollected).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  test('records error for unrecognised theme update action', () => {
    const response = {
      analysisEntries: [],
      themeUpdates: [
        { action: 'retire_theme', themeCode: 'T01' },
      ],
      crossConnections: [],
      postCandidates: [],
      storyReferences: [],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('unrecognised action')
    expect(result.errors[0]).toContain('retire_theme')
  })

  test('handles null items in response arrays gracefully', () => {
    const response = {
      analysisEntries: [null, undefined, 'not-an-object'],
      themeUpdates: [null],
      crossConnections: [null],
      postCandidates: [null],
      storyReferences: [null, { headline: 'Valid Story', type: 'product-launch', sector: 'general-ai' }],
    }

    const result = applyAnalysisResponse(response, state)
    expect(result.entriesAdded).toBe(0)
    expect(result.errors.length).toBeGreaterThan(0)
    // Valid story reference should still be collected despite null siblings
    expect(result.storiesCollected).toBe(1)
  })
})

// ── collectStoryReferences ────────────────────────────────

describe('collectStoryReferences', () => {
  test('aggregates story references across multiple transcripts', () => {
    const batch1 = [
      { headline: 'Story A', type: 'product-launch', sector: 'general-ai' },
    ]
    const batch2 = [
      { headline: 'Story B', type: 'funding', sector: 'biopharma' },
      { headline: 'Story C', type: 'regulation', sector: 'medtech' },
    ]

    const collector = collectStoryReferences()
    collector.add(batch1, 'transcript-1.txt')
    collector.add(batch2, 'transcript-2.txt')

    const all = collector.getAll()
    expect(all).toHaveLength(3)
    expect(all[0].sourceFile).toBe('transcript-1.txt')
    expect(all[2].sourceFile).toBe('transcript-2.txt')
  })

  test('deduplicates stories by headline (case-insensitive)', () => {
    const collector = collectStoryReferences()
    collector.add([{ headline: 'Big AI News', type: 'product-launch', sector: 'general-ai' }], 'file1.txt')
    collector.add([{ headline: 'big ai news', type: 'product-launch', sector: 'general-ai' }], 'file2.txt')

    expect(collector.getAll()).toHaveLength(1)
  })

  test('handles empty batches', () => {
    const collector = collectStoryReferences()
    collector.add([], 'file1.txt')
    collector.add(null, 'file2.txt')
    collector.add(undefined, 'file3.txt')
    expect(collector.getAll()).toHaveLength(0)
  })
})

// ── loadSourcesConfig ─────────────────────────────────────

describe('loadSourcesConfig', () => {
  test('loads and returns sources from editorial-sources.yaml', () => {
    const config = loadSourcesConfig()
    expect(config.sources).toBeDefined()
    expect(config.sources['ai-daily-brief']).toBeDefined()
    expect(config.sources['ai-daily-brief'].name).toBe('AI Daily Brief')
  })

  test('includes processing config', () => {
    const config = loadSourcesConfig()
    expect(config.processing).toBeDefined()
    expect(config.processing.max_transcripts_per_session).toBe(25)
  })

  test('includes budget config', () => {
    const config = loadSourcesConfig()
    expect(config.budget).toBeDefined()
    expect(config.budget.weekly_cap_usd).toBe(50)
  })
})
