import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import yaml from 'js-yaml'
import { validateParam } from '../lib/walk.js'

const ROOT = resolve(import.meta.dir, '../../..')

export function getSubscriptions() {
  const configPath = join(ROOT, 'config/subscriptions.yaml')
  if (!existsSync(configPath)) return { sources: [] }

  const config = yaml.load(readFileSync(configPath, 'utf-8'))

  // Read latest run data once (not per-source)
  let lastRunData = null
  const runsDir = join(ROOT, 'output/runs')
  if (existsSync(runsDir)) {
    const runFiles = readdirSync(runsDir)
      .filter(f => f.startsWith('subscription-') && f.endsWith('.json'))
      .sort()
    if (runFiles.length > 0) {
      try {
        lastRunData = JSON.parse(readFileSync(join(runsDir, runFiles[runFiles.length - 1]), 'utf-8'))
      } catch { /* ignore corrupt run files */ }
    }
  }

  // Note: hasCredentials checks file existence only — it cannot determine per-source
  // credential presence without decrypting. Per-source checking deferred until needed.
  const hasCredentials = existsSync(join(ROOT, '.credentials.enc'))

  const sources = (config.sources || []).map(s => {
    let lastRun = null
    if (lastRunData) {
      const result = (lastRunData.results || []).find(r => r.source === s.name)
      if (result) lastRun = { date: lastRunData.startedAt, success: result.success, error: result.error }
    }
    return { ...s, lastRun, hasCredentials }
  })

  return { sources }
}

export function saveCredentials(body) {
  const { sources } = body || {}
  if (!Array.isArray(sources)) {
    const err = new Error('sources array required')
    err.status = 400
    throw err
  }

  // Write credentials via the credential store (spawns Node for ESM compatibility)
  const proc = Bun.spawnSync({
    cmd: ['node', '--input-type=module', '-e', `
      import { saveCredentials } from './scripts/lib/credential-store.js';
      saveCredentials(JSON.parse(process.argv[1]));
    `, JSON.stringify(sources)],
    cwd: ROOT,
  })

  if (proc.exitCode !== 0) {
    console.error('credential-store stderr:', proc.stderr?.toString())
    const err = new Error('Failed to save credentials')
    err.status = 500
    throw err
  }

  return { saved: true }
}

export function testLogins() {
  return new Promise((resolve) => {
    const proc = spawn('node', ['scripts/subscription-fetch.js', '--test'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    proc.stdout.on('data', d => { output += d })
    proc.stderr.on('data', d => { output += d })

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ success: false, output: 'Timeout after 60s' })
    }, 60000)

    proc.on('close', (code) => {
      clearTimeout(timer)
      resolve({ success: code === 0, output: output.slice(-2000) })
    })
  })
}

export function triggerFetch(body) {
  if (body?.source) validateParam(body.source, 'source') // prevent injection via spawn args
  const sourceArg = body?.source ? ['--source', body.source] : []
  const proc = spawn('node', ['scripts/subscription-fetch.js', ...sourceArg], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
  proc.unref()

  return { started: true, pid: proc.pid }
}
