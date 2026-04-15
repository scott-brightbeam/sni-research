#!/usr/bin/env bun
/**
 * reconcile-digest-urls.js — merge DISCOVER-resolved URLs from
 * stories-session-N.json files back into digest key_stories via
 * headline fuzzy-matching.
 *
 * The podcast-import skill writes digests with key_stories[]; the UI
 * reads these (via episode_stories in Turso). The editorial-analyse
 * skill writes a parallel stories-session-N.json with its own (often
 * differently-worded) headlines. DISCOVER resolves the stories-session
 * URLs. This script transfers those URLs back into the digest files so
 * the UI shows clickable links for stories that appeared in both.
 *
 * Match scoring:
 *   - Extract significant tokens from each headline (lowercase,
 *     length >= 4, not in STOPWORDS)
 *   - Score = count of tokens shared between the two headlines
 *   - Require at least MIN_MATCH_SCORE tokens in common
 *   - Pick the best scoring match per digest story
 *
 * Usage:
 *   bun scripts/reconcile-digest-urls.js           # dry run
 *   bun scripts/reconcile-digest-urls.js --commit  # write changes
 */

import { readdirSync, statSync, readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const COMMIT = process.argv.includes('--commit')
const LABEL = COMMIT ? '[COMMIT]' : '[DRY-RUN]'

const STOPWORDS = new Set([
  'that','this','with','from','have','been','will','would','could','should',
  'what','when','where','which','their','there','these','those','about',
  'into','they','them','more','than','other','after','also','such','like',
  'over','over','some','most','much','many','only','just','than','then',
  'while','during','because','since','after','before','between','among',
  'through','under','into','onto','upon','via','very','quite','really',
  'been','being','was','were','has','had','does','did','doing','done',
])

const MIN_MATCH_SCORE = 6 // at least 6 shared significant tokens. Higher = fewer false positives.

function tokensFor(text) {
  if (!text) return new Set()
  return new Set(
    text.toLowerCase()
      .replace(/[^\p{L}\p{N}\s$%]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !STOPWORDS.has(t))
  )
}

function score(aTokens, bTokens) {
  let n = 0
  for (const t of aTokens) if (bTokens.has(t)) n++
  return n
}

/**
 * Parse a story's sourceFile into a slug that matches digest filenames.
 * sourceFile: "2026-04-14-moonshots-elon-musk-vs-sam-altman-ai-job-loss-and-openai-s-852b.md"
 * Returns: { date: "2026-04-14", slug: "elon-musk-vs-sam-altman-ai-job-loss-and-openai-s-852b" }
 */
function parseSourceFile(sf) {
  if (!sf) return null
  const m = sf.replace(/\.md$/, '').match(/^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)$/i)
  if (!m) return null
  const date = m[1]
  const rest = m[2]
  // Strip source prefix (ai-daily-brief-, moonshots-, a16z-, etc.) — we don't
  // know how many segments the source slug has, so we try progressively shorter
  // prefixes later when matching against digest filenames.
  return { date, rest }
}

// ---------------------------------------------------------------------------

console.log(`${LABEL} reconcile-digest-urls starting…`)

// Build map: date -> list of (stories from stories-session files)
// grouped for each episode-slug-variant
const sessionFiles = readdirSync(join(ROOT, 'data/editorial'))
  .filter(f => /^stories-session-\d+\.json$/.test(f))

/** @type {Map<string, Array<{headline:string, url:string, tokens:Set, sourceFile:string, rest:string, date:string}>>} */
const sessionByDate = new Map()
let totalSessionStories = 0

for (const f of sessionFiles) {
  try {
    const d = JSON.parse(readFileSync(join(ROOT, 'data/editorial', f), 'utf8'))
    if (!Array.isArray(d)) continue
    for (const s of d) {
      if (!s.headline || !s.url || !s.sourceFile) continue
      if (!s.url.startsWith('http')) continue // skip sentinels for matching purposes
      const parsed = parseSourceFile(s.sourceFile)
      if (!parsed) continue
      const entry = {
        headline: s.headline,
        url: s.url,
        headlineTokens: tokensFor(s.headline), // headline only, matching key
        tokens: tokensFor(s.headline + ' ' + (s.detail || '')), // retained for compat
        sourceFile: s.sourceFile,
        rest: parsed.rest,
        date: parsed.date,
      }
      if (!sessionByDate.has(parsed.date)) sessionByDate.set(parsed.date, [])
      sessionByDate.get(parsed.date).push(entry)
      totalSessionStories++
    }
  } catch {}
}

console.log(`Indexed ${totalSessionStories} DISCOVER-resolved stories across ${sessionByDate.size} dates`)

// Walk digest files, try to match their key_stories to session entries
const podcastsDir = join(ROOT, 'data/podcasts')
let digestsScanned = 0, digestsChanged = 0, urlsTransferred = 0
const changes = []

const dates = readdirSync(podcastsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
for (const date of dates) {
  const dateDir = join(podcastsDir, date)
  for (const source of readdirSync(dateDir)) {
    const sourceDir = join(dateDir, source)
    if (!statSync(sourceDir).isDirectory()) continue
    for (const file of readdirSync(sourceDir)) {
      if (!file.endsWith('.digest.json')) continue
      const path = join(sourceDir, file)
      digestsScanned++

      let digest
      try { digest = JSON.parse(readFileSync(path, 'utf8')) }
      catch { continue }
      if (!Array.isArray(digest.key_stories) || digest.key_stories.length === 0) continue

      // Candidate session stories: same date, and sourceFile's rest segment
      // includes the digest filename slug.
      const digestSlug = file.replace(/\.digest\.json$/, '')
      const candidates = (sessionByDate.get(date) || [])
        .filter(s => s.rest.includes(digestSlug) || digestSlug.includes(s.rest))

      if (candidates.length === 0) continue

      // Build all (digestIdx, candidateIdx, score) triples for key_stories
      // without URLs, then greedily assign highest-scoring pairs first,
      // never reusing a candidate. This prevents one session story from
      // matching multiple digest stories (which caused false positives
      // when a digest story's DETAIL mentioned an entity already covered
      // by a different session story).
      const pairs = []
      digest.key_stories.forEach((ks, di) => {
        if (!ks || ks.url) return
        const ksTokens = tokensFor(ks.headline) // HEADLINE ONLY — detail adds noise
        candidates.forEach((c, ci) => {
          const sc = score(ksTokens, c.headlineTokens)
          if (sc >= MIN_MATCH_SCORE) pairs.push({ di, ci, score: sc })
        })
      })
      pairs.sort((a, b) => b.score - a.score)

      const usedDigests = new Set()
      const usedCandidates = new Set()
      let changed = false
      for (const { di, ci, score: sc } of pairs) {
        if (usedDigests.has(di) || usedCandidates.has(ci)) continue
        usedDigests.add(di)
        usedCandidates.add(ci)
        const ks = digest.key_stories[di]
        const c = candidates[ci]
        ks.url = c.url
        changed = true
        urlsTransferred++
        changes.push({
          file: path.replace(ROOT + '/', ''),
          digestHead: ks.headline.substring(0, 60),
          sessionHead: c.headline.substring(0, 60),
          score: sc,
          url: c.url.substring(0, 60),
        })
      }

      if (changed) {
        digestsChanged++
        if (COMMIT) writeFileSync(path, JSON.stringify(digest, null, 2) + '\n')
      }
    }
  }
}

console.log('')
console.log(`Digests scanned: ${digestsScanned}`)
console.log(`Digests changed: ${digestsChanged}`)
console.log(`URLs transferred: ${urlsTransferred}`)

if (changes.length > 0) {
  console.log('')
  console.log('Sample matches:')
  changes.slice(0, 8).forEach(c => {
    console.log(`  [${c.score}] ${c.digestHead}`)
    console.log(`     →  ${c.sessionHead}`)
    console.log(`     URL: ${c.url}`)
  })
}

if (!COMMIT) {
  console.log('')
  console.log('This was a DRY RUN. Re-run with --commit to apply changes.')
}
