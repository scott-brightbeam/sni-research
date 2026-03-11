import { readdirSync, readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { estimateCost } from '../lib/pricing.js'

const ROOT = resolve(import.meta.dir, '../../..')
const COPILOT_DIR = join(ROOT, 'data/copilot')

/**
 * GET /api/usage?period=today|week|month|all
 * Returns token usage and cost aggregated by model for the given period.
 */
export async function getUsage(query) {
  const period = query.period || 'all'
  const cutoff = getCutoff(period)

  // Scan all thread JSONL files across all weeks
  const byModel = {}
  const chatsDir = join(COPILOT_DIR, 'chats')
  if (!existsSync(chatsDir)) return { period, byModel: {}, totalCost: 0 }

  for (const weekDir of readdirSync(chatsDir)) {
    if (!/^week-\d+$/.test(weekDir)) continue
    const dir = join(chatsDir, weekDir)

    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue
      try {
        const lines = readFileSync(join(dir, file), 'utf-8')
          .split('\n')
          .filter(l => l.trim())

        for (const line of lines) {
          const msg = JSON.parse(line)
          if (!msg.usage || msg.role !== 'assistant') continue

          // Apply time filter
          if (cutoff && msg.timestamp) {
            const msgTime = new Date(msg.timestamp).getTime()
            if (msgTime < cutoff) continue
          }

          const model = msg.model || 'unknown'
          if (!byModel[model]) {
            byModel[model] = { inputTokens: 0, outputTokens: 0, cost: 0, messages: 0 }
          }
          byModel[model].inputTokens += msg.usage.input_tokens || 0
          byModel[model].outputTokens += msg.usage.output_tokens || 0
          byModel[model].messages += 1
        }
      } catch { /* skip corrupt files */ }
    }
  }

  // Calculate costs per model
  let totalCost = 0
  for (const [model, stats] of Object.entries(byModel)) {
    stats.cost = estimateCost(model, stats.inputTokens, stats.outputTokens)
    totalCost += stats.cost
  }

  return { period, byModel, totalCost }
}

function getCutoff(period) {
  const now = new Date()
  switch (period) {
    case 'today': {
      const start = new Date(now)
      start.setHours(0, 0, 0, 0)
      return start.getTime()
    }
    case 'week': {
      // Start of current editorial week (Friday)
      const start = new Date(now)
      const day = start.getDay()
      const diff = (day + 2) % 7 // days since Friday
      start.setDate(start.getDate() - diff)
      start.setHours(0, 0, 0, 0)
      return start.getTime()
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      return start.getTime()
    }
    case 'all':
    default:
      return null
  }
}
