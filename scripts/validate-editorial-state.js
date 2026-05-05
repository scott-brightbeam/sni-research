#!/usr/bin/env bun
/**
 * validate-editorial-state.js — Schema & constraint validation for state.json
 *
 * The editorial state document is the persistent memory of the editorial
 * intelligence system. This script validates it against all schema constraints
 * and business rules.
 *
 * Usage:
 *   Module:  import { validateEditorialState } from './validate-editorial-state.js'
 *            const { valid, errors, warnings } = validateEditorialState(state)
 *
 *   CLI:     bun scripts/validate-editorial-state.js [path]
 *            Default path: data/editorial/state.json
 *            Exit 0 = valid, Exit 1 = errors found
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'

// ── Constants ───────────────────────────────────────────

const VALID_FORMATS = new Set([
  'Format 1: The Concept Contrast',
  'Format 2: The News Decoder',
  'Format 3: The Behavioural Paradox',
  'Format 4: The Honest Confession',
  'Format 5: The Quiet Observation',
  "Format 6: The Practitioner's Take",
])

const VALID_FRESHNESS = new Set(['timely', 'evergreen', 'timely-evergreen', 'very-timely'])
const VALID_POST_STATUSES = new Set(['suggested', 'approved', 'in-progress', 'published', 'rejected', 'archived', 'unknown'])
const VALID_PRIORITIES = new Set(['immediate', 'high', 'medium-high', 'medium', 'low', 'unknown'])
const VALID_TIERS = new Set([-1, 0, 1, 2])
const VALID_ANALYSIS_STATUSES = new Set(['active', 'retired', 'stub', 'unknown'])
const STALE_POST_FIELDS = new Set(['sourceUrl', 'url', 'themes', 'sourceUrls', 'type', 'postType', 'editorialNotes', 'dateGenerated', 'angle', 'theme'])
const THEME_CODE_RE = /^T\d{2,3}$/  // allow 3-digit codes once T99 is exhausted (May 2026)

// ── Section validators ──────────────────────────────────

/**
 * Validate the postBacklog section.
 * @param {Object} postBacklog - keyed by post ID
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validatePostBacklog(postBacklog) {
  const errors = []
  const warnings = []

  if (!postBacklog || typeof postBacklog !== 'object') {
    errors.push({ code: 'POST_BACKLOG_MISSING', id: null, message: 'postBacklog is missing or not an object' })
    return { errors, warnings }
  }

  const titleLengths = []

  for (const [id, post] of Object.entries(postBacklog)) {
    if (!post || typeof post !== 'object') {
      errors.push({ code: 'POST_INVALID', id, message: `post #${id} is not an object` })
      continue
    }

    const isArchived = post.status === 'archived'

    // Title length
    if (post.title && typeof post.title === 'string') {
      if (post.title.length > 100) {
        errors.push({
          code: 'POST_TITLE_LENGTH',
          id,
          message: `post #${id}: title exceeds 100 characters (${post.title.length} chars)`,
        })
      }
      if (!isArchived) {
        titleLengths.push(post.title.length)
      }
    }

    // Format — null is allowed for archived posts
    if (post.format !== null && post.format !== undefined) {
      if (!VALID_FORMATS.has(post.format)) {
        errors.push({
          code: 'POST_FORMAT',
          id,
          message: `post #${id}: format "${post.format}" not in canonical set`,
        })
      }
    } else if (!isArchived && post.format !== null && post.format !== undefined) {
      // format is null/undefined on non-archived — that's fine, null is allowed
    }

    // Freshness — null/undefined allowed
    if (post.freshness !== null && post.freshness !== undefined) {
      if (!VALID_FRESHNESS.has(post.freshness)) {
        errors.push({
          code: 'POST_FRESHNESS',
          id,
          message: `post #${id}: freshness "${post.freshness}" not in valid set`,
        })
      }
    }

    // Status
    if (!VALID_POST_STATUSES.has(post.status)) {
      errors.push({
        code: 'POST_STATUS',
        id,
        message: `post #${id}: status "${post.status}" not in valid set`,
      })
    }

    // Priority — case-sensitive check
    if (post.priority !== undefined && post.priority !== null) {
      const lower = typeof post.priority === 'string' ? post.priority.toLowerCase() : ''
      if (VALID_PRIORITIES.has(lower) && post.priority !== lower) {
        errors.push({
          code: 'POST_PRIORITY_CASE',
          id,
          message: `post #${id}: priority should be lowercase ("${post.priority}" → "${lower}")`,
        })
      } else if (!VALID_PRIORITIES.has(lower)) {
        errors.push({
          code: 'POST_PRIORITY',
          id,
          message: `post #${id}: priority "${post.priority}" not in valid set`,
        })
      }
    }

    // sourceDocuments — all elements must be strings
    if (post.sourceDocuments !== undefined && post.sourceDocuments !== null) {
      if (!Array.isArray(post.sourceDocuments)) {
        errors.push({
          code: 'POST_SOURCE_DOCS_TYPE',
          id,
          message: `post #${id}: sourceDocuments is not an array`,
        })
      } else {
        for (let i = 0; i < post.sourceDocuments.length; i++) {
          if (typeof post.sourceDocuments[i] !== 'string') {
            errors.push({
              code: 'POST_SOURCE_DOCS_TYPE',
              id,
              message: `post #${id}: sourceDocuments[${i}] is not a string (got ${typeof post.sourceDocuments[i]})`,
            })
          }
        }
      }
    }

    // coreArgument > 50 chars for non-archived
    if (!isArchived && post.coreArgument !== undefined && post.coreArgument !== null) {
      if (typeof post.coreArgument === 'string' && post.coreArgument.length <= 50) {
        errors.push({
          code: 'POST_CORE_ARGUMENT',
          id,
          message: `post #${id}: coreArgument is too short (${post.coreArgument.length} chars, minimum 50)`,
        })
      }
    }

    // notes > 50 chars for non-archived posts from session 56+
    // Legacy posts (pre-session 56) may have empty notes — warn, don't error
    if (!isArchived && post.notes !== undefined && post.notes !== null) {
      if (typeof post.notes === 'string' && post.notes.length <= 50) {
        const target = (post.session && post.session >= 56) ? errors : warnings
        target.push({
          code: 'POST_NOTES',
          id,
          message: `post #${id}: notes is too short (${post.notes.length} chars, minimum 50)`,
        })
      }
    }

    // Stale fields
    for (const field of STALE_POST_FIELDS) {
      if (field in post) {
        errors.push({
          code: 'POST_STALE_FIELD',
          id,
          message: `post #${id}: stale field "${field}" should be removed`,
        })
      }
    }
  }

  // Warning: average title length > 60 across non-archived
  if (titleLengths.length > 0) {
    const avg = titleLengths.reduce((a, b) => a + b, 0) / titleLengths.length
    if (avg > 60) {
      warnings.push({
        code: 'POST_AVG_TITLE_LENGTH',
        id: null,
        message: `average post title length is ${Math.round(avg)} chars (target: \u2264 60)`,
      })
    }
  }

  return { errors, warnings }
}

/**
 * Validate the analysisIndex section.
 * @param {Object} analysisIndex - keyed by document ID
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validateAnalysisIndex(analysisIndex) {
  const errors = []
  const warnings = []

  if (!analysisIndex || typeof analysisIndex !== 'object') {
    errors.push({ code: 'ANALYSIS_INDEX_MISSING', id: null, message: 'analysisIndex is missing or not an object' })
    return { errors, warnings }
  }

  const filenameSeen = new Map() // lowercase filename → first ID

  for (const [id, entry] of Object.entries(analysisIndex)) {
    if (!entry || typeof entry !== 'object') {
      errors.push({ code: 'ANALYSIS_INVALID', id, message: `analysis #${id} is not an object` })
      continue
    }

    // session: present and typeof number
    if (entry.session === undefined || entry.session === null) {
      errors.push({
        code: 'ANALYSIS_SESSION_MISSING',
        id,
        message: `analysis #${id}: session is missing`,
      })
    } else if (typeof entry.session !== 'number') {
      errors.push({
        code: 'ANALYSIS_SESSION_TYPE',
        id,
        message: `analysis #${id}: session should be a number (got ${typeof entry.session})`,
      })
    }

    // tier: in VALID_TIERS
    if (entry.tier !== undefined && entry.tier !== null) {
      if (!VALID_TIERS.has(entry.tier)) {
        errors.push({
          code: 'ANALYSIS_TIER',
          id,
          message: `analysis #${id}: tier ${entry.tier} not in valid set {-1, 0, 1, 2}`,
        })
      }
    }

    // status: in VALID_ANALYSIS_STATUSES
    if (entry.status !== undefined && entry.status !== null) {
      if (!VALID_ANALYSIS_STATUSES.has(entry.status)) {
        errors.push({
          code: 'ANALYSIS_STATUS',
          id,
          message: `analysis #${id}: status "${entry.status}" not in valid set`,
        })
      }
    }

    // themes: array, each matches THEME_CODE_RE (empty array OK)
    if (entry.themes !== undefined && entry.themes !== null) {
      if (!Array.isArray(entry.themes)) {
        errors.push({
          code: 'ANALYSIS_THEMES_TYPE',
          id,
          message: `analysis #${id}: themes should be an array`,
        })
      } else {
        for (const theme of entry.themes) {
          if (typeof theme !== 'string' || !THEME_CODE_RE.test(theme)) {
            errors.push({
              code: 'ANALYSIS_THEME_CODE',
              id,
              message: `analysis #${id}: theme code "${theme}" doesn't match T## pattern`,
            })
          }
        }
      }
    }

    // summary > 50 chars for tier 1 active entries
    if (entry.tier === 1 && entry.status === 'active') {
      if (entry.summary !== undefined && entry.summary !== null && typeof entry.summary === 'string') {
        if (entry.summary.length <= 50) {
          errors.push({
            code: 'ANALYSIS_SUMMARY_SHORT',
            id,
            message: `analysis #${id}: summary too short for tier-1 active entry (${entry.summary.length} chars, minimum 50)`,
          })
        }
      }
    }

    // Duplicate filename check (case-insensitive, only entries with filename)
    if (entry.filename && typeof entry.filename === 'string') {
      const lower = entry.filename.toLowerCase()
      if (filenameSeen.has(lower)) {
        warnings.push({
          code: 'ANALYSIS_DUPLICATE_FILENAME',
          id,
          message: `analysis #${id}: duplicate filename "${entry.filename}" (first seen in #${filenameSeen.get(lower)})`,
        })
      } else {
        filenameSeen.set(lower, id)
      }
    }
  }

  // Warning: entries missing filename
  const missingFilename = Object.values(analysisIndex).filter(e => e && typeof e === 'object' && !e.filename).length
  if (missingFilename > 0) {
    warnings.push({
      code: 'ANALYSIS_MISSING_FILENAME',
      id: null,
      message: `${missingFilename} analysis entries missing filename field`,
    })
  }

  return { errors, warnings }
}

/**
 * Validate the themeRegistry section.
 * @param {Object} themeRegistry - keyed by theme code
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validateThemeRegistry(themeRegistry) {
  const errors = []
  const warnings = []

  if (!themeRegistry || typeof themeRegistry !== 'object') {
    errors.push({ code: 'THEME_REGISTRY_MISSING', id: null, message: 'themeRegistry is missing or not an object' })
    return { errors, warnings }
  }

  // Determine current session for staleness check
  let maxSession = 0
  for (const theme of Object.values(themeRegistry)) {
    if (theme && theme.evidence && Array.isArray(theme.evidence)) {
      for (const ev of theme.evidence) {
        if (typeof ev.session === 'number' && ev.session > maxSession) {
          maxSession = ev.session
        }
      }
    }
  }

  for (const [code, theme] of Object.entries(themeRegistry)) {
    if (!theme || typeof theme !== 'object') {
      errors.push({ code: 'THEME_INVALID', id: code, message: `theme ${code} is not an object` })
      continue
    }

    // Code matches THEME_CODE_RE
    if (!THEME_CODE_RE.test(code)) {
      errors.push({
        code: 'THEME_CODE',
        id: code,
        message: `theme code "${code}" doesn't match T## pattern`,
      })
    }

    // name: present and non-empty
    if (!theme.name || typeof theme.name !== 'string' || theme.name.trim() === '') {
      errors.push({
        code: 'THEME_NAME',
        id: code,
        message: `theme ${code}: name is missing or empty`,
      })
    }

    // evidence: array, each entry needs session (number), source (string), content (string)
    if (theme.evidence !== undefined && theme.evidence !== null) {
      if (!Array.isArray(theme.evidence)) {
        errors.push({
          code: 'THEME_EVIDENCE_TYPE',
          id: code,
          message: `theme ${code}: evidence should be an array`,
        })
      } else {
        for (let i = 0; i < theme.evidence.length; i++) {
          const ev = theme.evidence[i]
          if (!ev || typeof ev !== 'object') {
            errors.push({
              code: 'THEME_EVIDENCE_ENTRY',
              id: code,
              message: `theme ${code}: evidence[${i}] is not an object`,
            })
            continue
          }
          if (typeof ev.session !== 'number') {
            errors.push({
              code: 'THEME_EVIDENCE_SESSION',
              id: code,
              message: `theme ${code}: evidence[${i}].session should be a number`,
            })
          }
          if (typeof ev.source !== 'string') {
            errors.push({
              code: 'THEME_EVIDENCE_SOURCE',
              id: code,
              message: `theme ${code}: evidence[${i}].source should be a string`,
            })
          }
          if (typeof ev.content !== 'string') {
            errors.push({
              code: 'THEME_EVIDENCE_CONTENT',
              id: code,
              message: `theme ${code}: evidence[${i}].content should be a string`,
            })
          }
        }

        // documentCount >= evidence.length (evidence is trimmed to 12)
        if (typeof theme.documentCount === 'number' && theme.documentCount < theme.evidence.length) {
          errors.push({
            code: 'THEME_DOC_COUNT',
            id: code,
            message: `theme ${code}: documentCount (${theme.documentCount}) < evidence.length (${theme.evidence.length})`,
          })
        }

        // Warning: all evidence sessions older than maxSession - 10
        if (theme.evidence.length > 0 && maxSession > 10) {
          const allOld = theme.evidence.every(ev => typeof ev.session === 'number' && ev.session < maxSession - 10)
          if (allOld) {
            warnings.push({
              code: 'THEME_STALE',
              id: code,
              message: `theme ${code} ("${theme.name || '?'}"): all evidence older than session ${maxSession - 10}`,
            })
          }
        }
      }
    }
  }

  return { errors, warnings }
}

/**
 * Validate the counters section against actual index/backlog data.
 * @param {Object} counters
 * @param {Object} analysisIndex
 * @param {Object} postBacklog
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validateCounters(counters, analysisIndex, postBacklog) {
  const errors = []
  const warnings = []

  if (!counters || typeof counters !== 'object') {
    errors.push({ code: 'COUNTERS_MISSING', id: null, message: 'counters is missing or not an object' })
    return { errors, warnings }
  }

  // Required fields, typeof number, > 0
  for (const field of ['nextSession', 'nextDocument', 'nextPost']) {
    if (counters[field] === undefined || counters[field] === null) {
      errors.push({
        code: 'COUNTER_MISSING',
        id: field,
        message: `counters.${field} is missing`,
      })
    } else if (typeof counters[field] !== 'number') {
      errors.push({
        code: 'COUNTER_TYPE',
        id: field,
        message: `counters.${field} should be a number (got ${typeof counters[field]})`,
      })
    } else if (counters[field] <= 0) {
      errors.push({
        code: 'COUNTER_ZERO',
        id: field,
        message: `counters.${field} must be > 0 (got ${counters[field]})`,
      })
    }
  }

  // nextDocument > max analysis entry ID
  if (analysisIndex && typeof analysisIndex === 'object' && typeof counters.nextDocument === 'number') {
    const maxId = Object.keys(analysisIndex).reduce((max, k) => {
      const n = parseInt(k, 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)
    if (maxId > 0 && counters.nextDocument <= maxId) {
      errors.push({
        code: 'COUNTER_BEHIND',
        id: 'nextDocument',
        message: `counters.nextDocument (${counters.nextDocument}) must be > max analysis ID (${maxId})`,
      })
    }
  }

  // nextPost > max post ID
  if (postBacklog && typeof postBacklog === 'object' && typeof counters.nextPost === 'number') {
    const maxId = Object.keys(postBacklog).reduce((max, k) => {
      const n = parseInt(k, 10)
      return isNaN(n) ? max : Math.max(max, n)
    }, 0)
    if (maxId > 0 && counters.nextPost <= maxId) {
      errors.push({
        code: 'COUNTER_BEHIND',
        id: 'nextPost',
        message: `counters.nextPost (${counters.nextPost}) must be > max post ID (${maxId})`,
      })
    }
  }

  // nextSession > max session in analysis entries
  if (analysisIndex && typeof analysisIndex === 'object' && typeof counters.nextSession === 'number') {
    const maxSession = Object.values(analysisIndex).reduce((max, entry) => {
      if (entry && typeof entry.session === 'number') {
        return Math.max(max, entry.session)
      }
      return max
    }, 0)
    if (maxSession > 0 && counters.nextSession <= maxSession) {
      errors.push({
        code: 'COUNTER_BEHIND',
        id: 'nextSession',
        message: `counters.nextSession (${counters.nextSession}) must be > max session (${maxSession})`,
      })
    }
  }

  return { errors, warnings }
}

// ── pendingContributions (MCP server reverse-merge) ─────

const VALID_CONTRIBUTION_TYPES = new Set([
  'post_candidate',
  'theme_evidence',
  'new_theme',
  'article',
  'decision',
  'story_reference',
  'draft_suggestion',
])

const SUPPORTED_SIDECAR_VERSION = 1

/**
 * Validate the pendingContributions array — the queue of MCP write-tool
 * sidecars merged in by sync-to-turso's phase-0 pullContributions before
 * the destructive editorial-table sync runs.
 *
 * Each entry mirrors the on-disk sidecar shape produced by submitContribution
 * (web/api/lib/mcp-tools/contribute.js).
 *
 * @param {Array} pending
 * @returns {{ errors: Array, warnings: Array }}
 */
export function validatePendingContributions(pending) {
  const errors = []
  const warnings = []

  if (!Array.isArray(pending)) {
    errors.push({
      code: 'PENDING_CONTRIBUTIONS_TYPE',
      id: null,
      message: 'pendingContributions should be an array',
    })
    return { errors, warnings }
  }

  for (let i = 0; i < pending.length; i++) {
    const entry = pending[i]
    const id = entry?.contributionId ?? `index-${i}`

    if (!entry || typeof entry !== 'object') {
      errors.push({
        code: 'PENDING_CONTRIBUTION_INVALID',
        id,
        message: `pendingContributions[${i}] is not an object`,
      })
      continue
    }

    if (entry.version !== SUPPORTED_SIDECAR_VERSION) {
      errors.push({
        code: 'PENDING_CONTRIBUTION_VERSION',
        id,
        message: `pendingContributions[${i}]: version ${entry.version} is not supported (expected ${SUPPORTED_SIDECAR_VERSION})`,
      })
    }

    if (typeof entry.contributionId !== 'string' || entry.contributionId.length === 0) {
      errors.push({
        code: 'PENDING_CONTRIBUTION_ID',
        id,
        message: `pendingContributions[${i}]: contributionId is missing or not a string`,
      })
    }

    if (!VALID_CONTRIBUTION_TYPES.has(entry.type)) {
      errors.push({
        code: 'PENDING_CONTRIBUTION_TYPE',
        id,
        message: `pendingContributions[${i}]: type "${entry.type}" not in valid set`,
      })
    }

    if (!entry.payload || typeof entry.payload !== 'object') {
      errors.push({
        code: 'PENDING_CONTRIBUTION_PAYLOAD',
        id,
        message: `pendingContributions[${i}]: payload is missing or not an object`,
      })
    }

    if (!entry.user || typeof entry.user !== 'object' || typeof entry.user.email !== 'string') {
      errors.push({
        code: 'PENDING_CONTRIBUTION_USER',
        id,
        message: `pendingContributions[${i}]: user.email is missing`,
      })
    }

    if (typeof entry.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.ts)) {
      errors.push({
        code: 'PENDING_CONTRIBUTION_TS',
        id,
        message: `pendingContributions[${i}]: ts is not an ISO timestamp`,
      })
    }

    // payloadHash is optional (v1 sidecars without it are still valid).
    // When present, must be a 64-char lowercase hex string (SHA-256 digest).
    if ('payloadHash' in entry) {
      if (typeof entry.payloadHash !== 'string' || !/^[0-9a-f]{64}$/.test(entry.payloadHash)) {
        errors.push({
          code: 'PENDING_CONTRIBUTION_PAYLOAD_HASH',
          id,
          message: `pendingContributions[${i}]: payloadHash must be a 64-char lowercase hex string`,
        })
      }
    }
  }

  return { errors, warnings }
}

/**
 * Validate the full editorial state document.
 * @param {Object} state - the parsed state.json
 * @returns {{ valid: boolean, errors: Array, warnings: Array }}
 */
export function validateEditorialState(state) {
  const errors = []
  const warnings = []

  if (!state || typeof state !== 'object') {
    return { valid: false, errors: [{ code: 'STATE_NULL', id: null, message: 'state is null or not an object' }], warnings: [] }
  }

  // Required top-level sections
  const required = ['counters', 'analysisIndex', 'themeRegistry', 'postBacklog', 'decisionLog']
  for (const section of required) {
    if (!(section in state)) {
      errors.push({
        code: 'SECTION_MISSING',
        id: section,
        message: `required section "${section}" is missing`,
      })
    }
  }

  // decisionLog: just check it's an array
  if ('decisionLog' in state && !Array.isArray(state.decisionLog)) {
    errors.push({
      code: 'DECISION_LOG_TYPE',
      id: null,
      message: 'decisionLog should be an array',
    })
  }

  // Validate each section
  if (state.postBacklog) {
    const r = validatePostBacklog(state.postBacklog)
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  if (state.analysisIndex) {
    const r = validateAnalysisIndex(state.analysisIndex)
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  if (state.themeRegistry) {
    const r = validateThemeRegistry(state.themeRegistry)
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  if (state.counters) {
    const r = validateCounters(state.counters, state.analysisIndex || {}, state.postBacklog || {})
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  // pendingContributions is OPTIONAL (only present after Task 8b's
  // pullContributions runs). Validate only when present.
  if ('pendingContributions' in state) {
    const r = validatePendingContributions(state.pendingContributions)
    errors.push(...r.errors)
    warnings.push(...r.warnings)
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ── CLI ─────────────────────────────────────────────────

if (import.meta.main) {
  const path = process.argv[2] || join(resolve(import.meta.dir, '..'), 'data/editorial/state.json')

  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    console.error(`Failed to read ${path}: ${err.message}`)
    process.exit(2)
  }

  let state
  try {
    state = JSON.parse(raw)
  } catch (err) {
    console.error(`Failed to parse JSON: ${err.message}`)
    process.exit(2)
  }

  const { valid, errors, warnings } = validateEditorialState(state)

  for (const e of errors) {
    console.log(`[ERROR] ${e.message}`)
  }
  for (const w of warnings) {
    console.log(`[WARN]  ${w.message}`)
  }

  console.log(`---`)
  console.log(`${errors.length} error${errors.length !== 1 ? 's' : ''}, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`)

  process.exit(valid ? 0 : 1)
}
