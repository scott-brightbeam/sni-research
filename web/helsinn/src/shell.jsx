/* =========================================================================
   Brightbeam × Helsinn proposal site – shell
   Rail (left-side primary navigation), TopBar (slim, Contact-only),
   router, SectionPage, Tabs, LiveCall mode, Search.
   Exports: App, SectionPage, Tabs, PageHead, Sub, Footer, Rail, TopBar,
            BrightbeamLogo, SECTIONS, setHash, parseHash, useScrollSpy.
   ========================================================================= */

import React from 'react';
import { SEARCH_INDEX } from './search-index.jsx';
import { SecHome, SecContext, SecProposal, SecTacit, SecAIN } from './sections.jsx';
import { installAnalytics, trackView } from './analytics.js';
const { useState: useS, useEffect: useE, useMemo: useM, useRef: useR, useCallback: useC } = React;

/* ---------- Router (hash-based, section/tab/anchor) ---------- */
function parseHash(){
  // #section[:tab][#anchor]  e.g. "proposal:commercials#investment"
  const h = (window.location.hash || '').replace(/^#/, '');
  if (!h) return { section:'home', tab:null, anchor:null };
  const anchorIdx = h.indexOf('#');
  let base = h, anchor = null;
  if (anchorIdx >= 0){ base = h.slice(0, anchorIdx); anchor = h.slice(anchorIdx+1) }
  const [section, tab] = base.split(':');
  return { section: section || 'home', tab: tab || null, anchor };
}

function setHash(section, tab, anchor){
  let h = section;
  if (tab) h += ':' + tab;
  if (anchor) h += '#' + anchor;
  if (('#' + h) !== window.location.hash){
    history.pushState(null, '', '#' + h);
  }
}

/* ---------- Site-wide primary nav ----------
   `hasTabs` flags sections whose body has sub-tabs — currently only `proposal`.
   The rail uses this to know whether to render L2 (sub-tabs) under the L1 entry. */
const SECTIONS = [
  { id: 'home',      num: '01', short: 'Home',                title: 'Home',                hasTabs: false },
  { id: 'context',   num: '02', short: 'Context & Case',      title: 'Context & Case',      hasTabs: false },
  { id: 'proposal',  num: '03', short: 'The proposal',        title: 'The proposal',        hasTabs: true  },
  { id: 'tacit',     num: '04', short: 'Tacit knowledge',     title: 'Tacit knowledge',     hasTabs: false },
  { id: 'aimn',      num: '05', short: 'Becoming AI-native',  title: 'Becoming AI-native',  hasTabs: false },
];

/* ---------- Proposal sub-tabs (L2 under "The proposal" in the rail) ---------- */
const PROPOSAL_TABS = [
  { id: 'shape',       label: 'The programme shape' },
  { id: 'commercials', label: 'The commercials' },
  { id: 'detail',      label: 'The detail' },
];

/* ---------- L3 anchor map ----------
   Mirrors the anchor lists hardcoded in sections.jsx. Keyed by section id, or
   `${section}:${tab}` for proposal panes. The rail reads this to render the
   in-page TOC. Keep in sync with sections.jsx if anchors change. */
const SECTION_ANCHORS = {
  context: [
    { id: 'starting-point', label: 'The starting point' },
    { id: 'business-case',  label: 'The business case' },
  ],
  'proposal:shape': [
    { id: 'streams',  label: 'The three workstreams' },
    { id: 'usecases', label: 'The candidate set' },
    { id: 'alpha',    label: 'Selecting the candidates' },
    { id: 'gmp',      label: 'Phase 2 / GMP pathway' },
  ],
  'proposal:commercials': [
    { id: 'investment',  label: 'Investment' },
    { id: 'bdp',         label: 'BDP application' },
    { id: 'timeline',    label: 'Timeline' },
    { id: 'assumptions', label: 'Assumptions & exclusions' },
  ],
  'proposal:detail': [
    { id: 'governance', label: 'Governance, risk & change' },
    { id: 'appa',       label: 'BDP technical reference' },
    { id: 'close',      label: 'Next steps' },
  ],
  tacit: [
    { id: 'why',      label: 'The background of tacit knowledge' },
    { id: 'taxonomy', label: 'The Unified Taxonomy' },
    { id: 'method',   label: 'How Brightbeam captures' },
    { id: 'karr',     label: 'Knowledge-at-risk register' },
  ],
  aimn: [
    { id: 'destination', label: 'AI-native as a destination' },
    { id: 'survival',    label: 'Why AI-native is a survival question' },
    { id: 'regulation',  label: 'The regulatory environment' },
    { id: 'position',    label: 'Our position' },
    { id: 'phase1',      label: 'Starting the flywheel · Phase 1' },
    { id: 'phase2',      label: 'Phase 2 – Scale and integration' },
    { id: 'phase3',      label: 'Phase 3 – AI-native' },
    { id: 'benefits',    label: 'Benefits that accrue along the way' },
  ],
};

/* ---------- Brightbeam logo (inline SVG; no external assets) ----------
   Two-tone A-frame: black outline + ember inner V. Wordmark in Arial to
   match the site's typography (no serif font dependency). */
function BrightbeamLogo(){
  return (
    <svg viewBox="0 0 140 32" aria-hidden="true">
      <path d="M6 26 L18 6 L30 26 Z" fill="none" stroke="#111" strokeWidth="2.4" strokeLinejoin="round"/>
      <path d="M12 26 L18 16 L24 26" fill="none" stroke="#EA4700" strokeWidth="2.4" strokeLinejoin="round"/>
      <text x="40" y="22" fontFamily="Arial, sans-serif" fontSize="20" fontWeight="600" fill="#111" letterSpacing="-0.3">Brightbeam</text>
    </svg>
  );
}

/* ---------- Slim top bar (functions only) ----------
   The rail handles all content navigation. The top bar is reserved for
   functions — currently just the Contact mailto. */
function TopBar(){
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <a className="topbar__contact" href="mailto:scott.wilkinson@brightbeam.com">
          Contact
        </a>
      </div>
    </header>
  );
}

/* ---------- Rail (left-side primary navigation) ----------
   Three nested levels:
     L1 — site sections (always visible)
     L2 — sub-tabs of the current section (only Proposal has them)
     L3 — in-page anchors of the current section/tab (scroll-spy active)

   Click handlers route through setHash(); identical pattern to the prior
   TopNav so the URL hash is the single source of truth. */
function Rail({ route }){
  const currentSection = SECTIONS.find(s => s.id === route.section) || SECTIONS[0];
  const currentTabId = currentSection.hasTabs ? (route.tab || PROPOSAL_TABS[0].id) : null;

  const anchorKey = currentSection.hasTabs ? `${currentSection.id}:${currentTabId}` : currentSection.id;
  const currentAnchors = SECTION_ANCHORS[anchorKey] || [];

  const activeAnchor = useScrollSpy(currentAnchors.map(a => a.id));

  const goToAnchor = (e, anchorId) => {
    e.preventDefault();
    const el = document.getElementById(anchorId);
    if (el) el.scrollIntoView({ behavior:'smooth', block:'start' });
  };

  const goToSection = (e, sectionId, tabId) => {
    e.preventDefault();
    setHash(sectionId, tabId || null);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    window.scrollTo({ top:0, behavior:'instant' });
  };

  return (
    <aside className="rail" aria-label="Site navigation">
      <a
        className="rail__logo"
        href="#home"
        aria-label="Brightbeam home"
        onClick={(e) => goToSection(e, 'home')}>
        <BrightbeamLogo/>
      </a>

      <nav className="rail__nav" aria-label="Primary">
        <ul className="rail__list">
          {SECTIONS.map(s => {
            const isCurrent = route.section === s.id;
            const hasL2 = s.hasTabs;
            const isOpen = isCurrent;
            const itemCls = ['rail__item']
              .concat(hasL2 ? [] : ['rail__item--leaf'])
              .concat(isCurrent ? ['is-current'] : [])
              .concat(isOpen ? ['is-open'] : [])
              .join(' ');

            return (
              <li key={s.id} className={itemCls}>
                <a
                  className="rail__l1"
                  href={'#' + s.id}
                  onClick={(e) => goToSection(e, s.id)}>
                  <span className="rail__l1-num">{s.num}</span>
                  <span className="rail__l1-label">{s.short}</span>
                  {hasL2 && (
                    <svg className="rail__l1-chev" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M5 3 L11 8 L5 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </a>

                {hasL2 && (
                  <div className="rail__l2-wrap">
                    <ul className="rail__l2-list">
                      {PROPOSAL_TABS.map(t => {
                        const isCurrentTab = isCurrent && currentTabId === t.id;
                        const tabAnchors = isCurrentTab ? currentAnchors : [];
                        return (
                          <li key={t.id} className={'rail__l2-item' + (isCurrentTab ? ' is-current' : '')}>
                            <a
                              className="rail__l2"
                              href={`#${s.id}:${t.id}`}
                              onClick={(e) => goToSection(e, s.id, t.id)}>
                              {t.label}
                            </a>
                            {isCurrentTab && tabAnchors.length > 0 && (
                              <div className="rail__l3-wrap">
                                <ul className="rail__l3-list">
                                  {tabAnchors.map(a => (
                                    <li key={a.id} className="rail__l3-item">
                                      <a
                                        className={'rail__l3' + (activeAnchor === a.id ? ' is-active' : '')}
                                        href={`#${s.id}:${t.id}#${a.id}`}
                                        onClick={(e) => goToAnchor(e, a.id)}>
                                        {a.label}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {!hasL2 && isCurrent && currentAnchors.length > 0 && (
                  <div className="rail__l3-wrap">
                    <ul className="rail__l3-list">
                      {currentAnchors.map(a => (
                        <li key={a.id} className="rail__l3-item">
                          <a
                            className={'rail__l3' + (activeAnchor === a.id ? ' is-active' : '')}
                            href={`#${s.id}#${a.id}`}
                            onClick={(e) => goToAnchor(e, a.id)}>
                            {a.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/* ---------- Search (simple substring index across all section files) ---------- */
function Search(){
  const [q, setQ] = useS('');
  const [open, setOpen] = useS(false);
  const ref = useR(null);

  useE(()=>{
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const results = useM(()=>{
    if (!q || q.length < 2) return [];
    const needle = q.toLowerCase();
    const out = [];
    const idx = SEARCH_INDEX || [];
    for (const entry of idx){
      const pos = entry.body.toLowerCase().indexOf(needle);
      if (pos >= 0){
        const start = Math.max(0, pos - 40);
        const end = Math.min(entry.body.length, pos + needle.length + 80);
        let snippet = entry.body.slice(start, end);
        if (start > 0) snippet = '…' + snippet;
        if (end < entry.body.length) snippet = snippet + '…';
        out.push({ ...entry, snippet, score: (entry.title.toLowerCase().includes(needle) ? 10 : 1) });
        if (out.length > 40) break;
      }
    }
    out.sort((a,b) => b.score - a.score);
    return out.slice(0, 12);
  }, [q]);

  const goTo = (r) => {
    setHash(r.section, r.tab, r.anchor);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    setOpen(false); setQ('');
    setTimeout(()=>{
      if (r.anchor){
        const el = document.getElementById(r.anchor);
        if (el) el.scrollIntoView({ block:'start', behavior:'instant' });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
    }, 50);
  };

  const highlight = (text) => {
    if (!q) return text;
    const lower = text.toLowerCase();
    const needle = q.toLowerCase();
    const parts = [];
    let i = 0;
    while (true){
      const p = lower.indexOf(needle, i);
      if (p < 0){ parts.push(text.slice(i)); break }
      parts.push(text.slice(i, p));
      parts.push(<mark key={p}>{text.slice(p, p + needle.length)}</mark>);
      i = p + needle.length;
    }
    return parts;
  };

  return (
    <div className="topnav__search" ref={ref}>
      <svg className="topnav__search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="7" cy="7" r="4.5"/>
        <path d="M14 14 L10.5 10.5"/>
      </svg>
      <input
        type="search"
        placeholder="Search the proposal"
        value={q}
        onChange={(e)=>{ setQ(e.target.value); setOpen(true) }}
        onFocus={()=>setOpen(true)}
        aria-label="Search"
      />
      {open && q.length >= 2 && (
        <div className="search-results">
          {results.length === 0 ? (
            <div className="search-empty">No results for "{q}"</div>
          ) : results.map((r, i) => (
            <a key={i} className="search-result"
              href="#"
              onClick={(e)=>{ e.preventDefault(); goTo(r) }}>
              <span className="search-result__path">{r.path}</span>
              <span className="search-result__title">{highlight(r.title)}</span>
              <span className="search-result__snippet">{highlight(r.snippet)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Section Page shell ---------- */
/* ---------- Section Page shell ----------
   The L3 in-page TOC has moved into the Rail (left side, app-wide).
   This component now just lays out the section main column with its
   prev/next footer. The `anchors` prop is accepted for back-compat with
   call sites in sections.jsx but no longer used internally — the rail
   reads SECTION_ANCHORS directly. */
function SectionPage({ sectionId, sectionTitle, sectionNum, anchors, children, nextLink, prevLink }){
  return (
    <div className="section-page">
      {children}

      {(nextLink || prevLink) && (
        <div className="section-footer">
          <div>
            {prevLink && (
              <a className="section-footer__link" href={'#' + prevLink.id}
                onClick={(e)=>{ e.preventDefault(); setHash(prevLink.id); window.dispatchEvent(new HashChangeEvent('hashchange')); window.scrollTo({top:0, behavior:'instant'}) }}>
                <span className="section-footer__caps">← Previous</span>
                <span className="section-footer__title">{prevLink.title}</span>
              </a>
            )}
          </div>
          <div>
            {nextLink && (
              <a className="section-footer__link section-footer__link--next" href={'#' + nextLink.id}
                onClick={(e)=>{ e.preventDefault(); setHash(nextLink.id); window.dispatchEvent(new HashChangeEvent('hashchange')); window.scrollTo({top:0, behavior:'instant'}) }}>
                <span className="section-footer__caps">Next →</span>
                <span className="section-footer__title">{nextLink.title}</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- PageHead ---------- */
function PageHead({ eyebrow, title, lede }){
  return (
    <header className="page-head">
      <p className="page-head__eyebrow">{eyebrow}</p>
      <h1 className="page-head__title">{title}</h1>
      {lede && <p className="page-head__lede">{lede}</p>}
    </header>
  );
}

/* ---------- Sub-section ---------- */
function Sub({ id, eyebrow, title, children, bodyClass }){
  return (
    <section className="sub reveal" id={id} data-screen-label={id}>
      {eyebrow && <p className="sub__eyebrow">{eyebrow}</p>}
      {title && <h2 className="sub__title">{title}</h2>}
      <div className={`sub-body-wrap ${bodyClass || ''}`}>{children}</div>
    </section>
  );
}

/* ---------- Tabs component (section 3 secondary nav) ---------- */
function Tabs({ tabs, value, onChange }){
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          className={`tabs__btn ${t.id === value ? 'is-active' : ''}`}
          onClick={() => onChange(t.id)}>
          <span className="tabs__btn-num">Tab {String.fromCharCode(65 + i)}</span>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Scroll spy hook ---------- */
function useScrollSpy(ids){
  const [active, setActive] = useS(ids[0]);
  useE(() => {
    const onScroll = () => {
      let cur = ids[0];
      const threshold = 140;
      for (const id of ids){
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= threshold){
          cur = id;
        }
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [ids.join('|')]);
  return active;
}

/* ---------- Scroll reveal (IntersectionObserver applied to .reveal) ---------- */
function useScrollReveal(){
  useE(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries){
        if (e.isIntersecting){
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    }, { rootMargin:'0px 0px -80px 0px', threshold:0.08 });

    const obs = () => {
      document.querySelectorAll('.reveal:not(.is-visible)').forEach(el => io.observe(el));
    };
    obs();
    // Reobserve when route changes
    const t = setInterval(obs, 400);
    return () => { io.disconnect(); clearInterval(t) };
  }, []);
}

/* ---------- Footer ---------- */
function Footer(){
  return (
    <footer className="footer footer--minimal">
      <div className="footer__meta">
        <span>© Brightbeam 2026. For Helsinn Birex Phase 1 – prepared 23 April 2026.</span>
        <span>v1.3 · AC · confidential</span>
      </div>
    </footer>
  );
}

/* ---------- App ---------- */
function App(){
  const [route, setRoute] = useS(parseHash());
  const [liveCall, setLiveCall] = useS(() => {
    try { return localStorage.getItem('bb_livecall') === '1' } catch { return false }
  });

  // Route
  useE(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Save current section to localStorage so refresh lands in the same place
  useE(() => {
    try { localStorage.setItem('bb_route', JSON.stringify(route)) } catch {}
  }, [route]);

  // Scroll to anchor on route change
  useE(() => {
    if (route.anchor){
      setTimeout(() => {
        const el = document.getElementById(route.anchor);
        if (el) el.scrollIntoView({ block:'start', behavior:'smooth' });
      }, 80);
    }
  }, [route.anchor]);

  // Live-call toggle
  useE(() => {
    if (liveCall) document.body.classList.add('live-call');
    else document.body.classList.remove('live-call');
    try { localStorage.setItem('bb_livecall', liveCall ? '1' : '0') } catch {}
  }, [liveCall]);

  // Keyboard shortcut L for live-call mode
  useE(() => {
    const onKey = (e) => {
      // Don't trigger in form fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'l' || e.key === 'L'){
        setLiveCall(v => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useScrollReveal();

  // Analytics — install once, then report view on every route change.
  useE(() => { installAnalytics(); }, []);
  useE(() => {
    trackView({ section: route.section, tab: route.tab, anchor: route.anchor });
  }, [route.section, route.tab, route.anchor]);

  // Pick section component
  let body = null;
  if (route.section === 'home')          body = <SecHome/>;
  else if (route.section === 'context')  body = <SecContext/>;
  else if (route.section === 'proposal') body = <SecProposal tab={route.tab}/>;
  else if (route.section === 'tacit')    body = <SecTacit/>;
  else if (route.section === 'aimn')     body = <SecAIN/>;
  else                                   body = <SecHome/>;

  return (
    <>
      <TopBar/>
      <div className="shell">
        <Rail route={route}/>
        <main
          className="shell__main"
          key={route.section + ':' + (route.tab || '')}
          data-screen-label={`${route.section}${route.tab ? ':' + route.tab : ''}`}>
          <div className="route-fade">
            {body}
          </div>
        </main>
      </div>
      <Footer/>
    </>
  );
}

export {
  App, SectionPage, Tabs, PageHead, Sub, Footer, Rail, TopBar, BrightbeamLogo,
  SECTIONS, setHash, parseHash, useScrollSpy,
};
