#!/usr/bin/env bun
/**
 * EV Newsletter Link Extraction Pipeline
 *
 * Runs independently via launchd (daily at 07:30, after podcast import at 07:00).
 * Reads podcast manifest/digests for EV newsletter entries, extracts links,
 * fetches articles, saves to data/verified/, and generates domain recommendations.
 *
 * Does NOT modify any existing scripts or config files.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'
import { extractUrls, filterUrls, classifySector, fetchAndExtract } from './lib/ev-parser.js'

const ROOT = resolve(import.meta.dir, '..')
const EDITORIAL_DIR = join(ROOT, 'data/editorial')
const PROCESSED_PATH = join(EDITORIAL_DIR, 'ev-processed.json')
const RECOMMENDATIONS_PATH = join(EDITORIAL_DIR, 'ev-recommendations.json')

function log(msg) {
  console.log(`[ev-extract] ${new Date().toISOString().slice(11, 19)} ${msg}`)
}

function getConfig() {
  return yaml.load(readFileSync(join(ROOT, 'config/ev-extraction.yaml'), 'utf-8'))
}

function getProcessed() {
  if (!existsSync(PROCESSED_PATH)) return []
  try { return JSON.parse(readFileSync(PROCESSED_PATH, 'utf-8')) } catch { return [] }
}

function saveProcessed(list) {
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  writeFileSync(PROCESSED_PATH, JSON.stringify(list, null, 2))
}

// Find EV newsletter digests — try manifest first, then scan directories
function findEvDigests(config) {
  const pattern = (config.source_name_pattern || 'Exponential View Newsletter').toLowerCase()
  const digests = []

  // Try manifest.json, then .bak
  for (const fname of ['manifest.json', 'manifest.json.bak']) {
    const mpath = join(ROOT, 'data/podcasts', fname)
    if (!existsSync(mpath)) continue
    try {
      const manifest = JSON.parse(readFileSync(mpath, 'utf-8'))
      const entries = Array.isArray(manifest) ? manifest : Object.values(manifest)
      for (const entry of entries) {
        if ((entry.source || '').toLowerCase().includes(pattern.toLowerCase())) {
          digests.push({
            id: entry.digestPath || entry.filename,
            digestPath: entry.digestPath ? join(ROOT, entry.digestPath) : null,
            transcriptPath: entry.transcriptPath ? join(ROOT, entry.transcriptPath) : null,
            date: entry.date,
            source: entry.source,
          })
        }
      }
      if (digests.length > 0) return digests
    } catch { continue }
  }

  // Fallback: scan data/podcasts/ directories
  const podcastDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastDir)) return []
  for (const dateDir of readdirSync(podcastDir).sort().reverse()) {
    const datePath = join(podcastDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sourceDir of readdirSync(datePath)) {
      if (!sourceDir.toLowerCase().includes('exponential')) continue
      const sourcePath = join(datePath, sourceDir)
      if (!statSync(sourcePath).isDirectory()) continue
      for (const file of readdirSync(sourcePath)) {
        if (!file.endsWith('.digest.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
          if ((raw.source || '').toLowerCase().includes(pattern.toLowerCase())) {
            digests.push({
              id: join(dateDir, sourceDir, file),
              digestPath: join(sourcePath, file),
              transcriptPath: join(sourcePath, file.replace('.digest.json', '.md')),
              date: raw.date || dateDir,
              source: raw.source,
            })
          }
        } catch { /* skip */ }
      }
    }
  }

  return digests
}

// Check if URL already exists in corpus
function isInCorpus(url) {
  const verifiedDir = join(ROOT, 'data/verified')
  if (!existsSync(verifiedDir)) return false

  const dirs = readdirSync(verifiedDir).sort().reverse().slice(0, 14)
  for (const dateDir of dirs) {
    const datePath = join(verifiedDir, dateDir)
    if (!statSync(datePath).isDirectory()) continue
    for (const sectorDir of readdirSync(datePath)) {
      const sectorPath = join(datePath, sectorDir)
      if (!statSync(sectorPath).isDirectory()) continue
      for (const file of readdirSync(sectorPath)) {
        if (!file.endsWith('.json')) continue
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, file), 'utf-8'))
          if (raw.url === url) return true
        } catch { /* skip */ }
      }
    }
  }
  return false
}

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  log('Starting EV newsletter link extraction')
  const config = getConfig()
  const processed = getProcessed()
  const processedSet = new Set(processed)

  const digests = findEvDigests(config)
  log(`Found ${digests.length} EV digest(s) total`)

  const newDigests = digests.filter(d => !processedSet.has(d.id))
  if (newDigests.length === 0) {
    log('No new EV digests to process. Exiting.')
    return
  }

  log(`Processing ${newDigests.length} new EV digest(s)`)

  const now = new Date()
  const currentWeek = getISOWeek(now)
  const currentYear = now.getFullYear()
  const allDomains = new Map()
  let savedCount = 0
  let skippedCount = 0
  let failedCount = 0

  for (const digest of newDigests) {
    log(`\nProcessing: ${digest.source} (${digest.date})`)

    let text = ''
    if (digest.transcriptPath && existsSync(digest.transcriptPath)) {
      text = readFileSync(digest.transcriptPath, 'utf-8')
    }
    if (!text && digest.digestPath && existsSync(digest.digestPath)) {
      const digestData = JSON.parse(readFileSync(digest.digestPath, 'utf-8'))
      text = JSON.stringify(digestData)
    }

    if (!text) {
      log(`  No content found, skipping`)
      continue
    }

    const rawUrls = extractUrls(text)
    const urls = filterUrls(rawUrls)
    log(`  Extracted ${rawUrls.length} URLs, ${urls.length} after filtering`)

    for (const url of urls) {
      const domain = new URL(url).hostname.replace(/^www\./, '')
      if (!allDomains.has(domain)) allDomains.set(domain, { count: 0, articles: [] })
      allDomains.get(domain).count++

      if (isInCorpus(url)) {
        skippedCount++
        continue
      }

      log(`  Fetching: ${url}`)
      await new Promise(r => setTimeout(r, 2000))
      const article = await fetchAndExtract(url)
      if (!article || !article.text || article.text.length < 100) {
        failedCount++
        continue
      }

      const sector = classifySector(article.text)

      let isCurrentWeek = false
      if (article.datePublished) {
        const pubDate = new Date(article.datePublished)
        isCurrentWeek = getISOWeek(pubDate) === currentWeek && pubDate.getFullYear() === currentYear
      }

      const dateStr = article.datePublished?.split('T')[0] || now.toISOString().split('T')[0]
      const slug = (article.title || 'untitled').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

      const destDir = join(ROOT, 'data/verified', dateStr, sector)
      mkdirSync(destDir, { recursive: true })

      const articleJson = {
        title: article.title,
        url: article.url,
        source: article.source,
        source_type: 'ev-newsletter',
        date_published: dateStr,
        date_confidence: article.datePublished ? 'medium' : 'low',
        date_verified_method: article.datePublished ? 'meta-tag' : 'inferred',
        sector,
        keywords_matched: [],
        snippet: article.text.slice(0, 500),
        full_text: article.text,
        found_by: ['ev-newsletter'],
        scraped_at: new Date().toISOString(),
        ingested_at: new Date().toISOString(),
        score: null,
        score_reason: isCurrentWeek ? 'ev-current-week' : null,
        ev_priority: isCurrentWeek,
      }

      writeFileSync(join(destDir, `${slug}.json`), JSON.stringify(articleJson, null, 2))
      savedCount++
      allDomains.get(domain).articles.push({ title: article.title, url })

      log(`  Saved: ${article.title} (${sector}, ${isCurrentWeek ? 'current week' : 'older'})`)
    }

    processed.push(digest.id)
    saveProcessed(processed)
  }

  // Generate domain recommendations
  const existingSources = loadExistingSources()
  const recommendations = []
  for (const [domain, info] of allDomains) {
    if (!existingSources.has(domain) && info.count >= 1) {
      recommendations.push({
        domain,
        linkCount: info.count,
        firstSeen: now.toISOString(),
        articles: info.articles.slice(0, 5),
      })
    }
  }

  if (recommendations.length > 0) {
    let existing = []
    if (existsSync(RECOMMENDATIONS_PATH)) {
      try { existing = JSON.parse(readFileSync(RECOMMENDATIONS_PATH, 'utf-8')).domains || [] } catch {}
    }
    const merged = mergeRecommendations(existing, recommendations)
    writeFileSync(RECOMMENDATIONS_PATH, JSON.stringify({ domains: merged, lastUpdated: now.toISOString() }, null, 2))
    log(`\nWrote ${merged.length} domain recommendations`)
  }

  log(`\nComplete: ${savedCount} saved, ${skippedCount} skipped (dedup), ${failedCount} failed`)
}

function loadExistingSources() {
  const sources = new Set()
  try {
    const cfg = yaml.load(readFileSync(join(ROOT, 'config/sources.yaml'), 'utf-8'))
    const text = JSON.stringify(cfg)
    const domainRegex = /[\w-]+\.[\w-]+\.[\w]+|[\w-]+\.[\w]+/g
    for (const m of text.match(domainRegex) || []) {
      sources.add(m.toLowerCase())
    }
  } catch { /* no sources config */ }
  return sources
}

function mergeRecommendations(existing, newRecs) {
  const byDomain = new Map()
  for (const r of existing) byDomain.set(r.domain, r)
  for (const r of newRecs) {
    if (byDomain.has(r.domain)) {
      const prev = byDomain.get(r.domain)
      prev.linkCount += r.linkCount
      prev.articles = [...prev.articles, ...r.articles].slice(0, 10)
    } else {
      byDomain.set(r.domain, r)
    }
  }
  return [...byDomain.values()].sort((a, b) => b.linkCount - a.linkCount)
}

main().catch(err => {
  console.error('[ev-extract] Fatal error:', err)
  process.exit(1)
})
