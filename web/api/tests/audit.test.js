import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { readFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { audit } from '../lib/audit.js'

const ROOT = resolve(import.meta.dir, '../../..')
const AUDIT_DIR = join(ROOT, 'data/audit')
const AUDIT_PATH = join(AUDIT_DIR, 'audit.log')

let originalContent = null

// Small delay to let async audit writes flush
const flush = () => new Promise(resolve => setTimeout(resolve, 50))

describe('audit logger', () => {
  beforeAll(() => {
    if (existsSync(AUDIT_PATH)) {
      originalContent = readFileSync(AUDIT_PATH, 'utf-8')
    }
  })

  afterAll(() => {
    // Restore original or clean up
    if (originalContent !== null) {
      const { writeFileSync } = require('fs')
      writeFileSync(AUDIT_PATH, originalContent)
    } else if (existsSync(AUDIT_PATH)) {
      rmSync(AUDIT_PATH)
    }
  })

  it('writes a JSONL entry', async () => {
    audit({ sub: 'test@example.com', name: 'Test' }, 'test.action', 'item-123', { extra: true })
    await flush()

    expect(existsSync(AUDIT_PATH)).toBe(true)
    const lines = readFileSync(AUDIT_PATH, 'utf-8').trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1])

    expect(last.user).toBe('test@example.com')
    expect(last.action).toBe('test.action')
    expect(last.target).toBe('item-123')
    expect(last.extra).toBe(true)
    expect(last.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('handles null user gracefully', async () => {
    audit(null, 'anon.action', 'item-456')
    await flush()

    const lines = readFileSync(AUDIT_PATH, 'utf-8').trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1])

    expect(last.user).toBe('anonymous')
    expect(last.action).toBe('anon.action')
  })
})
