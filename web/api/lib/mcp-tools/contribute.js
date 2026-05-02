import { randomUUID } from 'crypto'
import { writeFile, rename, mkdir } from 'fs/promises'
import { join } from 'path'
import { getDb } from '../db.js'
import config from '../config.js'
import { nextSyncTimestamp } from './sync-times.js'

export class SidecarError extends Error {
  constructor(msg) {
    super(msg)
    this.code = 'SIDECAR_FAILED'
  }
}

function getContribDir() {
  // Read lazily so SNI_ROOT overrides in tests take effect.
  return join(process.env.SNI_ROOT || config.ROOT, 'data/editorial/contributions')
}

/**
 * Idempotency-aware sidecar write. Returns {contributionId, queuedFor, idempotent?}.
 *
 * If clientRequestId is provided AND this user already has a successful
 * contribution with that id, returns the existing contributionId WITHOUT
 * writing a new sidecar.
 *
 * Concurrency caveat: the SELECT-then-INSERT here is NOT race-safe across
 * truly concurrent retries with the same (clientRequestId, user_email). Two
 * calls arriving in the same millisecond can both miss the SELECT and both
 * write a sidecar. The audit-row UNIQUE partial index then catches the
 * second INSERT (wrapTool logs and continues), but the duplicate sidecar
 * file is durable. pullContributions (Task 8b) is responsible for cross-
 * sidecar dedup by clientRequestId during the reverse-merge phase.
 *
 * Realistic exposure is low — a contributor would have to retry the same
 * call twice in <100ms — but the duplicate-sidecar consequence is real.
 *
 * @param {string} type     Contribution type (e.g. 'post_candidate')
 * @param {object} payload  The Zod-validated tool args (excluding clientRequestId)
 * @param {{sub: string, name?: string}} user
 * @param {string|undefined} clientRequestId
 * @returns {Promise<{contributionId: string, queuedFor: string, idempotent?: boolean}>}
 */
export async function submitContribution(type, payload, user, clientRequestId) {
  if (clientRequestId) {
    const db = getDb()
    const existing = await db.execute({
      sql: `SELECT contribution_id FROM mcp_contributions
            WHERE client_request_id = ? AND user_email = ? AND outcome = 'success'
            ORDER BY id DESC LIMIT 1`,
      args: [clientRequestId, user.sub],
    })
    if (existing.rows.length > 0 && existing.rows[0].contribution_id) {
      return {
        contributionId: existing.rows[0].contribution_id,
        queuedFor: nextSyncTimestamp(),
        idempotent: true,
      }
    }
  }

  const id = randomUUID()
  const sidecar = {
    version: 1,
    contributionId: id,
    type,
    payload,
    user: { email: user.sub, name: user.name ?? null },
    ts: new Date().toISOString(),
    clientRequestId: clientRequestId ?? null,
  }

  try {
    const contribDir = getContribDir()
    await mkdir(contribDir, { recursive: true })
    const finalPath = join(contribDir, `${id}.json`)
    const tmpPath = `${finalPath}.tmp`
    await writeFile(tmpPath, JSON.stringify(sidecar, null, 2), 'utf-8')
    await rename(tmpPath, finalPath)  // POSIX-atomic on same FS
  } catch (e) {
    throw new SidecarError(`sidecar write failed: ${e.message}`)
  }

  return { contributionId: id, queuedFor: nextSyncTimestamp() }
}
