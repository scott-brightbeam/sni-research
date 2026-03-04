import { readFileSync } from 'fs'
import { join, resolve } from 'path'

const ROOT = resolve(import.meta.dir, '../../..')

export function loadEnvKey(key) {
  if (process.env[key]) return process.env[key]
  try {
    const envPath = join(ROOT, '.env')
    const lines = readFileSync(envPath, 'utf8').split('\n')
    for (const line of lines) {
      const match = line.match(new RegExp(`^${key}=(.+)$`))
      if (match) return match[1].trim()
    }
  } catch { /* .env missing is fine */ }
  return undefined
}
