/**
 * mcp-rate-limit.js — In-memory per-user sliding-window limiter for /mcp.
 *
 * 60 calls per 60-second window per user_email. Buckets are kept in a
 * module-scope Map; on each call, timestamps older than WINDOW_MS are
 * pruned and the new call is appended. When the bucket is at capacity
 * the call is rejected with a Retry-After hint derived from the oldest
 * remaining timestamp.
 *
 * Per-process state — fine for the single-machine Fly deployment we run
 * today. If the app ever scales horizontally, lift this into a shared
 * store (Redis, Turso) keyed by user_email.
 */

const WINDOW_MS = 60_000
const LIMIT = 60

const buckets = new Map()

/**
 * Check + record a call for the given user. Returns
 * { ok: true } if under the limit (call is recorded as a side effect),
 * { ok: false, retryAfterSec } if over.
 *
 * @param {string} userEmail
 * @returns {{ ok: true } | { ok: false, retryAfterSec: number }}
 */
export function rateLimitCheck(userEmail) {
  const now = Date.now()
  const arr = buckets.get(userEmail) || []
  const recent = arr.filter((t) => now - t < WINDOW_MS)
  if (recent.length >= LIMIT) {
    const oldest = recent[0]
    const retryAfterSec = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000))
    // Persist the pruned (still-over-limit) array so we don't accumulate
    // unbounded historical timestamps even while the user is being rejected.
    buckets.set(userEmail, recent)
    return { ok: false, retryAfterSec }
  }
  recent.push(now)
  buckets.set(userEmail, recent)
  return { ok: true }
}

/** Test-only reset. */
export function _resetRateLimitForTests() {
  buckets.clear()
}
