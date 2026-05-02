import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { createTestDb, migrateSchema, SCHEMA_VERSION } from '../lib/db.js'

describe('MCP schema migration v6', () => {
  let db

  beforeAll(async () => {
    db = createTestDb()
    await migrateSchema(db)
  })

  afterAll(() => db.close())

  it('creates mcp_contributions with required columns including v6 additions', async () => {
    const cols = await db.execute(`PRAGMA table_info(mcp_contributions)`)
    const names = cols.rows.map(r => r.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'ts', 'user_email', 'jti', 'tool', 'payload',
      'outcome', 'error', 'latency_ms', 'contribution_id', 'client_request_id',
      'lifecycle_state', 'lifecycle_updated_at', 'rollback_of', 'payload_hash',
    ]))
  })

  it('NOT NULL on outcome is enforced', async () => {
    await expect(
      db.execute(`INSERT INTO mcp_contributions (user_email, tool) VALUES ('a','b')`)
    ).rejects.toThrow(/NOT NULL/)
  })

  it('CHECK on outcome enforces enum', async () => {
    await expect(
      db.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome) VALUES (?,?,?)`,
        args: ['a@b.com', 'tool', 'bogus_outcome'],
      })
    ).rejects.toThrow(/CHECK/)
  })

  it('mcp_revoked_tokens has jti as PK', async () => {
    const cols = await db.execute(`PRAGMA table_info(mcp_revoked_tokens)`)
    expect(cols.rows.find(r => r.pk === 1).name).toBe('jti')
  })

  it('SCHEMA_VERSION is 6', async () => {
    expect(SCHEMA_VERSION).toBe(6)
    const r = await db.execute(`SELECT version FROM schema_version`)
    expect(r.rows[0].version).toBe(6)
  })

  it('migration is idempotent', async () => {
    await migrateSchema(db)
    const r = await db.execute(`SELECT version FROM schema_version`)
    expect(r.rows[0].version).toBe(SCHEMA_VERSION)
  })

  it('indexes exist', async () => {
    const r = await db.execute(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='mcp_contributions'`)
    const idxs = r.rows.map(x => x.name)
    expect(idxs).toEqual(expect.arrayContaining([
      'idx_mcp_contributions_user_ts',
      'idx_mcp_contributions_outcome_ts',
      'idx_mcp_contributions_clientreq',
    ]))
  })

  // Positive-path coverage and idempotency UNIQUE enforcement.
  // Without these, a future tightening of (e.g.) `jti TEXT` to NOT NULL,
  // or accidentally dropping the UNIQUE keyword on the clientreq index,
  // slips through. A separate test DB keeps the inserts from polluting
  // the schema-introspection tests above.
  describe('valid inserts and uniqueness', () => {
    let posDb
    beforeAll(async () => {
      posDb = createTestDb()
      await migrateSchema(posDb)
    })
    afterAll(() => posDb.close())

    it('accepts a fully-populated row', async () => {
      await posDb.execute({
        sql: `INSERT INTO mcp_contributions
              (user_email, jti, tool, payload, outcome, error, latency_ms, contribution_id, client_request_id)
              VALUES (?,?,?,?,?,?,?,?,?)`,
        args: ['alice@brightbeam.com', 'jti-1', 'sni_search_articles',
               '{"query":"x"}', 'success', null, 12,
               '11111111-2222-3333-4444-555555555555', 'req-1'],
      })
      const r = await posDb.execute(`SELECT COUNT(*) AS c FROM mcp_contributions WHERE jti = 'jti-1'`)
      expect(r.rows[0].c).toBe(1)
    })

    it('accepts a row with only the three NOT NULL columns', async () => {
      await posDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome) VALUES (?,?,?)`,
        args: ['minimal@brightbeam.com', 'sni_get_themes', 'success'],
      })
      const r = await posDb.execute(`SELECT * FROM mcp_contributions WHERE user_email = 'minimal@brightbeam.com'`)
      expect(r.rows[0].jti).toBeNull()
      expect(r.rows[0].payload).toBeNull()
      expect(r.rows[0].error).toBeNull()
      expect(r.rows[0].latency_ms).toBeNull()
      expect(r.rows[0].contribution_id).toBeNull()
      expect(r.rows[0].client_request_id).toBeNull()
    })

    it('rejects a duplicate jti in mcp_revoked_tokens', async () => {
      await posDb.execute({
        sql: `INSERT INTO mcp_revoked_tokens (jti, revoked_by) VALUES (?,?)`,
        args: ['dup-jti', 'admin@brightbeam.com'],
      })
      await expect(
        posDb.execute({
          sql: `INSERT INTO mcp_revoked_tokens (jti, revoked_by) VALUES (?,?)`,
          args: ['dup-jti', 'admin@brightbeam.com'],
        })
      ).rejects.toThrow(/UNIQUE|PRIMARY KEY/i)
    })

    it('rejects duplicate (client_request_id, user_email) — idempotency UNIQUE', async () => {
      const args = ['alice@brightbeam.com', 'sni_submit_post_candidate', 'success', 'dup-req']
      await posDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, client_request_id) VALUES (?,?,?,?)`,
        args,
      })
      await expect(
        posDb.execute({
          sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, client_request_id) VALUES (?,?,?,?)`,
          args,
        })
      ).rejects.toThrow(/UNIQUE/i)
    })

    it('allows duplicate client_request_id from different users', async () => {
      await posDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, client_request_id) VALUES (?,?,?,?)`,
        args: ['userA@brightbeam.com', 'sni_submit_post_candidate', 'success', 'shared-req'],
      })
      await posDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, client_request_id) VALUES (?,?,?,?)`,
        args: ['userB@brightbeam.com', 'sni_submit_post_candidate', 'success', 'shared-req'],
      })
      const r = await posDb.execute(`SELECT COUNT(*) AS c FROM mcp_contributions WHERE client_request_id = 'shared-req'`)
      expect(r.rows[0].c).toBe(2)
    })
  })

  describe('v6 lifecycle columns', () => {
    let lcDb
    beforeAll(async () => {
      lcDb = createTestDb()
      await migrateSchema(lcDb)
    })
    afterAll(() => lcDb.close())

    it('lifecycle_state defaults to submitted on insert without explicit value', async () => {
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id) VALUES (?,?,?,?)`,
        args: ['lc@brightbeam.com', 'sni_search_articles', 'success', 'lc-cid-1'],
      })
      const r = await lcDb.execute(`SELECT lifecycle_state FROM mcp_contributions WHERE contribution_id = 'lc-cid-1'`)
      expect(r.rows[0].lifecycle_state).toBe('submitted')
    })

    it('lifecycle_state CHECK accepts all 7 valid values', async () => {
      const valid = ['submitted', 'pulled', 'merged', 'consumed', 'rolled_back', 'quarantined', 'lost']
      for (let i = 0; i < valid.length; i++) {
        await lcDb.execute({
          sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id, lifecycle_state) VALUES (?,?,?,?,?)`,
          args: ['lc@brightbeam.com', 'tool', 'success', `lc-cid-ls-${i}`, valid[i]],
        })
      }
      const r = await lcDb.execute(`SELECT lifecycle_state FROM mcp_contributions WHERE user_email = 'lc@brightbeam.com' AND contribution_id LIKE 'lc-cid-ls-%'`)
      const states = r.rows.map(x => x.lifecycle_state).sort()
      expect(states).toEqual([...valid].sort())
    })

    it('lifecycle_state CHECK rejects invalid value', async () => {
      await expect(
        lcDb.execute({
          sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, lifecycle_state) VALUES (?,?,?,?)`,
          args: ['lc@brightbeam.com', 'tool', 'success', 'bogus'],
        })
      ).rejects.toThrow(/CHECK/)
    })

    it('rollback_of accepts NULL', async () => {
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id, rollback_of) VALUES (?,?,?,?,?)`,
        args: ['lc@brightbeam.com', 'tool', 'success', 'lc-cid-null-rbof', null],
      })
      const r = await lcDb.execute(`SELECT rollback_of FROM mcp_contributions WHERE contribution_id = 'lc-cid-null-rbof'`)
      expect(r.rows[0].rollback_of).toBeNull()
    })

    it('rollback_of accepts a valid contribution_id FK reference', async () => {
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id) VALUES (?,?,?,?)`,
        args: ['lc@brightbeam.com', 'tool', 'success', 'lc-cid-original'],
      })
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id, rollback_of) VALUES (?,?,?,?,?)`,
        args: ['lc@brightbeam.com', 'tool', 'success', 'lc-cid-rollback', 'lc-cid-original'],
      })
      const r = await lcDb.execute(`SELECT rollback_of FROM mcp_contributions WHERE contribution_id = 'lc-cid-rollback'`)
      expect(r.rows[0].rollback_of).toBe('lc-cid-original')
    })

    it('payload_hash accepts NULL (existing v5 rows)', async () => {
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id) VALUES (?,?,?,?)`,
        args: ['lc@brightbeam.com', 'tool', 'success', 'lc-cid-no-hash'],
      })
      const r = await lcDb.execute(`SELECT payload_hash FROM mcp_contributions WHERE contribution_id = 'lc-cid-no-hash'`)
      expect(r.rows[0].payload_hash).toBeNull()
    })

    it('payload_hash accepts a 64-char hex string', async () => {
      const hash = 'a'.repeat(64)
      await lcDb.execute({
        sql: `INSERT INTO mcp_contributions (user_email, tool, outcome, contribution_id, payload_hash) VALUES (?,?,?,?,?)`,
        args: ['lc@brightbeam.com', 'tool', 'success', 'lc-cid-with-hash', hash],
      })
      const r = await lcDb.execute(`SELECT payload_hash FROM mcp_contributions WHERE contribution_id = 'lc-cid-with-hash'`)
      expect(r.rows[0].payload_hash).toBe(hash)
    })

    it('v6 migration is idempotent', async () => {
      await migrateSchema(lcDb)
      const r = await lcDb.execute(`SELECT version FROM schema_version`)
      expect(r.rows[0].version).toBe(SCHEMA_VERSION)
    })
  })
})
