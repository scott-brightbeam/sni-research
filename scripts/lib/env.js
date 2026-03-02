/**
 * env.js — Shared environment variable loader for SNI Research Tool
 *
 * Bun >=1.3 filters certain env vars (like ANTHROPIC_API_KEY) from automatic
 * .env loading. This module loads them manually as a workaround.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

/**
 * Load an environment variable, falling back to manual .env parsing.
 * @param {string} key
 * @returns {string | undefined}
 */
export function loadEnvKey(key) {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = join(ROOT, '.env');
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(new RegExp(`^${key}=(.+)$`));
      if (match) return match[1].trim();
    }
  } catch { /* .env missing is fine */ }
  return undefined;
}
