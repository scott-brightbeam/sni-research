import { readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import yaml from 'js-yaml'
import { validateOffLimits, validateSources, validateSectors } from '../lib/config-validator.js'

const ROOT = resolve(import.meta.dir, '../../..')

const CONFIGS = {
  'off-limits': { file: 'off-limits.yaml', validate: validateOffLimits },
  'sources':    { file: 'sources.yaml',    validate: validateSources },
  'sectors':    { file: 'sectors.yaml',    validate: validateSectors },
}

export async function getConfig(name) {
  const cfg = CONFIGS[name]
  if (!cfg) throw new Error(`Unknown config: ${name}`)

  const filePath = join(ROOT, 'config', cfg.file)
  const content = readFileSync(filePath, 'utf-8')
  return yaml.load(content)
}

export async function putConfig(name, data) {
  const cfg = CONFIGS[name]
  if (!cfg) throw new Error(`Unknown config: ${name}`)

  const filePath = join(ROOT, 'config', cfg.file)
  const tmpPath = filePath + '.tmp'
  const bakPath = filePath + '.bak'

  try {
    // 1. Serialize to YAML
    const yamlStr = yaml.dump(data, { lineWidth: 120, noRefs: true })

    // 2. Write to .tmp
    writeFileSync(tmpPath, yamlStr)

    // 3. Parse back to verify valid YAML
    const parsed = yaml.load(readFileSync(tmpPath, 'utf-8'))

    // 4. Structural validation
    cfg.validate(parsed)

    // 5. Backup current file
    if (existsSync(filePath)) {
      copyFileSync(filePath, bakPath)
    }

    // 6. Rename .tmp over original
    const { renameSync } = await import('fs')
    renameSync(tmpPath, filePath)

    // 7. Return updated config
    return parsed

  } catch (err) {
    // Clean up tmp on failure
    if (existsSync(tmpPath)) rmSync(tmpPath)
    throw err
  }
}
