/**
 * prompt.js — Shared prompt loader + template renderer for SNI Research Tool
 *
 * Loads markdown prompt files with YAML frontmatter from config/prompts/.
 * Renders {{placeholder}} variables. Counts tokens via js-tiktoken.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import YAML from 'js-yaml';
import { encodingForModel } from 'js-tiktoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PROMPTS_DIR = join(ROOT, 'config/prompts');

const tokenEncoder = encodingForModel('gpt-4'); // cl100k_base, close enough for Claude

/**
 * Load a prompt file from config/prompts/{name}.md
 * Parses YAML frontmatter (model, max_tokens, temperature, version).
 * Returns the metadata and the template body.
 *
 * @param {string} name — filename without extension (e.g. 'score', 'draft-system')
 * @returns {{ meta: object, template: string }}
 */
export function loadPrompt(name) {
  const filePath = join(PROMPTS_DIR, `${name}.md`);
  const raw = readFileSync(filePath, 'utf8');
  if (raw.length === 0) throw new Error(`Prompt file is empty: ${name}.md`);

  const parts = raw.split('---');
  if (parts.length < 3) throw new Error(`Invalid frontmatter in ${name}.md: expected --- fences`);

  const meta = YAML.load(parts[1]);
  const template = parts.slice(2).join('---').trim();
  return { meta, template };
}

/**
 * Replace {{key}} placeholders in a template string.
 * Throws if a placeholder has no matching var (catches typos).
 *
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function renderPrompt(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in vars)) throw new Error(`Missing template variable: {{${key}}}`);
    return vars[key];
  });
}

/**
 * Count tokens in a text string using cl100k_base encoding.
 * @param {string} text
 * @returns {number}
 */
export function countTokens(text) {
  return tokenEncoder.encode(text).length;
}

/**
 * Load the canonical sector display names from config/sector-names.yaml.
 * Returns the full mapping object.
 *
 * @returns {Record<string, { config: string, tldr: string, body: string, order: number }>}
 */
export function loadSectorNames() {
  const filePath = join(ROOT, 'config', 'sector-names.yaml');
  return YAML.load(readFileSync(filePath, 'utf8'));
}
