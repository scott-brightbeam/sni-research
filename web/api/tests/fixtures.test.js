/**
 * fixtures.test.js — Tests for seed functions (fixtures.js) and the
 * MCP tool harness (mcp-harness.js).
 *
 * Every test that touches the DB uses the singleton pattern so that
 * wrapTool-style handlers (which call getDb() internally) hit the same
 * in-memory client as the assertions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { z } from 'zod'

import { getDb, _resetDbSingleton, migrateSchema } from '../lib/db.js'
import {
  seedArticles,
  seedThemes,
  seedPodcasts,
  seedPosts,
  seedDecisions,
  seedDrafts,
} from './fixtures.js'
import { callTool } from './mcp-harness.js'

// ---------------------------------------------------------------------------
// Shared DB setup
// ---------------------------------------------------------------------------

let db

beforeEach(async () => {
  _resetDbSingleton()
  db = getDb()
  await migrateSchema(db)
})

// ---------------------------------------------------------------------------
// seedArticles
// ---------------------------------------------------------------------------

describe('seedArticles', () => {
  it('inserts the requested count', async () => {
    await seedArticles(db, 10)
    const r = await db.execute('SELECT COUNT(*) AS cnt FROM articles')
    expect(r.rows[0].cnt).toBe(10)
  })

  it('cycles sectors round-robin across all 5 values', async () => {
    await seedArticles(db, 15)
    const r = await db.execute(
      'SELECT DISTINCT sector FROM articles ORDER BY sector'
    )
    expect(r.rows.length).toBe(5)
    const sectors = r.rows.map(row => row.sector).sort()
    expect(sectors).toEqual([
      'biopharma',
      'general-ai',
      'insurance',
      'manufacturing',
      'medtech',
    ])
  })
})

// ---------------------------------------------------------------------------
// seedThemes
// ---------------------------------------------------------------------------

describe('seedThemes', () => {
  it('inserts themes with codes T01..T0N', async () => {
    await seedThemes(db, 3)
    const r = await db.execute('SELECT code FROM themes ORDER BY code')
    expect(r.rows.map(row => row.code)).toEqual(['T01', 'T02', 'T03'])
  })

  it('withEvidence:true seeds 2 evidence rows per theme', async () => {
    await seedThemes(db, 2, { withEvidence: true })
    const r = await db.execute('SELECT COUNT(*) AS cnt FROM theme_evidence')
    expect(r.rows[0].cnt).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// seedPodcasts
// ---------------------------------------------------------------------------

describe('seedPodcasts', () => {
  it('inserts the requested count', async () => {
    await seedPodcasts(db, 5)
    const r = await db.execute('SELECT COUNT(*) AS cnt FROM episodes')
    expect(r.rows[0].cnt).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// seedPosts
// ---------------------------------------------------------------------------

describe('seedPosts', () => {
  it('cycles status and priority correctly', async () => {
    await seedPosts(db, 8)
    const statusR = await db.execute(
      'SELECT DISTINCT status FROM posts ORDER BY status'
    )
    const priorityR = await db.execute(
      'SELECT DISTINCT priority FROM posts ORDER BY priority'
    )
    // 8 posts: statuses cycle across 4 values — all 4 covered
    expect(statusR.rows.length).toBe(4)
    // 8 posts: priorities cycle across 3 values — all 3 covered
    expect(priorityR.rows.length).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// seedDecisions
// ---------------------------------------------------------------------------

describe('seedDecisions', () => {
  it('inserts unique IDs', async () => {
    await seedDecisions(db, 4)
    const r = await db.execute(
      'SELECT DISTINCT id FROM decisions ORDER BY id'
    )
    expect(r.rows.length).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// seedDrafts (filesystem)
// ---------------------------------------------------------------------------

describe('seedDrafts', () => {
  let tmpDir

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sni-fixtures-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes files to fsRoot/output/', async () => {
    await seedDrafts(tmpDir, 2)
    const outputDir = path.join(tmpDir, 'output')
    expect(fs.existsSync(outputDir)).toBe(true)
    const files = fs.readdirSync(outputDir).sort()
    expect(files).toEqual(['draft-week-17.md', 'draft-week-18.md'])
  })

  it('writes expected content into each file', async () => {
    await seedDrafts(tmpDir, 1)
    const content = fs.readFileSync(
      path.join(tmpDir, 'output', 'draft-week-17.md'),
      'utf8'
    )
    expect(content).toBe('# Draft week 17\n\nbody for week 17\n')
  })
})

// ---------------------------------------------------------------------------
// callTool harness — minimal stub to exercise the harness without Task 4
// ---------------------------------------------------------------------------

/**
 * Minimal test-only wrapTool stub.
 *
 * NOT the real wrapTool (that's Task 4 → web/api/lib/mcp-tools/audit.js).
 * This stub only verifies that:
 *   1. callTool can find and invoke a registered tool.
 *   2. An audit row written by the handler is queryable via db.
 *
 * Kept intentionally tiny. Do not reuse this outside fixtures.test.js.
 */
function stubWrapTool(srv, toolName, handler, { inputSchema = z.object({}).shape } = {}) {
  srv.registerTool(
    toolName,
    {
      title: 'Stub tool',
      description: 'Test-only stub for harness verification',
      inputSchema,
    },
    async (args, extra) => {
      const result = await handler(args, extra)

      // Insert an audit row so callTool's audit query finds something.
      const db = getDb()
      await db.execute({
        sql: `INSERT INTO mcp_contributions
                (user_email, tool, outcome, payload)
              VALUES (?, ?, ?, ?)`,
        args: [
          extra.authInfo?.email ?? 'unknown',
          toolName,
          'success',
          JSON.stringify(args ?? null),
        ],
      })

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      }
    }
  )
}

describe('callTool harness', () => {
  it('invokes a registered tool and returns result + audit row', async () => {
    const user = { email: 'test@example.com' }
    const expectedPayload = { hello: 'world' }

    function register(srv) {
      stubWrapTool(srv, 'test_stub_tool', async (args) => expectedPayload)
    }

    const { result, auditRow } = await callTool({
      register,
      name: 'test_stub_tool',
      args: { input: 'ignored' },
      user,
      db,
    })

    // result shape
    expect(result).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content[0].type).toBe('text')
    expect(JSON.parse(result.content[0].text)).toEqual(expectedPayload)
    expect(result.structuredContent).toEqual(expectedPayload)

    // audit row
    expect(auditRow).not.toBeNull()
    expect(auditRow.tool).toBe('test_stub_tool')
    expect(auditRow.user_email).toBe('test@example.com')
    expect(auditRow.outcome).toBe('success')
  })

  it('throws a clear error when the tool is not registered', async () => {
    function register(srv) {
      // Register under a different name
      srv.registerTool('other_tool', { title: 'Other', inputSchema: z.object({}).shape }, async () => ({
        content: [],
      }))
    }

    await expect(
      callTool({ register, name: 'missing_tool', args: {}, user: {}, db })
    ).rejects.toThrow(/tool "missing_tool" not registered/)
  })

  it('preserves authInfo for tools registered without an inputSchema', async () => {
    // The SDK's executeToolHandler dispatches handler(extra) for no-schema
    // tools. The harness mirrors this branch — without it, `extra` would be
    // shadowed by `args` and authInfo would silently disappear.
    let captured
    function register(srv) {
      srv.registerTool(
        'no_schema_tool',
        { title: 'No schema' },
        async (extra) => {
          captured = extra
          return { content: [{ type: 'text', text: 'ok' }] }
        }
      )
    }

    await callTool({
      register,
      name: 'no_schema_tool',
      args: { ignored: true },
      user: { email: 'auth@example.com' },
      db,
    })

    expect(captured?.authInfo?.email).toBe('auth@example.com')
  })
})
