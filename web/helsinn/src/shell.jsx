/* =========================================================================
   Brightbeam × Helsinn proposal site – shell
   TopNav, router, SectionPage, Tabs, SideTOC, LiveCall mode, Search
   Exports: App, SectionPage, Tabs, PageHead, Sub, useScrollSpy, setHash
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

/* ---------- Site-wide primary nav ---------- */
const SECTIONS = [
  { id: 'home',      num: '01', short: 'Home',              title: 'Home' },
  { id: 'context',   num: '02', short: 'Context & Case',     title: 'Context & Case' },
  { id: 'proposal',  num: '03', short: 'The proposal',      title: 'The proposal' },
  { id: 'tacit',     num: '04', short: 'Tacit knowledge',   title: 'Tacit knowledge' },
  { id: 'aimn',      num: '05', short: 'Becoming AI-native',title: 'Becoming AI-native' },
];

/* ---------- Top Nav ---------- */
const PROPOSAL_SUBTABS = [
  { id:'shape',       label:'The programme shape' },
  { id:'commercials', label:'The commercials' },
  { id:'detail',      label:'The detail' },
];

function TopNav({ route, onLiveToggle, liveCall }){
  const onProposal = route.section === 'proposal';
  const activeTab = onProposal ? (route.tab || 'shape') : null;
  return (
    <header className="topnav">
      <div className="topnav__inner">
        <a className="topnav__brand" href="#home" onClick={(e)=>{e.preventDefault(); setHash('home'); window.dispatchEvent(new HashChangeEvent('hashchange'))}}>
          <img className="topnav__brand-logo" src="assets/brightbeam-logo.png" alt="Brightbeam" />
          <span className="topnav__brand-sub">× Helsinn · Phase 1</span>
        </a>
        <nav className="topnav__nav" aria-label="Primary">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={'#' + s.id}
              className={route.section === s.id ? 'is-active' : ''}
              onClick={(e)=>{
                e.preventDefault();
                setHash(s.id);
                window.dispatchEvent(new HashChangeEvent('hashchange'));
                window.scrollTo({ top:0, behavior:'instant' });
              }}>
              {s.short}
            </a>
          ))}
          <a
            className="topnav__contact"
            href="mailto:scott.wilkinson@brightbeam.com">
            Contact
          </a>
        </nav>
      </div>
      {onProposal && (
        <div className="topnav__subrow">
          <div className="topnav__subinner">
            <nav className="topnav__subnav" aria-label="Proposal sub-sections">
              {PROPOSAL_SUBTABS.map((t, i) => (
                <a
                  key={t.id}
                  href={`#proposal:${t.id}`}
                  className={'topnav__subnav-item ' + (activeTab === t.id ? 'is-active' : '')}
                  onClick={(e)=>{
                    e.preventDefault();
                    setHash('proposal', t.id);
                    window.dispatchEvent(new HashChangeEvent('hashchange'));
                    window.scrollTo({ top:0, behavior:'instant' });
                  }}>
                  <span className="topnav__subnav-label">{t.label}</span>
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </header>
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
function SectionPage({ sectionId, sectionTitle, sectionNum, anchors, children, nextLink, prevLink }){
  // Scroll spy for tertiary TOC
  const activeAnchor = useScrollSpy(anchors.map(a => a.id));

  return (
    <>
      <div className="section-page">
        <aside className="section-page__side" aria-label="Section navigation">
          <span className="side-marker">{sectionTitle}</span>
          <p className="side-toc__label">On this page</p>
          <ul className="side-toc__list">
            {anchors.map(a => (
              <li key={a.id}>
                <a
                  href={'#' + a.id}
                  className={`side-toc__link ${activeAnchor === a.id ? 'is-active' : ''}`}
                  onClick={(e)=>{
                    e.preventDefault();
                    const el = document.getElementById(a.id);
                    if (el){
                      el.scrollIntoView({ behavior:'smooth', block:'start' });
                    }
                  }}>
                  {a.label}
                </a>
              </li>
            ))}
          </ul>
        </aside>
        <main className="section-page__main">
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
        </main>
      </div>
    </>
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
      <TopNav route={route} liveCall={liveCall} onLiveToggle={()=>setLiveCall(v=>!v)}/>
      <div
        key={route.section + ':' + (route.tab || '')}
        className="route-fade"
        data-screen-label={`${route.section}${route.tab ? ':' + route.tab : ''}`}>
        {body}
      </div>
      <Footer/>
    </>
  );
}

export {
  App, SectionPage, Tabs, PageHead, Sub, Footer, TopNav,
  SECTIONS, setHash, parseHash, useScrollSpy,
};
