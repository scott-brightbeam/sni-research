import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { validateParam } from '../lib/walk.js'

const ROOT = resolve(import.meta.dir, '../../..')

/**
 * Scan data/podcasts/ directories for .digest.json files.
 * Used as fallback when manifest.json does not exist.
 */
function scanDigestFiles() {
  const podcastsDir = join(ROOT, 'data/podcasts')
  if (!existsSync(podcastsDir)) return []

  const episodes = []
  const dateDirs = readdirSync(podcastsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()

  for (const dateDir of dateDirs) {
    const datePath = join(podcastsDir, dateDir)
    let sourceDirs
    try { sourceDirs = readdirSync(datePath) } catch { continue }

    for (const sourceDir of sourceDirs) {
      const sourcePath = join(datePath, sourceDir)
      let files
      try { files = readdirSync(sourcePath) } catch { continue }

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
            digestPath: `data/podcasts/${dateDir}/${sourceDir}/${file}`,
            digest,
          })
        } catch { /* skip malformed digest */ }
      }
    }
  }

  return episodes
}

export async function handleGetPodcasts(query) {
  const { week } = query
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')

  let episodes

  if (existsSync(manifestPath)) {
    // Use manifest when available (keyed by filename per PRD §5.1)
    let manifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch {
      return { week: week || null, episodes: [], lastRun: null }
    }

    let entries = Array.isArray(manifest)
      ? manifest
      : Object.entries(manifest).map(([filename, entry]) => ({ filename, ...entry }))

    if (week) {
      const weekNum = parseInt(week, 10)
      entries = entries.filter(e => e.week === weekNum)
    }

    episodes = entries.map(entry => {
      let digest = null
      if (entry.digestPath) {
        const digestFullPath = join(ROOT, entry.digestPath)
        if (existsSync(digestFullPath)) {
          try {
            digest = JSON.parse(readFileSync(digestFullPath, 'utf-8'))
          } catch { /* skip malformed */ }
        }
      }
      return { ...entry, digest }
    })
  } else {
    // Fallback: scan digest files directly
    episodes = scanDigestFiles()
    if (week) {
      const weekNum = parseInt(week, 10)
      episodes = episodes.filter(e => e.week === weekNum)
    }
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
