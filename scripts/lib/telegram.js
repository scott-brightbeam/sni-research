/**
 * telegram.js — Telegram Bot API wrapper for SNI alerts
 *
 * Sends messages via Zaphod bot. Uses HTML parse mode for reliable formatting.
 * Fire-and-forget — caller handles fallback to macOS notifications.
 */

import { loadEnvKey } from './env.js';

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a Telegram message via Zaphod's bot API.
 * @param {string} text — message body (HTML formatted)
 * @param {object} [opts]
 * @param {string} [opts.parseMode='HTML'] — 'MarkdownV2' | 'HTML'
 * @returns {Promise<{ ok: boolean, messageId?: number, error?: string }>}
 */
export async function sendTelegram(text, opts = {}) {
  const token = loadEnvKey('TELEGRAM_BOT_TOKEN');
  const chatId = loadEnvKey('TELEGRAM_CHAT_ID');
  if (!token || !chatId) {
    console.warn('[telegram] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID');
    return { ok: false, error: 'missing credentials' };
  }

  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: opts.parseMode || 'HTML',
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, error: data.description || 'unknown' };
    return { ok: true, messageId: data.result?.message_id };
  } catch (err) {
    console.warn(`[telegram] Send failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}
