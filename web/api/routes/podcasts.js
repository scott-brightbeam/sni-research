import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { validateParam } from '../lib/walk.js'

const ROOT = resolve(import.meta.dir, '../../..')

export async function handleGetPodcasts(query) {
  const { week } = query
  const manifestPath = join(ROOT, 'data/podcasts/manifest.json')

  if (!existsSync(manifestPath)) {
    return { week: week || null, episodes: [], lastRun: null }
  }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  } catch {
    return { week: week || null, episodes: [], lastRun: null }
  }

  let entries = Array.isArray(manifest) ? manifest : []

  if (week) {
    const weekNum = parseInt(week, 10)
    entries = entries.filter(e => e.week === weekNum)
  }

  const episodes = entries.map(entry => {
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
