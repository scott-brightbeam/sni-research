/**
 * db.js — Turso client for pipeline scripts (remote-only, no embedded replica)
 *
 * Pipeline scripts run on the local dev machine, not Fly.io, so they connect
 * directly to the remote Turso database without an embedded replica.
 */

import { createClient } from '@libsql/client'
import { loadEnvKey } from './env.js'

/**
 * Create a remote-only Turso client for pipeline sync operations.
 * Returns null if TURSO_DATABASE_URL is not configured.
 * @returns {import('@libsql/client').Client | null}
 */
export function createSyncDb() {
  const url = loadEnvKey('TURSO_DATABASE_URL')
  const authToken = loadEnvKey('TURSO_AUTH_TOKEN')
  if (!url) {
    console.warn('[db] TURSO_DATABASE_URL not set — database sync disabled')
    return null
  }
  return createClient({ url, authToken })
}
