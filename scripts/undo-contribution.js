#!/usr/bin/env bun
/**
 * undo-contribution.js — Surgical per-contribution undo via lifecycle + provenance
 *
 * Usage:
 *   bun scripts/undo-contribution.js <contributionId> [--reason "<text>"] [--by <email>] [--dry-run]
 *
 * Flags:
 *   --reason "<text>"   Recorded in the lifecycle update + journal entry
 *   --by <email>        Operator email (defaults to $USER@brightbeam.com)
 *   --dry-run           Print what would change without writing anything
 *
 * Flow: acquire lock → snapshot → look up audit row → branch on lifecycle_state
 * → splice state.json → validate → atomic write → journal → quarantine sidecar → release lock
 */

import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync,
} from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = process.env.SNI_ROOT || resolve(__dirname, '..')

import { waitAndAcquireStateLock, releaseStateLock } from './lib/state-lock.js'
import { snapshotState, pruneSnapshots } from './lib/state-snapshot.js'
import { appendSyncLog } from './lib/sync-journal.js'
import { validateEditorialState } from './validate-editorial-state.js'
import { sendTelegram } from './lib/telegram.js'

// Use web/api/lib/db.js for the production DB client (has createTestDb, migrateSchema, getDb)
import { getDb } from '../web/api/lib/db.js'

// ── Path helpers ─────────────────────────────────────────────────────────────

function getEditorialDir(root)   { return join(root, 'data/editorial') }
function getStatePath(root)      { return join(getEditorialDir(root), 'state.json') }
function getBackupDir(root)      { return join(getEditorialDir(root), 'backups') }
function getLockPath(root)       { return join(getEditorialDir(root), '.state-undo.lock') }
function getJournalPath(root)    { return join(getEditorialDir(root), 'sync-log.jsonl') }
function getProcessedDir(root)   { return join(getEditorialDir(root), 'contributions/processed') }
function getContribDir(root)     { return join(getEditorialDir(root), 'contributions') }
function getQuarantineDir(root)  { return join(getEditorialDir(root), 'contributions/quarantined') }
function getFailedDir(root)      { return join(getEditorialDir(root), 'contributions/failed') }

// ── Sidecar discovery ────────────────────────────────────────────────────────

/**
 * Walk processed/ and active contributions/ looking for {uuid}.json.
 * Returns the path if found, null otherwise.
 */
function findSidecar(root, uuid) {
  // 1. processed/**/{uuid}.json
  const processedDir = getProcessedDir(root)
  if (existsSync(processedDir)) {
    const found = walkForSidecar(processedDir, uuid)
    if (found) return found
  }
  // 2. active contributions/{uuid}.json (pulled but not yet archived)
  const active = join(getContribDir(root), `${uuid}.json`)
  if (existsSync(active)) return active
  return null
}

function walkForSidecar(dir, uuid) {
  if (!existsSync(dir)) return null
  const target = `${uuid}.json`
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = walkForSidecar(full, uuid)
      if (nested) return nested
    } else if (entry.name === target) {
      return full
    }
  }
  return null
}

// ── State mutations ──────────────────────────────────────────────────────────

/**
 * Walk state.json and collect all entries whose _origin.contributionId matches.
 * Returns { mutations: Array<{section, key, prevValue}>, removedEntries: string[] }
 */
function collectOriginEntries(state, contributionId) {
  const mutations = []
  const removedEntries = []

  // postBacklog
  for (const [id, post] of Object.entries(state.postBacklog || {})) {
    if (post?._origin?.contributionId === contributionId) {
      mutations.push({ section: 'postBacklog', key: id, prevValue: post })
      removedEntries.push(`postBacklog:${id}`)
    }
  }

  // themeRegistry — evidence[] entries
  for (const [code, theme] of Object.entries(state.themeRegistry || {})) {
    if (!theme) continue
    // Check if the theme itself was created by this contribution
    if (theme._origin?.contributionId === contributionId) {
      mutations.push({ section: 'themeRegistry:theme', key: code, prevValue: theme })
      removedEntries.push(`themeRegistry:${code} (theme creation)`)
    }
    // Check evidence entries
    if (Array.isArray(theme.evidence)) {
      const matchingEvidence = theme.evidence
        .map((ev, idx) => ({ ev, idx }))
        .filter(({ ev }) => ev?._origin?.contributionId === contributionId)
      for (const { ev, idx } of matchingEvidence) {
        mutations.push({ section: 'themeRegistry:evidence', key: code, evidenceIdx: idx, prevValue: ev })
        removedEntries.push(`themeRegistry:${code}:evidence[${idx}]`)
      }
    }
  }

  // decisionLog
  for (let i = 0; i < (state.decisionLog || []).length; i++) {
    const entry = state.decisionLog[i]
    if (entry?._origin?.contributionId === contributionId) {
      mutations.push({ section: 'decisionLog', key: i, prevValue: entry })
      removedEntries.push(`decisionLog:${i}`)
    }
  }

  return { mutations, removedEntries }
}

/**
 * Apply the collected mutations to the state in place.
 * Handles the new_theme edge case: if the theme has later evidence (not from
 * this contribution), preserve the theme but remove the _origin mark.
 */
function applyOriginRemovals(state, mutations) {
  // Process in stable order: theme evidence first (to know doc counts),
  // then theme creations (so we can check remaining evidence), then the rest.

  // Step 1: strip matched theme evidence entries (build a removal set per theme code)
  const evidenceRemovals = new Map() // code → Set of indices to remove
  for (const m of mutations) {
    if (m.section === 'themeRegistry:evidence') {
      if (!evidenceRemovals.has(m.key)) evidenceRemovals.set(m.key, new Set())
      evidenceRemovals.get(m.key).add(m.evidenceIdx)
    }
  }
  for (const [code, indices] of evidenceRemovals) {
    const theme = state.themeRegistry[code]
    if (!theme || !Array.isArray(theme.evidence)) continue
    const removedCount = indices.size
    theme.evidence = theme.evidence.filter((_, i) => !indices.has(i))
    // Decrement documentCount (but not below 0)
    if (typeof theme.documentCount === 'number') {
      theme.documentCount = Math.max(0, theme.documentCount - removedCount)
    }
  }

  // Step 2: handle theme creations
  for (const m of mutations) {
    if (m.section !== 'themeRegistry:theme') continue
    const code = m.key
    const theme = state.themeRegistry[code]
    if (!theme) continue // already gone

    const remainingEvidence = theme.evidence || []
    // Check if any remaining evidence is NOT from this contribution
    const hasLaterEvidence = remainingEvidence.some(ev =>
      !ev._origin || ev._origin.contributionId !== m.prevValue._origin?.contributionId
    )

    if (hasLaterEvidence) {
      // Preserve the theme — just remove the _origin mark and adjust documentCount
      delete theme._origin
    } else {
      // Safe to delete the entire theme
      delete state.themeRegistry[code]
    }
  }

  // Step 3: remove postBacklog entries
  for (const m of mutations) {
    if (m.section !== 'postBacklog') continue
    delete state.postBacklog[m.key]
    // Do NOT decrement nextPost — gaps are fine, prevents id-reuse confusion
  }

  // Step 4: filter decisionLog
  const decisionRemovalKeys = new Set(
    mutations.filter(m => m.section === 'decisionLog').map(m => m.key)
  )
  if (decisionRemovalKeys.size > 0) {
    state.decisionLog = (state.decisionLog || []).filter((_, i) => !decisionRemovalKeys.has(i))
  }
}

// ── Quarantine helpers ───────────────────────────────────────────────────────

/**
 * Copy a sidecar to quarantine/{YYYY-MM-DD}/ and write a sentinel .attempts file
 * in failed/ marking it as manually rolled back.
 */
function quarantineSidecar(root, sidecarPath, uuid) {
  const date = new Date().toISOString().slice(0, 10)
  const quarantineDir = join(getQuarantineDir(root), date)
  mkdirSync(quarantineDir, { recursive: true })
  const destPath = join(quarantineDir, `${uuid}.json`)
  copyFileSync(sidecarPath, destPath)

  // Write sentinel
  const failedDir = getFailedDir(root)
  mkdirSync(failedDir, { recursive: true })
  const attPath = join(failedDir, `${uuid}.attempts`)
  const existing = existsSync(attPath)
    ? (() => { try { return JSON.parse(readFileSync(attPath, 'utf8')) } catch { return { count: 0 } } })()
    : { count: 0 }
  writeFileSync(attPath, JSON.stringify({
    count: existing.count + 1,
    lastAttempt: new Date().toISOString(),
    reason: 'manually rolled back via undo-contribution',
  }, null, 2))

  return destPath
}

// ── Atomic state write ───────────────────────────────────────────────────────

function writeStateAtomic(statePath, state) {
  const tmpPath = statePath + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(state, null, 2))
  renameSync(tmpPath, statePath)
}

// ── Core undoContribution function ──────────────────────────────────────────

/**
 * Surgically reverse one contribution's effect.
 *
 * @param {object} opts
 * @param {string}  opts.contributionId — UUID of the contribution to undo
 * @param {string}  [opts.root]         — project root (defaults to ROOT)
 * @param {object}  [opts.db]           — injected DB client (defaults to getDb())
 * @param {string}  [opts.reason]       — recorded in lifecycle update + journal
 * @param {string}  [opts.by]           — operator email (defaults to $USER@brightbeam.com)
 * @param {boolean} [opts.dryRun]       — if true, print what would change without writing
 * @param {Function}[opts.telegram]     — injected sendTelegram (for tests)
 * @returns {Promise<{
 *   contributionId: string,
 *   prevLifecycle: string,
 *   newLifecycle: string,
 *   removedEntries: string[],
 *   preStatePath: string|null,
 *   journalId: string|null,
 *   sidecarPath: string|null,
 *   quarantinedPath: string|null,
 *   noOp: boolean,
 * }>}
 */
export async function undoContribution({
  contributionId,
  root = ROOT,
  db = getDb(),
  reason = null,
  by = null,
  dryRun = false,
  telegram = sendTelegram,
} = {}) {
  if (!contributionId || typeof contributionId !== 'string') {
    throw new Error('undoContribution: contributionId is required (UUID string)')
  }

  const byEmail = by || `${process.env.USER || 'operator'}@brightbeam.com`
  const statePath = getStatePath(root)
  const lockPath = getLockPath(root)
  const backupDir = getBackupDir(root)
  const journalPath = getJournalPath(root)

  // ── 1. Acquire state lock ─────────────────────────────────────────────────
  await waitAndAcquireStateLock(lockPath, { owner: 'undo-contribution', timeoutMs: 60_000 })

  let preStatePath = null

  try {
    // ── 2. Look up audit row ───────────────────────────────────────────────
    const auditRow = await (async () => {
      try {
        const result = await db.execute({
          sql: `SELECT id, contribution_id, lifecycle_state, lifecycle_updated_at, user_email, tool, payload
                FROM mcp_contributions
                WHERE contribution_id = ?
                LIMIT 1`,
          args: [contributionId],
        })
        return result.rows[0] ?? null
      } catch (err) {
        throw new Error(`undoContribution: DB lookup failed: ${err.message}`)
      }
    })()

    if (!auditRow) {
      throw new Error(`undoContribution: contribution ${contributionId} not found in mcp_contributions`)
    }

    const prevLifecycle = auditRow.lifecycle_state

    // ── 3. Handle terminal no-op states ───────────────────────────────────
    if (prevLifecycle === 'rolled_back') {
      console.log(`Contribution ${contributionId} is already rolled back at ${auditRow.lifecycle_updated_at}`)
      return {
        contributionId,
        prevLifecycle,
        newLifecycle: 'rolled_back',
        removedEntries: [],
        preStatePath: null,
        journalId: null,
        sidecarPath: null,
        quarantinedPath: null,
        noOp: true,
      }
    }

    if (prevLifecycle === 'quarantined' || prevLifecycle === 'lost') {
      console.log(`Contribution ${contributionId} is in state '${prevLifecycle}' — no action needed`)
      return {
        contributionId,
        prevLifecycle,
        newLifecycle: prevLifecycle,
        removedEntries: [],
        preStatePath: null,
        journalId: null,
        sidecarPath: null,
        quarantinedPath: null,
        noOp: true,
      }
    }

    // ── 4. Snapshot state.json ─────────────────────────────────────────────
    if (existsSync(statePath)) {
      preStatePath = snapshotState(statePath, backupDir, 'pre-undo')
      pruneSnapshots(backupDir, 'pre-undo', 30)
    }

    // ── 5. Locate sidecar ─────────────────────────────────────────────────
    const sidecarPath = findSidecar(root, contributionId)

    // ── 6. Branch on lifecycle_state ──────────────────────────────────────
    let removedEntries = []
    let quarantinedPath = null

    if (prevLifecycle === 'submitted' || prevLifecycle === 'pulled') {
      // No state.json mutation — nothing was merged yet.
      // Quarantine the sidecar if found so a re-pull won't re-merge.
      if (sidecarPath) {
        if (!dryRun) {
          quarantinedPath = quarantineSidecar(root, sidecarPath, contributionId)
        } else {
          console.log(`[dry-run] would quarantine sidecar: ${sidecarPath}`)
        }
      }
      console.log(`Contribution ${contributionId} (${prevLifecycle}) — no state.json changes needed`)

    } else if (prevLifecycle === 'merged') {
      // Splice from pendingContributions[] if present
      const state = existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf8'))
        : null

      if (state) {
        const pending = state.pendingContributions ?? []
        const before = pending.length
        state.pendingContributions = pending.filter(c => c.contributionId !== contributionId)
        const spliced = before - state.pendingContributions.length
        if (spliced > 0) {
          removedEntries.push(`pendingContributions:${contributionId}`)
        }

        if (!dryRun) {
          const validation = validateEditorialState(state)
          if (!validation.valid) {
            // Restore from snapshot
            if (preStatePath) copyFileSync(preStatePath, statePath)
            throw new Error(
              `undoContribution: state validation failed after merge rollback: ${validation.errors.map(e => e.message).join('; ')}`
            )
          }
          writeStateAtomic(statePath, state)
        }
      }

      // Quarantine sidecar so re-pull won't re-merge
      if (sidecarPath) {
        if (!dryRun) {
          quarantinedPath = quarantineSidecar(root, sidecarPath, contributionId)
        } else {
          console.log(`[dry-run] would quarantine sidecar: ${sidecarPath}`)
        }
      }

    } else if (prevLifecycle === 'consumed') {
      // Full consumed rollback — walk all known _origin destinations
      const state = existsSync(statePath)
        ? JSON.parse(readFileSync(statePath, 'utf8'))
        : null

      if (state) {
        const { mutations, removedEntries: collected } = collectOriginEntries(state, contributionId)
        removedEntries = collected

        if (dryRun) {
          console.log(`[dry-run] would change:`)
          for (const entry of collected) {
            console.log(`  - remove ${entry}`)
          }
        } else {
          if (mutations.length > 0) {
            applyOriginRemovals(state, mutations)

            // Validate after mutation
            let validation
            try {
              validation = validateEditorialState(state)
            } catch (err) {
              // Treat throws as invalid
              if (preStatePath) copyFileSync(preStatePath, statePath)
              throw new Error(`undoContribution: validator threw: ${err.message}`)
            }
            if (!validation.valid) {
              // Restore from snapshot
              if (preStatePath) copyFileSync(preStatePath, statePath)
              throw new Error(
                `undoContribution: state validation failed after consumed rollback: ${validation.errors.map(e => e.message).join('; ')}`
              )
            }
            writeStateAtomic(statePath, state)
          }

          // Write compensating audit row (new row, not an update)
          const compensatingId = randomUUID()
          try {
            await db.execute({
              sql: `INSERT INTO mcp_contributions
                      (user_email, tool, payload, outcome, contribution_id, lifecycle_state, rollback_of)
                    VALUES (?, 'sni_rollback', ?, 'success', ?, 'rolled_back', ?)`,
              args: [
                byEmail,
                JSON.stringify({ reason, removedEntries }),
                compensatingId,
                contributionId,
              ],
            })
          } catch (err) {
            // Non-fatal — log and continue
            console.warn(`[undo-contribution] failed to insert compensating row: ${err.message}`)
          }
        }

        // Quarantine sidecar
        if (sidecarPath) {
          if (!dryRun) {
            quarantinedPath = quarantineSidecar(root, sidecarPath, contributionId)
          } else {
            console.log(`[dry-run] would quarantine sidecar: ${sidecarPath}`)
          }
        }
      }
    }

    // ── 7. Update original audit row lifecycle ────────────────────────────
    if (!dryRun) {
      try {
        await db.execute({
          sql: `UPDATE mcp_contributions
                SET lifecycle_state = 'rolled_back',
                    lifecycle_updated_at = datetime('now')
                WHERE contribution_id = ?`,
          args: [contributionId],
        })
      } catch (err) {
        console.warn(`[undo-contribution] failed to update lifecycle row: ${err.message}`)
      }
    }

    // ── 8. Append journal entry ───────────────────────────────────────────
    const journalId = randomUUID()
    if (!dryRun) {
      appendSyncLog(journalPath, {
        syncRunId: journalId,
        ts: new Date().toISOString(),
        outcome: 'undo',
        contributionId,
        prevLifecycle,
        newLifecycle: 'rolled_back',
        removedEntries,
        reason,
        by: byEmail,
        preStatePath,
      })
    } else {
      console.log(`[dry-run] would append journal entry: outcome=undo, contributionId=${contributionId}, prevLifecycle=${prevLifecycle}`)
    }

    // ── 9. Summary ────────────────────────────────────────────────────────
    if (!dryRun) {
      console.log(`[undo-contribution] summary:`)
      console.log(`  contribution_id:  ${contributionId}`)
      console.log(`  prevLifecycle:    ${prevLifecycle}`)
      console.log(`  newLifecycle:     rolled_back`)
      console.log(`  removedEntries:   ${removedEntries.length}`)
      if (preStatePath) console.log(`  snapshot:         ${preStatePath}`)
      if (quarantinedPath) console.log(`  quarantined:      ${quarantinedPath}`)
      console.log(`  journalId:        ${journalId}`)
    }

    return {
      contributionId,
      prevLifecycle,
      newLifecycle: dryRun ? prevLifecycle : 'rolled_back',
      removedEntries,
      preStatePath,
      journalId: dryRun ? null : journalId,
      sidecarPath,
      quarantinedPath,
      noOp: false,
    }

  } finally {
    releaseStateLock(lockPath)
  }
}

// ── Argument parsing ─────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    contributionId: null,
    reason: null,
    by: null,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reason' && argv[i + 1]) {
      args.reason = argv[++i]
    } else if (a === '--by' && argv[i + 1]) {
      args.by = argv[++i]
    } else if (a === '--dry-run') {
      args.dryRun = true
    } else if (!a.startsWith('-') && !args.contributionId) {
      args.contributionId = a
    }
  }
  return args
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (import.meta.main) {
  const { contributionId, reason, by, dryRun } = parseArgs(process.argv.slice(2))

  if (!contributionId) {
    console.error('Usage: bun scripts/undo-contribution.js <contributionId> [--reason "<text>"] [--by <email>] [--dry-run]')
    process.exit(1)
  }

  try {
    const result = await undoContribution({ contributionId, reason, by, dryRun })
    if (result.noOp) {
      process.exit(0)
    }
  } catch (err) {
    console.error(`undo-contribution failed: ${err.message}`)
    process.exit(1)
  }
}
