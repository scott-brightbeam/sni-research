import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const RECS_PATH = join(ROOT, 'data/editorial/ev-recommendations.json')
const PENDING_PATH = join(ROOT, 'data/editorial/sources-pending.json')

export function getEvRecommendations() {
  if (!existsSync(RECS_PATH)) return { domains: [] }
  try {
    return JSON.parse(readFileSync(RECS_PATH, 'utf-8'))
  } catch {
    return { domains: [] }
  }
}

export function updateEvRecommendation(domain, body) {
  const { action } = body || {}
  if (!action || !['accept', 'dismiss'].includes(action)) {
    const err = new Error('action must be "accept" or "dismiss"')
    err.status = 400
    throw err
  }

  const data = getEvRecommendations()
  const idx = data.domains.findIndex(d => d.domain === domain)
  if (idx === -1) {
    const err = new Error('Domain not found in recommendations')
    err.status = 404
    throw err
  }

  const removed = data.domains.splice(idx, 1)[0]

  if (action === 'accept') {
    let pending = []
    if (existsSync(PENDING_PATH)) {
      try { pending = JSON.parse(readFileSync(PENDING_PATH, 'utf-8')) } catch {}
    }
    pending.push({ domain, addedAt: new Date().toISOString(), linkCount: removed.linkCount })
    mkdirSync(join(ROOT, 'data/editorial'), { recursive: true })
    writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2))
  }

  writeFileSync(RECS_PATH, JSON.stringify(data, null, 2))
  return { success: true, action, domain }
}
