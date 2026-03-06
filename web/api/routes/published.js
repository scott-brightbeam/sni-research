import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
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
      try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* skip */ }
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
    try { meta = JSON.parse(readFileSync(metaPath, 'utf-8')) } catch { /* skip */ }
  }

  let analysis = null
  const analysisPath = join(PUB_DIR, `${week}-analysis.json`)
  if (existsSync(analysisPath)) {
    try { analysis = JSON.parse(readFileSync(analysisPath, 'utf-8')) } catch { /* skip */ }
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

export function saveAnalysis(week, analysis) {
  if (!WEEK_RE.test(week)) throw new Error(`Invalid week format: ${week}`)
  ensureDir()
  writeFileSync(join(PUB_DIR, `${week}-analysis.json`), JSON.stringify(analysis, null, 2))
}
