import { readFileSync } from 'fs'
import { join } from 'path'

const PROMPTS_DIR = join(import.meta.dir, '..', '..', 'config', 'prompts')

/**
 * Load and render a prompt template from config/prompts/.
 * Reads config/prompts/<name>.txt, performs {key} → value replacement.
 * @param {string} name — prompt filename without extension (e.g. 'content-match.v1')
 * @param {object} vars — key-value pairs for replacement
 * @returns {string} Rendered prompt text
 */
export function loadAndRenderPrompt(name, vars) {
  let prompt = readFileSync(join(PROMPTS_DIR, `${name}.txt`), 'utf8')
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replaceAll(`{${key}}`, value)
  }
  return prompt
}
