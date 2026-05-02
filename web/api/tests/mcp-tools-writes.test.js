/**
 * mcp-tools-writes.test.js — Tests for the 6 write tools added in Task 7.
 *
 * Each describe block has 4 tests:
 *   1. Happy path       — sidecar written + audit row + queuedFor present
 *   2. Schema violation — Zod safeParse rejects bad input directly
 *   3. Sidecar shape    — version=1, type, payload fields, no clientRequestId in payload
 *   4. Idempotency      — same clientRequestId from same user returns existing contributionId
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import { registerWriteTools } from '../lib/mcp-tools/writes.js'
import {
  SubmitThemeEvidenceIn,
  ProposeNewThemeIn,
  SubmitArticleIn,
  AddDecisionIn,
  SubmitStoryReferenceIn,
  SubmitDraftSuggestionIn,
} from '../lib/mcp-tools/schemas.js'
import { callTool } from './mcp-harness.js'
import { seedThemes } from './fixtures.js'

let TEST_ROOT

beforeEach(async () => {
  TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-task7-'))
  process.env.SNI_ROOT = TEST_ROOT
  _resetDbSingleton()
  await migrateSchema(getDb())
})

afterEach(() => {
  delete process.env.SNI_ROOT
  fs.rmSync(TEST_ROOT, { recursive: true, force: true })
})

// ── Helpers ────────────────────────────────────────────────────────────────

const ALICE = { sub: 'alice@brightbeam.com', name: 'Alice', jti: 'jti-alice' }
const BOB   = { sub: 'bob@brightbeam.com',   name: 'Bob',   jti: 'jti-bob'   }

function readSidecar(contribId) {
  const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
  const filePath = path.join(contribDir, `${contribId}.json`)
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function listSidecars() {
  const contribDir = path.join(TEST_ROOT, 'data/editorial/contributions')
  if (!fs.existsSync(contribDir)) return []
  return fs.readdirSync(contribDir).filter(f => f.endsWith('.json'))
}

// ── sni_submit_theme_evidence ──────────────────────────────────────────────

describe('sni_submit_theme_evidence', () => {
  const TOOL = 'sni_submit_theme_evidence'

  function args(overrides = {}) {
    return {
      themeCode: 'T01',
      content: 'AI agents are disrupting drug discovery workflows.',
      source: 'TBPN episode 42',
      url: 'https://podcast.example/ep42',
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    await seedThemes(db, 3)
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(auditRow.user_email).toBe(ALICE.sub)
    expect(auditRow.contribution_id).toBe(result.structuredContent.contributionId)
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: missing content rejected by Zod', () => {
    const r = SubmitThemeEvidenceIn.safeParse({ themeCode: 'T01' })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=theme_evidence, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    await seedThemes(db, 3)
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-te-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('theme_evidence')
    expect(sidecar.payload.themeCode).toBe('T01')
    expect(sidecar.payload.content).toBe('AI agents are disrupting drug discovery workflows.')
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-te-1')
    expect(sidecar.user.email).toBe(ALICE.sub)
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    await seedThemes(db, 3)
    const a = args({ clientRequestId: 'idem-te-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})

// ── sni_propose_new_theme ──────────────────────────────────────────────────

describe('sni_propose_new_theme', () => {
  const TOOL = 'sni_propose_new_theme'

  function args(overrides = {}) {
    return {
      name: 'Regulatory AI Risk',
      rationale: 'EU AI Act enforcement is creating compliance overhead across all sectors.',
      initialEvidence: [
        { content: 'First evidence item.', source: 'Reuters', url: 'https://reuters.com/1' },
      ],
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: missing name rejected by Zod', () => {
    const r = ProposeNewThemeIn.safeParse({ rationale: 'no name here' })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=new_theme, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-nt-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('new_theme')
    expect(sidecar.payload.name).toBe('Regulatory AI Risk')
    expect(sidecar.payload.initialEvidence).toHaveLength(1)
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-nt-1')
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const a = args({ clientRequestId: 'idem-nt-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})

// ── sni_submit_article ─────────────────────────────────────────────────────

describe('sni_submit_article', () => {
  const TOOL = 'sni_submit_article'

  function args(overrides = {}) {
    return {
      url: 'https://techcrunch.com/2026/04/30/gpt5-announcement',
      title: 'GPT-5 Released with Extended Context Window',
      sector: 'general-ai',
      source: 'TechCrunch',
      snippet: 'OpenAI released GPT-5 today with a 2M context window.',
      scoreReason: 'Tier-1 AI announcement with broad enterprise relevance.',
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: invalid sector rejected by Zod', () => {
    const r = SubmitArticleIn.safeParse({
      url: 'https://example.com',
      title: 'Test',
      sector: 'not-a-sector',
    })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=article, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-art-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('article')
    expect(sidecar.payload.url).toBe('https://techcrunch.com/2026/04/30/gpt5-announcement')
    expect(sidecar.payload.sector).toBe('general-ai')
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-art-1')
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const a = args({ clientRequestId: 'idem-art-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})

// ── sni_add_decision ───────────────────────────────────────────────────────

describe('sni_add_decision', () => {
  const TOOL = 'sni_add_decision'

  function args(overrides = {}) {
    return {
      title: 'Exclude Palantir coverage',
      decision: 'We will not cover Palantir in the newsletter due to brand risk concerns.',
      reasoning: 'Multiple reader complaints in Week 14. Audience skews EU public sector.',
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: missing decision field rejected by Zod', () => {
    const r = AddDecisionIn.safeParse({ title: 'No decision text' })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=decision, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-dec-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('decision')
    expect(sidecar.payload.title).toBe('Exclude Palantir coverage')
    expect(sidecar.payload.decision).toContain('brand risk')
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-dec-1')
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const a = args({ clientRequestId: 'idem-dec-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})

// ── sni_submit_story_reference ─────────────────────────────────────────────

describe('sni_submit_story_reference', () => {
  const TOOL = 'sni_submit_story_reference'

  function args(overrides = {}) {
    return {
      url: 'https://www.technologyreview.com/2026/04/30/bioai',
      headline: 'MIT Researchers Use AI to Design Novel Antibiotic Compounds',
      sector: 'biopharma',
      context: 'Discussed at length in TBPN ep 44; Scott flagged as must-cover.',
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: missing headline rejected by Zod', () => {
    const r = SubmitStoryReferenceIn.safeParse({ url: 'https://example.com' })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=story_reference, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-sr-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('story_reference')
    expect(sidecar.payload.url).toBe('https://www.technologyreview.com/2026/04/30/bioai')
    expect(sidecar.payload.sector).toBe('biopharma')
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-sr-1')
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const a = args({ clientRequestId: 'idem-sr-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})

// ── sni_submit_draft_suggestion ────────────────────────────────────────────

describe('sni_submit_draft_suggestion', () => {
  const TOOL = 'sni_submit_draft_suggestion'

  function args(overrides = {}) {
    return {
      week: 17,
      target: 'tldr',
      suggestion: 'The tl;dr should open with the regulatory angle rather than the product release — readers care more about what EU AI Act enforcement means for their operations.',
      rationale: 'Matches the editorial voice established in Week 13 post-mortem notes.',
      ...overrides,
    }
  }

  it('happy path: sidecar written + audit row + queuedFor present', async () => {
    const db = getDb()
    const { result, auditRow } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args(),
      user: ALICE,
      db,
    })
    expect(result.structuredContent.contributionId).toMatch(/^[a-f0-9-]{36}$/)
    expect(result.structuredContent.queuedFor).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(auditRow.tool).toBe(TOOL)
    expect(auditRow.outcome).toBe('success')
    expect(listSidecars()).toHaveLength(1)
  })

  it('schema violation: invalid target enum rejected by Zod', () => {
    const r = SubmitDraftSuggestionIn.safeParse({
      week: 17,
      target: 'not_a_target',
      suggestion: 'some text',
    })
    expect(r.success).toBe(false)
  })

  it('sidecar shape: version=1, type=draft_suggestion, payload fields correct, no clientRequestId in payload', async () => {
    const db = getDb()
    const { result } = await callTool({
      register: registerWriteTools,
      name: TOOL,
      args: args({ clientRequestId: 'crid-ds-1' }),
      user: ALICE,
      db,
    })
    const sidecar = readSidecar(result.structuredContent.contributionId)
    expect(sidecar.version).toBe(1)
    expect(sidecar.type).toBe('draft_suggestion')
    expect(sidecar.payload.week).toBe(17)
    expect(sidecar.payload.target).toBe('tldr')
    expect(sidecar.payload).not.toHaveProperty('clientRequestId')
    expect(sidecar.clientRequestId).toBe('crid-ds-1')
  })

  it('idempotency: same clientRequestId from same user returns existing contributionId', async () => {
    const db = getDb()
    const a = args({ clientRequestId: 'idem-ds-1' })
    const first = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    const second = await callTool({ register: registerWriteTools, name: TOOL, args: a, user: ALICE, db })
    expect(second.result.structuredContent.contributionId).toBe(first.result.structuredContent.contributionId)
    expect(second.result.structuredContent.idempotent).toBe(true)
    expect(listSidecars()).toHaveLength(1)
  })
})
