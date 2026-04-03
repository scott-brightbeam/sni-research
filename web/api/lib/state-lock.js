/**
 * Promise-based mutex for serialising state.json writes.
 * Handles in-process concurrency (multiple HTTP requests).
 * Cross-process concurrency (API vs pipeline) uses .analyse.lock files.
 */

let _queue = Promise.resolve()

export function withStateLock(fn) {
  let release
  const acquire = new Promise(resolve => { release = resolve })
  const prev = _queue
  _queue = acquire
  return prev.then(async () => {
    try {
      return await fn()
    } finally {
      release()
    }
  })
}
