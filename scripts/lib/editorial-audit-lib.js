/**
 * editorial-audit-lib.js — Pure helpers for the upstream editorial
 * audit pass. Everything in this module is deterministic, has no I/O,
 * and no LLM calls. The CLI script `scripts/editorial-audit-upstream.js`
 * drives these helpers with a live Opus 4.7 1M call.
 *
 * Target shape: every auditable item is represented as `{ kind, id }`.
 *   kind ∈ { 'analysis', 'theme-evidence', 'backlog' }
 *   id   — the state-document key (analysisIndex[id], postBacklog[id])
 *          or the composite 'T##:N' for theme evidence (T## = themeCode,
 *          N = evidence array index).
 *
 * Idempotency: every audit run appends to state.editorialAudits[] a
 * record per target — with patches=[] for clean targets. On the next
 * run, targets already audited at the current AUDIT_VERSION are
 * skipped. Bump AUDIT_VERSION when the audit prompt changes enough
 * that a re-audit is warranted (the change is usually to pick up new
 * principles that the previous version of the prompt didn't enforce).
 */

import {
  buildEvidenceCalibrationSection,
  buildMustCatchPatternsSection,
  buildCEOEmpathySection,
} from './editorial-principles.js'

/**
 * Bump when the audit prompt changes materially. Entries audited at
 * older versions will be re-picked by collectAuditTargets on the next
 * run. Keep the history here in a comment so we can trace what each
 * version did differently.
 *
 *   v1 — initial release. Evidence calibration + must-catch patterns
 *        + CEO empathy lenses applied to analysis summaries, theme
 *        evidence (claim/content/significance), backlog (title,
 *        coreArgument, notes).
 */
export const AUDIT_VERSION = 1

// ── Prompt builder ────────────────────────────────────────

/**
 * Compose the system prompt for the upstream audit pass. The auditor
 * gets all the principles used by the drafting pipeline and is asked
 * to return STRUCTURED JSON PATCHES (not prose). Patches are applied
 * by applyUpstreamAuditPatches().
 */
export function buildUpstreamAuditSystemPrompt() {
  return [
    'You are an editorial auditor for the SNI pipeline. You read raw editorial material that feeds the weekly newsletter and LinkedIn drafts, and you rewrite the parts that breach the Brightbeam editorial principles.',
    '',
    'You are NOT reading drafts. You are reading their upstream RAW MATERIAL — analysis summaries, theme evidence entries, and post backlog items (title, coreArgument, notes). The same principles apply: anything here gets quoted or paraphrased into a draft later, and if it carries a bad frame upstream, the downstream draft has to fight it.',
    '',
    buildEvidenceCalibrationSection(),
    '',
    buildMustCatchPatternsSection(),
    '',
    'CEO EMPATHY — applies to ALL three output types (analysis summary, theme evidence content, backlog title/coreArgument/notes). The SNI audience is CEOs and senior leaders across biopharma, medtech, manufacturing, insurance, and AI-native companies. Apply these four lenses:',
    '',
    buildCEOEmpathySection(),
    '',
    'OUTPUT CONTRACT — return a single JSON object, no prose commentary, no markdown fences:',
    '',
    '{',
    '  "analysisPatches": [',
    '    { "id": "309", "field": "summary", "oldValue": "<exact text from the input>", "newValue": "<rewritten version or null if uncertain>", "ruleBroken": "<short label, e.g. matters-ban, attribution-test, ceo-specific-not-systemic>" }',
    '  ],',
    '  "themeEvidencePatches": [',
    '    { "id": "T01:2", "field": "claim", "oldValue": "...", "newValue": "...", "ruleBroken": "..." }',
    '  ],',
    '  "backlogPatches": [',
    '    { "id": "44", "field": "coreArgument", "oldValue": "...", "newValue": "...", "ruleBroken": "..." }',
    '  ]',
    '}',
    '',
    'RULES FOR PATCHES:',
    '- If a target has NO issues, omit it from the output entirely. Do NOT emit empty patches for clean targets.',
    '- If a target has an issue but you CANNOT confidently rewrite it (e.g. the argument is unsalvageable without losing the point), set newValue to null. The item will be flagged in the audit log but its content untouched.',
    '- oldValue MUST match the exact text from the input so the applier can find the field. Any whitespace difference will cause the patch to be skipped.',
    '- For analysis entries, the auditable fields are: summary, keyThemes, postPotentialReasoning. Patch the one that breaches.',
    '- For theme evidence, the auditable fields are: claim, content, significance (whichever is present on the evidence entry). Patch the one that breaches.',
    '- For backlog items, the auditable fields are: title, coreArgument, notes. Patch the one that breaches.',
    '- One patch per field per target. If multiple issues co-occur in the same field, address all of them in a single rewrite.',
    '- Never introduce a new banned pattern while fixing another. A rewrite that swaps "matters" for "is significant" has not fixed the problem.',
    '',
    'TRUST LEVEL. The material you are auditing is from transcripts and research notes. Claims attributed to podcast guests, single-source opinions, and pseudonymous figures fail the attribution test even if the transcript treated them as authoritative — source-document claims are NOT gospel. Rewrite to de-attribute or cut.',
  ].join('\n')
}

/**
 * Render the user message for one audit batch. Pass the full state
 * plus the batch of targets. Each target is rendered with ID and all
 * auditable fields (analysis: summary + keyThemes + postPotentialReasoning;
 * theme evidence: claim/content/significance on the referenced entry;
 * backlog: title + coreArgument + notes + the text of its source
 * analysis entries so the auditor can judge systemic-vs-specific).
 */
export function renderAuditBatch(state, targets) {
  const parts = ['## AUDIT TARGETS', '']

  const analysisTargets = targets.filter(t => t.kind === 'analysis')
  const themeTargets = targets.filter(t => t.kind === 'theme-evidence')
  const backlogTargets = targets.filter(t => t.kind === 'backlog')

  if (analysisTargets.length) {
    parts.push('### Analysis entries', '')
    for (const { id } of analysisTargets) {
      const entry = state.analysisIndex?.[id]
      if (!entry) continue
      parts.push(`#### Analysis ${id}: ${entry.title || '(untitled)'}`)
      parts.push(`  source: ${entry.source || '—'}${entry.host ? ` / host: ${entry.host}` : ''}`)
      if (entry.summary) parts.push(`  summary: ${JSON.stringify(entry.summary)}`)
      if (entry.keyThemes) parts.push(`  keyThemes: ${JSON.stringify(entry.keyThemes)}`)
      if (entry.postPotentialReasoning) parts.push(`  postPotentialReasoning: ${JSON.stringify(entry.postPotentialReasoning)}`)
      parts.push('')
    }
  }

  if (themeTargets.length) {
    parts.push('### Theme evidence', '')
    for (const { id } of themeTargets) {
      const [code, idxStr] = id.split(':')
      const idx = parseInt(idxStr, 10)
      const theme = state.themeRegistry?.[code]
      const evidence = theme?.evidence?.[idx]
      if (!evidence) continue
      parts.push(`#### Theme ${code} (${theme.name || '(unnamed)'}), evidence #${idx}`)
      parts.push(`  id: ${id}`)
      if (evidence.claim) parts.push(`  claim: ${JSON.stringify(evidence.claim)}`)
      if (evidence.content) parts.push(`  content: ${JSON.stringify(evidence.content)}`)
      if (evidence.significance) parts.push(`  significance: ${JSON.stringify(evidence.significance)}`)
      parts.push('')
    }
  }

  if (backlogTargets.length) {
    parts.push('### Backlog items', '')
    for (const { id } of backlogTargets) {
      const post = state.postBacklog?.[id]
      if (!post) continue
      parts.push(`#### Backlog ${id}`)
      if (post.title) parts.push(`  title: ${JSON.stringify(post.title)}`)
      if (post.coreArgument) parts.push(`  coreArgument: ${JSON.stringify(post.coreArgument)}`)
      if (post.notes) parts.push(`  notes: ${JSON.stringify(post.notes)}`)
      const srcDocs = Array.isArray(post.sourceDocuments) ? post.sourceDocuments : []
      if (srcDocs.length) {
        parts.push(`  sourceDocuments: [${srcDocs.join(', ')}]`)
        for (const srcId of srcDocs) {
          const src = state.analysisIndex?.[srcId]
          if (src?.summary) {
            parts.push(`    └─ source ${srcId} summary: ${JSON.stringify(src.summary).slice(0, 500)}…`)
          }
        }
      }
      parts.push('')
    }
  }

  return parts.join('\n')
}

// ── Target collection ─────────────────────────────────────

/**
 * Collect which items in state need auditing based on the given
 * options. Returns an array of `{ kind, id }` targets.
 *
 * @param {object} state — loaded state document
 * @param {object} opts
 * @param {Date|string} [opts.since] — ISO date or Date; pick analysis
 *                                     entries with dateProcessed >= since,
 *                                     backlog with dateAdded >= since
 * @param {string[]} [opts.ids] — explicit IDs. Analysis entries are bare
 *                                numeric strings; theme evidence is 'T##:N';
 *                                backlog items are bare numeric (string)
 * @param {boolean} [opts.suggestedBacklog] — retrofit mode: every
 *                                            backlog entry with status='suggested'
 *                                            plus each's sourceDocuments analysis IDs
 * @param {number} [opts.limit] — cap returned targets
 * @param {number} [opts.auditVersion=AUDIT_VERSION] — skip items already
 *                                                      audited at this version
 * @returns {Array<{kind: string, id: string}>}
 */
export function collectAuditTargets(state, opts = {}) {
  const version = opts.auditVersion ?? AUDIT_VERSION
  const targets = []
  const seen = new Set()

  const addTarget = (kind, id) => {
    const key = `${kind}:${id}`
    if (seen.has(key)) return
    if (hasBeenAuditedAtVersion(state, kind, id, version)) return
    seen.add(key)
    targets.push({ kind, id })
  }

  // --ids: explicit identifiers. Theme-evidence IDs look like 'T##:N';
  // bare numeric IDs are analysis or backlog (check state for which).
  // Unknown IDs are silently dropped.
  if (Array.isArray(opts.ids) && opts.ids.length) {
    for (const rawId of opts.ids) {
      const id = String(rawId).trim()
      if (!id) continue
      const themeMatch = id.match(/^(T\d{2}):(\d+)$/)
      if (themeMatch) {
        const [, code, idxStr] = themeMatch
        const idx = parseInt(idxStr, 10)
        if (state.themeRegistry?.[code]?.evidence?.[idx]) {
          addTarget('theme-evidence', id)
        }
      } else if (state.postBacklog?.[id]) {
        addTarget('backlog', id)
      } else if (state.analysisIndex?.[id]) {
        addTarget('analysis', id)
      }
    }
  }

  // --suggested-backlog retrofit: every suggested item + its source analysis entries.
  if (opts.suggestedBacklog && state.postBacklog) {
    for (const [id, post] of Object.entries(state.postBacklog)) {
      if (post?.status !== 'suggested') continue
      addTarget('backlog', id)
      const srcDocs = Array.isArray(post.sourceDocuments) ? post.sourceDocuments : []
      for (const srcId of srcDocs) {
        if (state.analysisIndex?.[String(srcId)]) {
          addTarget('analysis', String(srcId))
        }
      }
    }
  }

  // --since: date-bounded forward sweep.
  if (opts.since) {
    const sinceIso = toIsoDate(opts.since)
    if (sinceIso) {
      for (const [id, entry] of Object.entries(state.analysisIndex || {})) {
        const processed = entry?.dateProcessed
        if (processed && String(processed) >= sinceIso) {
          addTarget('analysis', id)
        }
      }
      for (const [id, post] of Object.entries(state.postBacklog || {})) {
        const added = post?.dateAdded
        if (added && String(added) >= sinceIso) {
          addTarget('backlog', id)
        }
      }
      // Theme evidence: entries with a dateAdded field on the evidence
      // itself OR whose session is tagged as added since the cutoff.
      for (const [code, theme] of Object.entries(state.themeRegistry || {})) {
        const evidence = Array.isArray(theme?.evidence) ? theme.evidence : []
        evidence.forEach((ev, idx) => {
          const added = ev?.dateAdded
          if (added && String(added) >= sinceIso) {
            addTarget('theme-evidence', `${code}:${idx}`)
          }
        })
      }
    }
  }

  if (opts.limit && Number.isInteger(opts.limit) && opts.limit > 0) {
    return targets.slice(0, opts.limit)
  }
  return targets
}

function toIsoDate(since) {
  if (!since) return null
  if (since instanceof Date) return since.toISOString().slice(0, 10)
  const s = String(since).trim()
  if (!s) return null
  // Accept 'YYYY-MM-DD' or full ISO, normalise to 'YYYY-MM-DD' for
  // string comparison against the dateProcessed/dateAdded fields which
  // are stored as 'YYYY-MM-DD'.
  return s.slice(0, 10)
}

// ── Idempotency ───────────────────────────────────────────

/**
 * Has the given target already been audited at the given version?
 * Checks state.editorialAudits[]. Used by collectAuditTargets to
 * skip repeat work.
 */
export function hasBeenAuditedAtVersion(state, kind, id, version) {
  const log = Array.isArray(state?.editorialAudits) ? state.editorialAudits : []
  for (const record of log) {
    if (record?.kind === kind && record?.id === id && record?.auditVersion === version) {
      return true
    }
  }
  return false
}

// ── Patch application ─────────────────────────────────────

/**
 * Apply patches returned by the auditor to the state document. Mutates
 * state in place (safe — the caller uses saveState's write-validate-swap).
 * Appends one record per target to state.editorialAudits[] so idempotency
 * and audit-log visibility survive across runs.
 *
 * @param {object} state
 * @param {object} patches — { analysisPatches, themeEvidencePatches, backlogPatches }
 * @param {object} [opts]
 * @param {string} [opts.timestamp=new Date().toISOString()]
 * @param {number} [opts.auditVersion=AUDIT_VERSION]
 * @returns {{ applied: number, skipped: number, auditedTargets: number }}
 */
export function applyUpstreamAuditPatches(state, patches, opts = {}) {
  const timestamp = opts.timestamp || new Date().toISOString()
  const version = opts.auditVersion ?? AUDIT_VERSION

  if (!state || typeof state !== 'object') {
    throw new Error('applyUpstreamAuditPatches: state is required')
  }
  if (!Array.isArray(state.editorialAudits)) {
    state.editorialAudits = []
  }

  const summary = { applied: 0, skipped: 0, auditedTargets: 0 }

  const analysisPatches = patches?.analysisPatches || []
  const themePatches = patches?.themeEvidencePatches || []
  const backlogPatches = patches?.backlogPatches || []

  // Group patches by target for a single audit-log record per target.
  const byTarget = new Map()
  const recordFor = (kind, id) => {
    const key = `${kind}:${id}`
    if (!byTarget.has(key)) {
      byTarget.set(key, { kind, id, patches: [] })
    }
    return byTarget.get(key)
  }

  for (const p of analysisPatches) {
    const ok = tryApplyFieldPatch(state.analysisIndex, p.id, p.field, p.oldValue, p.newValue, ANALYSIS_FIELDS)
    if (ok) summary.applied++; else summary.skipped++
    recordFor('analysis', String(p.id)).patches.push(sanitizePatch(p, ok))
  }

  for (const p of themePatches) {
    const [code, idxStr] = String(p.id || '').split(':')
    const idx = parseInt(idxStr, 10)
    const theme = state.themeRegistry?.[code]
    const evidence = theme?.evidence?.[idx]
    const ok = evidence
      ? tryApplyFieldPatch({ [p.id]: evidence }, p.id, p.field, p.oldValue, p.newValue, THEME_EVIDENCE_FIELDS)
      : false
    if (ok) summary.applied++; else summary.skipped++
    recordFor('theme-evidence', String(p.id)).patches.push(sanitizePatch(p, ok))
  }

  for (const p of backlogPatches) {
    const ok = tryApplyFieldPatch(state.postBacklog, p.id, p.field, p.oldValue, p.newValue, BACKLOG_FIELDS)
    if (ok) summary.applied++; else summary.skipped++
    recordFor('backlog', String(p.id)).patches.push(sanitizePatch(p, ok))
  }

  for (const record of byTarget.values()) {
    state.editorialAudits.push({
      timestamp,
      auditVersion: version,
      kind: record.kind,
      id: record.id,
      patches: record.patches,
    })
    summary.auditedTargets++
  }

  return summary
}

/**
 * Record a clean audit (no patches needed) for a set of targets, so
 * idempotency tracking covers them on the next run. The script calls
 * this for every target in a batch that the auditor did NOT return a
 * patch for.
 */
export function recordCleanAudits(state, targets, opts = {}) {
  const timestamp = opts.timestamp || new Date().toISOString()
  const version = opts.auditVersion ?? AUDIT_VERSION
  if (!Array.isArray(state.editorialAudits)) state.editorialAudits = []
  let recorded = 0
  for (const { kind, id } of targets) {
    if (hasBeenAuditedAtVersion(state, kind, id, version)) continue
    state.editorialAudits.push({
      timestamp,
      auditVersion: version,
      kind,
      id: String(id),
      patches: [],
    })
    recorded++
  }
  return recorded
}

// ── Internal helpers ──────────────────────────────────────

const ANALYSIS_FIELDS = new Set(['summary', 'keyThemes', 'postPotentialReasoning'])
const THEME_EVIDENCE_FIELDS = new Set(['claim', 'content', 'significance'])
const BACKLOG_FIELDS = new Set(['title', 'coreArgument', 'notes'])

function tryApplyFieldPatch(container, id, field, oldValue, newValue, allowedFields) {
  if (!container || !container[id]) return false
  if (!allowedFields.has(field)) return false
  const current = container[id][field]
  if (typeof current !== 'string') return false
  // newValue === null means "flagged but not rewritten" — record in
  // log but do not mutate.
  if (newValue === null || newValue === undefined) return false
  if (typeof newValue !== 'string' || newValue.length === 0) return false
  // Exact-match requirement protects against overwriting stale state
  // if the auditor operated on an old snapshot. Allow whitespace-
  // only differences to reduce false-negatives from line endings.
  if (typeof oldValue !== 'string') return false
  if (normalise(current) !== normalise(oldValue)) return false
  container[id][field] = newValue
  return true
}

function normalise(s) {
  return String(s).replace(/\s+/g, ' ').trim()
}

function sanitizePatch(p, applied) {
  return {
    field: p.field,
    oldValue: p.oldValue,
    newValue: p.newValue,
    ruleBroken: p.ruleBroken || null,
    applied,
  }
}
