import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import config from './config.js'

const AUDIT_DIR = join(config.ROOT, 'data/audit')
const AUDIT_PATH = join(AUDIT_DIR, 'audit.log')

let _dirEnsured = false

/**
 * Append an audit entry to the JSONL audit log.
 * Non-blocking — fire-and-forget. Errors logged to stderr, never thrown.
 * @param {object|null} user — { sub, name } from JWT payload
 * @param {string} action — e.g. 'backlog.status', 'article.delete'
 * @param {string} target — identifier of the affected resource
 * @param {object} detail — additional context
 */
export function audit(user, action, target, detail = {}) {
  const entry = {
    ts: new Date().toISOString(),
    user: user?.sub || 'anonymous',
    action,
    target,
    ...detail,
  }
  const line = JSON.stringify(entry) + '\n'

  const write = async () => {
    if (!_dirEnsured) {
      await mkdir(AUDIT_DIR, { recursive: true })
      _dirEnsured = true
    }
    await appendFile(AUDIT_PATH, line)
  }

  write().catch(err => console.error('[audit] write failed:', err.message))
}
