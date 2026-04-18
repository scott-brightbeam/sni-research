/**
 * editorial-audit-lib.test.js — Deterministic tests for the upstream
 * audit library. Pure functions only — no I/O, no LLM, no API.
 */

import { describe, test, expect } from 'bun:test'
import {
  AUDIT_VERSION,
  buildUpstreamAuditSystemPrompt,
  renderAuditBatch,
  collectAuditTargets,
  applyUpstreamAuditPatches,
  recordCleanAudits,
  hasBeenAuditedAtVersion,
} from './editorial-audit-lib.js'

// ── Fixture state ────────────────────────────────────────

function fixtureState() {
  return {
    counters: { nextSession: 148, nextDocument: 310, nextPost: 242 },
    analysisIndex: {
      '100': {
        title: 'Shoddy Industry',
        source: 'Fake Podcast',
        dateProcessed: '2026-04-17',
        session: 140,
        tier: 1,
        summary: 'The biopharma industry is finally waking up to AI. This matters because drug discovery has been broken for years.',
        keyThemes: 'industry awakening, drug discovery',
      },
      '101': {
        title: 'Clean Analysis',
        source: 'Another Podcast',
        dateProcessed: '2026-04-18',
        session: 141,
        tier: 1,
        summary: 'Research from Anthropic suggests 28,000 agent skills have been mapped into nine categories.',
        keyThemes: 'agent skills taxonomy',
      },
      '50': {
        title: 'Older Entry',
        source: 'Ancient Podcast',
        dateProcessed: '2026-01-10',
        session: 50,
        tier: 1,
        summary: 'This one is not in the audit window.',
      },
    },
    themeRegistry: {
      'T01': {
        name: 'Enterprise Diffusion Gap',
        evidence: [
          {
            documentId: '100',
            session: 140,
            dateAdded: '2026-04-17',
            claim: 'On the Fake Podcast this week, signüll argued that incredibly the industry has got it wrong. The key is more ambition.',
          },
          {
            documentId: '101',
            session: 141,
            dateAdded: '2026-04-18',
            content: 'Anthropic published research showing agent adoption patterns across 120 enterprises.',
          },
        ],
      },
    },
    postBacklog: {
      '44': {
        title: 'The Inverse Deskilling Paradox — AI Is Safest to Use Where It Is Most Dangerous to Delegate',
        status: 'suggested',
        dateAdded: '2026-04-17',
        session: 140,
        coreArgument: 'The industry keeps missing this. Not a hiring problem but a structural failure. AI advances fastest on verifiable tasks — the very tasks where delegation causes the fastest human capability loss.',
        format: 'concept-contrast',
        sourceDocuments: ['100'],
        notes: 'This really matters for enterprise readiness.',
      },
      '45': {
        title: 'Approved Post',
        status: 'approved',
        dateAdded: '2026-04-17',
        coreArgument: 'Some argument.',
        sourceDocuments: [],
        notes: 'Already shipped.',
      },
    },
    editorialAudits: [],
  }
}

// ── Prompt builder ────────────────────────────────────────

describe('buildUpstreamAuditSystemPrompt', () => {
  const prompt = buildUpstreamAuditSystemPrompt()

  test('explains that the material is upstream raw, not drafts', () => {
    expect(prompt.toLowerCase()).toContain('raw')
    expect(prompt.toLowerCase()).toContain('analysis summaries')
    expect(prompt.toLowerCase()).toContain('theme evidence')
    expect(prompt.toLowerCase()).toContain('backlog')
  })

  test('embeds the canonical evidence calibration + must-catch + CEO sections', () => {
    expect(prompt).toContain('EVIDENCE CALIBRATION')
    expect(prompt).toContain('ATTRIBUTION TEST')
    expect(prompt).toContain('VOICING LADDER')
    expect(prompt).toContain('MUST-CATCH STYLE PATTERNS')
    expect(prompt).toContain("'MATTERS' BAN")
    expect(prompt).toContain('CEO EMPATHY')
    expect(prompt).toContain('SYSTEMIC vs SPECIFIC')
  })

  test('specifies the JSON patch output contract', () => {
    expect(prompt).toContain('"analysisPatches"')
    expect(prompt).toContain('"themeEvidencePatches"')
    expect(prompt).toContain('"backlogPatches"')
    expect(prompt).toContain('oldValue')
    expect(prompt).toContain('newValue')
    expect(prompt).toContain('ruleBroken')
  })

  test('instructs omission for clean targets, null for unsalvageable', () => {
    expect(prompt.toLowerCase()).toContain('omit it')
    expect(prompt.toLowerCase()).toContain('newvalue to null')
  })
})

// ── Render batch ──────────────────────────────────────────

describe('renderAuditBatch', () => {
  const state = fixtureState()

  test('includes analysis fields for analysis targets', () => {
    const out = renderAuditBatch(state, [{ kind: 'analysis', id: '100' }])
    expect(out).toContain('Analysis 100')
    expect(out).toContain('Shoddy Industry')
    expect(out).toContain('summary')
    expect(out).toContain('finally waking up')
  })

  test('includes claim/content/significance for theme evidence targets', () => {
    const out = renderAuditBatch(state, [{ kind: 'theme-evidence', id: 'T01:0' }])
    expect(out).toContain('Theme T01')
    expect(out).toContain('Enterprise Diffusion Gap')
    expect(out).toContain('claim')
    expect(out).toContain('signüll')
  })

  test('includes title/coreArgument/notes for backlog + pulls source analysis summaries', () => {
    const out = renderAuditBatch(state, [{ kind: 'backlog', id: '44' }])
    expect(out).toContain('Backlog 44')
    expect(out).toContain('coreArgument')
    expect(out).toContain('source 100 summary')
    expect(out).toContain('finally waking up')
  })

  test('silently skips unknown IDs', () => {
    const out = renderAuditBatch(state, [{ kind: 'analysis', id: '9999' }])
    expect(out).not.toContain('9999')
  })
})

// ── Target collection ────────────────────────────────────

describe('collectAuditTargets', () => {
  test('--since includes analysis entries with dateProcessed >= since', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { since: '2026-04-17' })
    const analysisIds = targets.filter(t => t.kind === 'analysis').map(t => t.id)
    expect(analysisIds).toContain('100')
    expect(analysisIds).toContain('101')
    expect(analysisIds).not.toContain('50')
  })

  test('--since includes backlog entries with dateAdded >= since', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { since: '2026-04-17' })
    const backlogIds = targets.filter(t => t.kind === 'backlog').map(t => t.id)
    expect(backlogIds).toContain('44')
    expect(backlogIds).toContain('45')
  })

  test('--since includes theme evidence with dateAdded >= since', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { since: '2026-04-18' })
    const themeIds = targets.filter(t => t.kind === 'theme-evidence').map(t => t.id)
    expect(themeIds).toContain('T01:1')
    // T01:0 was dated 2026-04-17, before the cutoff
    expect(themeIds).not.toContain('T01:0')
  })

  test('--ids identifies analysis, theme-evidence, and backlog by shape', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { ids: ['100', 'T01:0', '44'] })
    expect(targets).toContainEqual({ kind: 'analysis', id: '100' })
    expect(targets).toContainEqual({ kind: 'theme-evidence', id: 'T01:0' })
    expect(targets).toContainEqual({ kind: 'backlog', id: '44' })
  })

  test('--ids skips unknown identifiers', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { ids: ['9999', 'T99:0'] })
    expect(targets).toHaveLength(0)
  })

  test('--suggested-backlog picks suggested posts AND their source analysis entries', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { suggestedBacklog: true })
    expect(targets).toContainEqual({ kind: 'backlog', id: '44' })
    // post 44 sourceDocuments: ['100']
    expect(targets).toContainEqual({ kind: 'analysis', id: '100' })
    // post 45 is status='approved', should be skipped
    expect(targets).not.toContainEqual({ kind: 'backlog', id: '45' })
  })

  test('--limit caps returned targets', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, { since: '2020-01-01', limit: 2 })
    expect(targets).toHaveLength(2)
  })

  test('de-dupes when the same target is requested via multiple flags', () => {
    const state = fixtureState()
    const targets = collectAuditTargets(state, {
      ids: ['44'],
      suggestedBacklog: true,
    })
    const backlog44 = targets.filter(t => t.kind === 'backlog' && t.id === '44')
    expect(backlog44).toHaveLength(1)
  })

  test('idempotency: skips targets already audited at the current version', () => {
    const state = fixtureState()
    state.editorialAudits.push({
      timestamp: '2026-04-18T08:00:00Z',
      auditVersion: AUDIT_VERSION,
      kind: 'analysis',
      id: '100',
      patches: [],
    })
    const targets = collectAuditTargets(state, { ids: ['100', '101'] })
    expect(targets).not.toContainEqual({ kind: 'analysis', id: '100' })
    expect(targets).toContainEqual({ kind: 'analysis', id: '101' })
  })

  test('idempotency: older version audit records do not block', () => {
    const state = fixtureState()
    state.editorialAudits.push({
      timestamp: '2026-04-17T08:00:00Z',
      auditVersion: AUDIT_VERSION - 1,
      kind: 'analysis',
      id: '100',
      patches: [],
    })
    const targets = collectAuditTargets(state, { ids: ['100'] })
    expect(targets).toContainEqual({ kind: 'analysis', id: '100' })
  })
})

// ── hasBeenAuditedAtVersion ──────────────────────────────

describe('hasBeenAuditedAtVersion', () => {
  test('returns false for empty audit log', () => {
    const state = fixtureState()
    expect(hasBeenAuditedAtVersion(state, 'analysis', '100', AUDIT_VERSION)).toBe(false)
  })

  test('returns true after an audit record is appended', () => {
    const state = fixtureState()
    state.editorialAudits.push({
      timestamp: 'now',
      auditVersion: AUDIT_VERSION,
      kind: 'analysis',
      id: '100',
      patches: [],
    })
    expect(hasBeenAuditedAtVersion(state, 'analysis', '100', AUDIT_VERSION)).toBe(true)
  })

  test('does not match across kinds', () => {
    const state = fixtureState()
    state.editorialAudits.push({
      timestamp: 'now',
      auditVersion: AUDIT_VERSION,
      kind: 'analysis',
      id: '100',
      patches: [],
    })
    expect(hasBeenAuditedAtVersion(state, 'backlog', '100', AUDIT_VERSION)).toBe(false)
  })
})

// ── Patch application ────────────────────────────────────

describe('applyUpstreamAuditPatches', () => {
  test('applies an analysis-summary patch when oldValue matches', () => {
    const state = fixtureState()
    const original = state.analysisIndex['100'].summary
    const result = applyUpstreamAuditPatches(state, {
      analysisPatches: [{
        id: '100',
        field: 'summary',
        oldValue: original,
        newValue: 'The biopharma industry has been shaped by long regulatory cycles and heavy capital requirements; AI is now changing the economics of that structure.',
        ruleBroken: 'ceo-specific-not-systemic',
      }],
    })
    expect(result.applied).toBe(1)
    expect(state.analysisIndex['100'].summary).not.toBe(original)
    expect(state.analysisIndex['100'].summary.toLowerCase()).not.toContain('waking up')
    expect(state.editorialAudits).toHaveLength(1)
    expect(state.editorialAudits[0].kind).toBe('analysis')
    expect(state.editorialAudits[0].id).toBe('100')
    expect(state.editorialAudits[0].patches[0].applied).toBe(true)
  })

  test('skips a patch when oldValue does not match (stale snapshot)', () => {
    const state = fixtureState()
    const result = applyUpstreamAuditPatches(state, {
      analysisPatches: [{
        id: '100',
        field: 'summary',
        oldValue: 'WRONG TEXT',
        newValue: 'NEW',
        ruleBroken: 'test',
      }],
    })
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(state.editorialAudits[0].patches[0].applied).toBe(false)
  })

  test('skips a patch with null newValue (flagged but unchanged)', () => {
    const state = fixtureState()
    const original = state.analysisIndex['100'].summary
    const result = applyUpstreamAuditPatches(state, {
      analysisPatches: [{
        id: '100',
        field: 'summary',
        oldValue: original,
        newValue: null,
        ruleBroken: 'unsalvageable',
      }],
    })
    expect(result.applied).toBe(0)
    expect(result.skipped).toBe(1)
    expect(state.analysisIndex['100'].summary).toBe(original)
    expect(state.editorialAudits[0].patches[0].newValue).toBeNull()
  })

  test('applies a theme-evidence patch on the claim field', () => {
    const state = fixtureState()
    const original = state.themeRegistry['T01'].evidence[0].claim
    const result = applyUpstreamAuditPatches(state, {
      themeEvidencePatches: [{
        id: 'T01:0',
        field: 'claim',
        oldValue: original,
        newValue: 'A recurring tension in enterprise AI adoption is the gap between raw data and AI-ready data.',
        ruleBroken: 'attribution-test',
      }],
    })
    expect(result.applied).toBe(1)
    expect(state.themeRegistry['T01'].evidence[0].claim).not.toContain('signüll')
  })

  test('applies a backlog coreArgument patch', () => {
    const state = fixtureState()
    const original = state.postBacklog['44'].coreArgument
    const result = applyUpstreamAuditPatches(state, {
      backlogPatches: [{
        id: '44',
        field: 'coreArgument',
        oldValue: original,
        newValue: 'AI gains traction fastest on verifiable tasks. That very feature creates a paradox: these are the tasks where delegating to AI compounds the erosion of human capability most quickly.',
        ruleBroken: 'false-contrast+strident',
      }],
    })
    expect(result.applied).toBe(1)
    expect(state.postBacklog['44'].coreArgument).not.toContain('keeps missing')
  })

  test('rejects patches against non-whitelisted fields', () => {
    const state = fixtureState()
    const result = applyUpstreamAuditPatches(state, {
      analysisPatches: [{
        id: '100',
        field: 'title',  // title is NOT in ANALYSIS_FIELDS
        oldValue: state.analysisIndex['100'].title,
        newValue: 'Hacked title',
        ruleBroken: 'n/a',
      }],
    })
    expect(result.applied).toBe(0)
    expect(state.analysisIndex['100'].title).toBe('Shoddy Industry')
  })

  test('handles whitespace-only differences between oldValue and current', () => {
    const state = fixtureState()
    const state100 = state.analysisIndex['100']
    const paddedOld = '  ' + state100.summary + '  \n'
    const result = applyUpstreamAuditPatches(state, {
      analysisPatches: [{
        id: '100',
        field: 'summary',
        oldValue: paddedOld,
        newValue: 'Clean rewrite.',
        ruleBroken: 'test',
      }],
    })
    expect(result.applied).toBe(1)
  })

  test('idempotency: applying same patch twice updates log but does nothing the second time', () => {
    const state = fixtureState()
    const original = state.analysisIndex['100'].summary
    const patch = {
      analysisPatches: [{
        id: '100',
        field: 'summary',
        oldValue: original,
        newValue: 'Rewritten.',
        ruleBroken: 'x',
      }],
    }
    const first = applyUpstreamAuditPatches(state, patch)
    const second = applyUpstreamAuditPatches(state, patch)
    expect(first.applied).toBe(1)
    expect(second.applied).toBe(0) // oldValue no longer matches
  })

  test('groups multiple patches on the same target into one audit record', () => {
    const state = fixtureState()
    const summary = state.analysisIndex['100'].summary
    const keyThemes = state.analysisIndex['100'].keyThemes
    applyUpstreamAuditPatches(state, {
      analysisPatches: [
        { id: '100', field: 'summary', oldValue: summary, newValue: 'Fixed summary.', ruleBroken: 'a' },
        { id: '100', field: 'keyThemes', oldValue: keyThemes, newValue: 'fixed themes', ruleBroken: 'b' },
      ],
    })
    const recordsFor100 = state.editorialAudits.filter(r => r.kind === 'analysis' && r.id === '100')
    expect(recordsFor100).toHaveLength(1)
    expect(recordsFor100[0].patches).toHaveLength(2)
  })

  test('recordCleanAudits logs targets without patches for future idempotency', () => {
    const state = fixtureState()
    const recorded = recordCleanAudits(state, [
      { kind: 'analysis', id: '101' },
      { kind: 'backlog', id: '45' },
    ])
    expect(recorded).toBe(2)
    expect(hasBeenAuditedAtVersion(state, 'analysis', '101', AUDIT_VERSION)).toBe(true)
    expect(hasBeenAuditedAtVersion(state, 'backlog', '45', AUDIT_VERSION)).toBe(true)
    // A second call should record zero (already in log)
    expect(recordCleanAudits(state, [{ kind: 'analysis', id: '101' }])).toBe(0)
  })
})
