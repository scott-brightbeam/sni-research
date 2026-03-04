import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
const OUTPUT = join(ROOT, 'output')

function readJsonSafe(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function getAvailableWeeks() {
  if (!existsSync(OUTPUT)) return []
  const weeks = []
  for (const f of readdirSync(OUTPUT)) {
    const m = f.match(/^draft-week-(\d+)\.md$/)
    if (m) weeks.push(parseInt(m[1]))
  }
  return weeks.sort((a, b) => a - b)
}

export async function getDraft({ week } = {}) {
  const available = getAvailableWeeks()
  if (available.length === 0) {
    throw Object.assign(new Error('No drafts found'), { status: 404 })
  }

  let weekNum
  if (week) {
    if (!/^\d+$/.test(week)) throw Object.assign(new Error(`Invalid week: ${week}`), { status: 400 })
    weekNum = parseInt(week)
  } else {
    weekNum = available[available.length - 1]
  }

  const draftPath = join(OUTPUT, `draft-week-${weekNum}.md`)
  if (!existsSync(draftPath)) {
    throw Object.assign(new Error(`Draft for week ${weekNum} not found`), { status: 404 })
  }

  const draft = readFileSync(draftPath, 'utf-8')
  const review = readJsonSafe(join(OUTPUT, `review-week-${weekNum}.json`))
  const links = readJsonSafe(join(OUTPUT, `links-week-${weekNum}.json`))
  const evaluate = readJsonSafe(join(OUTPUT, `evaluate-week-${weekNum}.json`))

  return {
    week: weekNum,
    draft,
    review,
    links,
    evaluate,
    availableWeeks: available,
  }
}
