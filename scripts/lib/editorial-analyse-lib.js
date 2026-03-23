/**
 * editorial-analyse-lib.js — Business logic for the ANALYSE pipeline
 *
 * Pure-function logic extracted from editorial-analyse.js for testability:
 *   - Source metadata extraction from transcript filenames
 *   - Deduplication (detecting already-processed transcripts)
 *   - Response application (mapping Opus JSON → state mutations)
 *   - Story reference collection for the DISCOVER pipeline
 *   - Source config loading
 *
 * The orchestration script (editorial-analyse.js) imports these and handles
 * I/O (reading transcripts, calling Opus, saving state).
 *
 * Does NOT import from any existing pipeline module in scripts/
 * except editorial-state.js (the foundation library we built).
 */

import yaml from 'js-yaml'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import {
  addAnalysisEntry,
  addThemeEvidence,
  addNewTheme,
  addCrossConnection,
  addPostBacklogEntry,
} from './editorial-state.js'

const ROOT = resolve(import.meta.dir, '../..')

// ── Source config loading ─────────────────────────────────

/**
 * Load editorial-sources.yaml and return parsed config.
 *
 * @returns {{ sources: object, budget: object, processing: object, discovery: object }}
 */
export function loadSourcesConfig() {
  const raw = readFileSync(join(ROOT, 'config/editorial-sources.yaml'), 'utf-8')
  return yaml.load(raw)
}

// ── Source metadata extraction ────────────────────────────

/**
 * Extract source metadata from a transcript filename by matching against
 * known podcast sources from editorial-sources.yaml.
 *
 * Filename conventions:
 *   "AI Daily Brief - 2026-03-15 - Big AI News.txt"
 *   "Cognitive Revolution - The Regulation Paradox.txt"
 *   "Moonshots.txt"
 *
 * @param {string} filename — transcript filename (basename, not full path)
 * @param {object} sources — sources map from loadSourcesConfig().sources
 * @returns {{ sourceKey: string|null, sourceName: string|null, host: string|null, tier: number|null, date: string|null, episode: string|null }}
 */
export function extractSourceMeta(filename, sources) {
  const baseName = filename.replace(/\.(txt|md)$/i, '')
  const result = {
    sourceKey: null,
    sourceName: null,
    host: null,
    tier: null,
    date: null,
    episode: null,
  }

  // Try to match against known source names (case-insensitive)
  const baseNameLower = baseName.toLowerCase()

  let matchedKey = null
  let matchedSource = null
  let longestMatchLen = 0

  for (const [key, source] of Object.entries(sources)) {
    const nameLC = source.name.toLowerCase()
    if (baseNameLower.startsWith(nameLC)) {
      // Prefer longest match (e.g. "No Priors" over "No")
      if (nameLC.length > longestMatchLen) {
        matchedKey = key
        matchedSource = source
        longestMatchLen = nameLC.length
      }
    }
  }

  if (matchedKey) {
    result.sourceKey = matchedKey
    result.sourceName = matchedSource.name
    result.host = matchedSource.host
    result.tier = matchedSource.tier

    // Extract the remainder after the source name
    const remainder = baseName.slice(longestMatchLen).replace(/^\s*[-–—]\s*/, '')

    if (remainder) {
      // Try to extract date (YYYY-MM-DD pattern)
      const dateMatch = remainder.match(/(\d{4}-\d{2}-\d{2})/)
      if (dateMatch) {
        result.date = dateMatch[1]
        // Everything after the date (minus separators) is the episode title
        const afterDate = remainder
          .replace(dateMatch[0], '')
          .replace(/^\s*[-–—]\s*/, '')
          .trim()
        result.episode = afterDate || null
      } else {
        // No date — the remainder is the episode title
        result.episode = remainder.trim() || null
      }
    }
  }

  return result
}

// ── Deduplication ─────────────────────────────────────────

/**
 * Check whether a transcript has already been processed.
 *
 * Primary: match on original filename (reliable — Claude can't change it).
 * Fallback: match on episode title + source name for legacy entries
 * that don't have a filename stored.
 *
 * @param {{ filename: string, episode: string|null, sourceName: string|null }} meta
 * @param {object} state — the full editorial state
 * @returns {boolean}
 */
export function isAlreadyProcessed(meta, state) {
  const entries = Object.values(state.analysisIndex || {})

  // Primary: match on filename (added Mar 2026 — prevents Claude title variation dupes)
  if (meta.filename) {
    const fnLC = meta.filename.toLowerCase()
    if (entries.some(entry => entry.filename?.toLowerCase() === fnLC)) return true
  }

  // Fallback: title + source match for legacy entries without filename
  if (meta.episode && meta.sourceName) {
    const episodeLC = meta.episode.toLowerCase()
    const sourceLC = meta.sourceName.toLowerCase()
    if (entries.some(entry =>
      !entry.filename &&
      entry.title?.toLowerCase() === episodeLC &&
      entry.source?.toLowerCase() === sourceLC
    )) return true
  }

  return false
}

// ── Response application ──────────────────────────────────

/**
 * Apply the structured JSON response from Opus ANALYSE to the state document.
 *
 * Processes each section of the response:
 *   - analysisEntries → addAnalysisEntry()
 *   - themeUpdates (add_evidence) → addThemeEvidence()
 *   - themeUpdates (new_theme) → addNewTheme()
 *   - crossConnections → addCrossConnection()
 *   - postCandidates → addPostBacklogEntry()
 *   - storyReferences → collected but not written to state
 *
 * Errors in individual items are caught and recorded, not thrown.
 * State is mutated in place.
 *
 * @param {object} response — parsed JSON from Opus
 * @param {object} state — mutated in place
 * @returns {{ entriesAdded: number, evidenceAdded: number, themesCreated: number, connectionsAdded: number, postsAdded: number, storiesCollected: number, storyReferences: Array, errors: string[] }}
 */
export function applyAnalysisResponse(response, state, { filename } = {}) {
  const stats = {
    entriesAdded: 0,
    evidenceAdded: 0,
    themesCreated: 0,
    connectionsAdded: 0,
    postsAdded: 0,
    storiesCollected: 0,
    storyReferences: [],
    errors: [],
  }

  // 1. Analysis entries — inject original filename for reliable dedup
  for (const entry of response.analysisEntries || []) {
    if (!entry || typeof entry !== 'object') {
      stats.errors.push('Analysis entry: received non-object item from Opus response')
      continue
    }
    try {
      if (filename) entry.filename = filename
      addAnalysisEntry(state, entry)
      stats.entriesAdded++
    } catch (err) {
      stats.errors.push(`Analysis entry "${entry.title || '(untitled)'}": ${err.message}`)
    }
  }

  // 2. Theme updates
  for (const update of response.themeUpdates || []) {
    if (!update || typeof update !== 'object') {
      stats.errors.push('Theme update: received non-object item from Opus response')
      continue
    }
    try {
      if (update.action === 'add_evidence') {
        addThemeEvidence(state, update.themeCode, update.evidence)
        stats.evidenceAdded++
      } else if (update.action === 'new_theme') {
        addNewTheme(state, update.themeCode, update.name, update.evidence)
        stats.themesCreated++
      } else {
        stats.errors.push(`Theme update: unrecognised action "${update.action}" for ${update.themeCode || '(no code)'}`)
      }
    } catch (err) {
      stats.errors.push(`Theme update ${update.action} ${update.themeCode}: ${err.message}`)
    }
  }

  // 3. Cross-connections
  for (const conn of response.crossConnections || []) {
    if (!conn || typeof conn !== 'object') {
      stats.errors.push('Cross-connection: received non-object item from Opus response')
      continue
    }
    try {
      addCrossConnection(state, conn.fromTheme, conn.toTheme, conn.reasoning)
      stats.connectionsAdded++
    } catch (err) {
      stats.errors.push(`Cross-connection ${conn.fromTheme || '?'}→${conn.toTheme || '?'}: ${err.message}`)
    }
  }

  // 4. Post candidates
  for (const post of response.postCandidates || []) {
    if (!post || typeof post !== 'object') {
      stats.errors.push('Post candidate: received non-object item from Opus response')
      continue
    }
    try {
      addPostBacklogEntry(state, post)
      stats.postsAdded++
    } catch (err) {
      stats.errors.push(`Post candidate "${post.title || '(untitled)'}": ${err.message}`)
    }
  }

  // 5. Story references (collected, not persisted to state)
  const stories = (response.storyReferences || []).filter(s => s && typeof s === 'object')
  stats.storyReferences = [...stories]
  stats.storiesCollected = stories.length

  return stats
}

// ── Story reference collection ────────────────────────────

/**
 * Create a story reference collector that aggregates references across
 * multiple transcript analyses and deduplicates by headline.
 *
 * @returns {{ add: (refs: Array, sourceFile: string) => void, getAll: () => Array }}
 */
export function collectStoryReferences() {
  const all = []
  const seen = new Set()

  return {
    /**
     * Add a batch of story references from a single transcript.
     * @param {Array|null|undefined} refs — story references from Opus response
     * @param {string} sourceFile — transcript filename for provenance
     */
    add(refs, sourceFile) {
      if (!refs || !Array.isArray(refs)) return

      for (const ref of refs) {
        if (!ref || typeof ref !== 'object') continue
        const key = (ref.headline || '').toLowerCase().trim()
        if (!key || seen.has(key)) continue

        seen.add(key)
        all.push({ ...ref, sourceFile })
      }
    },

    /**
     * Get all collected story references.
     * @returns {Array}
     */
    getAll() {
      return [...all]
    },
  }
}
