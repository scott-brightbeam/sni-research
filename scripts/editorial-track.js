#!/usr/bin/env bun
/**
 * editorial-track.js — TRACK stage of the editorial intelligence pipeline
 *
 * Manual publication logging — records when newsletters and LinkedIn posts
 * have been published. Prevents duplicate stories in future drafts.
 *
 * Usage:
 *   bun scripts/editorial-track.js --newsletter --week 12
 *   bun scripts/editorial-track.js --linkedin --post 43
 *   bun scripts/editorial-track.js --linkedin --post 43 --title "Multi-agent dysfunction"
 *   bun scripts/editorial-track.js --mark-published --post 43
 *   bun scripts/editorial-track.js --list
 *   bun scripts/editorial-track.js --help
 *
 * Reads:  data/editorial/published.json, data/editorial/state.json
 * Writes: data/editorial/published.json, data/editorial/state.json,
 *         data/editorial/activity.json
 */

import { resolve } from 'path'

import {
  loadState,
  saveState,
  loadPublished,
  trackPublished,
  isPublished,
  updatePostStatus,
  recomputeCorpusStats,
  logActivity,
} from './lib/editorial-state.js'

const ROOT = resolve(import.meta.dir, '..')

// ── Logging ──────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23)
const log  = (...a) => console.log(`[${ts()}] [track]`, ...a)
const warn = (...a) => console.warn(`[${ts()}] [track] ⚠`, ...a)
const err  = (...a) => console.error(`[${ts()}] [track] ✗`, ...a)

// ── CLI argument parsing ────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    newsletter: false,
    linkedin: false,
    markPublished: false,
    list: false,
    week: null,
    post: null,
    title: null,
    url: null,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        console.log(`Usage:
  bun scripts/editorial-track.js --newsletter --week N [--url URL]
  bun scripts/editorial-track.js --linkedin --post N [--title TITLE] [--url URL]
  bun scripts/editorial-track.js --mark-published --post N
  bun scripts/editorial-track.js --list
  bun scripts/editorial-track.js --help`)
        process.exit(0)
      case '--newsletter':
        opts.newsletter = true
        break
      case '--linkedin':
        opts.linkedin = true
        break
      case '--mark-published':
        opts.markPublished = true
        break
      case '--list':
        opts.list = true
        break
      case '--week': {
        if (i + 1 >= args.length) { err('--week requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 1) { err(`Invalid --week value: ${args[i]}`); process.exit(1) }
        opts.week = n
        break
      }
      case '--post': {
        if (i + 1 >= args.length) { err('--post requires a number'); process.exit(1) }
        const n = parseInt(args[++i], 10)
        if (Number.isNaN(n) || n < 1) { err(`Invalid --post value: ${args[i]}`); process.exit(1) }
        opts.post = n
        break
      }
      case '--title': {
        if (i + 1 >= args.length) { err('--title requires a value'); process.exit(1) }
        opts.title = args[++i]
        break
      }
      case '--url': {
        if (i + 1 >= args.length) { err('--url requires a value'); process.exit(1) }
        opts.url = args[++i]
        break
      }
      default:
        err(`Unknown argument: ${args[i]}`)
        process.exit(1)
    }
  }

  return opts
}

// ── Validation ──────────────────────────────────────────

function validateArgs(opts) {
  const modes = [opts.newsletter, opts.linkedin, opts.markPublished, opts.list].filter(Boolean)
  if (modes.length === 0) {
    err('Specify one of: --newsletter, --linkedin, --mark-published, --list')
    process.exit(1)
  }
  if (modes.length > 1) {
    err('Specify only one mode: --newsletter, --linkedin, --mark-published, or --list')
    process.exit(1)
  }

  if (opts.newsletter && opts.week == null) {
    err('--newsletter requires --week N')
    process.exit(1)
  }

  if (opts.linkedin && opts.post == null) {
    err('--linkedin requires --post N')
    process.exit(1)
  }

  if (opts.markPublished && opts.post == null) {
    err('--mark-published requires --post N')
    process.exit(1)
  }
}

// ── Commands ─────────────────────────────────────────────

function handleList() {
  const published = loadPublished()

  log('Published newsletters:')
  if (published.newsletters.length === 0) {
    log('  (none)')
  } else {
    for (const n of published.newsletters) {
      log(`  Week ${n.week} — ${n.date}${n.articleUrls ? ` (${n.articleUrls.length} articles)` : ''}`)
    }
  }

  log('')
  log('Published LinkedIn posts:')
  if (published.linkedin.length === 0) {
    log('  (none)')
  } else {
    for (const p of published.linkedin) {
      log(`  #${p.postId} — ${p.title || '(untitled)'} — ${p.date}`)
    }
  }
}

function handleNewsletter(opts) {
  const published = loadPublished()
  if (published.newsletters.some(n => n.week === opts.week)) {
    warn(`Newsletter for week ${opts.week} is already tracked. Skipping.`)
    return
  }

  const item = { week: opts.week }
  if (opts.url) item.url = opts.url

  trackPublished('newsletter', item)
  log(`Tracked newsletter publication: Week ${opts.week}`)
}

function handleLinkedIn(opts) {
  const state = loadState()
  const post = state?.postBacklog?.[String(opts.post)]

  // Resolve title from state if not provided on CLI
  const title = opts.title || post?.title || `Post #${opts.post}`

  if (isPublished(opts.post)) {
    warn(`Post #${opts.post} is already tracked as published. Skipping.`)
    return
  }

  if (!post) {
    warn(`Post #${opts.post} not found in state.json backlog — recording in published.json only`)
  }

  // Update state first (more fragile operation with validation)
  // so that published.json is only written if state succeeds or is skipped
  let stateUpdated = false
  if (state && post && post.status !== 'published') {
    try {
      updatePostStatus(state, opts.post, 'published')
      recomputeCorpusStats(state)
      saveState(state)
      stateUpdated = true
      log(`  Updated post #${opts.post} status to 'published' in state.json`)
    } catch (e) {
      warn(`  Could not update post status in state.json: ${e.message}`)
      logActivity('error', `Failed to sync post #${opts.post} status to state.json`, e.message)
    }
  }

  // Record in published.json (simpler write, less likely to fail)
  const item = { postId: opts.post, title }
  if (opts.url) item.url = opts.url

  trackPublished('linkedin', item)
  log(`Tracked LinkedIn publication: #${opts.post} — ${title}`)
}

function handleMarkPublished(opts) {
  const state = loadState()
  if (!state) {
    err('Cannot load state.json — run editorial-analyse.js first')
    process.exit(1)
  }

  const post = state.postBacklog?.[String(opts.post)]
  if (!post) {
    err(`Post #${opts.post} not found in backlog`)
    process.exit(1)
  }

  if (post.status === 'published') {
    warn(`Post #${opts.post} is already marked as published. Skipping.`)
    return
  }

  // Update state.json (critical operation)
  try {
    updatePostStatus(state, opts.post, 'published')
    recomputeCorpusStats(state)
    saveState(state)
  } catch (e) {
    err(`Failed to update post status: ${e.message}`)
    process.exit(1)
  }

  // Also record in published.json so isPublished() returns true
  if (!isPublished(opts.post)) {
    trackPublished('linkedin', { postId: opts.post, title: post.title })
  }

  // Activity log is non-critical — don't let it mask state success
  try {
    logActivity('track', `Marked post #${opts.post} as published`, post.title)
  } catch (e) {
    warn(`  Failed to log activity: ${e.message}`)
  }

  log(`Marked post #${opts.post} as published: ${post.title}`)
}

// ── Main ────────────────────────────────────────────────

function main() {
  const opts = parseArgs()
  validateArgs(opts)

  log('═══════════════════════════════════════════════')
  log('  EDITORIAL TRACK')
  log('═══════════════════════════════════════════════')

  if (opts.list) {
    handleList()
    return
  }

  if (opts.newsletter) {
    handleNewsletter(opts)
    return
  }

  if (opts.linkedin) {
    handleLinkedIn(opts)
    return
  }

  if (opts.markPublished) {
    handleMarkPublished(opts)
    return
  }
}

try {
  main()
} catch (error) {
  err(`Fatal error: ${error.message}`)
  console.error(error.stack)
  process.exit(1)
}
