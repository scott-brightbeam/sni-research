/**
 * retry.js — Shared retry-with-backoff utility for SNI Research Tool
 *
 * Wraps any async function with configurable retry logic and exponential backoff.
 * Formula: delay = baseDelayMs * 4^(attempt-1)
 * Default: 2s → 8s → 32s (3 attempts, ~42s total wait)
 */

const RETRY_STATUS_CODES = new Set([429, 503, 529]);

/**
 * Determine if an error is retryable.
 * Retries: 429 (rate limit), 503 (unavailable), 529 (overloaded), network errors.
 * Does NOT retry: 400 (bad request), 401 (auth), 404 (not found).
 * @param {Error} error
 * @returns {boolean}
 */
export function shouldRetryApiError(error) {
  // Anthropic SDK includes status on the error object
  if (error.status && RETRY_STATUS_CODES.has(error.status)) return true;
  // Network-level errors
  const msg = error.message || '';
  if (msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED')) return true;
  if (msg.includes('ETIMEDOUT') || msg.includes('timed out') || msg.includes('timeout') || msg.includes('fetch failed')) return true;
  if (msg.includes('network') || msg.includes('socket')) return true;
  // Anthropic overloaded message
  if (msg.includes('overloaded')) return true;
  return false;
}

/**
 * Wrap an async function with retry + exponential backoff.
 *
 * @param {() => Promise<T>} fn — async function to execute
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=3]
 * @param {number} [opts.baseDelayMs=2000] — 2s, 8s, 32s with base=2000 and factor=4
 * @param {(attempt: number, error: Error) => void} [opts.onRetry] — called before each retry
 * @param {(error: Error) => boolean} [opts.shouldRetry] — return false to abort immediately
 * @returns {Promise<T>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 2000,
    onRetry = () => {},
    shouldRetry = shouldRetryApiError,
  } = opts;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      if (!shouldRetry(error)) break;

      const delay = baseDelayMs * Math.pow(4, attempt - 1);
      onRetry(attempt, error);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}
