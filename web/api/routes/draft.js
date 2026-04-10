import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { getISOWeek } from '../lib/week.js'
import { parseDraftSections } from '../lib/draft-parser.js'
import { textSimilarity, loadThresholds, contentMatch } from '../lib/dedup.js'
import { getClient } from '../lib/claude.js'
import yaml from 'js-yaml'
import config from '../lib/config.js'

const ROOT = config.ROOT
const OUTPUT = join(ROOT, 'output')
const OVERLAP_CACHE_DIR = join(OUTPUT, 'overlap-cache')
const EDITORIAL_DRAFTS = join(ROOT, 'data/editorial/drafts')

function readJsonSafe(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.error(`[draft] Failed to parse ${path}: ${err.message}`)
    return null
  }
}

/**
 * Return parsed sections for an archived week, using a cache file when
 * the cache is newer than the source .md file.
 */
function getCachedSections(archPath, weekNumber) {
  mkdirSync(OVERLAP_CACHE_DIR, { recursive: true })
  const cachePath = join(OVERLAP_CACHE_DIR, `week-${weekNumber}.json`)

  if (existsSync(cachePath)) {
    const sourceMtime = statSync(archPath).mtimeMs
    const cacheMtime = statSync(cachePath).mtimeMs
    if (cacheMtime > sourceMtime) {
      const cached = readJsonSafe(cachePath)
      if (Array.isArray(cached)) return cached
    }
  }

  const archDraft = readFileSync(archPath, 'utf-8')
  const sections = parseDraftSections(archDraft)

  try {
    writeFileSync(cachePath, JSON.stringify(sections, null, 2), 'utf-8')
  } catch { /* non-fatal — continue without caching */ }

  return sections
}

/**
 * Scan data/editorial/drafts/ for session-based drafts.
 * Returns a map: weekNum -> { path, session, isFinal }
 * Prefers -final over -v1; highest session number wins ties.
 */
function getEditorialDraftWeeks() {
  if (!existsSync(EDITORIAL_DRAFTS)) return {}

  const files = readdirSync(EDITORIAL_DRAFTS)
    .filter(f => /^draft-session-\d+-(final|v\d+)\.md$/.test(f))

  const map = {}

  for (const f of files) {
    const sessionMatch = f.match(/draft-session-(\d+)/)
    if (!sessionMatch) continue
    const session = parseInt(sessionMatch[1])
    const isFinal = f.includes('-final.')
    const filePath = join(EDITORIAL_DRAFTS, f)

    try {
      const firstLine = readFileSync(filePath, 'utf-8').split('\n')[0]
      const weekMatch = firstLine.match(/^#\s+SNI:\s+Week\s+(\d+)/)
      if (!weekMatch) continue
      const weekNum = parseInt(weekMatch[1])

      const existing = map[weekNum]
      if (!existing ||
          (isFinal && !existing.isFinal) ||
          (isFinal === existing.isFinal && session > existing.session)) {
        map[weekNum] = { path: filePath, session, isFinal }
      }
    } catch { continue }
  }

  return map
}

function getAvailableWeeks() {
  const weeks = new Set()

  // Weeks with draft files in output/
  if (existsSync(OUTPUT)) {
    for (const f of readdirSync(OUTPUT)) {
      const m = f.match(/^draft-week-(\d+)\.md$/)
      if (m) weeks.add(parseInt(m[1]))
    }
  }

  // Weeks with editorial pipeline drafts in data/editorial/drafts/
  for (const weekNum of Object.keys(getEditorialDraftWeeks())) {
    weeks.add(parseInt(weekNum))
  }

  // Weeks with verified articles (same logic as status.js)
  const verifiedDir = join(ROOT, 'data/verified')
  if (existsSync(verifiedDir)) {
    for (const dateDir of readdirSync(verifiedDir)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateDir)) continue
      const d = new Date(dateDir + 'T12:00:00Z')
      if (!isNaN(d.getTime())) weeks.add(getISOWeek(d))
    }
  }

  return [...weeks].sort((a, b) => a - b)
}

export async function getDraft({ week } = {}) {
  const available = getAvailableWeeks()
  if (available.length === 0) {
    throw Object.assign(new Error('No drafts found'), { status: 404 })
  }

  let weekNum
  if (week) {
    if (!/^\d+$/.test(week)) throw Object.assign(new Error(`Invalid week: ${week}`), { status: 400 })
    weekNum = parseInt(week)
  } else {
    // Default to the current ISO week, or the nearest available week before it
    const currentWeek = getISOWeek(new Date())
    const candidates = available.filter(w => w <= currentWeek)
    weekNum = candidates.length > 0 ? candidates[candidates.length - 1] : available[available.length - 1]
  }

  const outputPath = join(OUTPUT, `draft-week-${weekNum}.md`)
  let draftPath = outputPath
  let hasDraft = existsSync(outputPath)

  // Fall back to editorial pipeline drafts if no output/ copy exists
  if (!hasDraft) {
    const editorialMap = getEditorialDraftWeeks()
    if (editorialMap[weekNum]) {
      draftPath = editorialMap[weekNum].path
      hasDraft = true
    }
  }

  const draft = hasDraft ? readFileSync(draftPath, 'utf-8') : null

  // Check for .verified sidecar — the hallucination gate's proof of pass.
  // If missing: draft is unverified (legacy or hand-edited). If sha256 mismatch:
  // the content has been modified since verification (stale verification).
  let verified = false
  let verifiedAt = null
  let verificationStatus = 'unverified'
  if (draft && draftPath) {
    const sidecarPath = draftPath + '.verified'
    if (existsSync(sidecarPath)) {
      try {
        const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
        const hash = createHash('sha256').update(draft).digest('hex')
        if (sidecar.source_draft_sha256 === hash) {
          verified = true
          verifiedAt = sidecar.verifiedAt
          verificationStatus = 'verified'
        } else {
          verificationStatus = 'stale'
        }
      } catch {
        verificationStatus = 'invalid-sidecar'
      }
    }
  }

  const review = readJsonSafe(join(OUTPUT, `review-week-${weekNum}.json`))
  const links = readJsonSafe(join(OUTPUT, `links-week-${weekNum}.json`))
  const evaluate = readJsonSafe(join(OUTPUT, `evaluate-week-${weekNum}.json`))

  return {
    week: weekNum,
    draft,
    review,
    links,
    evaluate,
    availableWeeks: available,
    verified,
    verifiedAt,
    verificationStatus,
  }
}

export async function saveDraft({ week } = {}, body = {}) {
  if (!week || !/^\d+$/.test(week)) throw Object.assign(new Error('Invalid week'), { status: 400 })

  const weekNum = parseInt(week)
  const draftPath = join(OUTPUT, `draft-week-${weekNum}.md`)

  // Allow saving even if no output/ copy exists yet — the editorial pipeline
  // may have generated the draft in data/editorial/drafts/ instead
  if (!existsSync(draftPath)) {
    const editorialMap = getEditorialDraftWeeks()
    if (!editorialMap[weekNum]) {
      throw Object.assign(new Error(`Draft for week ${weekNum} not found`), { status: 404 })
    }
  }

  if (body.draft === undefined || body.draft === null || typeof body.draft !== 'string') {
    throw new Error('Missing or invalid draft content')
  }
  if (body.draft.trim().length === 0) {
    throw new Error('Draft content cannot be empty')
  }

  writeFileSync(draftPath, body.draft, 'utf-8')

  // Return the full bundle (re-read everything)
  return getDraft({ week: String(weekNum) })
}

export async function getDraftHistory({ week } = {}) {
  if (!week || !/^\d+$/.test(week)) throw Object.assign(new Error('Invalid week'), { status: 400 })
  const weekNum = parseInt(week)

  return {
    week: weekNum,
    artifacts: {
      draft: existsSync(join(OUTPUT, `draft-week-${weekNum}.md`)),
      review: existsSync(join(OUTPUT, `review-week-${weekNum}.json`)),
      links: existsSync(join(OUTPUT, `links-week-${weekNum}.json`)),
      evaluate: existsSync(join(OUTPUT, `evaluate-week-${weekNum}.json`)),
    },
  }
}

export async function handleCheckOverlap({ week } = {}) {
  if (!week || !/^\d+$/.test(week)) throw Object.assign(new Error('Invalid week'), { status: 400 })
  const weekNum = parseInt(week)

  const startTime = performance.now()

  const draftPath = join(OUTPUT, `draft-week-${weekNum}.md`)
  if (!existsSync(draftPath)) {
    throw Object.assign(new Error(`Draft for week ${weekNum} not found`), { status: 404 })
  }

  const draft = readFileSync(draftPath, 'utf-8')
  const currentSections = parseDraftSections(draft)

  if (currentSections.length === 0) {
    return { week: weekNum, overlaps: [], sectionCount: 0, archivedWeeks: [], durationMs: Math.round(performance.now() - startTime) }
  }

  // Load thresholds
  let thresholds
  try {
    thresholds = loadThresholds()
  } catch (err) {
    console.error(`[overlap] Failed to load thresholds, using defaults: ${err.message}`)
    thresholds = { tier1: 0.12, tier2: 0.65 }
  }

  // Load lookback from config, default to 8 weeks
  let lookback = 8
  try {
    const configPath = join(ROOT, 'config/podcast-trust-sources.yaml')
    if (existsSync(configPath)) {
      const cfg = yaml.load(readFileSync(configPath, 'utf-8'))
      if (cfg && typeof cfg.overlap_lookback_weeks === 'number' && cfg.overlap_lookback_weeks > 0) {
        lookback = cfg.overlap_lookback_weeks
      }
    }
  } catch (err) {
    console.error(`[overlap] Failed to read lookback config: ${err.message}`)
  }

  // Load archived drafts (prefer published over draft)
  const archivedSections = []
  const archivedWeeks = []

  for (let w = weekNum - lookback; w < weekNum; w++) {
    if (w < 1) continue
    const pubPath = join(OUTPUT, `published/week-${w}.md`)
    const draftArchPath = join(OUTPUT, `draft-week-${w}.md`)
    const archPath = existsSync(pubPath) ? pubPath : existsSync(draftArchPath) ? draftArchPath : null

    if (archPath) {
      const archSections = getCachedSections(archPath, w)
      for (const s of archSections) {
        archivedSections.push({ ...s, week: w })
      }
      archivedWeeks.push(w)
    }
  }

  // Tier 1 scan
  const tier1Pairs = []
  for (const current of currentSections) {
    const currentText = `${current.heading}\n${current.body}`
    for (const archived of archivedSections) {
      const archivedText = `${archived.heading}\n${archived.body}`
      const similarity = textSimilarity(currentText, archivedText)
      if (similarity >= thresholds.tier1) {
        tier1Pairs.push({ current, archived, similarity })
      }
    }
  }

  // Sort by similarity descending, cap at 20 for Tier 2
  tier1Pairs.sort((a, b) => b.similarity - a.similarity)
  const tier2Candidates = tier1Pairs.slice(0, 20)

  // Tier 2 LLM check
  const overlaps = []
  let tier2FailedCount = 0
  if (tier2Candidates.length > 0) {
    const client = getClient()
    if (!client) {
      // Skip Tier-2 LLM confirmation — return Tier-1 cosine results only
      tier2FailedCount = tier2Candidates.length
    } else {
    const model = 'claude-sonnet-4-20250514'

    let tier2CallIndex = 0
    for (const { current, archived, similarity } of tier2Candidates) {
      // 200ms delay between Tier 2 LLM calls to avoid rate limiting (PRD §5.5)
      if (tier2CallIndex > 0) {
        await new Promise(resolve => setTimeout(resolve, 200))
      }
      tier2CallIndex++
      try {
        const result = await contentMatch(
          `${current.heading}\n${current.body}`,
          `${archived.heading}\n${archived.body}`,
          { client, model }
        )

        if (result.sameStory && result.confidence >= thresholds.tier2) {
          overlaps.push({
            currentHeading: current.heading,
            currentContainer: current.container,
            archivedHeading: archived.heading,
            archivedContainer: archived.container,
            archivedWeek: archived.week,
            tier1Similarity: similarity,
            tier2Confidence: result.confidence,
            explanation: result.explanation,
          })
        }
      } catch (err) {
        tier2FailedCount++
        console.error(`[overlap] Tier 2 check failed for "${current.heading}" vs "${archived.heading}": ${err.message}`)
      }
    }
    } // close else (client available)
  }

  return {
    week: weekNum,
    overlaps,
    sectionCount: currentSections.length,
    archivedWeeks,
    tier1CandidateCount: tier1Pairs.length,
    tier2CheckedCount: tier2Candidates.length,
    tier2FailedCount,
    durationMs: Math.round(performance.now() - startTime),
  }
}
