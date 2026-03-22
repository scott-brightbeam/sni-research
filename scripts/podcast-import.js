#!/usr/bin/env bun

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve, basename } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import yaml from 'js-yaml'
import * as cheerio from 'cheerio'

import { parseTranscriptFrontmatter } from './lib/transcript-parser.js'
import { loadManifest, saveManifest, isComplete, acquireImportLock, releaseImportLock } from './lib/manifest.js'
import { loadAndRenderPrompt } from './lib/prompt-loader.js'
import { textSimilarity, loadThresholds } from './lib/dedup.js'
import { slugify } from './lib/extract.js'
import { getISOWeekNumber, getISOYearForWeek, getWeekWindow } from './lib/week.js'

const ROOT = join(import.meta.dir, '..')
const MANIFEST_PATH = join(ROOT, 'data', 'podcasts', 'manifest.json')
const LOCK_PATH = join(ROOT, 'data', 'podcasts', '.import.lock')

// --- Env & config ---

function loadEnvKey(key) {
  if (process.env[key]) return process.env[key]
  try {
    const envFile = readFileSync(join(ROOT, '.env'), 'utf8')
    const match = envFile.match(new RegExp(`^${key}=(.+)$`, 'm'))
    if (match) return match[1].trim()
  } catch {}
  throw new Error(`Missing env key: ${key}`)
}

function loadConfig() {
  const raw = readFileSync(join(ROOT, 'config', 'podcast-trust-sources.yaml'), 'utf8')
  return yaml.load(raw)
}

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}`)
}

// --- LLM calls ---

async function callLLM(client, model, prompt, maxTokens = 4096) {
  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }]
  })
  const text = response.content[0].text
  try {
    return JSON.parse(text)
  } catch {
    const retry = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: text },
        { role: 'user', content: 'Your response was not valid JSON. Please return ONLY a JSON object/array with no other text.' }
      ]
    })
    return JSON.parse(retry.content[0].text)
  }
}

// --- Core functions ---

function scanSourceDirectory(sourcePath) {
  const resolved = sourcePath.replace('~', process.env.HOME)
  const files = []

  // Top-level only — do NOT recurse into Previous/ or other subdirectories (PRD §5.1)
  for (const entry of readdirSync(resolved, { withFileTypes: true })) {
    if (entry.isDirectory()) continue
    if (entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
      files.push(join(resolved, entry.name))
    }
  }

  return files
}

function isTrustSource(source, config) {
  return config.trust_sources.find(ts => ts.name === source) || null
}

function getPodcastSlug(source, config) {
  const ts = isTrustSource(source, config)
  if (ts) return ts.slug
  return slugify(source)
}

function getEditorialWeek(dateStr) {
  const week = getISOWeekNumber(dateStr)
  const year = getISOYearForWeek(dateStr)
  return { week, year }
}

async function generateDigest(transcript, metadata, client, model) {
  const prompt = loadAndRenderPrompt('transcript-digest.v1', {
    title: metadata.title || 'Unknown',
    source: metadata.source || 'Unknown',
    date: metadata.date || 'Unknown',
    duration: metadata.duration || 'Unknown',
    transcript
  })
  return await callLLM(client, model, prompt)
}

async function extractStories(transcript, client, model) {
  const prompt = loadAndRenderPrompt('story-extract.v7', { transcript })
  return await callLLM(client, model, prompt)
}

const corpusCache = new Map()
function loadCorpusForWeek(weekNum, year) {
  const key = `${year}-${weekNum}`
  if (corpusCache.has(key)) return corpusCache.get(key)

  const articles = []
  const window = getWeekWindow(weekNum, year)

  for (const dir of ['data/verified', 'data/podcast-articles']) {
    const dirPath = join(ROOT, dir)
    if (!existsSync(dirPath)) continue
    for (const dateDir of readdirSync(dirPath)) {
      if (dateDir >= window.start && dateDir <= window.end) {
        const datePath = join(dirPath, dateDir)
        try {
          for (const sectorDir of readdirSync(datePath)) {
            const sectorPath = join(datePath, sectorDir)
            try {
              for (const file of readdirSync(sectorPath)) {
                if (!file.endsWith('.json')) continue
                try {
                  const article = JSON.parse(readFileSync(join(sectorPath, file), 'utf8'))
                  articles.push(article)
                } catch {}
              }
            } catch {}
          }
        } catch {}
      }
    }
  }

  corpusCache.set(key, articles)
  return articles
}

async function fetchAndExtractArticle(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SNI-Research/1.0)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    })

    if (response.status === 401 || response.status === 403) {
      return { error: 'paywall' }
    }
    if (response.status === 404) {
      return { error: 'dead link' }
    }
    if (!response.ok) {
      return { error: `HTTP ${response.status}` }
    }

    const html = await response.text()
    const $ = cheerio.load(html)
    $('script, style, nav, footer, header, aside').remove()
    const text = $('article').text().trim() || $('main').text().trim() || $('body').text().trim()

    if (text.length < 200) {
      return { error: 'content too short (likely paywalled or non-article page)' }
    }

    return {
      text: text.slice(0, 10000),
      snippet: text.slice(0, 500),
      source: new URL(url).hostname
    }
  } catch (err) {
    return { error: err.message || 'network error' }
  }
}

async function gapFill(stories, metadata, weekNum, year, config, client, model, thresholds, inRunUrls, inRunHeadlines, stats, manifest, filename) {
  const corpus = loadCorpusForWeek(weekNum, year)

  // Resume support: skip stories already processed in a previous partial run
  const entry = manifest[filename]
  const processedStories = entry?.processedStories || []
  const alreadyProcessed = new Set(processedStories.map(s => s.headline.toLowerCase()))

  for (const story of stories) {
    // Skip if already processed in a previous run (crash recovery)
    if (alreadyProcessed.has(story.headline.toLowerCase())) {
      log(`    "${story.headline}" — skipped (already processed)`)
      continue
    }

    // Skip if already processed this run
    if (story.url && inRunUrls.has(story.url)) {
      log(`    "${story.headline}" — skipped (already processed this run)`)
      stats.storiesMatched++
      processedStories.push({ headline: story.headline, status: 'matched' })
      continue
    }
    if (inRunHeadlines.has(story.headline.toLowerCase())) {
      log(`    "${story.headline}" — skipped (duplicate headline this run)`)
      stats.storiesMatched++
      processedStories.push({ headline: story.headline, status: 'matched' })
      continue
    }

    // URL match
    if (story.url) {
      const urlMatch = corpus.find(a => a.url === story.url)
      if (urlMatch) {
        log(`    "${story.headline}" — MATCH (URL: ${story.url})`)
        stats.storiesMatched++
        inRunUrls.add(story.url)
        inRunHeadlines.add(story.headline.toLowerCase())
        processedStories.push({ headline: story.headline, status: 'matched' })
        continue
      }
    }

    // Tier 1: collect candidates, sort by similarity, cap at 5
    const tier1Candidates = []
    for (const article of corpus) {
      const sim = textSimilarity(story.headline, article.title || '')
      if (sim >= thresholds.tier1) {
        tier1Candidates.push({ article, sim })
      }
    }
    tier1Candidates.sort((a, b) => b.sim - a.sim)
    const topCandidates = tier1Candidates.slice(0, 5)

    // Tier 2: LLM match on top candidates only
    let tier1Match = false
    for (const { article } of topCandidates) {
      try {
        const prompt = loadAndRenderPrompt('content-match.v1', {
          story_a: `${story.headline}\n${story.detail || ''}`,
          story_b: `${article.title || ''}\n${article.snippet || article.full_text || ''}`
        })
        const result = await callLLM(client, model, prompt, 512)
        if (result.sameStory && result.confidence >= thresholds.tier2) {
          log(`    "${story.headline}" — MATCH (existing: ${article.title})`)
          stats.storiesMatched++
          tier1Match = true
          break
        }
      } catch (err) {
        log(`    WARN: Tier 2 match failed for "${story.headline}": ${err.message}`)
      }
    }

    if (tier1Match) {
      if (story.url) inRunUrls.add(story.url)
      inRunHeadlines.add(story.headline.toLowerCase())
      processedStories.push({ headline: story.headline, status: 'matched' })
      entry.processedStories = processedStories
      saveManifest(MANIFEST_PATH, manifest)
      continue
    }

    // No match — fetch if URL available
    if (!story.url) {
      log(`    "${story.headline}" — NO URL (podcast-mentioned, unfetched)`)
      stats.storiesNoUrl++
      inRunHeadlines.add(story.headline.toLowerCase())
      processedStories.push({ headline: story.headline, status: 'no-url' })
      entry.processedStories = processedStories
      saveManifest(MANIFEST_PATH, manifest)
      continue
    }

    log(`    "${story.headline}" — NO MATCH — fetching ${story.url}`)
    const fetched = await fetchAndExtractArticle(story.url)

    if (fetched.error) {
      log(`    fetch-failed: ${fetched.error}`)
      stats.fetchFailed++
      inRunUrls.add(story.url)
      inRunHeadlines.add(story.headline.toLowerCase())
      processedStories.push({ headline: story.headline, status: 'failed' })
      entry.processedStories = processedStories
      saveManifest(MANIFEST_PATH, manifest)
      continue
    }

    // Save article
    const sector = story.sector || 'general'
    const articleDir = join(ROOT, 'data', 'podcast-articles', metadata.date, sector)
    mkdirSync(articleDir, { recursive: true })
    const articleSlug = slugify(story.headline)
    const articlePath = join(articleDir, `${articleSlug}.json`)

    const articleData = {
      title: story.headline,
      url: story.url,
      source: fetched.source,
      date_published: metadata.date,
      sector,
      snippet: fetched.snippet,
      full_text: fetched.text,
      found_by: ['podcast-extract'],
      podcast_source: metadata.source,
      podcast_episode: metadata.title,
      podcast_episode_url: metadata.url || null,
      podcast_extract_confidence: parseFloat(story.confidence === 'high' ? '0.95' : '0.75')
    }

    writeFileSync(articlePath, JSON.stringify(articleData, null, 2))
    log(`    Saved to ${articlePath.replace(ROOT + '/', '')}`)
    stats.storiesFetched++
    inRunUrls.add(story.url)
    inRunHeadlines.add(story.headline.toLowerCase())
    processedStories.push({ headline: story.headline, status: 'fetched' })
    entry.processedStories = processedStories
    saveManifest(MANIFEST_PATH, manifest)
  }
}

function writeRunSummary(stats, startedAt) {
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const runsDir = join(ROOT, 'output', 'runs')
  mkdirSync(runsDir, { recursive: true })

  const summary = {
    runId: `podcast-${dateStr}-${Date.now()}`,
    date: dateStr,
    weekNumber: stats.weekNumber || 0,
    year: stats.year || 2026,
    startedAt: startedAt.toISOString(),
    completedAt: now.toISOString(),
    totalDuration: now.getTime() - startedAt.getTime(),
    stats: {
      filesScanned: stats.filesScanned,
      newImports: stats.newImports,
      skippedAlreadyImported: stats.skippedAlreadyImported,
      retried: stats.retried,
      failed: stats.failed,
      digestsGenerated: stats.digestsGenerated,
      storiesExtracted: stats.storiesExtracted,
      storiesFetched: stats.storiesFetched,
      storiesMatched: stats.storiesMatched,
      storiesNoUrl: stats.storiesNoUrl,
      fetchFailed: stats.fetchFailed
    },
    warnings: stats.warnings,
    errors: stats.errors
  }

  const path = join(runsDir, `podcast-import-${dateStr}.json`)
  writeFileSync(path, JSON.stringify(summary, null, 2))
  return path
}

// --- Main ---

async function main() {
  const startedAt = new Date()
  const config = loadConfig()

  log(`Scanning ${config.transcript_source}/`)

  // Acquire lock
  if (!acquireImportLock(LOCK_PATH)) {
    log('ERROR: Another import is running (lock held). Exiting.')
    process.exit(1)
  }

  const stats = {
    filesScanned: 0,
    newImports: 0,
    skippedAlreadyImported: 0,
    retried: 0,
    failed: 0,
    digestsGenerated: 0,
    storiesExtracted: 0,
    storiesFetched: 0,
    storiesMatched: 0,
    storiesNoUrl: 0,
    fetchFailed: 0,
    weekNumber: 0,
    year: 0,
    warnings: [],
    errors: []
  }

  try {
    const client = new Anthropic({ apiKey: loadEnvKey('ANTHROPIC_API_KEY') })
    const model = config.model || 'claude-sonnet-4-20250514'
    let thresholds
    try {
      thresholds = loadThresholds()
    } catch {
      thresholds = { tier1: 0.12, tier2: 0.65 }
    }

    const manifest = loadManifest(MANIFEST_PATH)
    const files = scanSourceDirectory(config.transcript_source)
    stats.filesScanned = files.length

    // In-run dedup tracking
    const inRunUrls = new Set()
    const inRunHeadlines = new Set()

    // Separate new files and retries
    const newFiles = []
    const retryFiles = []

    for (const filePath of files) {
      const filename = basename(filePath)
      const entry = manifest[filename]

      if (entry && isComplete(entry)) {
        stats.skippedAlreadyImported++
        continue
      }

      if (entry && !isComplete(entry)) {
        retryFiles.push({ filePath, filename, entry })
      } else {
        newFiles.push({ filePath, filename })
      }
    }

    log(`Found ${files.length} .md files, ${newFiles.length} new, ${retryFiles.length} to retry (${stats.skippedAlreadyImported} already imported)`)

    // Process new files
    for (const { filePath, filename } of newFiles) {
      log(`Importing: ${filename}`)

      const content = readFileSync(filePath, 'utf8')
      const parsed = parseTranscriptFrontmatter(content)

      if (!parsed) {
        log(`  ERROR: Failed to parse frontmatter — skipping`)
        stats.failed++
        stats.errors.push(`Frontmatter parse failed: ${filename}`)
        continue
      }

      // Log warnings
      for (const w of parsed.warnings) {
        log(`  WARN: ${w}`)
        stats.warnings.push(`${filename}: ${w}`)
      }

      if (!parsed.url) {
        stats.warnings.push(`No URL in frontmatter for ${filename}`)
      }

      const { week, year } = getEditorialWeek(parsed.date)
      stats.weekNumber = week
      stats.year = year

      const trustSource = isTrustSource(parsed.source, config)
      const podcastSlug = getPodcastSlug(parsed.source, config)
      const titleSlug = slugify(parsed.title || filename.replace('.md', ''))

      log(`  Source: ${parsed.source} | Date: ${parsed.date} | Week: ${week}`)
      log(`  Trust source: ${trustSource ? 'yes — will extract stories' : 'no'}`)

      // Copy transcript
      const destDir = join(ROOT, 'data', 'podcasts', parsed.date, podcastSlug)
      mkdirSync(destDir, { recursive: true })
      const destPath = join(destDir, `${titleSlug}.md`)
      copyFileSync(filePath, destPath)

      // Build manifest entry
      const entry = {
        filename,
        date: parsed.date,
        source: parsed.source,
        episodeUrl: parsed.url || null,
        title: parsed.title,
        duration: parsed.duration,
        digestPath: destPath.replace(ROOT + '/', '').replace('.md', '.digest.json'),
        transcriptPath: destPath.replace(ROOT + '/', ''),
        week,
        year,
        type: parsed.type,
        isTrustSource: !!trustSource,
        digestGenerated: false,
        storiesExtracted: !trustSource,
        storiesCount: 0,
        storiesFetched: 0,
        importedAt: new Date().toISOString()
      }

      // Generate digest
      try {
        const digest = await generateDigest(content, parsed, client, model)
        const digestData = {
          filename,
          title: parsed.title,
          source: parsed.source,
          date: parsed.date,
          episodeUrl: parsed.url || null,
          duration: parsed.duration,
          week,
          type: parsed.type,
          ...digest,
          tokenCount: Math.ceil(JSON.stringify(digest).length / 4)
        }
        const digestPath = join(destDir, `${titleSlug}.digest.json`)
        writeFileSync(digestPath, JSON.stringify(digestData, null, 2))
        entry.digestGenerated = true
        stats.digestsGenerated++
        log(`  Digest generated (${digestData.tokenCount} tokens)`)
      } catch (err) {
        log(`  ERROR: Digest generation failed: ${err.message}`)
        stats.errors.push(`Digest failed: ${filename}: ${err.message}`)
      }

      // Story extraction (trust sources only)
      if (trustSource) {
        try {
          const stories = await extractStories(content, client, model)
          entry.storiesCount = stories.length
          stats.storiesExtracted += stories.length
          log(`  Stories extracted: ${stories.length} identified`)

          // Gap-fill
          manifest[filename] = entry
          await gapFill(stories, parsed, week, year, config, client, model, thresholds, inRunUrls, inRunHeadlines, stats, manifest, filename)
          entry.storiesFetched = stats.storiesFetched
          entry.storiesExtracted = true
        } catch (err) {
          log(`  ERROR: Story extraction failed: ${err.message}`)
          stats.errors.push(`Story extraction failed: ${filename}: ${err.message}`)
          entry.storiesExtracted = false
        }
      }

      // Update manifest
      manifest[filename] = entry
      saveManifest(MANIFEST_PATH, manifest)
      stats.newImports++
      log(`  ✓ Import complete`)
    }

    // Retry incomplete files
    for (const { filePath, filename, entry } of retryFiles) {
      log(`Retrying: ${filename}`)
      const content = readFileSync(filePath, 'utf8')
      const parsed = parseTranscriptFrontmatter(content)
      if (!parsed) continue

      if (!entry.digestGenerated) {
        try {
          const digest = await generateDigest(content, parsed, client, model)
          const podcastSlug = getPodcastSlug(parsed.source, config)
          const titleSlug = slugify(parsed.title || filename.replace('.md', ''))
          const destDir = join(ROOT, 'data', 'podcasts', parsed.date, podcastSlug)
          mkdirSync(destDir, { recursive: true })
          const digestPath = join(destDir, `${titleSlug}.digest.json`)
          const digestData = {
            filename,
            title: parsed.title,
            source: parsed.source,
            date: parsed.date,
            episodeUrl: parsed.url || null,
            duration: parsed.duration,
            week: entry.week,
            type: parsed.type,
            ...digest,
            tokenCount: Math.ceil(JSON.stringify(digest).length / 4)
          }
          writeFileSync(digestPath, JSON.stringify(digestData, null, 2))
          entry.digestGenerated = true
          stats.digestsGenerated++
          log(`  Digest generated (${digestData.tokenCount} tokens)`)
        } catch (err) {
          log(`  ERROR: Retry digest failed: ${err.message}`)
          stats.errors.push(`Retry digest failed: ${filename}: ${err.message}`)
        }
      }

      if (entry.isTrustSource && !entry.storiesExtracted) {
        try {
          const stories = await extractStories(content, client, model)
          entry.storiesCount = stories.length
          stats.storiesExtracted += stories.length
          const { week, year } = getEditorialWeek(parsed.date)
          manifest[filename] = entry
          await gapFill(stories, parsed, week, year, config, client, model, thresholds, inRunUrls, inRunHeadlines, stats, manifest, filename)
          entry.storiesFetched = stats.storiesFetched
          entry.storiesExtracted = true
        } catch (err) {
          log(`  ERROR: Retry story extraction failed: ${err.message}`)
        }
      }

      manifest[filename] = entry
      saveManifest(MANIFEST_PATH, manifest)
      stats.retried++
      log(`  ✓ Retry complete`)
    }

    log(`═══ Import complete: ${stats.newImports} new, ${stats.retried} retried, ${stats.failed} failed ═══`)

    const summaryPath = writeRunSummary(stats, startedAt)
    log(`Run summary saved to ${summaryPath.replace(ROOT + '/', '')}`)
  } finally {
    releaseImportLock(LOCK_PATH)
  }
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`)
  releaseImportLock(LOCK_PATH)
  process.exit(1)
})
