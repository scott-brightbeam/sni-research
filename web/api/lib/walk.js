import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { join, resolve, basename } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')
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
