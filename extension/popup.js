const SERVER = 'http://localhost:3847';

const statusEl = document.getElementById('serverStatus');
const articleInfo = document.getElementById('articleInfo');
const pageTitleEl = document.getElementById('pageTitle');
const pageUrlEl = document.getElementById('pageUrl');
const sectorSelect = document.getElementById('sectorSelect');
const saveBtn = document.getElementById('save');
const resultEl = document.getElementById('result');

let activeTab = null;

function showResult(cls, text) {
  resultEl.className = `result ${cls}`;
  resultEl.textContent = text;
}

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Health check (2-second timeout)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${SERVER}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('not ok');
    statusEl.className = 'status online';
    statusEl.textContent = 'Server running';
  } catch {
    statusEl.className = 'status offline';
    statusEl.textContent = 'Server offline \u2014 run: bun scripts/server.js';
    return;
  }

  // 2. Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || (!tab.url.startsWith('http://') && !tab.url.startsWith('https://'))) {
    statusEl.className = 'status offline';
    statusEl.textContent = 'Cannot save from this page type';
    return;
  }
  activeTab = tab;
  pageTitleEl.textContent = tab.title || '(no title)';
  pageUrlEl.textContent = tab.url;
  articleInfo.style.display = 'block';
});

// 3. Save button
saveBtn.addEventListener('click', async () => {
  if (!activeTab) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  resultEl.className = 'result';

  try {
    // Capture rendered HTML from the active tab
    let html = null;
    try {
      const [execResult] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => document.documentElement.outerHTML,
      });
      html = execResult.result;
    } catch {
      showResult('error', 'Cannot capture page content (restricted page)');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Article';
      return;
    }

    const sectorOverride = sectorSelect.value || undefined;
    const body = {
      url: activeTab.url,
      html,
      title: activeTab.title,
    };
    if (sectorOverride) body.sectorOverride = sectorOverride;

    const res = await fetch(`${SERVER}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.status === 'saved') {
      let msg = `Saved to ${data.sector} (${data.date_published})`;
      if (data.date_warning) msg += '\n(date unverified \u2014 using today)';
      if (data.off_limits_warning) msg += `\nNote: off-limits match (${data.off_limits_warning})`;
      showResult('saved', msg);
    } else if (data.status === 'duplicate') {
      showResult('duplicate', `Already saved (${data.sector})`);
    } else if (data.error) {
      showResult('error', data.error);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Article';
    }
  } catch (e) {
    showResult('error', `Connection lost: ${e.message}`);
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Article';
  }
});
