#!/usr/bin/env bun
/**
 * editorial-verify-draft.js — Deterministic hallucination gate for SNI drafts
 *
 * Cross-references every URL and podcast reference in a draft against the
 * local article corpus (data/verified/) and podcast digests (data/podcasts/).
 * No LLM calls. HTTP liveness check for podcast URLs (skippable with --skip-http).
 * File-system checks for everything else.
 *
 * This script is the ONLY process allowed to write:
 *   - data/editorial/drafts/draft-session-{N}-final.md
 *   - output/draft-week-{W}.md
 *   - their {file}.verified sidecars
 *
 * A PreToolUse hook blocks any other writer (see .claude/hooks/verify-draft-write.py).
 *
 * Usage:
 *   bun scripts/editorial-verify-draft.js \
 *     --input data/editorial/drafts/draft-session-53-v2.md \
 *     --output-session data/editorial/drafts/draft-session-53-final.md \
 *     --output-week output/draft-week-15.md \
 *     --week 15
 *
 * Verify-only mode (no promotion):
 *   bun scripts/editorial-verify-draft.js --input {draft} --week 15 --verify-only
 *
 * Exit codes:
 *   0  pass — output files written, sidecars present
 *   1  verification fail — no output files written, failure report in logs/
 *   2  operational error — missing input, bad config, etc.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'
import yaml from 'js-yaml'
import { getWeekWindow } from './lib/week.js'
import { sendTelegram } from './lib/telegram.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const VERIFIER_VERSION = '1.0'

// ── CLI parsing ──────────────────────────────────────────

function parseArgs() {
  const args = { verifyOnly: false, skipHttp: false }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--input') args.input = argv[++i]
    else if (a === '--output-session') args.outputSession = argv[++i]
    else if (a === '--output-week') args.outputWeek = argv[++i]
    else if (a === '--week') args.week = parseInt(argv[++i], 10)
    else if (a === '--year') args.year = parseInt(argv[++i], 10)
    else if (a === '--verify-only') args.verifyOnly = true
    else if (a === '--skip-http') args.skipHttp = true
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0) }
    else { console.error(`Unknown argument: ${a}`); printHelp(); process.exit(2) }
  }
  if (!args.input) { console.error('Missing --input'); process.exit(2) }
  if (!args.week) { console.error('Missing --week'); process.exit(2) }
  if (!args.year) args.year = new Date().getFullYear()
  if (!args.verifyOnly && (!args.outputSession || !args.outputWeek)) {
    console.error('Missing --output-session or --output-week (or use --verify-only)')
    process.exit(2)
  }
  return args
}

function printHelp() {
  console.error(`Usage: bun scripts/editorial-verify-draft.js [options]

Options:
  --input PATH            Draft file to verify (required)
  --week N                ISO week number (required)
  --year YYYY             ISO year (default: current year)
  --output-session PATH   Destination for verified -final.md on pass
  --output-week PATH      Destination for verified output/draft-week-N.md on pass
  --verify-only           Verify without writing output files
  --skip-http             Skip HTTP liveness checks on podcast URLs (default: check)
  -h, --help              Show this help

Exit codes: 0 pass, 1 verification fail, 2 operational error`)
}

// ── URL normalisation ───────────────────────────────────

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi',
])

/**
 * Normalise a URL for comparison:
 *   - lowercase host, drop www.
 *   - force https://
 *   - drop fragment
 *   - strip tracking query params (utm_*, ref, fbclid, etc.)
 *   - collapse slashes, drop trailing slash
 *   - URL-decode path
 */
export function normaliseUrl(url) {
  try {
    const u = new URL(url.trim())
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    u.protocol = 'https:'
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k)
    }
    let path = u.pathname.replace(/\/+/g, '/')
    if (path.length > 1) path = path.replace(/\/$/, '')
    try { path = decodeURI(path) } catch { /* keep raw */ }
    u.pathname = path
    return u.toString()
  } catch {
    return url.trim()
  }
}

/**
 * Check whether two URLs match under the permissive rule:
 *  1. Exact normalised match, OR
 *  2. Same origin AND first 3 path segments match AND path-prefix relationship,
 *     which catches editor slug-stripping (e.g. ...-fsdC0VvN truncation)
 */
export function urlsMatch(draftUrl, corpusUrl) {
  const a = normaliseUrl(draftUrl)
  const b = normaliseUrl(corpusUrl)
  if (a === b) return true
  try {
    const ua = new URL(a)
    const ub = new URL(b)
    if (ua.origin !== ub.origin) return false
    // Query strings must match if present (strict)
    if (ua.search !== ub.search) return false
    const segsA = ua.pathname.split('/').filter(Boolean)
    const segsB = ub.pathname.split('/').filter(Boolean)
    // Neither may be a bare homepage (root or empty path)
    if (segsA.length === 0 || segsB.length === 0) return false
    // Single-segment paths are allowed only if the slug is long enough to be
    // clearly not a top-level directory (e.g. /p vs /p/ev-568). Sites like
    // cognitiverevolution.ai use flat URLs with long slugs.
    if ((segsA.length === 1 && segsA[0].length < 20) ||
        (segsB.length === 1 && segsB[0].length < 20)) {
      return false
    }
    // Check strict equality for all segments EXCEPT the last compared one.
    // The final segment gets a startsWith fallback — allowing slug-suffix
    // truncation like .../agent-breakthroughs vs .../agent-breakthroughs-fsdC0VvN.
    const checkLen = Math.min(3, segsA.length, segsB.length)
    for (let i = 0; i < checkLen - 1; i++) {
      if (segsA[i] !== segsB[i]) return false
    }
    const lastIdx = checkLen - 1
    const lastA = segsA[lastIdx]
    const lastB = segsB[lastIdx]
    if (lastA === lastB) {
      // Leading segments all match. If both have exactly checkLen segments, full path match.
      // If one is longer, it's a prefix match — accept.
      return true
    }
    // Slug-suffix divergence on the final compared segment.
    // Accept if the longer slug extends the shorter with a hyphen-continuation
    // (common pattern: tracking ID appended with '-', or descriptive slug tail).
    const shorter = lastA.length < lastB.length ? lastA : lastB
    const longer = lastA.length < lastB.length ? lastB : lastA
    if (shorter.length >= 4 && longer.startsWith(shorter)) {
      const tail = longer.slice(shorter.length)
      // Tail must begin with a separator (-, _, or .) to ensure this is a
      // slug extension, not two unrelated URLs that happen to share a prefix.
      if (/^[-_.]/.test(tail)) return true
    }
    return false
  } catch {
    return false
  }
}

// ── Markdown link extraction (copied from verify-links.js, not imported) ──

export function extractLinks(markdown) {
  const lines = markdown.split('\n')
  const links = []
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g
  for (let i = 0; i < lines.length; i++) {
    let match
    while ((match = linkPattern.exec(lines[i])) !== null) {
      links.push({
        anchorText: match[1].trim(),
        url: match[2].trim(),
        line: i + 1,
      })
    }
  }
  return links
}

// ── Section extraction ─────────────────────────────────

/**
 * Classify each link by which section it appears in:
 *   'tldr', 'sector', 'podcast'
 */
export function classifyLinks(markdown, links) {
  const lines = markdown.split('\n')
  // Find section boundaries
  let tldrStart = -1, transitionLine = -1, podcastStart = -1, closingLine = -1
  for (let i = 0; i < lines.length; i++) {
    if (tldrStart === -1 && /^##\s*tl;dr:/i.test(lines[i])) tldrStart = i
    if (transitionLine === -1 && /here's everything else worth reading/i.test(lines[i])) transitionLine = i
    if (podcastStart === -1 && /^##\s*But what set podcast/i.test(lines[i])) podcastStart = i
    if (/^thank you for reading/i.test(lines[i])) closingLine = i
  }
  return links.map(l => {
    let section = 'unknown'
    if (podcastStart !== -1 && l.line >= podcastStart + 1) section = 'podcast'
    else if (transitionLine !== -1 && l.line >= transitionLine + 1) section = 'sector'
    else if (tldrStart !== -1 && l.line >= tldrStart + 1) section = 'tldr'
    else if (tldrStart === -1 || l.line < tldrStart + 1) section = 'header'
    return { ...l, section }
  })
}

/**
 * Extract the podcast section text for prose-level scanning.
 */
export function extractPodcastSection(markdown) {
  const lines = markdown.split('\n')
  let start = -1, end = -1
  for (let i = 0; i < lines.length; i++) {
    if (start === -1 && /^##\s*But what set podcast/i.test(lines[i])) start = i
    if (start !== -1 && /^thank you for reading/i.test(lines[i])) { end = i; break }
  }
  if (start === -1) return ''
  if (end === -1) end = lines.length
  return lines.slice(start, end).join('\n')
}

// ── Corpus scanning ─────────────────────────────────────

/**
 * Scan data/verified/ for article URLs within a date range.
 * Returns a Map of normalised URL → { url, date_published, file }.
 */
export function buildArticleUrlIndex(windowStart, windowEnd, bufferDays = 21) {
  const verifiedDir = join(ROOT, 'data/verified')
  const index = new Map()
  if (!existsSync(verifiedDir)) return index

  // Compute scan range: window start − bufferDays to window end
  const startDate = new Date(windowStart + 'T00:00:00Z')
  startDate.setUTCDate(startDate.getUTCDate() - bufferDays)
  const startStr = startDate.toISOString().slice(0, 10)

  for (const dateDir of readdirSync(verifiedDir)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
    if (dateDir < startStr || dateDir > windowEnd) continue
    const datePath = join(verifiedDir, dateDir)
    let sectorDirs
    try { sectorDirs = readdirSync(datePath) } catch { continue }
    for (const sectorDir of sectorDirs) {
      const sectorPath = join(datePath, sectorDir)
      let files
      try { files = readdirSync(sectorPath) } catch { continue }
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          if (raw.url) {
            const key = normaliseUrl(raw.url)
            index.set(key, {
              url: raw.url,
              date_published: raw.date_published || dateDir,
              file: join(sectorPath, file),
            })
          }
        } catch { /* skip malformed */ }
      }
    }
  }
  return index
}

/**
 * Load canonical sources (host + name per slug) from editorial-sources.yaml
 */
function loadCanonicalSources() {
  const sourcesPath = join(ROOT, 'config/editorial-sources.yaml')
  const sources = new Map()
  if (!existsSync(sourcesPath)) return sources
  try {
    const cfg = yaml.load(readFileSync(sourcesPath, 'utf-8'))
    const src = cfg?.sources || {}
    for (const [slug, meta] of Object.entries(src)) {
      sources.set(slug, { name: meta.name || slug, host: meta.host || '' })
    }
  } catch { /* degrade gracefully */ }
  return sources
}

/**
 * Derive ISO week number from a YYYY-MM-DD string.
 * Matches getWeekWindow — Saturday-Friday convention (Apr 2026).
 */
function digestDateToWeek(dateStr, windowStart, windowEnd) {
  // For simplicity, classify by whether the digest date falls in the window
  // Treat anything within window ± 14 days before as "previous weeks"
  if (dateStr >= windowStart && dateStr <= windowEnd) return 0 // current week
  if (dateStr < windowStart) {
    const cutoff14 = new Date(windowStart + 'T00:00:00Z')
    cutoff14.setUTCDate(cutoff14.getUTCDate() - 14)
    const cutoffStr = cutoff14.toISOString().slice(0, 10)
    if (dateStr >= cutoffStr) return -1 // within trailing 2 weeks
  }
  return -99 // out of range
}

/**
 * Load podcast whitelist. Prefers manifest.json (fast lookup with week metadata)
 * but falls back to scanning data/podcasts/{date}/{source}/*.digest.json directly
 * when manifest is missing or corrupt.
 *
 * Returns { digests: [...], urlIndex: Map, sources: Map<slug, {name, host}> }
 */
export function buildPodcastWhitelist(targetWeek, targetYear) {
  const sources = loadCanonicalSources()
  const urlIndex = new Map()
  const digests = []

  const { start: windowStart, end: windowEnd } = getWeekWindow(targetWeek, targetYear)
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')

  // Path 1: manifest.json exists — use it (fast, has authoritative week numbers)
  if (existsSync(manifestPath)) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      // Fall through to directory scan
      manifest = null
    }

    if (manifest) {
      for (const [filename, entry] of Object.entries(manifest)) {
        const w = entry.week
        if (typeof w !== 'number') continue
        const weeksDiff = targetWeek - w
        if (weeksDiff < 0 || weeksDiff > 2) continue
        if (!entry.digestPath) continue

        const digestFullPath = join(ROOT, entry.digestPath)
        if (!existsSync(digestFullPath)) continue

        let digest
        try { digest = JSON.parse(readFileSync(digestFullPath, 'utf-8')) }
        catch { continue }

        addDigestToWhitelist({
          filename, entry, digest, sources, urlIndex, digests,
          isCurrentWeek: w === targetWeek,
        })
      }
      return { digests, urlIndex, sources }
    }
  }

  // Path 2: fallback — scan data/podcasts/{date}/{source}/*.digest.json directly
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) return { digests, urlIndex, sources }

  // Compute trailing window: window start − 14 days to window end
  const trailingStartDate = new Date(windowStart + 'T00:00:00Z')
  trailingStartDate.setUTCDate(trailingStartDate.getUTCDate() - 14)
  const trailingStart = trailingStartDate.toISOString().slice(0, 10)

  let dateDirs
  try { dateDirs = readdirSync(podcastDir) } catch { return { digests, urlIndex, sources } }

  for (const dateDir of dateDirs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
    if (dateDir < trailingStart || dateDir > windowEnd) continue
    const datePath = join(podcastDir, dateDir)
    let sourceDirs
    try {
      if (!statSync(datePath).isDirectory()) continue
      sourceDirs = readdirSync(datePath)
    } catch { continue }

    for (const sourceDir of sourceDirs) {
      const sourcePath = join(datePath, sourceDir)
      let files
      try {
        if (!statSync(sourcePath).isDirectory()) continue
        files = readdirSync(sourcePath)
      } catch { continue }

      for (const file of files) {
        if (!file.endsWith('.digest.json')) continue
        let digest
        try {
          digest = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
        } catch { continue }

        const isCurrentWeek = dateDir >= windowStart && dateDir <= windowEnd
        const slug = file.replace('.digest.json', '')
        const entry = {
          filename: `${dateDir}-${sourceDir}-${slug}.md`,
          date: dateDir,
          source: digest.source || sourceDir,
          sourceSlug: sourceDir,
          title: digest.title || slug,
          week: isCurrentWeek ? targetWeek : null,
          year: targetYear,
        }

        addDigestToWhitelist({
          filename: entry.filename,
          entry,
          digest,
          sources,
          urlIndex,
          digests,
          isCurrentWeek,
        })
      }
    }
  }

  return { digests, urlIndex, sources }
}

/**
 * Add a digest entry to the whitelist maps. Shared between manifest and
 * directory-scan code paths.
 */
function addDigestToWhitelist({ filename, entry, digest, sources, urlIndex, digests, isCurrentWeek }) {
  const canonical = sources.get(entry.sourceSlug) || {}
  const d = {
    filename,
    date: entry.date,
    source: entry.source || digest.source,
    sourceSlug: entry.sourceSlug,
    title: entry.title || digest.title,
    week: entry.week,
    year: entry.year,
    host: canonical.host || digest.host || '',
    canonicalName: canonical.name || entry.source,
    isCurrentWeek,
  }

  const urls = [
    digest.episodeUrl,
    digest.url,
    ...((digest.key_stories || []).map(s => s && s.url).filter(Boolean)),
  ].filter(Boolean)

  for (const u of urls) {
    urlIndex.set(normaliseUrl(u), { url: u, digest: d })
  }
  d.urls = urls
  digests.push(d)
}

// ── Config loaders ─────────────────────────────────────

export function loadOverrideUrls() {
  const path = join(ROOT, 'config/editorial-verified-urls.txt')
  const set = new Set()
  if (!existsSync(path)) return set
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      set.add(normaliseUrl(trimmed))
    }
  } catch { /* empty */ }
  return set
}

export function loadPodcastBlocklist() {
  const path = join(ROOT, 'config/podcast-name-blocklist.yaml')
  if (!existsSync(path)) return { names: [], pairs: [] }
  try {
    const cfg = yaml.load(readFileSync(path, 'utf-8'))
    return {
      names: cfg?.blocked_names || [],
      pairs: cfg?.blocked_host_podcast_pairs || [],
    }
  } catch {
    return { names: [], pairs: [] }
  }
}

// ── HTTP liveness check ────────────────────────────────

/**
 * Check if a URL resolves to a 2xx or 3xx status.
 * Uses HEAD first (cheap), falls back to GET if HEAD returns 405 Method Not Allowed.
 * Timeout: 8 seconds per URL.
 *
 * Returns { ok: boolean, status: number|null, error: string|null }
 */
export async function checkUrlLive(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  try {
    // Try HEAD first (cheap)
    let resp = await fetch(url, { method: 'HEAD', signal: controller.signal, headers, redirect: 'follow' })
    // Some servers return 405 or 403 on HEAD; retry with GET
    if (resp.status === 405 || resp.status === 403) {
      resp = await fetch(url, { method: 'GET', signal: controller.signal, headers, redirect: 'follow' })
    }
    clearTimeout(timeout)
    if (resp.status >= 200 && resp.status < 400) return { ok: true, status: resp.status, error: null }
    return { ok: false, status: resp.status, error: `HTTP ${resp.status}` }
  } catch (err) {
    clearTimeout(timeout)
    const isTimeout = err.name === 'AbortError'
    return { ok: false, status: null, error: isTimeout ? 'timeout' : err.message }
  }
}

/**
 * Check HTTP liveness for all podcast section URLs.
 * Rate-limited to avoid hammering any one domain.
 */
export async function checkPodcastUrlsLive(classifiedLinks) {
  const violations = []
  const podcastLinks = classifiedLinks.filter(l => l.section === 'podcast')
  if (podcastLinks.length === 0) return violations

  const RATE_LIMIT_MS = 500 // half-second between requests
  for (const link of podcastLinks) {
    const result = await checkUrlLive(link.url)
    if (!result.ok) {
      violations.push({
        severity: 'fail',
        check: 'podcast_url_live',
        message: `Podcast URL does not resolve: ${link.url} (${result.error || 'HTTP ' + result.status}, line ${link.line})`,
      })
    }
    await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS))
  }
  return violations
}

/**
 * Check HTTP liveness for all tl;dr and sector URLs (non-podcast). Catches URL
 * typos and regional-variant mismatches that the corpus lookup would accept
 * but a reader clicking the link would not.
 *
 * Added Apr 2026 after Week 17 retro: the draft carried
 *   /us/...cfc-pilots-agentic...572446.aspx (draft) vs
 *   /ca/...cfc-pilots-agentic...572448.aspx (corpus)
 * and
 *   /apple-new-ceo-john-ternus-... (draft) vs
 *   /apple-ceo-john-ternus-...     (corpus)
 * Both passed corpus_urls (close-enough string match) but would have been
 * caught by a HEAD request.
 *
 * Parallelism: request concurrency = 5, rate-limited per host to avoid bans.
 * Total time for ~40 links: ~10-15 seconds. Budget worth paying.
 */
export async function checkNonPodcastUrlsLive(classifiedLinks) {
  const violations = []
  const links = classifiedLinks.filter(l => l.section !== 'podcast')
  if (links.length === 0) return violations

  const CONCURRENCY = 5
  const PER_HOST_DELAY_MS = 300
  const hostLastHit = new Map()

  async function checkOne(link) {
    const host = (() => {
      try { return new URL(link.url).hostname } catch { return '' }
    })()
    // Reserve a slot BEFORE awaiting so parallel workers don't all read
    // the same "last hit" timestamp and stampede the same host.
    const now = Date.now()
    const nextFree = Math.max(now, hostLastHit.get(host) || 0)
    hostLastHit.set(host, nextFree + PER_HOST_DELAY_MS)
    const waitMs = nextFree - now
    if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs))

    const result = await checkUrlLive(link.url)
    if (result.ok) return null

    // Status 403 is often a bot-block on working pages — warn, don't fail.
    const status = result.status
    const looksLikeBotBlock = status === 403 || status === 429
    const errLabel = result.error || (status ? `HTTP ${status}` : 'network error')
    return {
      severity: looksLikeBotBlock ? 'warn' : 'fail',
      check: 'link_url_live',
      message: `${link.section.toUpperCase()} URL does not resolve: ${link.url} (${errLabel}, line ${link.line})`,
    }
  }

  // Simple worker pool
  const queue = [...links]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const link = queue.shift()
      if (!link) break
      const v = await checkOne(link)
      if (v) violations.push(v)
    }
  })
  await Promise.all(workers)

  return violations
}

// ── Checks ─────────────────────────────────────────────

export function checkPodcastReferences(draft, classifiedLinks, whitelist, sources, overrideUrls = new Set()) {
  const violations = []
  const podcastLinks = classifiedLinks.filter(l => l.section === 'podcast')

  for (const link of podcastLinks) {
    // Podcast URLs MUST be exact (normalised) matches against the digest corpus.
    // No prefix fallback — editors must copy URLs verbatim from digest JSON files.
    // Paraphrased/truncated podcast URLs do not resolve on the web (HTTP check
    // will catch them) and are a common hallucination vector.
    const normDraft = normaliseUrl(link.url)
    if (whitelist.urlIndex.has(normDraft)) continue

    // Editor override: URL was manually verified and added to config/editorial-verified-urls.txt
    if (overrideUrls.has(normDraft)) continue

    // Also accept if anchor text references a known source AND the URL shares
    // the same origin as a whitelisted source URL (weaker, but avoids rejecting
    // legitimate URL variants that still resolve).
    const text = link.anchorText.toLowerCase()
    let nameMatched = false
    let originMatched = false
    for (const digest of whitelist.digests) {
      if (!digest.isCurrentWeek) continue
      const sourceName = (digest.canonicalName || digest.source || '').toLowerCase()
      const host = (digest.host || '').toLowerCase()
      if ((sourceName && text.includes(sourceName)) ||
          (host && text.includes(host))) {
        nameMatched = true
        // Check if any digest URL shares the origin of the draft URL
        try {
          const draftOrigin = new URL(link.url).origin
          for (const u of (digest.urls || [])) {
            try {
              if (new URL(u).origin === draftOrigin) { originMatched = true; break }
            } catch {}
          }
        } catch {}
        if (originMatched) break
      }
    }

    if (nameMatched && originMatched) {
      // Name AND origin matched — likely a legitimate URL variant; warn but pass
      // HTTP check downstream will catch dead URLs
      violations.push({
        severity: 'warn',
        check: 'podcast_references',
        message: `Podcast URL does not match a digest URL exactly, but source name and origin match a whitelist entry: "${link.anchorText}" → ${link.url} (line ${link.line})`,
      })
    } else {
      violations.push({
        severity: 'fail',
        check: 'podcast_references',
        message: `Podcast reference not verifiable: "${link.anchorText}" → ${link.url} (line ${link.line}). Copy the URL verbatim from data/podcasts/.../*.digest.json`,
      })
    }
  }

  return violations
}

export function checkCorpusUrls(draft, classifiedLinks, articleIndex, podcastWhitelist, overrideUrls) {
  const violations = []
  for (const link of classifiedLinks) {
    const normDraft = normaliseUrl(link.url)

    // Exact override match
    if (overrideUrls.has(normDraft)) continue

    // Article corpus match (exact or prefix)
    let matched = false
    if (articleIndex.has(normDraft)) matched = true
    if (!matched) {
      for (const corpusUrl of articleIndex.keys()) {
        if (urlsMatch(link.url, corpusUrl)) { matched = true; break }
      }
    }
    if (matched) continue

    // Podcast whitelist match
    if (podcastWhitelist.urlIndex.has(normDraft)) continue
    let podcastMatched = false
    for (const [key, entry] of podcastWhitelist.urlIndex) {
      if (urlsMatch(link.url, entry.url)) { podcastMatched = true; break }
    }
    if (podcastMatched) continue

    violations.push({
      severity: 'fail',
      check: 'corpus_urls',
      message: `Draft URL not in corpus: ${link.url} (line ${link.line}, in ${link.section})`,
    })
  }
  return violations
}

export function checkFreshness(draft, classifiedLinks, articleIndex, windowStart, windowEnd) {
  const violations = []
  const windowStartDate = new Date(windowStart)
  const windowEndDate = new Date(windowEnd)
  const lines = draft.split('\n')

  for (const link of classifiedLinks) {
    const normDraft = normaliseUrl(link.url)
    let entry = articleIndex.get(normDraft)
    if (!entry) {
      for (const [key, v] of articleIndex) {
        if (urlsMatch(link.url, v.url)) { entry = v; break }
      }
    }
    if (!entry || !entry.date_published) continue

    const pubDate = new Date(entry.date_published)
    if (isNaN(pubDate.getTime())) continue

    const daysBefore = Math.floor((windowStartDate - pubDate) / (1000 * 60 * 60 * 24))
    const daysAfter = Math.floor((pubDate - windowEndDate) / (1000 * 60 * 60 * 24))

    if (pubDate >= windowStartDate && pubDate <= windowEndDate) continue

    const surroundingText = (lines[link.line - 1] || '').toLowerCase()
    const timeMarkers = ['this week', 'today', 'yesterday', 'last night', 'this morning']
    const hasTimeMarker = timeMarkers.some(m => surroundingText.includes(m))

    if (daysBefore > 21) {
      if (hasTimeMarker) {
        violations.push({
          severity: 'fail',
          check: 'freshness',
          message: `Stale URL used with 'this week' claim: ${link.url} (${entry.date_published} is ${daysBefore} days before window, line ${link.line})`,
        })
      } else {
        violations.push({
          severity: 'warn',
          check: 'freshness',
          message: `Stale URL: ${link.url} (${entry.date_published}, ${daysBefore} days before window)`,
        })
      }
    } else if (daysBefore > 14 || daysAfter > 3) {
      violations.push({
        severity: 'warn',
        check: 'freshness',
        message: `URL outside window: ${link.url} (${entry.date_published})`,
      })
    }
  }
  return violations
}

export function checkDateSanity(draft, windowStart, windowEnd) {
  const violations = []
  const windowStartDate = new Date(windowStart)
  const windowEndDate = new Date(windowEnd)
  const today = new Date()

  // Look for explicit date strings (simple heuristic)
  const datePattern = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?/g
  let match
  while ((match = datePattern.exec(draft)) !== null) {
    const monthName = match[0].split(/\s+/)[0]
    const day = parseInt(match[1], 10)
    const year = match[2] ? parseInt(match[2], 10) : windowStartDate.getFullYear()
    const monthIdx = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(monthName.toLowerCase())
    if (monthIdx === -1) continue
    const d = new Date(Date.UTC(year, monthIdx, day))
    if (d > today && (d - today) / (1000 * 60 * 60 * 24) > 7) {
      violations.push({
        severity: 'fail',
        check: 'date_sanity',
        message: `Future date referenced: ${match[0]} (line ${draft.substring(0, match.index).split('\n').length})`,
      })
    }
  }
  return violations
}

export function checkPodcastBlocklist(draft, blocklist) {
  const violations = []
  const lines = draft.split('\n')
  const lower = draft.toLowerCase()

  for (const name of blocklist.names) {
    const idx = lower.indexOf(name.toLowerCase())
    if (idx !== -1) {
      const lineNum = draft.substring(0, idx).split('\n').length
      violations.push({
        severity: 'fail',
        check: 'podcast_blocklist',
        message: `Known hallucinated podcast name detected: "${name}" (line ${lineNum})`,
      })
    }
  }

  for (const pair of blocklist.pairs) {
    const needle = `${pair.host}`.toLowerCase()
    if (lower.includes(needle) && lower.includes(pair.podcast.toLowerCase())) {
      violations.push({
        severity: 'fail',
        check: 'podcast_blocklist',
        message: `Blocked host/podcast pair: "${pair.host}" on "${pair.podcast}"`,
      })
    }
  }

  return violations
}

export function checkPodcastNameHeuristic(draft, whitelist, sources) {
  // Scan whole draft for "Capitalised Phrase on/podcast/show/brief"
  // and verify the phrase matches a whitelist source name or any known source
  const violations = []
  const lines = draft.split('\n')
  const validPhrases = new Set()
  for (const d of whitelist.digests) {
    if (d.canonicalName) validPhrases.add(d.canonicalName.toLowerCase())
    if (d.source) validPhrases.add(d.source.toLowerCase())
    if (d.host) validPhrases.add(d.host.toLowerCase())
  }
  for (const [slug, meta] of sources) {
    if (meta.name) validPhrases.add(meta.name.toLowerCase())
    if (meta.host) validPhrases.add(meta.host.toLowerCase())
  }

  const phrasePattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\s+(?:on|podcast|show|brief)\b/g
  for (let i = 0; i < lines.length; i++) {
    let m
    const line = lines[i]
    while ((m = phrasePattern.exec(line)) !== null) {
      const phrase = m[1]
      const lower = phrase.toLowerCase()
      // Allow short common phrases (single word that's a generic term)
      if (phrase.split(/\s+/).length < 2) continue
      // Allow if phrase is inside a recognised source/host name
      let recognised = false
      for (const v of validPhrases) {
        if (v.includes(lower) || lower.includes(v)) { recognised = true; break }
      }
      if (recognised) continue
      // Common English phrases that are false positives
      if (/^(Here|Note|Key|Look|First|Next|This|That|Last|Our|New|Also)/i.test(phrase)) continue
      violations.push({
        severity: 'warn',
        check: 'podcast_name_heuristic',
        message: `Unrecognised capitalised phrase adjacent to podcast keyword: "${phrase}" (line ${i + 1})`,
      })
    }
  }
  return violations
}

export function checkStructure(draft) {
  const violations = []
  const lines = draft.split('\n')

  // Title line
  if (!/^#\s+SNI:\s+Week\s+\d+/.test(lines[0] || '')) {
    violations.push({ severity: 'fail', check: 'structure', message: 'Missing title line `# SNI: Week N` on line 1' })
  }

  // Welcome line — relaxed: must contain "Welcome to" + "across"
  const welcome = lines.slice(1, 5).join(' ')
  if (!/Welcome to.*(?:across|covering)/i.test(welcome)) {
    violations.push({ severity: 'fail', check: 'structure', message: 'Missing welcome line' })
  }

  // tl;dr H2
  if (!draft.match(/^##\s*tl;dr:/im)) {
    violations.push({ severity: 'fail', check: 'structure', message: 'Missing `## tl;dr:` H2 heading' })
  }

  // Transition line
  if (!/here's everything else worth reading/i.test(draft)) {
    violations.push({ severity: 'fail', check: 'structure', message: 'Missing transition line "Here\'s everything else worth reading this week:"' })
  }

  // Five H3 sector headings in order
  const sectorOrder = ['AI & tech', 'Biopharma', 'Medtech', 'Advanced manufacturing', 'Insurance']
  let lastIdx = -1
  const sectorLines = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^###\s*(.+?):?\s*$/)
    if (!m) continue
    const heading = m[1].trim()
    const matchedSector = sectorOrder.find(s => heading.toLowerCase() === s.toLowerCase())
    if (matchedSector) sectorLines[matchedSector] = i
  }
  for (const s of sectorOrder) {
    if (!(s in sectorLines)) {
      violations.push({ severity: 'fail', check: 'structure', message: `Missing sector heading: \`### ${s}:\`` })
    }
  }
  // Verify order
  const presentOrder = sectorOrder.filter(s => s in sectorLines)
  const sortedByLine = [...presentOrder].sort((a, b) => sectorLines[a] - sectorLines[b])
  if (JSON.stringify(presentOrder) !== JSON.stringify(sortedByLine)) {
    violations.push({ severity: 'fail', check: 'structure', message: `Sector headings out of order. Expected: ${sectorOrder.join(', ')}` })
  }

  // Count bullets per sector
  const sectorBullets = {}
  for (const s of sectorOrder) {
    if (!(s in sectorLines)) continue
    const startLine = sectorLines[s]
    const nextSector = sectorOrder
      .filter(other => other !== s && other in sectorLines && sectorLines[other] > startLine)
      .sort((a, b) => sectorLines[a] - sectorLines[b])[0]
    const endLine = nextSector ? sectorLines[nextSector] : lines.length
    let bulletCount = 0
    let unlinkedBullets = 0
    for (let i = startLine + 1; i < endLine; i++) {
      if (/^-\s+\[/.test(lines[i])) {
        bulletCount++
      } else if (/^-\s+/.test(lines[i])) {
        bulletCount++
        unlinkedBullets++
      }
    }
    sectorBullets[s] = bulletCount
    if (bulletCount < 3) {
      violations.push({ severity: 'fail', check: 'structure', message: `Sector \`${s}\` has only ${bulletCount} bullets (min 3)` })
    }
    if (unlinkedBullets > 0) {
      violations.push({ severity: 'fail', check: 'structure', message: `Sector \`${s}\` has ${unlinkedBullets} bullets without linked headlines` })
    }
  }

  // Podcast section
  if (!draft.match(/^##\s*But what set podcast tongues a-wagging\?/m)) {
    violations.push({ severity: 'warn', check: 'structure', message: 'Missing podcast section heading (allowed only on zero-digest weeks)' })
  }

  // Closing line
  if (!/thank you for reading/i.test(draft)) {
    violations.push({ severity: 'fail', check: 'structure', message: 'Missing closing line starting with "Thank you for reading"' })
  }

  // Word count
  // Word count range: 1250 floor accommodates the lean single-sentence bullet
  // format (Week 15 final was ~1435 words). 3500 ceiling catches runaway
  // expansion back toward the old long-form body sections.
  const wordCount = draft.trim().split(/\s+/).length
  if (wordCount < 1250 || wordCount > 3500) {
    violations.push({
      severity: 'fail',
      check: 'structure',
      message: `Word count ${wordCount} outside range [1250, 3500]`,
    })
  }

  return violations
}

// ── Main verification ──────────────────────────────────

export async function verifyDraft(draft, week, year, opts = {}) {
  const { skipHttp = false } = opts
  const { start, end } = getWeekWindow(week, year)
  const articleIndex = buildArticleUrlIndex(start, end)
  const podcastWhitelist = buildPodcastWhitelist(week, year)
  const overrideUrls = loadOverrideUrls()
  const blocklist = loadPodcastBlocklist()

  const rawLinks = extractLinks(draft)
  const classifiedLinks = classifyLinks(draft, rawLinks)

  const checks = {
    structure: checkStructure(draft),
    podcast_blocklist: checkPodcastBlocklist(draft, blocklist),
    podcast_references: checkPodcastReferences(draft, classifiedLinks, podcastWhitelist, podcastWhitelist.sources, overrideUrls),
    podcast_name_heuristic: checkPodcastNameHeuristic(draft, podcastWhitelist, podcastWhitelist.sources),
    corpus_urls: checkCorpusUrls(draft, classifiedLinks, articleIndex, podcastWhitelist, overrideUrls),
    freshness: checkFreshness(draft, classifiedLinks, articleIndex, start, end),
    date_sanity: checkDateSanity(draft, start, end),
  }

  // HTTP liveness check for podcast URLs — catches link rot and hallucinated
  // URLs that slipped into the digest corpus. Skipped with --skip-http flag.
  if (!skipHttp) {
    checks.podcast_url_live = await checkPodcastUrlsLive(classifiedLinks)
    // Also check tl;dr and sector URLs — catches typos + regional variants
    // that pass the corpus lookup but 404 in browsers.
    checks.link_url_live = await checkNonPodcastUrlsLive(classifiedLinks)
  } else {
    checks.podcast_url_live = []
    checks.link_url_live = []
  }

  const allViolations = Object.values(checks).flat()
  const failures = allViolations.filter(v => v.severity === 'fail')
  const warnings = allViolations.filter(v => v.severity === 'warn')

  return {
    pass: failures.length === 0,
    failures,
    warnings,
    checks,
    window: { start, end },
    httpChecked: !skipHttp,
    stats: {
      articles_indexed: articleIndex.size,
      podcasts_whitelisted: podcastWhitelist.digests.length,
      current_week_digests: podcastWhitelist.digests.filter(d => d.isCurrentWeek).length,
      links_total: rawLinks.length,
      links_podcast: classifiedLinks.filter(l => l.section === 'podcast').length,
      links_sector: classifiedLinks.filter(l => l.section === 'sector').length,
      links_tldr: classifiedLinks.filter(l => l.section === 'tldr').length,
    },
  }
}

// ── Report writing ──────────────────────────────────────

function writeFailureReport(result, draftPath, week) {
  const logDir = join(ROOT, 'logs/verification')
  mkdirSync(logDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = join(logDir, `week-${week}-${ts}-FAILED.md`)

  const lines = [
    `# Week ${week} Draft Verification — FAILED`,
    `Timestamp: ${new Date().toISOString()}`,
    `Draft: ${draftPath}`,
    `Window: ${result.window.start} to ${result.window.end}`,
    ``,
    `## Summary`,
    `- ${result.failures.length} violations (fail)`,
    `- ${result.warnings.length} warnings`,
    ``,
    `## Stats`,
    `- Articles indexed: ${result.stats.articles_indexed}`,
    `- Podcast digests (3-week window): ${result.stats.podcasts_whitelisted}`,
    `- Current-week digests: ${result.stats.current_week_digests}`,
    `- Links total: ${result.stats.links_total} (tl;dr ${result.stats.links_tldr}, sector ${result.stats.links_sector}, podcast ${result.stats.links_podcast})`,
    ``,
    `## Failures`,
    ``,
  ]

  for (const [check, violations] of Object.entries(result.checks)) {
    const fails = violations.filter(v => v.severity === 'fail')
    if (fails.length === 0) continue
    lines.push(`### ${check}`)
    for (const v of fails) lines.push(`- ${v.message}`)
    lines.push(``)
  }

  if (result.warnings.length > 0) {
    lines.push(`## Warnings`)
    for (const v of result.warnings) lines.push(`- [${v.check}] ${v.message}`)
    lines.push(``)
  }

  lines.push(`## Action required`)
  lines.push(`Rewrite the affected sections using ONLY references from the whitelist above.`)
  lines.push(`The editorial-draft skill should retry automatically (max 3 attempts).`)

  writeFileSync(reportPath, lines.join('\n'), 'utf-8')
  return reportPath
}

function writeSidecar(targetPath, draft, result, week) {
  const sidecarPath = targetPath + '.verified'
  const sidecar = {
    verifiedAt: new Date().toISOString(),
    week,
    window: result.window,
    checks: Object.fromEntries(
      Object.entries(result.checks).map(([k, v]) => [k, {
        pass: v.filter(x => x.severity === 'fail').length === 0,
        items_checked: v.length,
        warnings: v.filter(x => x.severity === 'warn').length,
      }])
    ),
    stats: result.stats,
    source_draft_sha256: createHash('sha256').update(draft).digest('hex'),
    verifier_version: VERIFIER_VERSION,
  }
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2), 'utf-8')
  return sidecarPath
}

function writeSentinelFlag(week, reportPath) {
  const flagDir = join(ROOT, 'data/editorial/drafts')
  mkdirSync(flagDir, { recursive: true })
  const flagPath = join(flagDir, 'VERIFICATION-FAILED.flag')
  writeFileSync(flagPath, JSON.stringify({
    failedAt: new Date().toISOString(),
    week,
    reportPath,
  }, null, 2), 'utf-8')
  return flagPath
}

function clearSentinelFlag() {
  const flagPath = join(ROOT, 'data/editorial/drafts/VERIFICATION-FAILED.flag')
  if (existsSync(flagPath)) {
    try { unlinkSync(flagPath) } catch {}
  }
}

function writeAuditLog(result, draftPath, week) {
  const logDir = join(ROOT, 'logs/verification')
  mkdirSync(logDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = join(logDir, `week-${week}-${ts}.json`)
  writeFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    draft: draftPath,
    week,
    pass: result.pass,
    failures: result.failures.length,
    warnings: result.warnings.length,
    stats: result.stats,
  }, null, 2), 'utf-8')
  return logPath
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  if (!existsSync(args.input)) {
    console.error(`Draft file not found: ${args.input}`)
    process.exit(2)
  }

  let draft
  try {
    draft = readFileSync(args.input, 'utf-8')
  } catch (e) {
    console.error(`Failed to read draft: ${e.message}`)
    process.exit(2)
  }

  console.error(`=== Editorial Draft Verification ===`)
  console.error(`Draft:  ${args.input}`)
  console.error(`Week:   ${args.week} (${args.year})`)

  const result = await verifyDraft(draft, args.week, args.year, { skipHttp: args.skipHttp })

  console.error(``)
  console.error(`Window: ${result.window.start} to ${result.window.end}`)
  console.error(`Articles indexed: ${result.stats.articles_indexed}`)
  console.error(`Podcast digests (3-week): ${result.stats.podcasts_whitelisted} (current week: ${result.stats.current_week_digests})`)
  console.error(`Links: ${result.stats.links_total} (tl;dr ${result.stats.links_tldr}, sector ${result.stats.links_sector}, podcast ${result.stats.links_podcast})`)
  console.error(``)

  for (const [check, violations] of Object.entries(result.checks)) {
    const fails = violations.filter(v => v.severity === 'fail')
    const warns = violations.filter(v => v.severity === 'warn')
    const status = fails.length === 0 ? (warns.length === 0 ? '✓' : '⚠') : '✗'
    console.error(`${status} ${check}: ${fails.length} fail, ${warns.length} warn`)
    for (const v of fails) console.error(`   FAIL: ${v.message}`)
    for (const v of warns) console.error(`   warn: ${v.message}`)
  }
  console.error(``)

  // Always write audit log
  writeAuditLog(result, args.input, args.week)

  if (!result.pass) {
    console.error(`=== Result: FAIL (${result.failures.length} violations) ===`)
    const reportPath = writeFailureReport(result, args.input, args.week)
    const flagPath = writeSentinelFlag(args.week, reportPath)
    console.error(`Report: ${reportPath}`)
    console.error(`Flag: ${flagPath}`)

    // Telegram alert (fire-and-forget)
    const topFailures = result.failures.slice(0, 3).map(v => v.message).join('\n- ')
    const msg = `⚠ <b>SNI Draft Verification FAILED — Week ${args.week}</b>\n\n`
      + `${result.failures.length} violations.\n\n`
      + `Top:\n- ${topFailures}\n\n`
      + `Report: ${basename(reportPath)}`
    try { await sendTelegram(msg) } catch { /* ignore */ }

    process.exit(1)
  }

  console.error(`=== Result: PASS (${result.warnings.length} warnings) ===`)
  clearSentinelFlag()

  if (args.verifyOnly) {
    console.error(`Verify-only mode — no output files written.`)
    process.exit(0)
  }

  // Promote: copy input → session + week outputs, write sidecars
  mkdirSync(dirname(args.outputSession), { recursive: true })
  mkdirSync(dirname(args.outputWeek), { recursive: true })
  writeFileSync(args.outputSession, draft, 'utf-8')
  writeFileSync(args.outputWeek, draft, 'utf-8')
  const sidecarA = writeSidecar(args.outputSession, draft, result, args.week)
  const sidecarB = writeSidecar(args.outputWeek, draft, result, args.week)
  console.error(`Wrote: ${args.outputSession}`)
  console.error(`Wrote: ${args.outputWeek}`)
  console.error(`Sidecars: ${basename(sidecarA)}, ${basename(sidecarB)}`)
  process.exit(0)
}

// Only run main if invoked directly
if (import.meta.main) {
  main().catch(err => {
    console.error(`Fatal: ${err.message}`)
    console.error(err.stack)
    process.exit(2)
  })
}
