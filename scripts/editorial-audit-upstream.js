#!/usr/bin/env bun
/**
 * editorial-audit-upstream.js — Deterministic tooling for the Claude-Code-
 * native upstream editorial audit. Splits into three I/O modes that
 * a Claude Code skill drives:
 *
 *   --list-targets     Print JSON: { targets, batches, systemPrompt }.
 *                      Claude Code reads this, reasons through each batch
 *                      using the principles, produces patches.
 *
 *   --print-principles Print the composed system prompt text. Convenience
 *                      for operator inspection.
 *
 *   --apply-patches FILE
 *                      Apply a JSON patches file written by the skill.
 *                      Records clean audits for targets in the file's
 *                      `auditedTargetIds` that received no patch. Writes
 *                      state.json via the existing write-validate-swap.
 *
 * No Anthropic API calls. The LLM reasoning runs inside the Claude Code
 * session that drives the skill, under the user's subscription — not
 * metered API. This script is the deterministic plumbing around that
 * reasoning: target collection (idempotent by AUDIT_VERSION), rendering
 * the audit material, and atomic patch application.
 *
 * CLI flags:
 *   --since DATE          YYYY-MM-DD cutoff (default: yesterday UTC)
 *   --ids ID1,ID2,…       Explicit IDs (analysis, backlog numeric, or T##:N)
 *   --suggested-backlog   Retrofit: every status='suggested' post + sourceDocuments
 *   --limit N             Cap number of targets
 *   --batch-size N        Targets per batch (default 8)
 *   --force-all-versions  Re-audit items already recorded at current AUDIT_VERSION
 *   --dry-run             Print plan, skip state writes (apply-patches mode)
 */

import { readFileSync } from 'fs'
import {
  loadState,
  saveState,
  logActivity,
} from './lib/editorial-state.js'
import {
  AUDIT_VERSION,
  buildUpstreamAuditSystemPrompt,
  renderAuditBatch,
  collectAuditTargets,
  applyUpstreamAuditPatches,
  recordCleanAudits,
} from './lib/editorial-audit-lib.js'

// ── CLI parsing ──────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    mode: null,               // 'list-targets' | 'print-principles' | 'apply-patches'
    patchesFile: null,
    since: null,
    ids: null,
    suggestedBacklog: false,
    limit: null,
    batchSize: 8,
    dryRun: false,
    forceAllVersions: false,
  }
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    switch (a) {
      case '--list-targets':
        opts.mode = 'list-targets'
        break
      case '--print-principles':
        opts.mode = 'print-principles'
        break
      case '--apply-patches':
        opts.mode = 'apply-patches'
        opts.patchesFile = args[++i]
        break
      case '--since':
        opts.since = args[++i]
        break
      case '--ids':
        opts.ids = (args[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
        break
      case '--suggested-backlog':
        opts.suggestedBacklog = true
        break
      case '--limit':
        opts.limit = parseInt(args[++i], 10)
        break
      case '--batch-size':
        opts.batchSize = parseInt(args[++i], 10)
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--force-all-versions':
        opts.forceAllVersions = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
      default:
        console.error(`Unknown flag: ${a}`)
        printHelp()
        process.exit(1)
    }
  }
  if (!opts.mode) {
    console.error('One of --list-targets, --print-principles, --apply-patches is required')
    printHelp()
    process.exit(1)
  }
  if (opts.mode === 'apply-patches' && !opts.patchesFile) {
    console.error('--apply-patches requires a JSON file path')
    process.exit(1)
  }
  if (opts.mode === 'list-targets') {
    if (!opts.since && !opts.ids && !opts.suggestedBacklog) {
      const y = new Date(Date.now() - 24 * 60 * 60 * 1000)
      opts.since = y.toISOString().slice(0, 10)
    }
    if (opts.limit != null && (!Number.isInteger(opts.limit) || opts.limit <= 0)) {
      console.error('--limit must be a positive integer')
      process.exit(1)
    }
    if (!Number.isInteger(opts.batchSize) || opts.batchSize <= 0 || opts.batchSize > 30) {
      console.error('--batch-size must be between 1 and 30')
      process.exit(1)
    }
  }
  return opts
}

function printHelp() {
  console.log(`
editorial-audit-upstream — Claude-Code-native upstream audit tooling

Usage:
  bun scripts/editorial-audit-upstream.js --list-targets [flags]       # plan + batches
  bun scripts/editorial-audit-upstream.js --print-principles           # prompt text
  bun scripts/editorial-audit-upstream.js --apply-patches FILE         # apply patches

List-targets flags:
  --since DATE          Items with dateProcessed/dateAdded >= DATE (default: yesterday)
  --ids ID1,ID2,…       Specific IDs (numeric for analysis/backlog, T##:N for theme evidence)
  --suggested-backlog   Retrofit: all status='suggested' posts + their source analysis
  --limit N             Cap returned targets
  --batch-size N        Targets per batch (default 8)
  --force-all-versions  Ignore the audit-log idempotency check

Apply-patches flags:
  --dry-run             Print summary + patches, do NOT save state

Examples:
  bun scripts/editorial-audit-upstream.js --list-targets --since 2026-04-17
  bun scripts/editorial-audit-upstream.js --print-principles > /tmp/principles.md
  bun scripts/editorial-audit-upstream.js --apply-patches /tmp/audit-patches.json
`.trimStart())
}

// ── Modes ─────────────────────────────────────────────────

function modeListTargets(opts) {
  const state = loadState()
  if (!state) {
    console.error('Failed to load state.json')
    process.exit(1)
  }

  const collectOpts = opts.forceAllVersions ? { ...opts, auditVersion: -1 } : opts
  const targets = collectAuditTargets(state, collectOpts)

  // Slice into batches of opts.batchSize.
  const batches = []
  for (let i = 0; i < targets.length; i += opts.batchSize) {
    batches.push(targets.slice(i, i + opts.batchSize))
  }

  const payload = {
    auditVersion: AUDIT_VERSION,
    generatedAt: new Date().toISOString(),
    options: {
      since: opts.since,
      ids: opts.ids,
      suggestedBacklog: opts.suggestedBacklog,
      limit: opts.limit,
      batchSize: opts.batchSize,
      forceAllVersions: opts.forceAllVersions,
    },
    totalTargets: targets.length,
    targetsByKind: targets.reduce((acc, t) => {
      acc[t.kind] = (acc[t.kind] || 0) + 1
      return acc
    }, {}),
    systemPrompt: buildUpstreamAuditSystemPrompt(),
    batches: batches.map((batch, i) => ({
      batchIndex: i,
      targetCount: batch.length,
      targets: batch,
      rendered: renderAuditBatch(state, batch),
    })),
  }

  process.stdout.write(JSON.stringify(payload, null, 2))
  process.stdout.write('\n')
}

function modePrintPrinciples() {
  process.stdout.write(buildUpstreamAuditSystemPrompt())
  process.stdout.write('\n')
}

function modeApplyPatches(opts) {
  let patches
  try {
    patches = JSON.parse(readFileSync(opts.patchesFile, 'utf-8'))
  } catch (err) {
    console.error(`Failed to read patches file ${opts.patchesFile}: ${err.message}`)
    process.exit(1)
  }

  const state = loadState()
  if (!state) {
    console.error('Failed to load state.json')
    process.exit(1)
  }

  // Apply the patches.
  const result = applyUpstreamAuditPatches(state, patches)

  // Clean-audit bookkeeping: skill supplies `auditedTargetIds` with every
  // target it reviewed, whether it produced a patch or not. Record every
  // reviewed target without a patch so the next run skips them (idempotency).
  const patchedKeys = new Set([
    ...(patches.analysisPatches || []).map(p => `analysis:${p.id}`),
    ...(patches.themeEvidencePatches || []).map(p => `theme-evidence:${p.id}`),
    ...(patches.backlogPatches || []).map(p => `backlog:${p.id}`),
  ])
  const reviewed = Array.isArray(patches.auditedTargetIds) ? patches.auditedTargetIds : []
  const cleanTargets = reviewed.filter(t => !patchedKeys.has(`${t.kind}:${t.id}`))
  const cleanRecorded = recordCleanAudits(state, cleanTargets)

  // Summary.
  console.log(`[audit-upstream] apply-patches:`)
  console.log(`  applied        ${result.applied}`)
  console.log(`  skipped        ${result.skipped}`)
  console.log(`  auditedTargets ${result.auditedTargetTargets ?? result.auditedTargets ?? 0}`)
  console.log(`  cleanRecorded  ${cleanRecorded}`)

  if (opts.dryRun) {
    console.log(`[audit-upstream] --dry-run: state.json NOT written`)
    return
  }

  try {
    saveState(state)
    console.log(`[audit-upstream] state.json saved`)
  } catch (err) {
    console.error(`Failed to save state.json: ${err.message}`)
    process.exit(2)
  }

  logActivity(
    'editorial-audit',
    `Applied ${result.applied} patches across ${reviewed.length} target(s)`,
    `applied=${result.applied} skipped=${result.skipped} cleanRecorded=${cleanRecorded}`,
  )
}

// ── Main ──────────────────────────────────────────────────

function main() {
  const opts = parseArgs(process.argv)
  switch (opts.mode) {
    case 'list-targets':
      return modeListTargets(opts)
    case 'print-principles':
      return modePrintPrinciples()
    case 'apply-patches':
      return modeApplyPatches(opts)
  }
}

try {
  main()
} catch (err) {
  console.error('FATAL:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
}
