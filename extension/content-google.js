/**
 * content-google.js - Injects "SNI" save buttons into Google Search and News results.
 *
 * Selector strategy: Google frequently changes class names. We use a layered approach:
 * 1. Primary: structural selectors (div.g, a > h3 pattern)
 * 2. Fallback: find all <a> elements containing <h3> children (works even if div.g changes)
 * Google News uses <article> elements (more stable structure).
 */

const SERVER = 'http://localhost:3847';
const MARKER = 'data-sni';
let serverOnline = false;

// ─── Button creation ──────────────────────────────────────────────────────────

function createButton(url, title) {
  const btn = document.createElement('button');
  btn.className = 'sni-save-btn';
  btn.textContent = 'SNI';
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    saveArticle(btn, url, title);
  });
  return btn;
}

async function saveArticle(btn, url, title) {
  btn.disabled = true;
  btn.textContent = '...';
  btn.className = 'sni-save-btn saving';

  try {
    const res = await fetch(`${SERVER}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title }),
    });
    const data = await res.json();

    if (data.status === 'saved') {
      btn.textContent = 'Saved';
      btn.className = 'sni-save-btn saved';
    } else if (data.status === 'duplicate') {
      btn.textContent = 'Dup';
      btn.className = 'sni-save-btn duplicate';
    } else {
      btn.textContent = 'Err';
      btn.className = 'sni-save-btn error';
      setTimeout(() => {
        btn.textContent = 'SNI';
        btn.className = 'sni-save-btn';
        btn.disabled = false;
      }, 3000);
    }
  } catch {
    btn.textContent = 'Err';
    btn.className = 'sni-save-btn error';
    setTimeout(() => {
      btn.textContent = 'SNI';
      btn.className = 'sni-save-btn';
      btn.disabled = false;
    }, 3000);
  }
}

// ─── URL filtering ────────────────────────────────────────────────────────────

function isUsableUrl(href) {
  if (!href) return false;
  if (href.startsWith('/search')) return false;
  if (href.startsWith('/imgres')) return false;
  if (href.includes('google.com/search')) return false;
  if (href.includes('accounts.google.com')) return false;
  if (href.includes('support.google.com')) return false;
  if (href.includes('maps.google.com')) return false;
  return href.startsWith('http://') || href.startsWith('https://');
}

// ─── Google Search injection ──────────────────────────────────────────────────

function injectGoogleSearch() {
  // Strategy 1: div.g containers (standard organic results)
  document.querySelectorAll('div.g').forEach(result => {
    if (result.hasAttribute(MARKER)) return;
    const a = result.querySelector('a');
    const h3 = a?.querySelector('h3');
    if (!a || !h3) return;
    if (!isUsableUrl(a.href)) return;
    result.setAttribute(MARKER, '1');
    h3.parentElement.appendChild(createButton(a.href, h3.textContent));
  });

  // Strategy 2: fallback — any <a> containing an <h3> that we haven't processed
  document.querySelectorAll('a h3').forEach(h3 => {
    const a = h3.closest('a');
    if (!a) return;
    const container = a.closest('[data-hveid]') || a.parentElement;
    if (!container || container.hasAttribute(MARKER)) return;
    if (!isUsableUrl(a.href)) return;
    container.setAttribute(MARKER, '1');
    h3.parentElement.appendChild(createButton(a.href, h3.textContent));
  });
}

// ─── Google News injection ────────────────────────────────────────────────────

function injectGoogleNews() {
  document.querySelectorAll('article').forEach(article => {
    if (article.hasAttribute(MARKER)) return;
    const links = article.querySelectorAll('a[href]');
    let targetLink = null;
    let title = '';
    for (const link of links) {
      const href = link.href;
      if (href && !href.includes('accounts.google') && !href.includes('support.google')) {
        targetLink = link;
        title = link.textContent?.trim() || '';
        if (!title) {
          const heading = article.querySelector('h3, h4, [role="heading"]');
          title = heading?.textContent?.trim() || '';
        }
        break;
      }
    }
    if (!targetLink || !title) return;
    article.setAttribute(MARKER, '1');
    const btn = createButton(targetLink.href, title);
    targetLink.parentElement.appendChild(btn);
  });
}

// ─── Main injection ───────────────────────────────────────────────────────────

function injectButtons() {
  if (!serverOnline) return;
  const isNews = location.hostname === 'news.google.com';
  if (isNews) {
    injectGoogleNews();
  } else {
    injectGoogleSearch();
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

(async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`${SERVER}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) serverOnline = true;
  } catch {
    return; // Server not running — do nothing silently
  }

  injectButtons();

  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.body, { childList: true, subtree: true });
})();
