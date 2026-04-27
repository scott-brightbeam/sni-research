// Client-side analytics: track section/tab/anchor changes and report dwell.
// On route change, close the prior view (POST with dwellMs) and open a new one.
// Heartbeat every 30s so last_activity_at stays fresh while the tab is idle.
// On pagehide / tab close, sendBeacon the final dwell.
//
// The server reads email + sid from the JWT cookie — the client never needs to
// know them.

const VIEW_URL = '/a/view';
const HEARTBEAT_URL = '/a/heartbeat';
const HEARTBEAT_MS = 30_000;

let current = null;       // { section, tab, anchor, startedAt, startedMs, visibleMs, visibleSince }
let heartbeatTimer = null;

function now() { return Date.now(); }

function stopTimer() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function startTimer() {
  stopTimer();
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    try {
      fetch(HEARTBEAT_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, HEARTBEAT_MS);
}

function accumulateVisible() {
  if (!current) return;
  if (current.visibleSince != null) {
    current.visibleMs += now() - current.visibleSince;
    current.visibleSince = document.visibilityState === 'visible' ? now() : null;
  }
}

function sendClose(view) {
  if (!view) return;
  // Finalise visible time
  const visibleSince = view.visibleSince;
  const dwell = view.visibleMs + (visibleSince ? (now() - visibleSince) : 0);
  const body = JSON.stringify({
    section: view.section,
    tab: view.tab,
    anchor: view.anchor,
    startedAt: view.startedAt,
    dwellMs: Math.max(0, Math.round(dwell)),
  });
  const blob = new Blob([body], { type: 'application/json' });
  // sendBeacon is fire-and-forget and survives navigation; fall back to fetch.
  if (navigator.sendBeacon && navigator.sendBeacon(VIEW_URL, blob)) return;
  try {
    fetch(VIEW_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function trackView({ section, tab, anchor }) {
  if (!section) return;
  // If route is identical, don't reset dwell timer.
  if (current &&
      current.section === section &&
      (current.tab || null) === (tab || null) &&
      (current.anchor || null) === (anchor || null)) {
    return;
  }
  // Close prior view with its accumulated dwell.
  if (current) sendClose(current);
  current = {
    section,
    tab: tab || null,
    anchor: anchor || null,
    startedAt: new Date().toISOString(),
    startedMs: now(),
    visibleMs: 0,
    visibleSince: document.visibilityState === 'visible' ? now() : null,
  };
  startTimer();
}

function onVisibilityChange() {
  if (!current) return;
  if (document.visibilityState === 'visible') {
    current.visibleSince = now();
  } else {
    accumulateVisible();
    // When hidden, freeze visibleSince so heartbeat won't double-count.
    current.visibleSince = null;
  }
}

function onUnload() {
  if (!current) return;
  sendClose(current);
  current = null;
  stopTimer();
}

export function installAnalytics() {
  document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
  window.addEventListener('pagehide', onUnload, { capture: true });
  // beforeunload is less reliable on mobile but catches desktop back-nav etc.
  window.addEventListener('beforeunload', onUnload, { capture: true });
}
