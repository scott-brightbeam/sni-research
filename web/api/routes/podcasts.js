import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { validateParam } from '../lib/walk.js'
import config from '../lib/config.js'

const ROOT = config.ROOT

// Stale-while-revalidate cache for the full podcast list. Scanning 140+ digest
// files on Fly's persistent volume blocks the event loop for several seconds.
// 5-minute TTL, serve stale during refresh, async yields keep the dashboard
// responsive during the walk itself.
const PODCASTS_CACHE_TTL_MS = 5 * 60_000
let _podcastsCache = null
let _podcastsCacheAt = 0
let _podcastsInflight = null

const YIELD_EVERY = 50
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve))
const yieldsEnabled = () => process.env.SNI_TEST_MODE !== '1'

/**
 * Scan data/podcasts/ directories for .digest.json files.
 * Used as fallback when manifest.json does not exist.
 * Yields the event loop every 50 files to keep health checks responsive.
 */
async function scanDigestFiles() {
  const podcastsDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastsDir)) return []

  const episodes = []
  const dateDirs = readdirSync(podcastsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()

  let processed = 0
  for (const dateDir of dateDirs) {
    const datePath = join(podcastsDir, dateDir)
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
        try {
          const digest = JSON.parse(readFileSync(join(sourcePath, file), 'utf-8'))
          const slug = file.replace('.digest.json', '')
          episodes.push({
            filename: digest.filename || `${dateDir}-${sourceDir}-${slug}.md`,
            title: digest.title,
            source: digest.source,
            date: digest.date || dateDir,
            week: digest.week,
            duration: digest.duration,
            episodeUrl: digest.episodeUrl || null,
            type: 'podcast',
            archived: digest.archived || false,
            digestPath: `data/podcasts/${dateDir}/${sourceDir}/${file}`,
            digest,
          })
        } catch { /* skip malformed digest */ }
        processed++
        if (yieldsEnabled() && processed % YIELD_EVERY === 0) await yieldToEventLoop()
      }
    }
  }

  return episodes
}

export function invalidatePodcastsCache() {
  _podcastsCache = null
  _podcastsCacheAt = 0
}

async function loadAllEpisodes() {
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')
  if (existsSync(manifestPath)) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      return []
    }
    const entries = Array.isArray(manifest)
      ? manifest
      : Object.entries(manifest).map(([filename, entry]) => ({ filename, ...entry }))

    const episodes = []
    let processed = 0
    for (const entry of entries) {
      let digest = null
      if (entry.digestPath) {
        const digestFullPath = join(ROOT, entry.digestPath)
        if (existsSync(digestFullPath)) {
          try {
            digest = JSON.parse(readFileSync(digestFullPath, 'utf-8'))
          } catch { /* skip malformed */ }
        }
      }
      episodes.push({ ...entry, archived: digest?.archived || entry.archived || false, digest })
      processed++
      if (yieldsEnabled() && processed % YIELD_EVERY === 0) await yieldToEventLoop()
    }
    return episodes
  }
  // Fallback: scan digest files directly (also async)
  return await scanDigestFiles()
}

async function refreshPodcastsCache() {
  try {
    const result = await loadAllEpisodes()
    _podcastsCache = result
    _podcastsCacheAt = Date.now()
    return result
  } finally {
    _podcastsInflight = null
  }
}

async function getAllEpisodesCached() {
  if (process.env.SNI_TEST_MODE === '1') return loadAllEpisodes()

  const now = Date.now()

  // Fresh cache
  if (_podcastsCache && (now - _podcastsCacheAt) < PODCASTS_CACHE_TTL_MS) {
    return _podcastsCache
  }

  // Stale cache: return stale now, refresh in background
  if (_podcastsCache) {
    if (!_podcastsInflight) {
      _podcastsInflight = refreshPodcastsCache()
      _podcastsInflight.catch(err => console.error('[podcasts] background refresh failed:', err.message))
    }
    return _podcastsCache
  }

  // Cold start
  if (!_podcastsInflight) {
    _podcastsInflight = refreshPodcastsCache()
  }
  return _podcastsInflight
}

export async function handleGetPodcasts(query) {
  const { week } = query
  let episodes = await getAllEpisodesCached()

  if (week) {
    const weekNum = parseInt(week, 10)
    episodes = episodes.filter(e => e.week === weekNum)
  }

  // Find the latest podcast-import run summary
  const runsDir = join(ROOT, 'output/runs')
  let lastRun = null
  if (existsSync(runsDir)) {
    try {
      const runFiles = readdirSync(runsDir)
        .filter(f => f.startsWith('podcast-import-') && f.endsWith('.json'))
        .sort()
        .reverse()

      if (runFiles.length > 0) {
        try {
          lastRun = JSON.parse(readFileSync(join(runsDir, runFiles[0]), 'utf-8'))
        } catch { /* skip malformed */ }
      }
    } catch { /* skip if can't read dir */ }
  }

  // Newest first
  episodes.sort((a, b) => (b.date || '').localeCompare(a.date || ''))

  return { week: week ? parseInt(week, 10) : null, episodes, lastRun }
}

export async function handleGetTranscript(query) {
  const { date, source, title } = query

  if (!date || !source || !title) {
    const err = new Error('Missing required params: date, source, title')
    err.status = 400
    throw err
  }

  try {
    validateParam(date, 'date')
    validateParam(source, 'source')
    validateParam(title, 'title')
  } catch (e) {
    const err = new Error(e.message)
    err.status = 400
    throw err
  }

  const filePath = join(ROOT, 'data/podcasts', date, source, `${title}.md`)

  if (!existsSync(filePath)) {
    const err = new Error('Transcript not found')
    err.status = 404
    throw err
  }

  const raw = readFileSync(filePath, 'utf-8')

  // Parse frontmatter
  let metadata = {}
  let transcript = raw

  if (raw.startsWith('---')) {
    const endIndex = raw.indexOf('---', 3)
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim()
      transcript = raw.slice(endIndex + 3).trim()

      for (const line of frontmatter.split('\n')) {
        const colonIdx = line.indexOf(':')
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim()
          const value = line.slice(colonIdx + 1).trim()
          metadata[key] = value
        }
      }
    }
  }

  return { transcript, metadata }
}

export async function handlePatchPodcast(date, source, slug, body) {
  validateParam(date, 'date')
  validateParam(source, 'source')
  validateParam(slug, 'slug')

  const digestPath = join(ROOT, 'data/podcasts', date, source, `${slug}.digest.json`)
  if (!existsSync(digestPath)) {
    const err = new Error('Podcast digest not found')
    err.status = 404
    throw err
  }

  const raw = JSON.parse(readFileSync(digestPath, 'utf-8'))

  if (body.archived === true) {
    raw.archived = true
  } else if (body.archived === false) {
    delete raw.archived
  }

  writeFileSync(digestPath, JSON.stringify(raw, null, 2))
  return { digest: raw }
}
