#!/usr/bin/env bun
/**
 * editorial-draft.js — DRAFT stage of the editorial intelligence pipeline
 *
 * Generates the weekly SNI newsletter via a three-model flow:
 *   1. Opus 4.6 generates the initial draft from editorial state
 *   2. Gemini 3.1 Pro + GPT-5.4 critique in parallel
 *   3. Opus 4.6 revises based on merged critique
 *
 * Usage:
 *   bun scripts/editorial-draft.js                   # Generate draft for current week
 *   bun scripts/editorial-draft.js --week N          # Generate for specific week
 *   bun scripts/editorial-draft.js --session N       # Use specific ANALYSE session number
 *   bun scripts/editorial-draft.js --dry-run         # Show context stats, no LLM calls
 *   bun scripts/editorial-draft.js --skip-critique   # Generate only, skip critique/revise
 *   bun scripts/editorial-draft.js --force           # Overwrite existing draft
 *
 * Reads:  data/editorial/state.json, config/prompts/editorial-*.txt,
 *         config/editorial-sources.yaml, data/verified/
 * Writes: data/editorial/drafts/draft-session-{N}-*.md,
 *         data/editorial/drafts/critique-session-{N}.json,
 *         data/editorial/drafts/metrics-session-{N}.json,
 *         data/editorial/cost-log.json, data/editorial/activity.json
 *
 * Does NOT import from any existing pipeline module in scripts/ except
 * shared utilities (editorial-state.js, editorial-context.js, editorial-multi-model.js).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import { join, resolve } from 'path'
import {
  loadState,
  logActivity,
} from './lib/editorial-state.js'
import { buildDraftContext } from './lib/editorial-context.js'
import {
  callOpus,
  callCritiqueModels,
  getSessionCosts,
  resetSessionCosts,
  validateProviders,
  availableEditorialProviders,
} from './lib/editorial-multi-model.js'
import {
  extractDraftMarkdown,
  parseDraftSections,
  validateDraftStructure,
  calculateDraftMetrics,
  mergeCritiques,
  renderCritiquePrompt,
  renderRevisionPrompt,
  buildDraftArtifact,
} from './lib/editorial-draft-lib.js'
import { loadAndRenderPrompt } from './lib/prompt-loader.js'

const ROOT = resolve(import.meta.dir, '..')
const EDITORIAL_DIR = join(ROOT, 'data/editorial')
const DRAFTS_DIR = join(EDITORIAL_DIR, 'drafts')
const LOCK_FILE = join(EDITORIAL_DIR, '.draft.lock')
const LOCK_MAX_AGE_MS = 30 * 60 * 1000 // 30 minutes

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [draft]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [draft] ⚠`, ...a)
const err  = (...a) => console.error(`[${ts()}] [draft] ✗`, ...a)

// ── CLI argument parsing ────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    week: null,
    session: null,
    dryRun: false,
    skipCritique: false,
    force: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--week': {
        if (i + 1 >= args.length) { err('--week requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 1) { err(`Invalid --week value: ${args[i]}`); process.exit(1) }
        opts.week = n
        break
      }
      case '--session': {
        if (i + 1 >= args.length) { err('--session requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 0) { err(`Invalid --session value: ${args[i]}`); process.exit(1) }
        opts.session = n
        break
      }
      case '--dry-run':
        opts.dryRun = true
        break
      case '--skip-critique':
        opts.skipCritique = true
        break
      case '--force':
        opts.force = true
        break
      case '--critique-only':
        opts.critiqueOnly = true
        break
      default:
        warn(`Unknown argument: ${args[i]}`)
    }
  }

  return opts
}

// ── Week resolution ──────────────────────────────────────

/**
 * Get the ISO 8601 week number for a date.
 * @param {Date} date
 * @returns {number}
 */
function getISOWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

/**
 * Resolve the editorial week number.
 * @param {number|null} cliWeek — from --week flag
 * @returns {number}
 */
function resolveWeek(cliWeek) {
  if (cliWeek != null) return cliWeek
  return getISOWeekNumber(new Date())
}

// ── Session resolution ──────────────────────────────────

/**
 * Resolve the ANALYSE session number (for output naming).
 * DRAFT reuses ANALYSE sessions — does NOT increment the session counter.
 *
 * @param {number|null} cliSession — from --session flag
 * @param {object} state — editorial state
 * @returns {number}
 */
function resolveSession(cliSession, state) {
  if (cliSession != null) return cliSession
  // Use the most recent ANALYSE session (nextSession - 1)
  return Math.max(1, (state.counters?.nextSession ?? 1) - 1)
}

// ── Draft existence check ────────────────────────────────

/**
 * Check if a draft already exists for this session.
 * @param {number} sessionNum
 * @returns {boolean}
 */
function draftExists(sessionNum) {
  return existsSync(join(DRAFTS_DIR, `draft-session-${sessionNum}-final.md`))
      || existsSync(join(DRAFTS_DIR, `draft-session-${sessionNum}-v1.md`))
}

// ── Previous newsletter discovery ───────────────────────

/**
 * Find the most recent previous newsletter draft.
 * @param {number} currentSession
 * @returns {string|null} — file path or null
 */
function findPreviousNewsletter(currentSession) {
  if (!existsSync(DRAFTS_DIR)) return null

  const files = readdirSync(DRAFTS_DIR)
    .filter(f => /^draft-session-\d+-final\.md$/.test(f))
    .map(f => ({ name: f, session: parseInt(f.match(/\d+/)[0], 10) }))
    .filter(f => f.session < currentSession)
    .sort((a, b) => a.session - b.session)

  if (files.length === 0) return null
  return join(DRAFTS_DIR, files[files.length - 1].name)
}

// ── Lock file ────────────────────────────────────────────

function acquireLock(sessionNum) {
  if (existsSync(LOCK_FILE)) {
    try {
      const lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
      const lockAge = Date.now() - new Date(lockData.timestamp).getTime()
      if (lockAge < LOCK_MAX_AGE_MS) {
        err(`DRAFT already running (PID ${lockData.pid}, started ${lockData.timestamp})`)
        err('If stale, delete data/editorial/.draft.lock')
        process.exit(1)
      }
      warn('Stale lock detected (>30 min) — overriding')
    } catch (e) {
      warn(`Unreadable lock file (${e.message}) — overriding`)
    }
  }

  writeFileSync(LOCK_FILE, JSON.stringify({
    pid: process.pid,
    timestamp: new Date().toISOString(),
    session: sessionNum,
    stage: 'initialising',
  }, null, 2))
}

function updateLockStage(stage) {
  if (!existsSync(LOCK_FILE)) return
  try {
    const lockData = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
    lockData.stage = stage
    writeFileSync(LOCK_FILE, JSON.stringify(lockData, null, 2))
  } catch (e) {
    warn(`Failed to update lock stage to '${stage}': ${e.message}`)
  }
}

function releaseLock() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE)
  } catch (e) {
    warn(`Failed to release lock: ${e.message}`)
  }
}

// ── Cost logging ────────────────────────────────────────

function saveCostLog(sessionNum, costs, elapsed) {
  const costLogPath = join(ROOT, 'data/editorial/cost-log.json')
  let costLog = {}
  if (existsSync(costLogPath)) {
    try {
      costLog = JSON.parse(readFileSync(costLogPath, 'utf-8'))
    } catch (e) {
      warn(`cost-log.json is corrupt (${e.message}) — starting fresh for this entry`)
      costLog = {}
    }
  }

  if (!costLog.sessions) costLog.sessions = {}
  if (!costLog.weeks) costLog.weeks = {}

  // Record session cost under draft-specific key
  costLog.sessions[`draft-${sessionNum}`] = {
    timestamp: new Date().toISOString(),
    elapsed,
    stage: 'draft',
    costs: {
      opus: { calls: costs.opus.calls, cost: costs.opus.cost },
      gemini: { calls: costs.gemini.calls, cost: costs.gemini.cost },
      openai: { calls: costs.openai.calls, cost: costs.openai.cost },
    },
    total: costs.total,
  }

  // Aggregate weekly cost (ISO week number)
  const now = new Date()
  const weekNum = getISOWeekNumber(now)
  const weekKey = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`

  if (!costLog.weeks[weekKey]) {
    costLog.weeks[weekKey] = {
      weeklyTotal: 0,
      budget: 50,
      breakdown: { analyse: 0, discover: 0, draft: 0, critique: 0 },
    }
  }

  costLog.weeks[weekKey].weeklyTotal += costs.total
  costLog.weeks[weekKey].breakdown.draft += costs.total

  writeFileSync(costLogPath, JSON.stringify(costLog, null, 2))
  log(`  Cost logged to cost-log.json (week ${weekKey})`)
}

// ── Main pipeline ───────────────────────────────────────

async function main() {
  const opts = parseArgs()
  const startTime = Date.now()

  log('═══════════════════════════════════════════════')
  log('  EDITORIAL DRAFT PIPELINE')
  log('═══════════════════════════════════════════════')

  // 1. Validate providers
  const providers = validateProviders()
  if (!providers.ready) {
    // For skip-critique mode, only Anthropic is required
    if (opts.skipCritique) {
      const hasAnthropic = !providers.missing.some(m => m.includes('ANTHROPIC'))
      if (!hasAnthropic) {
        err('ANTHROPIC_API_KEY required for draft generation')
        process.exit(1)
      }
    } else {
      err('Missing API keys:')
      for (const missing of providers.missing) {
        err(`  • ${missing}`)
      }
      process.exit(1)
    }
  }

  // 2. Load state
  const state = loadState()
  if (!state) {
    err('Cannot load data/editorial/state.json — run editorial-analyse.js first')
    process.exit(1)
  }

  // 2b. Critique-only mode — skip draft, only run Gemini+GPT critique pair
  if (opts.critiqueOnly) {
    if (!opts.session) { err('--critique-only requires --session N'); process.exit(1) }

    const providers = availableEditorialProviders()
    if (!providers.openai && !providers.gemini) {
      err('At least one of OPENAI_API_KEY or GOOGLE_AI_API_KEY required for critique')
      process.exit(1)
    }

    const draftPath = join(DRAFTS_DIR, `draft-session-${opts.session}-v1.md`)
    if (!existsSync(draftPath)) {
      err(`Draft not found: ${draftPath}`)
      err(`Generate draft first, then: bun scripts/editorial-draft.js --critique-only --session ${opts.session}`)
      process.exit(1)
    }
    const draft = readFileSync(draftPath, 'utf-8')

    log(`Critique-only mode: reading ${draftPath}`)
    resetSessionCosts()

    // Load critique template (was missing — caused models to receive raw draft with no instructions)
    let critiqueTemplate
    try {
      critiqueTemplate = readFileSync(join(ROOT, 'config/prompts/editorial-critique.v1.txt'), 'utf-8')
    } catch (e) {
      err(`Failed to load critique template: ${e.message}`)
      process.exit(1)
    }

    const themeNames = Object.entries(state.themeRegistry || {}).map(([code, t]) => `${code}: ${t.name}`)
    const critiquePrompt = renderCritiquePrompt(critiqueTemplate, draft, { themes: themeNames, week: opts.session, sectionNames: [] })
    const critiqueSystem = 'You are an editorial reviewer for a weekly AI newsletter targeting senior enterprise leaders. Provide specific, actionable critique.'
    const critiqueResults = await callCritiqueModels(critiquePrompt, { system: critiqueSystem, maxTokens: 4000 })
    const { merged } = mergeCritiques(critiqueResults)

    const critiquePath = join(DRAFTS_DIR, `critique-session-${opts.session}.json`)
    writeFileSync(critiquePath, JSON.stringify({ gemini: critiqueResults.gemini, openai: critiqueResults.openai, merged }, null, 2))
    log(`Critique saved to ${critiquePath}`)

    const costs = getSessionCosts()
    log(`Cost: $${costs.total.toFixed(4)} (Gemini: $${costs.gemini.cost?.toFixed(4) || '0'}, OpenAI: $${costs.openai.cost?.toFixed(4) || '0'})`)
    process.exit(0)
  }

  // 3. Resolve week and session
  const week = resolveWeek(opts.week)
  const sessionNum = resolveSession(opts.session, state)

  log(`Week: ${week}, Session: ${sessionNum}`)
  log(`State: ${Object.keys(state.analysisIndex || {}).length} entries, ` +
      `${Object.keys(state.themeRegistry || {}).length} themes, ` +
      `${Object.keys(state.postBacklog || {}).length} posts`)

  // 4. Check if draft already exists
  if (!opts.force && draftExists(sessionNum)) {
    log(`Draft for session ${sessionNum} already exists. Use --force to overwrite.`)
    return
  }

  // 5. Build context
  const previousNewsletter = findPreviousNewsletter(sessionNum)
  let context
  try {
    context = buildDraftContext(week, {
      sectorArticlesDir: join(ROOT, 'data/verified'),
      previousNewsletterPath: previousNewsletter,
    })
  } catch (ctxErr) {
    err(`Failed to build draft context: ${ctxErr.message}`)
    process.exit(1)
  }

  log(`Context: ~${context.tokenEstimate.toLocaleString()} tokens`)
  if (previousNewsletter) {
    log(`Previous newsletter: ${previousNewsletter}`)
  }

  // Dry run — show stats and exit
  if (opts.dryRun) {
    log('\n── DRY RUN ──')
    log(`  Week: ${week}`)
    log(`  Session: ${sessionNum}`)
    log(`  Context tokens: ~${context.tokenEstimate.toLocaleString()}`)
    log(`  System prompt tokens: ~${Math.ceil(context.system.length / 4).toLocaleString()}`)
    log(`  User message tokens: ~${Math.ceil(context.user.length / 4).toLocaleString()}`)
    log(`  Skip critique: ${opts.skipCritique}`)
    log(`  Estimated cost: ~$${opts.skipCritique ? '1.50' : '3.30'}`)
    return
  }

  // 6. Acquire lock
  acquireLock(sessionNum)
  resetSessionCosts()

  try {
    // 7. Ensure output directory
    mkdirSync(DRAFTS_DIR, { recursive: true })

    // 8. Load draft generation prompt
    let draftPromptAppend
    try {
      draftPromptAppend = loadAndRenderPrompt('draft-write', { week: String(week) })
    } catch (promptErr) {
      err(`Failed to load draft prompt: ${promptErr.message}`)
      releaseLock()
      process.exit(1)
    }

    // 9. Generate initial draft
    updateLockStage('generating')
    log('Generating initial draft...')

    const draftResponse = await callOpus(
      context.user + '\n\n---\n\n' + draftPromptAppend,
      {
        system: context.system,
        maxTokens: 16000,
        rawText: true,
        temperature: 0.5,
      }
    )

    log(`  Opus response: ${draftResponse.inputTokens.toLocaleString()} in / ${draftResponse.outputTokens.toLocaleString()} out`)

    // 10. Extract markdown
    const initialDraft = extractDraftMarkdown(draftResponse.raw)
    if (!initialDraft) {
      err('Opus returned empty or unparseable draft')
      err(`Raw response (first 500 chars): ${(draftResponse.raw || '').slice(0, 500)}`)
      logActivity('error', 'DRAFT generation failed', 'Opus returned empty draft')
      releaseLock()
      process.exit(1)
    }

    // 11. Validate structure
    const parsed = parseDraftSections(initialDraft)
    const validation = validateDraftStructure(parsed)

    if (!validation.valid) {
      warn(`Draft structure incomplete. Missing sections: ${validation.missing.join(', ')}`)
    }
    for (const warning of validation.warnings) {
      warn(`  ${warning}`)
    }
    if (parsed.unmatched.length > 0) {
      warn(`  Unrecognised sections: ${parsed.unmatched.join(', ')}`)
    }

    log(`  Draft: ${parsed.sections.length} sections, ~${initialDraft.split(/\s+/).length} words`)

    // 12. Save v1 draft
    const v1Path = join(DRAFTS_DIR, `draft-session-${sessionNum}-v1.md`)
    writeFileSync(v1Path, initialDraft)
    log(`  Saved v1 draft: draft-session-${sessionNum}-v1.md`)

    // 13. Critique + revision (unless --skip-critique)
    let finalDraft = initialDraft
    let critiqueData = { gemini: null, openai: null, merged: '' }

    if (!opts.skipCritique) {
      updateLockStage('critiquing')
      log('Running critique (Gemini + GPT in parallel)...')

      // Load and render critique prompt
      let critiqueTemplate
      try {
        critiqueTemplate = readFileSync(join(ROOT, 'config/prompts/editorial-critique.v1.txt'), 'utf-8')
      } catch (e) {
        err(`Failed to load critique template: ${e.message}`)
        err('Fix the template file or use --skip-critique to bypass.')
        logActivity('error', 'DRAFT critique failed', `Missing template: ${e.message}`)
        releaseLock()
        process.exit(1)
      }

      const themeNames = Object.values(state.themeRegistry || {}).map(t => t.name).slice(0, 20)
      const sectionNames = parsed.sections.map(s => s.name)

      const critiquePrompt = renderCritiquePrompt(critiqueTemplate, initialDraft, {
        themes: themeNames,
        week,
        sectionNames,
      })

      const critiqueSystem = 'You are an editorial reviewer for a weekly AI newsletter targeting senior enterprise leaders. Provide specific, actionable critique.'

      const critiqueResult = await callCritiqueModels(critiquePrompt, { system: critiqueSystem })

      // Log critique results
      if (critiqueResult.gemini.raw) {
        log(`  Gemini critique: ${critiqueResult.gemini.raw.length} chars`)
      } else {
        warn(`  Gemini critique failed: ${critiqueResult.gemini.error || 'no response'}`)
      }
      if (critiqueResult.openai.raw) {
        log(`  GPT critique: ${critiqueResult.openai.raw.length} chars`)
      } else {
        warn(`  GPT critique failed: ${critiqueResult.openai.error || 'no response'}`)
      }

      // Merge critiques
      const merged = mergeCritiques(critiqueResult)
      critiqueData = {
        gemini: { raw: critiqueResult.gemini.raw, error: critiqueResult.gemini.error },
        openai: { raw: critiqueResult.openai.raw, error: critiqueResult.openai.error },
        merged: merged.merged,
      }

      // 14. Revision (if we have critique feedback)
      if (merged.hasCritique) {
        updateLockStage('revising')
        log('Revising draft based on critique...')

        let reviseTemplate
        try {
          reviseTemplate = readFileSync(join(ROOT, 'config/prompts/editorial-revise.v1.txt'), 'utf-8')
        } catch (e) {
          err(`Failed to load revision template: ${e.message}`)
          err('Fix the template file or use --skip-critique to bypass revision.')
          logActivity('error', 'DRAFT revision failed', `Missing template: ${e.message}`)
          releaseLock()
          process.exit(1)
        }

        const revisionPrompt = renderRevisionPrompt(reviseTemplate, initialDraft, merged.merged, { week })

        try {
          const revisionResponse = await callOpus(revisionPrompt, {
            system: context.system,
            maxTokens: 16000,
            rawText: true,
            temperature: 0.4,
          })

          log(`  Revision response: ${revisionResponse.inputTokens.toLocaleString()} in / ${revisionResponse.outputTokens.toLocaleString()} out`)

          const revisedDraft = extractDraftMarkdown(revisionResponse.raw)
          if (revisedDraft) {
            finalDraft = revisedDraft
            log(`  Revised draft: ~${revisedDraft.split(/\s+/).length} words`)
          } else {
            warn('Revision returned empty — keeping v1 draft')
          }
        } catch (revErr) {
          warn(`Revision Opus call failed: ${revErr.message} — keeping v1 draft`)
          logActivity('error', 'DRAFT revision failed', revErr.message)
        }
      } else {
        warn('No critique feedback available — skipping revision')
      }
    } else {
      log('Critique skipped (--skip-critique)')
    }

    // 15. Save final draft
    const finalPath = join(DRAFTS_DIR, `draft-session-${sessionNum}-final.md`)
    writeFileSync(finalPath, finalDraft)
    log(`  Saved final draft: draft-session-${sessionNum}-final.md`)

    // 16. Calculate and save metrics
    const initialMetrics = calculateDraftMetrics(initialDraft)
    const finalMetrics = calculateDraftMetrics(finalDraft)

    const metricsPath = join(DRAFTS_DIR, `metrics-session-${sessionNum}.json`)
    writeFileSync(metricsPath, JSON.stringify({ initial: initialMetrics, final: finalMetrics }, null, 2))
    log(`  Metrics saved: ${finalMetrics.wordCount} words, ${finalMetrics.sectionCount} sections, ${finalMetrics.readingTimeMinutes} min read`)

    // 17. Save critique artifact
    const critiquePath = join(DRAFTS_DIR, `critique-session-${sessionNum}.json`)
    writeFileSync(critiquePath, JSON.stringify(critiqueData, null, 2))

    // 18. Build and save full artifact
    const costs = getSessionCosts()
    const artifact = buildDraftArtifact({
      initialDraft,
      finalDraft,
      critiques: critiqueData,
      metrics: { initial: initialMetrics, final: finalMetrics },
      session: sessionNum,
      timestamp: new Date().toISOString(),
      costs: {
        opus: { calls: costs.opus.calls, cost: costs.opus.cost },
        gemini: { calls: costs.gemini.calls, cost: costs.gemini.cost },
        openai: { calls: costs.openai.calls, cost: costs.openai.cost },
        total: costs.total,
      },
    })

    const artifactPath = join(DRAFTS_DIR, `artifact-session-${sessionNum}.json`)
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2))

    // Release lock
    releaseLock()

    // Cost logging
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    saveCostLog(sessionNum, costs, elapsed)

    // Activity logging
    logActivity(
      'draft',
      `Draft session ${sessionNum} complete`,
      `${finalMetrics.wordCount} words, ${finalMetrics.sectionCount} sections, $${costs.total.toFixed(4)} cost`
    )

    // Final report
    log('')
    log('═══════════════════════════════════════════════')
    log('  DRAFT COMPLETE')
    log('═══════════════════════════════════════════════')
    log(`  Session:       ${sessionNum}`)
    log(`  Week:          ${week}`)
    log(`  Duration:      ${elapsed}s`)
    log(`  Initial draft: ${initialMetrics.wordCount} words, ${initialMetrics.sectionCount} sections`)
    log(`  Final draft:   ${finalMetrics.wordCount} words, ${finalMetrics.sectionCount} sections`)
    log(`  Critique:      ${critiqueData.merged ? 'yes' : 'skipped'}`)
    log(`  Cost:          $${costs.total.toFixed(4)}`)
    log(`    Opus:        ${costs.opus.calls} calls, $${costs.opus.cost.toFixed(4)}`)
    if (costs.gemini.calls > 0) log(`    Gemini:      ${costs.gemini.calls} calls, $${costs.gemini.cost.toFixed(4)}`)
    if (costs.openai.calls > 0) log(`    GPT:         ${costs.openai.calls} calls, $${costs.openai.cost.toFixed(4)}`)
    log(`  Output:        ${finalPath}`)

  } catch (error) {
    // Log costs even on failure (tracks real spend)
    try {
      const costs = getSessionCosts()
      if (costs.total > 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
        saveCostLog(sessionNum, costs, elapsed + ' (FAILED)')
        warn(`Partial cost logged: $${costs.total.toFixed(4)}`)
      }
    } catch (costErr) {
      warn(`Failed to save cost log for crashed run: ${costErr.message}`)
    }

    releaseLock()
    err(`Fatal error: ${error.message}`)
    console.error(error.stack)
    logActivity('error', 'DRAFT pipeline crash', error.message)
    process.exit(1)
  }
}

// ── Run ─────────────────────────────────────────────────

main().catch(error => {
  // Catches errors before lock acquisition (validation, state loading)
  err(`Fatal error: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
})
