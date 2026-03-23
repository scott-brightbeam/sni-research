#!/usr/bin/env bun
/**
 * editorial-analyse.js — ANALYSE stage of the editorial intelligence pipeline
 *
 * Reads podcast transcripts from the configured directory, processes each through
 * Opus 4.6 with the editorial ANALYSE prompt, and applies the structured results
 * to state.json (analysis entries, theme evidence, cross-connections, post candidates).
 *
 * Story references are collected and saved for the DISCOVER pipeline.
 *
 * Usage:
 *   bun scripts/editorial-analyse.js                    # Process all pending transcripts
 *   bun scripts/editorial-analyse.js --transcript FILE  # Process a single file
 *   bun scripts/editorial-analyse.js --dry-run          # Show what would be processed
 *   bun scripts/editorial-analyse.js --limit N          # Process at most N transcripts
 *
 * Reads:  config/editorial-sources.yaml, config/prompts/editorial-*.txt,
 *         data/editorial/state.json, ~/Desktop/Podcast Transcripts/*.txt
 * Writes: data/editorial/state.json, data/editorial/activity.json,
 *         data/editorial/stories-session-N.json
 *
 * Does NOT import from any existing pipeline module in scripts/ except
 * shared utilities (retry.js, env.js, multi-model.js).
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs'
import { join, resolve, basename } from 'path'
import {
  loadState,
  saveState,
  beginSession,
  logActivity,
  addNotification,
  recomputeCorpusStats,
} from './lib/editorial-state.js'
import { buildAnalyseContext } from './lib/editorial-context.js'
import { callOpus, getSessionCosts, resetSessionCosts, validateProviders } from './lib/editorial-multi-model.js'
import {
  extractSourceMeta,
  isAlreadyProcessed,
  applyAnalysisResponse,
  collectStoryReferences,
  loadSourcesConfig,
} from './lib/editorial-analyse-lib.js'

const ROOT = resolve(import.meta.dir, '..')

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [analyse]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [analyse] ⚠`, ...a)
const err  = (...a) => console.error(`[${ts()}] [analyse] ✗`, ...a)

// ── CLI argument parsing ────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    transcript: null,   // single file path
    dryRun: false,
    limit: null,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--transcript':
        if (i + 1 >= args.length) { err('--transcript requires a file path'); process.exit(1) }
        opts.transcript = args[++i]
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--limit': {
        if (i + 1 >= args.length) { err('--limit requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 0) { err(`Invalid --limit value: ${args[i]}`); process.exit(1) }
        opts.limit = n
        break
      }
      default:
        // Treat bare args as transcript paths
        if (!args[i].startsWith('--')) {
          opts.transcript = args[i]
        }
    }
  }

  return opts
}

// ── Transcript discovery ────────────────────────────────

/**
 * Find transcript files to process.
 *
 * @param {string} transcriptDir — configured transcript directory
 * @param {object} sources — source config from editorial-sources.yaml
 * @param {object} state — current editorial state
 * @param {object} opts — { limit?, transcript? }
 * @returns {{ path: string, filename: string, meta: object }[]}
 */
function findPendingTranscripts(transcriptDir, sources, state, opts = {}) {
  // Single file mode
  if (opts.transcript) {
    const filePath = resolve(opts.transcript)
    if (!existsSync(filePath)) {
      err(`Transcript not found: ${filePath}`)
      return []
    }
    const filename = basename(filePath)
    const meta = extractSourceMeta(filename, sources)
    return [{ path: filePath, filename, meta }]
  }

  // Directory scan mode
  const expandedDir = transcriptDir.replace(/^~/, process.env.HOME || '')
  if (!existsSync(expandedDir)) {
    warn(`Transcript directory not found: ${expandedDir}`)
    warn('Create it and add .txt transcript files, or use --transcript FILE')
    return []
  }

  const files = readdirSync(expandedDir)
    .filter(f => /\.(txt|md)$/i.test(f))
    .sort() // alphabetical for predictable ordering

  const pending = []
  for (const filename of files) {
    const meta = extractSourceMeta(filename, sources)

    // Skip already-processed transcripts
    if (meta.episode && isAlreadyProcessed(meta, state)) {
      log(`  Skip (already processed): ${filename}`)
      continue
    }

    pending.push({
      path: join(expandedDir, filename),
      filename,
      meta,
    })
  }

  // Apply limit
  const limit = opts.limit || Infinity
  return pending.slice(0, limit)
}

// ── Single transcript processing ────────────────────────

/**
 * Process a single transcript through the ANALYSE pipeline.
 *
 * @param {{ path: string, filename: string, meta: object }} item
 * @param {object} state — mutated in place
 * @param {number} index — 1-based index for logging
 * @param {number} total — total transcripts to process
 * @returns {Promise<{ stats: object, storyRefs: Array }>}
 */
async function processTranscript(item, state, index, total) {
  const { path: filePath, filename, meta } = item
  const label = meta.sourceName
    ? `${meta.sourceName}${meta.episode ? ` — ${meta.episode}` : ''}`
    : filename

  log(`[${index}/${total}] Processing: ${label}`)

  // Read transcript
  let transcript
  try {
    transcript = readFileSync(filePath, 'utf-8')
  } catch (ioErr) {
    err(`  File read failed for ${filename}: ${ioErr.message}`)
    return { stats: null, storyRefs: [] }
  }

  if (!transcript.trim()) {
    warn(`  Empty transcript: ${filename}`)
    return { stats: null, storyRefs: [] }
  }

  // Build context
  const context = buildAnalyseContext(transcript, {
    source: meta.sourceName,
    episode: meta.episode,
    date: meta.date,
  })

  log(`  Context: ~${context.tokenEstimate.toLocaleString()} tokens`)

  // Call Opus 4.6 — extractJSON may throw if response is not valid JSON,
  // so we catch and handle gracefully with diagnostic output
  const startTime = Date.now()
  let response
  try {
    response = await callOpus(context.user, {
      system: context.system,
      maxTokens: 8000,
      temperature: 0.4, // lower temperature for structured analysis
    })
  } catch (apiErr) {
    // extractJSON throws if Opus returns non-JSON; catch here for diagnostics
    err(`  Opus call failed for ${filename}: ${apiErr.message}`)
    logActivity('error', `ANALYSE API failure: ${filename}`, apiErr.message)
    return { stats: null, storyRefs: [] }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  log(`  Opus response: ${elapsed}s, ${response.inputTokens.toLocaleString()} in / ${response.outputTokens.toLocaleString()} out`)

  // Validate JSON parse succeeded (extractJSON returns object or throws;
  // null only if rawText was set, which we don't use here)
  if (!response.parsed) {
    err(`  Failed to parse JSON from Opus response for: ${filename}`)
    err(`  Raw response (first 500 chars): ${(response.raw || '').slice(0, 500)}`)
    logActivity('error', `ANALYSE parse failure: ${filename}`, 'Opus returned non-JSON response')
    return { stats: null, storyRefs: [] }
  }

  // Validate response has expected structure before processing
  const expectedKeys = ['analysisEntries', 'themeUpdates', 'crossConnections', 'postCandidates', 'storyReferences']
  const hasExpectedKey = expectedKeys.some(k => Array.isArray(response.parsed[k]))
  if (!hasExpectedKey) {
    warn(`  Unexpected response structure from Opus for: ${filename}`)
    warn(`  Top-level keys: ${Object.keys(response.parsed).join(', ')}`)
    logActivity('error', `ANALYSE unexpected structure: ${filename}`, `Keys: ${Object.keys(response.parsed).join(', ')}`)
    return { stats: null, storyRefs: [] }
  }

  // Capture next post ID before applying — needed for correct notification assignment
  const nextPostBefore = state.counters.nextPost

  // Apply response to state
  const stats = applyAnalysisResponse(response.parsed, state)

  // Log results
  log(`  Results: ${stats.entriesAdded} entries, ${stats.evidenceAdded} evidence, ` +
      `${stats.themesCreated} themes, ${stats.connectionsAdded} connections, ` +
      `${stats.postsAdded} posts, ${stats.storiesCollected} stories`)

  if (stats.errors.length > 0) {
    for (const error of stats.errors) {
      warn(`  ${error}`)
    }
  }

  // Warn on zero-result analysis (likely a problem)
  if (stats.entriesAdded === 0 && stats.evidenceAdded === 0 && stats.storiesCollected === 0) {
    warn(`  Zero results from analysis of ${filename} — check response quality`)
  }

  // Notify for high-priority post candidates using correct post IDs
  const postCandidates = response.parsed.postCandidates || []
  for (let j = 0; j < postCandidates.length; j++) {
    const post = postCandidates[j]
    if (post && (post.priority === 'immediate' || post.priority === 'high')) {
      const postId = nextPostBefore + j
      if (state.postBacklog[String(postId)]) {
        addNotification(postId, post.title, post.priority, post.coreArgument || '')
      }
    }
  }

  return { stats, storyRefs: stats.storyReferences }
}

// ── Cost logging ────────────────────────────────────────

/**
 * Persist session cost data to data/editorial/cost-log.json for the web API.
 *
 * @param {number} sessionNum
 * @param {object} costs — from getSessionCosts()
 * @param {string} elapsed — formatted elapsed time
 * @param {object} config — source config (for budget)
 */
function saveCostLog(sessionNum, costs, elapsed, config) {
  const costLogPath = join(ROOT, 'data/editorial/cost-log.json')
  let costLog = {}
  if (existsSync(costLogPath)) {
    try { costLog = JSON.parse(readFileSync(costLogPath, 'utf-8')) } catch { costLog = {} }
  }

  if (!costLog.sessions) costLog.sessions = {}
  if (!costLog.weeks) costLog.weeks = {}

  // Record session cost
  costLog.sessions[sessionNum] = {
    timestamp: new Date().toISOString(),
    elapsed,
    stage: 'analyse',
    costs: {
      opus: { calls: costs.opus.calls, cost: costs.opus.cost },
      gemini: { calls: costs.gemini.calls, cost: costs.gemini.cost },
      openai: { calls: costs.openai.calls, cost: costs.openai.cost },
    },
    total: costs.total,
  }

  // Aggregate weekly cost (ISO week number)
  const now = new Date()
  const startOfYear = new Date(now.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((now - startOfYear) / 86400000)
  const weekNum = Math.ceil((dayOfYear + startOfYear.getDay() + 1) / 7)
  const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`

  if (!costLog.weeks[weekKey]) {
    costLog.weeks[weekKey] = {
      weeklyTotal: 0,
      budget: config.budget?.weekly_cap_usd || 50,
      breakdown: { analyse: 0, discover: 0, draft: 0, critique: 0 },
    }
  }

  costLog.weeks[weekKey].weeklyTotal += costs.total
  costLog.weeks[weekKey].breakdown.analyse += costs.total

  writeFileSync(costLogPath, JSON.stringify(costLog, null, 2))
  log(`  Cost logged to cost-log.json (week ${weekKey})`)
}

// ── Main pipeline ───────────────────────────────────────

async function main() {
  const opts = parseArgs()
  const startTime = Date.now()

  log('═══════════════════════════════════════════════')
  log('  EDITORIAL ANALYSE PIPELINE')
  log('═══════════════════════════════════════════════')

  // 1. Validate providers
  const providers = validateProviders()
  if (!providers.ready) {
    err('Missing API keys:')
    for (const missing of providers.missing) {
      err(`  • ${missing}`)
    }
    process.exit(1)
  }

  // 2. Load config
  let config
  try {
    config = loadSourcesConfig()
  } catch (e) {
    err(`Failed to load editorial-sources.yaml: ${e.message}`)
    process.exit(1)
  }

  // 3. Load state
  const state = loadState()
  if (!state) {
    err('Cannot load data/editorial/state.json — run editorial-convert-state.js first')
    process.exit(1)
  }

  log(`State: ${Object.keys(state.analysisIndex).length} entries, ` +
      `${Object.keys(state.themeRegistry).length} themes, ` +
      `${Object.keys(state.postBacklog).length} posts`)

  // 4. Find transcripts to process (BEFORE starting session to avoid wasted session numbers)
  const transcriptDir = config.processing?.transcript_dir || '~/Desktop/Podcast Transcripts'
  const maxTranscripts = opts.limit ?? config.processing?.max_transcripts_per_session ?? 25

  const pending = findPendingTranscripts(transcriptDir, config.sources, state, {
    limit: maxTranscripts,
    transcript: opts.transcript,
  })

  if (pending.length === 0) {
    if (opts.transcript) {
      err(`Transcript not found or already processed: ${opts.transcript}`)
      process.exit(1)
    }
    log('No pending transcripts to process.')
    return
  }

  log(`Found ${pending.length} transcript${pending.length === 1 ? '' : 's'} to process`)

  if (opts.dryRun) {
    log('\n── DRY RUN — would process: ──')
    for (const item of pending) {
      const label = item.meta.sourceName
        ? `${item.meta.sourceName}${item.meta.episode ? ` — ${item.meta.episode}` : ''}`
        : item.filename
      log(`  • ${label} (Tier ${item.meta.tier ?? '?'})`)
    }
    log(`\nEstimated cost: ~$${(pending.length * 0.50).toFixed(2)} (rough avg $0.50/transcript)`)
    return
  }

  // 5. Begin session (only if we have work to do and not in dry-run)
  resetSessionCosts()
  const sessionNum = beginSession(state)
  log(`Session ${sessionNum} started`)

  // 6. Process each transcript
  const storyCollector = collectStoryReferences()
  const totals = {
    processed: 0,
    skipped: 0,
    failed: 0,
    entriesAdded: 0,
    evidenceAdded: 0,
    themesCreated: 0,
    connectionsAdded: 0,
    postsAdded: 0,
    storiesCollected: 0,
  }

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i]
    try {
      const { stats, storyRefs } = await processTranscript(item, state, i + 1, pending.length)

      if (stats) {
        totals.processed++
        totals.entriesAdded += stats.entriesAdded
        totals.evidenceAdded += stats.evidenceAdded
        totals.themesCreated += stats.themesCreated
        totals.connectionsAdded += stats.connectionsAdded
        totals.postsAdded += stats.postsAdded
        totals.storiesCollected += stats.storiesCollected
        storyCollector.add(storyRefs, item.filename)
      } else {
        totals.skipped++
      }

      // Save state after each transcript for crash safety
      recomputeCorpusStats(state)
      saveState(state)
      log(`  State saved (${Object.keys(state.analysisIndex).length} entries total)`)

    } catch (error) {
      totals.failed++
      err(`  FAILED: ${item.filename}: ${error.message}`)
      logActivity('error', `ANALYSE failed: ${item.filename}`, error.message)

      // Save state even on failure (preserves progress from previous transcripts)
      try {
        saveState(state)
      } catch (saveError) {
        err(`  CRITICAL: Failed to save state after error: ${saveError.message}`)
        err(`  Progress from this session may be lost. Check data/editorial/state.json`)
      }
    }
  }

  // 7. Save story references for DISCOVER pipeline
  const allStories = storyCollector.getAll()
  if (allStories.length > 0) {
    const storiesPath = join(ROOT, 'data/editorial', `stories-session-${sessionNum}.json`)
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(storiesPath, JSON.stringify(allStories, null, 2))
    log(`Saved ${allStories.length} story references to ${basename(storiesPath)}`)
  }

  // 8. Final save and report
  recomputeCorpusStats(state)
  saveState(state)

  const costs = getSessionCosts()
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)

  log('')
  log('═══════════════════════════════════════════════')
  log('  SESSION COMPLETE')
  log('═══════════════════════════════════════════════')
  log(`  Session:       ${sessionNum}`)
  log(`  Duration:      ${elapsed}s`)
  log(`  Processed:     ${totals.processed} / ${pending.length} transcripts`)
  if (totals.skipped > 0) log(`  Skipped:       ${totals.skipped}`)
  if (totals.failed > 0)  log(`  Failed:        ${totals.failed}`)
  log(`  Entries added: ${totals.entriesAdded}`)
  log(`  Evidence:      ${totals.evidenceAdded} items added`)
  log(`  New themes:    ${totals.themesCreated}`)
  log(`  Connections:   ${totals.connectionsAdded}`)
  log(`  Posts:         ${totals.postsAdded} candidates`)
  log(`  Stories:       ${totals.storiesCollected} references`)
  log(`  Cost:          $${costs.total.toFixed(4)}`)
  log(`    Opus:        ${costs.opus.calls} calls, $${costs.opus.cost.toFixed(4)}`)

  // 9. Persist cost data for web API (/api/editorial/cost)
  saveCostLog(sessionNum, costs, elapsed, config)

  // Log to activity feed
  logActivity(
    'analyse',
    `Session ${sessionNum} complete: ${totals.processed} transcripts`,
    `${totals.entriesAdded} entries, ${totals.evidenceAdded} evidence, ` +
    `${totals.postsAdded} posts, $${costs.total.toFixed(4)} cost`
  )

  // Warn if approaching budget
  const weeklyBudget = config.budget?.weekly_cap_usd || 50
  const warnThreshold = (config.budget?.warn_threshold_pct || 60) / 100
  if (costs.total > weeklyBudget * warnThreshold) {
    warn(`Session cost $${costs.total.toFixed(2)} exceeds ${(warnThreshold * 100).toFixed(0)}% of weekly budget ($${weeklyBudget})`)
  }
}

// ── Run ─────────────────────────────────────────────────

main().catch(error => {
  err(`Fatal error: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
