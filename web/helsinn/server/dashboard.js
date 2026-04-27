// Server-rendered HTML analytics dashboard. No React, no JS bundle —
// just one self-contained HTML response. Keeps this lane fully isolated
// from the proposal SPA. Admin-gated in server.js.

function esc(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60); const rs = s % 60;
  if (m < 60) return m + 'm ' + rs + 's';
  const h = Math.floor(m / 60); const rm = m % 60;
  return h + 'h ' + rm + 'm';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d)) return iso;
  const diff = Date.now() - d.getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return s + 's ago';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24); return days + 'd ago';
}

function fmtSectionLabel(section, tab) {
  const s = { home: 'Home', context: 'Context & Case', proposal: 'Proposal',
              tacit: 'Tacit', aimn: 'AI-native' }[section] || section;
  return tab ? s + ' · ' + tab : s;
}

function avgDwellForUser(u) {
  if (!u.total_views) return 0;
  return Math.round(u.total_dwell_ms / u.total_views);
}

function avgDwellForSession(s) {
  if (!s.view_count) return 0;
  return Math.round(s.total_dwell_ms / s.view_count);
}

function sessionDuration(s) {
  const end = s.ended_at || s.last_activity_at;
  if (!s.started_at || !end) return null;
  return new Date(end).getTime() - new Date(s.started_at).getTime();
}

export function renderDashboard({ summary, users, sessions, views, bySection, me }) {
  const avgSession = summary.total_sessions
    ? Math.round(summary.total_dwell_ms / summary.total_sessions) : 0;

  const userRows = users.map(u => `
    <tr>
      <td class="mono">${esc(u.email)}</td>
      <td class="num">${esc(u.login_count)}</td>
      <td class="num">${esc(u.session_count)}</td>
      <td class="num">${esc(u.total_views)}</td>
      <td class="num">${fmtDuration(u.total_dwell_ms)}</td>
      <td class="num">${fmtDuration(avgDwellForUser(u))}</td>
      <td class="mono small">${esc(fmtDate(u.first_seen))}</td>
      <td class="mono small">${esc(fmtDate(u.last_seen))} <span class="dim">(${esc(fmtRelative(u.last_seen))})</span></td>
    </tr>
  `).join('') || `<tr><td colspan="8" class="empty">No logged-in users yet.</td></tr>`;

  const sessionRows = sessions.map(s => `
    <tr>
      <td class="mono">${esc(s.email)}</td>
      <td class="mono small">${esc(fmtDate(s.started_at))}</td>
      <td class="num">${fmtDuration(sessionDuration(s))}</td>
      <td class="num">${esc(s.view_count)}</td>
      <td class="num">${fmtDuration(s.total_dwell_ms)}</td>
      <td class="num">${fmtDuration(avgDwellForSession(s))}</td>
      <td class="mono small">${esc(s.ip || '—')}</td>
      <td class="small ua">${esc((s.user_agent || '').slice(0, 80))}</td>
      <td class="small">${s.ended_at ? 'ended' : 'active'}</td>
    </tr>
  `).join('') || `<tr><td colspan="9" class="empty">No sessions yet.</td></tr>`;

  const viewRows = views.map(v => `
    <tr>
      <td class="mono small">${esc(fmtDate(v.started_at))}</td>
      <td class="mono">${esc(v.email)}</td>
      <td>${esc(fmtSectionLabel(v.section, v.tab))}</td>
      <td class="mono small">${esc(v.anchor || '—')}</td>
      <td class="num">${fmtDuration(v.dwell_ms)}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">No views recorded yet.</td></tr>`;

  const sectionRows = bySection.map(s => `
    <tr>
      <td>${esc(fmtSectionLabel(s.section, s.tab))}</td>
      <td class="num">${esc(s.views)}</td>
      <td class="num">${esc(s.unique_users)}</td>
      <td class="num">${fmtDuration(s.total_dwell_ms)}</td>
      <td class="num">${fmtDuration(Math.round(s.avg_dwell_ms))}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty">No section views yet.</td></tr>`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Helsinn Phase 1 — Analytics</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet"/>
<meta name="referrer" content="no-referrer"/>
<link rel="icon" href="/favicon.ico"/>
<style>
  :root{ --ember:#EA4700; --ink:#111; --gray:#7a7a7a; --faint:#e6e6e6;
         --soft:#f5f3ee; --paper:#ffffff; --sans: Arial, 'Helvetica Neue', Helvetica, sans-serif; }
  *{box-sizing:border-box;}
  body{ margin:0; font-family:var(--sans); color:var(--ink); background:var(--soft); }
  .wrap{ max-width:1400px; margin:0 auto; padding:24px 32px 64px; }
  header{ display:flex; align-items:baseline; justify-content:space-between;
          gap:16px; margin-bottom:24px; border-bottom:1px solid var(--faint); padding-bottom:16px; }
  h1{ font-size:22px; margin:0; font-weight:700; letter-spacing:-0.01em; }
  .me{ font-size:12px; color:var(--gray); }
  .me a{ color:var(--ember); text-decoration:none; margin-left:12px; }
  .cards{ display:grid; grid-template-columns:repeat(4, 1fr); gap:16px; margin-bottom:32px; }
  .card{ background:var(--paper); border:1px solid var(--faint); padding:16px 20px; border-radius:4px; }
  .card .lbl{ font-size:11px; letter-spacing:0.08em; text-transform:uppercase;
              color:var(--gray); font-weight:700; margin:0 0 6px; }
  .card .val{ font-size:28px; font-weight:700; color:var(--ink); letter-spacing:-0.02em; }
  h2{ font-size:13px; letter-spacing:0.08em; text-transform:uppercase; font-weight:700;
       margin:28px 0 10px; color:var(--ink); }
  h2 .count{ color:var(--gray); font-weight:400; margin-left:8px; }
  table{ width:100%; border-collapse:collapse; background:var(--paper); font-size:13px; }
  th,td{ padding:8px 10px; text-align:left; border-bottom:1px solid var(--faint); vertical-align:top; }
  th{ font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--gray);
       font-weight:700; background:#faf8f3; position:sticky; top:0; }
  td.num, th.num{ text-align:right; font-variant-numeric:tabular-nums; }
  td.mono{ font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; }
  td.small, th.small{ font-size:11px; }
  .dim{ color:var(--gray); }
  .empty{ text-align:center; color:var(--gray); padding:24px; }
  .ua{ max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--gray); }
  .scroll{ overflow-x:auto; border:1px solid var(--faint); border-radius:4px; background:var(--paper); }
  .foot{ margin-top:40px; font-size:11px; color:var(--gray); }
</style></head><body>
<div class="wrap">
  <header>
    <h1>Helsinn Phase 1 Proposal — Analytics</h1>
    <div class="me">${esc(me || '')} <a href="/">Site</a> <a href="#" onclick="fetch('/auth/logout',{method:'POST'}).then(()=>location.href='/login')">Sign out</a></div>
  </header>

  <section class="cards">
    <div class="card"><p class="lbl">Unique users</p><p class="val">${esc(summary.unique_users)}</p></div>
    <div class="card"><p class="lbl">Total sessions</p><p class="val">${esc(summary.total_sessions)}</p></div>
    <div class="card"><p class="lbl">Total views</p><p class="val">${esc(summary.total_views)}</p></div>
    <div class="card"><p class="lbl">Avg session dwell</p><p class="val">${fmtDuration(avgSession)}</p></div>
  </section>

  <h2>Users <span class="count">${users.length}</span></h2>
  <div class="scroll"><table>
    <thead><tr>
      <th>Email</th><th class="num">Logins</th><th class="num">Sessions</th>
      <th class="num">Views</th><th class="num">Total dwell</th><th class="num">Avg / view</th>
      <th>First seen</th><th>Last seen</th>
    </tr></thead>
    <tbody>${userRows}</tbody>
  </table></div>

  <h2>Views by section</h2>
  <div class="scroll"><table>
    <thead><tr>
      <th>Section</th><th class="num">Views</th><th class="num">Unique users</th>
      <th class="num">Total dwell</th><th class="num">Avg dwell</th>
    </tr></thead>
    <tbody>${sectionRows}</tbody>
  </table></div>

  <h2>Recent sessions <span class="count">${sessions.length}</span></h2>
  <div class="scroll"><table>
    <thead><tr>
      <th>Email</th><th>Started</th><th class="num">Duration</th>
      <th class="num">Views</th><th class="num">Dwell</th><th class="num">Avg / view</th>
      <th>IP</th><th>User agent</th><th>Status</th>
    </tr></thead>
    <tbody>${sessionRows}</tbody>
  </table></div>

  <h2>Recent views <span class="count">${views.length}</span></h2>
  <div class="scroll"><table>
    <thead><tr>
      <th>When</th><th>User</th><th>Section</th><th>Anchor</th><th class="num">Dwell</th>
    </tr></thead>
    <tbody>${viewRows}</tbody>
  </table></div>

  <p class="foot">Generated ${fmtDate(new Date().toISOString())} · dwell calculated from the page's own timer, not the server clock · a view is closed when the user navigates or the tab is unloaded (sendBeacon).</p>
</div>
</body></html>`;
}
