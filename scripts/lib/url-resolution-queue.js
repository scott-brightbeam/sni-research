/**
 * url-resolution-queue.js — Background URL resolution for editorial state
 *
 * When an entry is written to state.json without a URL, it gets added to
 * a resolution queue. The resolver searches for the URL, validates it,
 * and patches state.json.
 *
 * Queue location: data/editorial/url-queue.json
 * Format: array of { type, id, title, source, date, attempts, lastAttempt }
 *
 * Used by: editorial-state.js (enqueue), url-resolver agent (dequeue + resolve)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../..')
const QUEUE_PATH = join(ROOT, 'data/editorial/url-queue.json')

/**
 * Load the resolution queue.
 * @returns {Array<object>}
 */
export function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return []
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, 'utf-8'))
  } catch {
    return []
  }
}

/**
 * Save the resolution queue.
 * @param {Array<object>} queue
 */
export function saveQueue(queue) {
  mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2))
}

/**
 * Add an item to the resolution queue if not already present.
 *
 * @param {'analysis'|'evidence'|'post'} type — which state section
 * @param {object} item — identifying info
 * @param {string} item.id — entry ID (for analysis/post) or "themeCode:evidenceIndex" (for evidence)
 * @param {string} item.title — title or content snippet for search
 * @param {string} item.source — source name
 * @param {string} [item.date] — date for narrowing search
 * @param {string} [item.host] — host/author name
 */
export function enqueue(type, item) {
  const queue = loadQueue()

  // Dedup — don't add if already queued
  const key = `${type}:${item.id}`
  if (queue.some(q => `${q.type}:${q.id}` === key)) return

  queue.push({
    type,
    id: item.id,
    title: item.title || '',
    source: item.source || '',
    date: item.date || null,
    host: item.host || null,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
    lastAttempt: null,
    resolved: false,
  })

  saveQueue(queue)
}

/**
 * Mark an item as resolved and remove it from the queue.
 * @param {string} type
 * @param {string} id
 * @param {string} url — the resolved URL
 */
export function markResolved(type, id, url) {
  const queue = loadQueue()
  const updated = queue.filter(q => !(q.type === type && q.id === id))
  saveQueue(updated)
  return url
}

/**
 * Record a failed resolution attempt.
 * @param {string} type
 * @param {string} id
 */
export function markAttempted(type, id) {
  const queue = loadQueue()
  const item = queue.find(q => q.type === type && q.id === id)
  if (item) {
    item.attempts++
    item.lastAttempt = new Date().toISOString()
  }
  saveQueue(queue)
}

/**
 * Get all unresolved items, optionally filtered by type.
 * @param {'analysis'|'evidence'|'post'} [type]
 * @returns {Array<object>}
 */
export function getUnresolved(type) {
  const queue = loadQueue()
  const unresolved = queue.filter(q => !q.resolved)
  return type ? unresolved.filter(q => q.type === type) : unresolved
}

/**
 * Get a summary of the queue state.
 * @returns {{ total: number, unresolved: number, byType: object }}
 */
export function getQueueStatus() {
  const queue = loadQueue()
  const unresolved = queue.filter(q => !q.resolved)
  const byType = {}
  for (const item of unresolved) {
    byType[item.type] = (byType[item.type] || 0) + 1
  }
  return { total: queue.length, unresolved: unresolved.length, byType }
}
