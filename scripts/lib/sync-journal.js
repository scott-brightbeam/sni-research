import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Append one entry to the sync journal JSONL file. Each line is a JSON object.
 * The directory is created if absent. Per-line appends are atomic on POSIX.
 *
 * @param {string} journalPath — absolute path to the .jsonl file
 * @param {object} entry — at minimum { syncRunId, ts, outcome }
 */
export function appendSyncLog(journalPath, entry) {
  mkdirSync(dirname(journalPath), { recursive: true })
  appendFileSync(journalPath, JSON.stringify(entry) + '\n', 'utf-8')
}

/**
 * Read the sync journal and return all entries as an array.
 * Malformed lines are returned with { _malformed: true, raw } rather than throwing.
 *
 * @param {string} journalPath
 * @returns {object[]}
 */
export function readSyncLog(journalPath) {
  if (!existsSync(journalPath)) return []
  return readFileSync(journalPath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line) }
      catch { return { _malformed: true, raw: line } }
    })
}
