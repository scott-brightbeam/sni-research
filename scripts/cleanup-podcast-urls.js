#!/usr/bin/env bun
/**
 * cleanup-podcast-urls.js — one-off retroactive cleanup.
 *
 * Nulls out contaminated "story URLs" in three places:
 *   1. data/podcasts/**\/*.digest.json  (key_stories[].url)
 *   2. data/editorial/stories-session-*.json  (stories[].url)
 *   3. Turso episode_stories table  (url column)
 *
 * A URL is contaminated if:
 *   - It points at a known podcast platform (spotify, simplecast, etc.)
 *   - It points at a podcast show site (lexfridman.com, dwarkesh.com, etc.)
 *   - It's identical to the episode's own URL (applies to digests only —
 *     stories-session files don't know the episode URL, so those rely on
 *     the platform-host check)
 *   - It's a YouTube search/handle-search fallback URL
 *
 * Newsletter URLs (exponentialview.co, bigtechnology.com) are allowlisted.
 *
 * Run with:
 *   bun scripts/cleanup-podcast-urls.js                   # dry run (no writes)
 *   bun scripts/cleanup-podcast-urls.js --commit          # perform writes
 */

import { readdirSync, statSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { shouldNullifyStoryUrl, isPodcastPlatformUrl } from './lib/podcast-url.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const COMMIT = process.argv.includes('--commit')
const LABEL = COMMIT ? '[COMMIT]' : '[DRY-RUN]'

console.log(`${LABEL} Podcast URL cleanup starting…`)
console.log(`  root: ${ROOT}`)
console.log('')

// ---------------------------------------------------------------------------
// 1. Digest files
// ---------------------------------------------------------------------------

function cleanDigests() {
  const podcastsDir = join(ROOT, 'data/podcasts')
  let filesScanned = 0
  let filesChanged = 0
  let storiesNulled = 0
  const changes = []

  const dates = readdirSync(podcastsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  for (const date of dates) {
    const dateDir = join(podcastsDir, date)
    for (const source of readdirSync(dateDir)) {
      const sourceDir = join(dateDir, source)
      if (!statSync(sourceDir).isDirectory()) continue
      for (const f of readdirSync(sourceDir)) {
        if (!f.endsWith('.digest.json')) continue
        const path = join(sourceDir, f)
        filesScanned++
        let digest
        try { digest = JSON.parse(readFileSync(path, 'utf8')) }
        catch { continue }

        if (!Array.isArray(digest.key_stories) || digest.key_stories.length === 0) continue

        const episodeUrl = digest.episodeUrl || digest.url || null
        let changed = false
        for (const s of digest.key_stories) {
          if (!s || typeof s !== 'object') continue
          if (shouldNullifyStoryUrl(s.url, episodeUrl)) {
            changes.push({ file: path.replace(ROOT + '/', ''), was: s.url })
            s.url = null
            changed = true
            storiesNulled++
          }
        }

        if (changed) {
          filesChanged++
          if (COMMIT) {
            writeFileSync(path, JSON.stringify(digest, null, 2) + '\n')
          }
        }
      }
    }
  }

  console.log(`--- Digest files ---`)
  console.log(`  scanned:       ${filesScanned}`)
  console.log(`  files changed: ${filesChanged}`)
  console.log(`  URLs nulled:   ${storiesNulled}`)
  if (changes.length > 0 && changes.length <= 10) {
    console.log('  examples:')
    changes.forEach(c => console.log(`    ${c.file.split('/').slice(-2).join('/')} → ${c.was.substring(0, 70)}`))
  } else if (changes.length > 10) {
    console.log(`  first 5 examples:`)
    changes.slice(0, 5).forEach(c => console.log(`    ${c.file.split('/').slice(-2).join('/')} → ${c.was.substring(0, 70)}`))
  }
  console.log('')
  return { filesChanged, storiesNulled }
}

// ---------------------------------------------------------------------------
// 2. stories-session-N.json files
// ---------------------------------------------------------------------------

function cleanStoriesSessions() {
  const editorialDir = join(ROOT, 'data/editorial')
  let filesScanned = 0
  let filesChanged = 0
  let storiesNulled = 0
  const changes = []

  const files = readdirSync(editorialDir).filter(f => /^stories-session-\d+\.json$/.test(f))
  for (const f of files) {
    const path = join(editorialDir, f)
    filesScanned++
    let stories
    try { stories = JSON.parse(readFileSync(path, 'utf8')) }
    catch { continue }
    if (!Array.isArray(stories)) continue

    let changed = false
    for (const s of stories) {
      if (!s || typeof s !== 'object') continue
      // We don't know the episode URL here, so we can only rely on the
      // platform-host blocklist. That catches the vast majority of cases.
      if (isPodcastPlatformUrl(s.url)) {
        changes.push({ file: f, was: s.url })
        s.url = null
        changed = true
        storiesNulled++
      }
    }

    if (changed) {
      filesChanged++
      if (COMMIT) {
        writeFileSync(path, JSON.stringify(stories, null, 2) + '\n')
      }
    }
  }

  console.log(`--- stories-session files ---`)
  console.log(`  scanned:       ${filesScanned}`)
  console.log(`  files changed: ${filesChanged}`)
  console.log(`  URLs nulled:   ${storiesNulled}`)
  if (changes.length > 0 && changes.length <= 10) {
    console.log('  examples:')
    changes.forEach(c => console.log(`    ${c.file} → ${c.was.substring(0, 70)}`))
  } else if (changes.length > 10) {
    console.log(`  first 5 examples:`)
    changes.slice(0, 5).forEach(c => console.log(`    ${c.file} → ${c.was.substring(0, 70)}`))
  }
  console.log('')
  return { filesChanged, storiesNulled }
}

// ---------------------------------------------------------------------------
// 3. Turso episode_stories table
// ---------------------------------------------------------------------------

async function cleanEpisodeStories() {
  const { getDb } = await import(join(ROOT, 'web/api/lib/db.js'))
  const db = await getDb()

  // Load all rows with a non-null, non-empty URL
  const r = await db.execute(
    `SELECT s.id, s.url, e.episode_url AS episode_url
       FROM episode_stories s
       JOIN episodes e ON e.id = s.episode_id
      WHERE s.url IS NOT NULL AND s.url != ''`
  )

  const toNull = []
  for (const row of r.rows) {
    if (shouldNullifyStoryUrl(row.url, row.episode_url)) {
      toNull.push(row.id)
    }
  }

  console.log(`--- Turso episode_stories ---`)
  console.log(`  rows scanned:  ${r.rows.length}`)
  console.log(`  rows to null:  ${toNull.length}`)

  if (toNull.length > 0 && COMMIT) {
    // Batch in chunks of 500 IDs
    for (let i = 0; i < toNull.length; i += 500) {
      const chunk = toNull.slice(i, i + 500)
      const placeholders = chunk.map(() => '?').join(',')
      await db.execute({
        sql: `UPDATE episode_stories SET url = NULL WHERE id IN (${placeholders})`,
        args: chunk,
      })
    }
    console.log(`  updated ${toNull.length} rows → url = NULL`)
  } else if (toNull.length > 0) {
    console.log(`  (would update ${toNull.length} rows if --commit were set)`)
  }
  console.log('')
  return { rowsUpdated: toNull.length }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const digestRes = cleanDigests()
const sessionsRes = cleanStoriesSessions()
const tursoRes = await cleanEpisodeStories()

console.log(`=== SUMMARY (${LABEL}) ===`)
console.log(`  digest URLs nulled:          ${digestRes.storiesNulled}`)
console.log(`  stories-session URLs nulled: ${sessionsRes.storiesNulled}`)
console.log(`  episode_stories rows nulled: ${tursoRes.rowsUpdated}`)
if (!COMMIT) {
  console.log('')
  console.log('  This was a DRY RUN. Re-run with --commit to apply changes.')
}
process.exit(0)
