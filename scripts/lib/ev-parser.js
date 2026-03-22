import { readFileSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'

const ROOT = resolve(import.meta.dir, '../..')
let _config = null

function getConfig() {
  if (_config) return _config
  const configPath = join(ROOT, 'config/ev-extraction.yaml')
  _config = yaml.load(readFileSync(configPath, 'utf-8'))
  return _config
}

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico']

export function extractUrls(text) {
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/g
  const matches = text.match(urlRegex) || []
  // Clean trailing punctuation
  const cleaned = matches.map(u => u.replace(/[.,;:!?)]+$/, ''))
  return [...new Set(cleaned)]
}

export function filterUrls(urls) {
  const config = getConfig()
  const exclusions = config.url_exclusions || []

  return urls.filter(url => {
    // Skip anchors
    if (url.startsWith('#')) return false

    try {
      // Skip images
      const path = new URL(url).pathname.toLowerCase()
      if (IMAGE_EXTS.some(ext => path.endsWith(ext))) return false

      // Skip excluded domains
      const hostname = new URL(url).hostname.replace(/^www\./, '')
      return !exclusions.some(excl => hostname === excl || hostname.endsWith('.' + excl))
    } catch {
      return false // invalid URL
    }
  })
}

// Simple keyword-based sector classification
const SECTOR_KEYWORDS = {
  biopharma: ['pharma', 'drug', 'clinical trial', 'biotech', 'gene therapy', 'fda', 'ema', 'oncology', 'therapeutic'],
  medtech: ['medical device', 'diagnostic', 'imaging', 'surgical robot', 'wearable health', 'digital health', 'telemedicine'],
  manufacturing: ['manufacturing', 'supply chain', 'industrial robot', 'digital twin', 'factory', 'automation'],
  insurance: ['insurance', 'underwriting', 'claims', 'actuarial', 'insurtech', 'reinsurance'],
}

export function classifySector(text) {
  const lower = text.toLowerCase()
  let bestSector = 'general'
  let bestScore = 0

  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      bestSector = sector
    }
  }

  return bestSector
}

export async function fetchAndExtract(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SNI-Research/1.0)' },
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return null

    const html = await resp.text()
    const { load } = await import('cheerio')
    const $ = load(html)

    // Remove nav, footer, script, style
    $('nav, footer, script, style, noscript, aside').remove()

    const title = $('h1').first().text().trim()
      || $('meta[property="og:title"]').attr('content')
      || $('title').text().trim()
      || ''

    const text = $('article').text().trim()
      || $('main').text().trim()
      || $('body').text().trim()

    const datePublished = $('meta[property="article:published_time"]').attr('content')
      || $('time[datetime]').attr('datetime')
      || null

    const source = new URL(url).hostname.replace(/^www\./, '')

    return { title, text: text.slice(0, 50000), datePublished, source, url }
  } catch {
    return null
  }
}
