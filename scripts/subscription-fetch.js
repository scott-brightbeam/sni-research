#!/usr/bin/env node
/**
 * Subscription Content Fetcher
 *
 * Runs under Node.js (not Bun) due to Playwright dependency.
 * Usage:
 *   node scripts/subscription-fetch.js [--test] [--source ft|substack]
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const ROOT = resolve(__dirname, '..')

const args = process.argv.slice(2)
const testMode = args.includes('--test')
const sourceFilter = args.find((a, i) => args[i - 1] === '--source')

function log(msg) {
  console.log(`[subscription-fetch] ${new Date().toISOString().slice(11, 19)} ${msg}`)
}

async function main() {
  log(testMode ? 'Running in TEST mode (login only)' : 'Starting subscription fetch')

  const config = yaml.load(readFileSync(join(ROOT, 'config/subscriptions.yaml'), 'utf-8'))
  const sources = config.sources.filter(s => s.enabled !== false)
    .filter(s => !sourceFilter || s.type === sourceFilter)

  // Load credentials
  const { loadCredentials } = await import('./lib/credential-store.js')
  const credentials = loadCredentials()

  // Lazy-load Playwright
  let chromium
  try {
    const pw = await import('playwright')
    chromium = pw.chromium
  } catch (err) {
    log(`ERROR: Playwright not available: ${err.message}`)
    log('Install with: npx playwright install chromium')
    process.exit(1)
  }

  const browserStatePath = join(ROOT, 'data/.browser-state')
  mkdirSync(browserStatePath, { recursive: true })

  const results = []

  for (const source of sources) {
    const cred = credentials.find(c => c.name === source.name)
    if (!cred) {
      log(`Skipping ${source.name}: no credentials`)
      results.push({ source: source.name, success: false, error: 'No credentials' })
      continue
    }

    log(`\nProcessing: ${source.name} (${source.type})`)
    const stateDir = join(browserStatePath, source.name.toLowerCase().replace(/\s+/g, '-'))
    mkdirSync(stateDir, { recursive: true })

    let browser
    try {
      browser = await chromium.launch({ headless: true })
      const context = await browser.newContext({
        storageState: existsSync(join(stateDir, 'state.json')) ? join(stateDir, 'state.json') : undefined,
      })
      const page = await context.newPage()

      if (source.type === 'substack') {
        const adapter = await import('./lib/adapters/substack.js')
        await adapter.login(page, cred.email, cred.password)
        log(`  Login successful`)

        if (!testMode) {
          const posts = await adapter.checkNewPosts(source.url)
          log(`  Found ${posts.length} posts`)
          for (const post of posts.slice(0, 5)) {
            await new Promise(r => setTimeout(r, 2000))
            const article = await adapter.fetchArticle(page, post.url)
            if (article.content.length > 100) {
              saveArticle(article, source.name)
              log(`  Saved: ${article.title}`)
            }
          }
        }
      } else if (source.type === 'ft') {
        const adapter = await import('./lib/adapters/ft.js')
        await adapter.login(page, cred.email, cred.password)
        log(`  Login successful`)

        if (!testMode) {
          const queries = loadFtQueries()
          for (const query of queries.slice(0, 5)) {
            await new Promise(r => setTimeout(r, 2000))
            const urls = await adapter.search(page, query)
            log(`  Query "${query}": ${urls.length} results`)
            for (const url of urls.slice(0, 3)) {
              await new Promise(r => setTimeout(r, 2000))
              const article = await adapter.fetchArticle(page, url)
              if (article.content.length > 100) {
                saveArticle(article, 'Financial Times')
                log(`  Saved: ${article.title}`)
              }
            }
          }
        }
      }

      await context.storageState({ path: join(stateDir, 'state.json') })
      results.push({ source: source.name, success: true })

      await browser.close()
    } catch (err) {
      log(`  ERROR: ${err.message}`)
      results.push({ source: source.name, success: false, error: err.message })
      if (browser) await browser.close().catch(() => {})
    }
  }

  // Write run summary
  const summary = {
    startedAt: new Date().toISOString(),
    testMode,
    results,
  }
  const summaryDir = join(ROOT, 'output/runs')
  mkdirSync(summaryDir, { recursive: true })
  writeFileSync(
    join(summaryDir, `subscription-${new Date().toISOString().split('T')[0]}.json`),
    JSON.stringify(summary, null, 2)
  )

  log(`\nComplete. ${results.filter(r => r.success).length}/${results.length} sources succeeded.`)
  if (results.some(r => !r.success)) process.exit(1)
}

function saveArticle(article, sourceName) {
  const dateStr = article.datePublished?.split('T')[0] || new Date().toISOString().split('T')[0]
  const slug = (article.title || 'untitled').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

  const sector = 'general'
  const destDir = join(ROOT, 'data/verified', dateStr, sector)
  mkdirSync(destDir, { recursive: true })

  const json = {
    title: article.title,
    url: article.url,
    source: sourceName,
    source_type: 'subscription',
    date_published: dateStr,
    date_confidence: article.datePublished ? 'high' : 'low',
    sector,
    keywords_matched: [],
    snippet: article.content.slice(0, 500),
    full_text: article.content,
    found_by: ['subscription'],
    scraped_at: new Date().toISOString(),
    ingested_at: new Date().toISOString(),
    score: null,
    score_reason: null,
  }

  writeFileSync(join(destDir, `${slug}.json`), JSON.stringify(json, null, 2))
}

function loadFtQueries() {
  try {
    const cfg = yaml.load(readFileSync(join(ROOT, 'config/sources.yaml'), 'utf-8'))
    const queries = []
    for (const [key, val] of Object.entries(cfg || {})) {
      if (typeof val === 'object' && val.queries) {
        queries.push(...val.queries.slice(0, 3))
      }
    }
    return queries.length > 0 ? queries : ['artificial intelligence', 'machine learning', 'AI regulation']
  } catch {
    return ['artificial intelligence', 'machine learning', 'AI regulation']
  }
}

main()
