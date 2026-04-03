import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getClient } from '../lib/claude.js'
import { DEFAULT_MODEL } from '../lib/pricing.js'
import config from '../lib/config.js'

const ROOT = config.ROOT
const PUB_DIR = join(ROOT, 'output/published')

const WEEK_RE = /^week-\d+$/

function ensureDir() {
  if (!existsSync(PUB_DIR)) mkdirSync(PUB_DIR, { recursive: true })
}

function parseSections(content) {
  const sections = []
  const parts = content.split(/^## /m)
  for (const part of parts) {
    if (!part.trim()) continue
    const lines = part.split('\n')
    const heading = lines[0].trim()
    if (!heading) continue
    const body = lines.slice(1).join('\n').trim()
    const wordCount = body ? body.split(/\s+/).filter(Boolean).length : 0
    sections.push({ heading, wordCount })
  }
  return sections
}

export function listPublished() {
  ensureDir()
  const files = readdirSync(PUB_DIR).filter(f => f.endsWith('.md'))
  const results = []

  for (const f of files) {
    const week = f.replace('.md', '')
    const metaPath = join(PUB_DIR, `${week}-meta.json`)
    let meta = {}
    if (existsSync(metaPath)) {
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch (err) {
        console.warn(`published: could not parse meta for ${week}:`, err.message)
      }
    }
    results.push({ week, ...meta })
  }

  // Sort descending by week number
  results.sort((a, b) => {
    const na = parseInt(a.week.replace('week-', ''), 10)
    const nb = parseInt(b.week.replace('week-', ''), 10)
    return nb - na
  })

  return results
}

export function getPublished(week) {
  ensureDir()
  const mdPath = join(PUB_DIR, `${week}.md`)
  if (!existsSync(mdPath)) return null

  const content = readFileSync(mdPath, 'utf-8')
  let meta = {}
  const metaPath = join(PUB_DIR, `${week}-meta.json`)
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch (err) {
      console.warn(`published: could not parse meta for ${week}:`, err.message)
    }
  }

  let analysis = null
  const analysisPath = join(PUB_DIR, `${week}-analysis.json`)
  if (existsSync(analysisPath)) {
    try { analysis = JSON.parse(readFileSync(analysisPath, 'utf-8')) } catch (err) {
      console.warn(`published: could not parse analysis for ${week}:`, err.message)
    }
  }

  return { content, meta, analysis }
}

export function savePublished(week, content, meta = {}) {
  if (!WEEK_RE.test(week)) throw new Error(`Invalid week format: ${week}`)
  if (!content || typeof content !== 'string' || !content.trim()) throw new Error('Content must be non-empty string')

  ensureDir()

  const sections = parseSections(content)
  const wordCount = content.split(/\s+/).filter(Boolean).length

  const fullMeta = {
    ...meta,
    wordCount,
    sectionCount: sections.length,
    sections,
    savedAt: new Date().toISOString(),
  }

  writeFileSync(join(PUB_DIR, `${week}.md`), content)
  writeFileSync(join(PUB_DIR, `${week}-meta.json`), JSON.stringify(fullMeta, null, 2))

  return fullMeta
}

const EXTRACTION_PROMPT = `Extract company/topic pairs from this newsletter for an off-limits exclusion list.
The off-limits list prevents the pipeline from re-covering the same company+topic in future weeks.

Rules:
- Include every named company or organisation that is the SUBJECT of a story
- Topic: 3–8 word noun phrase describing the specific development covered (e.g. "record Q1 revenue custom silicon", "on-premises AI research platform")
- If one story covers multiple companies separately, create one entry per company
- Exclude publications, analysts, regulators and advisory firms used only as sources (e.g. HSBC, Deloitte, PYMNTS, FDA, Citrini Research, Deutsche Bank)
- Exclude generic terms that aren't specific companies (e.g. "AI chip startups", "hyperscalers")
- One entry per unique company+topic combination — no duplicates

Respond with ONLY a JSON array, no markdown fencing, no explanation:
[{"company":"ExactCompanyName","topic":"short noun phrase describing development"},...]`

export async function extractExclusions({ week }) {
  if (!WEEK_RE.test(week)) {
    const err = new Error(`Invalid week format: ${week}`)
    err.status = 400
    throw err
  }

  const mdPath = join(PUB_DIR, `${week}.md`)
  if (!existsSync(mdPath)) {
    const err = new Error(`No published newsletter for ${week}`)
    err.status = 404
    throw err
  }

  const content = readFileSync(mdPath, 'utf-8')

  const client = getClient()
  if (!client) {
    return { entries: [], message: 'Extraction disabled (no API key)' }
  }

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    messages: [
      { role: 'user', content: `${EXTRACTION_PROMPT}\n\n---\n\n${content}` }
    ],
  })

  const text = response.content[0]?.text?.trim()
  if (!text) {
    const err = new Error('Claude returned empty response')
    err.status = 502
    throw err
  }

  let entries
  try {
    entries = JSON.parse(text)
  } catch (parseErr) {
    const err = new Error(`Claude returned invalid JSON: ${text.slice(0, 200)}`)
    err.status = 502
    throw err
  }

  if (!Array.isArray(entries)) {
    const err = new Error('Claude response is not an array')
    err.status = 502
    throw err
  }

  const cleaned = entries
    .filter(e => e && typeof e.company === 'string' && typeof e.topic === 'string')
    .map(e => ({ company: e.company.trim(), topic: e.topic.trim() }))
    .filter(e => e.company && e.topic)

  return {
    entries: cleaned,
    model: DEFAULT_MODEL,
    week,
    usage: response.usage,
  }
}
