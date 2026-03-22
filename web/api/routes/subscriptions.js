import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import yaml from 'js-yaml'

const ROOT = resolve(import.meta.dir, '../../..')

export function getSubscriptions() {
  const configPath = join(ROOT, 'config/subscriptions.yaml')
  if (!existsSync(configPath)) return { sources: [] }

  const config = yaml.load(readFileSync(configPath, 'utf-8'))
  const sources = (config.sources || []).map(s => {
    // Find latest run for this source
    const runsDir = join(ROOT, 'output/runs')
    let lastRun = null
    if (existsSync(runsDir)) {
      const runFiles = readdirSync(runsDir)
        .filter(f => f.startsWith('subscription-') && f.endsWith('.json'))
        .sort()
      if (runFiles.length > 0) {
        try {
          const data = JSON.parse(readFileSync(join(runsDir, runFiles[runFiles.length - 1]), 'utf-8'))
          const result = (data.results || []).find(r => r.source === s.name)
          if (result) lastRun = { date: data.startedAt, success: result.success, error: result.error }
        } catch { /* ignore */ }
      }
    }

    // Check if credentials exist by checking the encrypted file
    const hasCredentials = existsSync(join(ROOT, '.credentials.enc'))

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

    proc.on('close', (code) => {
      resolve({ success: code === 0, output: output.slice(-2000) })
    })

    // Timeout after 60s
    setTimeout(() => {
      proc.kill()
      resolve({ success: false, output: 'Timeout after 60s' })
    }, 60000)
  })
}

export function triggerFetch(body) {
  const sourceArg = body?.source ? ['--source', body.source] : []
  const proc = spawn('node', ['scripts/subscription-fetch.js', ...sourceArg], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: true,
  })
  proc.unref()

  return { started: true, pid: proc.pid }
}
