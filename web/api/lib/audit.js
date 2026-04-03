import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import config from './config.js'

const AUDIT_DIR = join(config.ROOT, 'data/audit')
const AUDIT_PATH = join(AUDIT_DIR, 'audit.log')

/**
 * Append an audit entry to the JSONL audit log.
 * @param {object|null} user — { sub, name } from JWT payload
 * @param {string} action — e.g. 'backlog.status', 'article.delete'
 * @param {string} target — identifier of the affected resource
 * @param {object} detail — additional context
 */
export function audit(user, action, target, detail = {}) {
  mkdirSync(AUDIT_DIR, { recursive: true })
  const entry = {
    ts: new Date().toISOString(),
    user: user?.sub || 'anonymous',
    action,
    target,
    ...detail,
  }
  appendFileSync(AUDIT_PATH, JSON.stringify(entry) + '\n')
}
