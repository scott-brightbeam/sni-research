import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, basename } from 'path'
import config from './config.js'

const ROOT = config.ROOT
const SAFE_PARAM = /^[\w-]+$/

export function validateParam(value, name) {
  if (!SAFE_PARAM.test(value)) throw new Error(`Invalid ${name}: ${value}`)
}

export function walkArticleDir(baseDir, callback, { sector, date, dateFrom, dateTo } = {}) {
  const dir = join(ROOT, `data/${baseDir}`)
  if (!existsSync(dir)) return

  const dates = readdirSync(dir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  for (const d of dates) {
    if (date && d !== date) continue
    if (dateTo && d > dateTo) continue
    if (dateFrom && d < dateFrom) break // sorted reverse — all remaining are older
    const datePath = join(dir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      if (sector && s !== sector) continue
      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          callback(raw, { date: d, sector: s, slug: basename(f, '.json'), sectorPath })
        } catch { /* skip malformed */ }
      }
    }
  }
}

/**
 * Async sibling of walkArticleDir that yields control to the event loop
 * every YIELD_EVERY files. Without this, walking 4576 articles synchronously
 * blocks the event loop for 30-60s on Fly's persistent volume — long enough
 * for the health check to fail and the machine to restart.
 *
 * Use this from any code path that runs during request handling, especially
 * status endpoints that block dashboard rendering.
 *
 * Yielding every 10 files keeps worst-case blocking windows to ~320ms on
 * Fly's cold volume (10 × ~32ms per readFileSync), well under the 5s health
 * check timeout. The yield overhead is ~1ms per yield × 458 yields = ~500ms
 * added to the full walk — acceptable when the walk itself takes 148s cold.
 *
 * In test mode (SNI_TEST_MODE=1), yields are skipped — tests run on local
 * SSD where the full walk takes <500ms and the cumulative setImmediate
 * overhead would push tests over their 5s timeout.
 */
const YIELD_EVERY = 10
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve))

export async function walkArticleDirAsync(baseDir, callback, { sector, date, dateFrom, dateTo } = {}) {
  const dir = join(ROOT, `data/${baseDir}`)
  if (!existsSync(dir)) return
  const yieldsEnabled = process.env.SNI_TEST_MODE !== '1'

  const dates = readdirSync(dir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()

  let processed = 0
  for (const d of dates) {
    if (date && d !== date) continue
    if (dateTo && d > dateTo) continue
    if (dateFrom && d < dateFrom) break
    const datePath = join(dir, d)
    if (!statSync(datePath).isDirectory()) continue

    const sectors = readdirSync(datePath).filter(s => {
      const p = join(datePath, s)
      return existsSync(p) && statSync(p).isDirectory()
    })

    for (const s of sectors) {
      if (sector && s !== sector) continue
      const sectorPath = join(datePath, s)
      const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))

      for (const f of files) {
        try {
          const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
          callback(raw, { date: d, sector: s, slug: basename(f, '.json'), sectorPath })
        } catch { /* skip malformed */ }
        processed++
        if (yieldsEnabled && processed % YIELD_EVERY === 0) {
          await yieldToEventLoop()
        }
      }
    }
  }
}
