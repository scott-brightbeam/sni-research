/**
 * alert.js — macOS Notification Centre alerts
 *
 * Non-blocking, fire-and-forget system notifications via osascript.
 * Used by pipeline.js for stage-boundary alerts and threshold warnings.
 *
 * Usage:
 *   import { sendAlert } from './lib/alert.js';
 *   sendAlert('SNI Pipeline', '✓ fetch: 15 saved (3.2s) → score');
 */

import { spawn } from 'child_process';

const TIMEOUT_MS = 5000;

/**
 * Send a macOS Notification Centre alert.
 * @param {string} title — bold heading (e.g. 'SNI Pipeline')
 * @param {string} body — detail line
 * @param {string} [subtitle] — optional secondary line
 */
export function sendAlert(title, body, subtitle) {
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  let script = `display notification "${esc(body)}" with title "${esc(title)}"`;
  if (subtitle) script += ` subtitle "${esc(subtitle)}"`;

  const proc = spawn('osascript', ['-e', script], { timeout: TIMEOUT_MS });
  proc.on('error', () => {}); // swallow — notifications are best-effort
}
