/* =========================================================================
   Brightbeam × Helsinn – Reusable components
   HeroReveal, PhaseArc, TaxonomyRadial, KARRCards, Skinny, Pullout,
   Cards, Stat, Timeline, KV, Glossary, TypeDivider
   ========================================================================= */

import React from 'react';
const { useState: ucS, useMemo: ucM, useEffect: ucE, useRef: ucR } = React;

/* =========================================================================
   HeroReveal – the 'electricity' reveal
   Animates each word in with a bouncy curve. The ember-glow word pulses.
   ========================================================================= */
function HeroReveal({ lines }){
  // lines = [{ text: 'AI must become', emberWords: [] }, ...]
  // Simpler: pass a flat list of words with meta.
  return (
    <h1 className="hero__reveal" aria-label={lines.map(w => w.text).join(' ')}>
      {lines.map((w, i) => {
        const cls = [
          'hero__word',
          w.ember ? 'is-ember' : '',
          w.glow ? 'is-ember-glow' : '',
        ].join(' ').trim();
        return (
          <React.Fragment key={i}>
            <span
              className={cls}
              style={{ animationDelay: (w.delay != null ? w.delay : (i * 90)) + 'ms' }}>
              {w.text}
            </span>
            {i < lines.length - 1 && ' '}
          </React.Fragment>
        );
      })}
    </h1>
  );
}

/* =========================================================================
   Skinny – "What's the skinny?"
   ========================================================================= */
function Skinny({ items }){
  return (
    <div className="skinny reveal">
      <p className="skinny__label">What's the skinny?</p>
      <ul className="skinny__list">
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

/* =========================================================================
   Pullout (type-as-callout)
   ========================================================================= */
function Pullout({ kicker, children }){
  return (
    <aside className="pullout reveal">
      {kicker && <p className="pullout__kicker">{kicker}</p>}
      <p className="pullout__text">{children}</p>
    </aside>
  );
}

function TypeDivider({ children }){
  return (
    <div className="type-divider reveal">
      <p className="type-divider__word">{children}</p>
    </div>
  );
}

/* =========================================================================
   Pullquote – a sentence lifted from surrounding prose as a typographic landmark
   ========================================================================= */
function Pullquote({ children }){
  return (
    <blockquote className="pullquote reveal">
      <p className="pullquote__text">{children}</p>
    </blockquote>
  );
}

/* =========================================================================
   Cards grid
   ========================================================================= */
function Cards({ items, cols = 3 }){
  return (
    <div className={`cards cards--${cols} reveal`}>
      {items.map((c, i) => (
        <div className="card" key={i}>
          {c.code && <span className="card__code">{c.code}</span>}
          <h3 className="card__title">{c.title}</h3>
          {c.body && <p className="card__body">{c.body}</p>}
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   Stats band
   ========================================================================= */
function Stats({ items }){
  return (
    <div className="stats reveal">
      {items.map((s, i) => (
        <div className="stat" key={i}>
          <div className="stat__fig">
            {s.fig}
            {s.unit && <span className="unit">{s.unit}</span>}
          </div>
          <div className="stat__cap">{s.cap}</div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   Key-value rows (Investment, BDP, etc.)
   ========================================================================= */
function KV({ rows, total }){
  return (
    <div className="kv reveal">
      {rows.map((r, i) => (
        <div className={`kv__row ${r.ember ? 'kv__row--ember' : ''}`} key={i}>
          <div className="kv__label">{r.label}</div>
          <div className="kv__val">{r.value}</div>
        </div>
      ))}
      {total && (
        <div className="kv__row kv__row--total">
          <div className="kv__label">{total.label}</div>
          <div className="kv__val">{total.value}</div>
        </div>
      )}
    </div>
  );
}

/* =========================================================================
   Timeline rows
   ========================================================================= */
function Timeline({ rows }){
  return (
    <div className="timeline reveal">
      {rows.map((r, i) => (
        <div className="timeline-row" key={i}>
          <div className="timeline-row__when">{r.when}</div>
          <div className="timeline-row__what">{r.what}</div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   Glossary
   ========================================================================= */
function Glossary({ items }){
  return (
    <div className="glossary reveal">
      {items.map((g, i) => (
        <div className="glossary__item" key={i}>
          <h4 className="glossary__term">{g.term}</h4>
          <p className="glossary__def">{g.def}</p>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   PhaseArc – interactive 3-phase timeline
   Used in Section 2 (business-case framing) and Section 5 (vision framing)
   with different narration wrapping the same interaction.
   ========================================================================= */
function PhaseArc({ phases, initial = 0 }){
  const [active, setActive] = ucS(initial);
  const cur = phases[active];
  // Progress fill: position of active dot along the spine
  // With 3 steps, dots sit at 1/6, 3/6, 5/6 of the track width
  const n = phases.length;
  const fillPct = ((active * 2 + 1) / (n * 2)) * 100;
  return (
    <div className="phase-arc reveal">
      <div className="phase-arc__spine" aria-hidden>
        <div className="phase-arc__spine-fill" style={{ width: fillPct + '%' }}/>
      </div>
      <div className="phase-arc__track">
        {phases.map((p, i) => (
          <button
            key={i}
            className={`phase-node ${i === active ? 'is-active' : ''} ${i < active ? 'is-done' : ''}`}
            onClick={() => setActive(i)}
            aria-pressed={i === active}>
            <span className="phase-node__dot" aria-hidden/>
            {p.when && p.when !== '\n' && (
              <span className="phase-node__num">Phase {String(i + 1).padStart(2,'0')} · {p.when}</span>
            )}
            <span className="phase-node__title">{p.title}</span>
            <span className="phase-node__blurb">{p.short}</span>
          </button>
        ))}
      </div>
      <div className="phase-arc__panel" key={active}>
        <h3>{cur.long}</h3>
        <p>{cur.body}</p>
        {cur.tags && (
          <div className="phase-arc__tags">
            {cur.tags.map((t, i) => <span key={i} className="phase-arc__tag">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   KARRCards – reveal cards for the Knowledge-at-Risk Register (Beat 7)
   Role-only attribution. Bouncy expand/collapse. One at a time.
   ========================================================================= */
function KARRCards({ roles }){
  const [open, setOpen] = ucS(0); // single-open index or -1
  return (
    <div className="karr reveal">
      {roles.map((r, i) => (
        <button
          key={i}
          className={`karr-card ${open === i ? 'is-open' : ''}`}
          onClick={() => setOpen(open === i ? -1 : i)}
          aria-expanded={open === i}>
          <div className="karr-card__head">
            <div>
              <h3 className="karr-card__role">{r.role}</h3>
              <p className="karr-card__scope">{r.scope}</p>
            </div>
            <span className="karr-card__plus" aria-hidden>+</span>
          </div>
          <div className="karr-card__body">
            <div className="karr-card__body-inner">
              {r.fields.map((f, j) => (
                <div className="karr-card__field" key={j}>
                  <span className="karr-card__field-label">{f.label}</span>
                  {f.value}
                </div>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* =========================================================================
   TaxonomyRadial – 12-category Unified Taxonomy of Knowledge
   Tacit categories = Ember Red (outer ring sense)
   Explicit categories = Amber Orange
   Meta-knowledge = mid-gray
   ========================================================================= */
function TaxonomyRadial({ data }){
  // data = { categories: [{ label, short, type: 'tacit'|'explicit'|'meta',
  //          example, bearing }] }
  const [active, setActive] = ucS(null);

  const size = 520;
  const cx = size / 2, cy = size / 2;
  const rIn = 90;       // inner ring radius
  const rOut = 230;     // outer ring radius

  const cats = data.categories;
  const n = cats.length; // 12
  const sweep = 360 / n;

  const polar = (r, deg) => {
    const a = (deg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arcPath = (riIn, riOut, sDeg, eDeg) => {
    const [x1, y1] = polar(riOut, sDeg);
    const [x2, y2] = polar(riOut, eDeg);
    const [x3, y3] = polar(riIn, eDeg);
    const [x4, y4] = polar(riIn, sDeg);
    const large = eDeg - sDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${riOut} ${riOut} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${riIn} ${riIn} 0 ${large} 0 ${x4} ${y4} Z`;
  };
  const labelPos = (riIn, riOut, sDeg, eDeg) => {
    const mid = (sDeg + eDeg) / 2;
    const rMid = (riIn + riOut) / 2;
    return [...polar(rMid, mid), mid];
  };

  const color = (type) => {
    if (type === 'tacit')    return '#EA4700';
    if (type === 'explicit') return '#FF9900';
    return '#7a7a7a'; // meta
  };
  const colorLight = (type) => {
    if (type === 'tacit')    return '#FFB894';
    if (type === 'explicit') return '#FFE0B3';
    return '#c8c8c8';
  };

  const slices = cats.map((c, i) => {
    const startDeg = i * sweep;
    const endDeg = (i + 1) * sweep;
    return { ...c, i, startDeg, endDeg };
  });

  const cur = active != null ? slices[active] : null;

  return (
    <div className="taxonomy">
      <div className="taxonomy__diagram">
        <svg viewBox={`0 0 ${size} ${size}`} aria-label="Unified Taxonomy of Knowledge - 12 categories">
          {slices.map(s => {
            const [lx, ly, mid] = labelPos(rIn, rOut, s.startDeg, s.endDeg);
            const isActive = active === s.i;
            const isDim = active != null && !isActive;
            // Rotate label so it reads along the radius
            const rotate = (mid > 90 && mid < 270) ? mid + 180 : mid;
            return (
              <g key={s.i}>
                <path
                  d={arcPath(rIn, rOut, s.startDeg, s.endDeg)}
                  fill={isActive ? color(s.type) : colorLight(s.type)}
                  stroke="#fff" strokeWidth="2"
                  className={`taxo-slice ${isActive ? 'is-active' : ''} ${isDim ? 'is-dim' : ''}`}
                  onMouseEnter={() => setActive(s.i)}
                  onClick={() => setActive(s.i)}
                />
                <text x={lx} y={ly}
                  transform={`rotate(${rotate - 90}, ${lx}, ${ly})`}
                  className="taxo-label"
                  style={{ fill: isActive ? '#fff' : '#2a2a2a', fontSize: 11 }}>
                  {s.short}
                </text>
              </g>
            );
          })}
          {/* Core */}
          <circle cx={cx} cy={cy} r={rIn - 6} className="taxo-center"
            onMouseEnter={() => setActive(null)} onClick={() => setActive(null)} />
          <text x={cx} y={cy - 10} className="taxo-center-text" style={{ fontSize: 11 }}>UNIFIED</text>
          <text x={cx} y={cy + 6} className="taxo-center-text" style={{ fontSize: 13, fontWeight: 900 }}>TAXONOMY</text>
          <text x={cx} y={cy + 22} className="taxo-center-text" style={{ fontSize: 11 }}>OF KNOWLEDGE</text>
        </svg>

        <div className="taxonomy__legend">
          <div className="taxonomy__legend-item">
            <span className="taxonomy__legend-dot" style={{ background: '#EA4700' }}/>
            <span>Tacit knowledge</span>
          </div>
          <div className="taxonomy__legend-item">
            <span className="taxonomy__legend-dot" style={{ background: '#FF9900' }}/>
            <span>Explicit knowledge</span>
          </div>
          <div className="taxonomy__legend-item">
            <span className="taxonomy__legend-dot" style={{ background: '#7a7a7a' }}/>
            <span>Meta-knowledge</span>
          </div>
        </div>
      </div>

      <div className="taxonomy__detail">
        {!cur ? (
          <>
            <div className="taxonomy__detail-eyebrow">Unified Taxonomy · overview</div>
            <h3 className="taxonomy__detail-title">Twelve categories. Three types. One spine for what Helsinn knows.</h3>
            <div className="taxonomy__detail-meta">
              <div>
                <div className="taxonomy__detail-meta-label">Tacit</div>
                <div className="taxonomy__detail-meta-value">{cats.filter(c=>c.type==='tacit').length} categories</div>
              </div>
              <div>
                <div className="taxonomy__detail-meta-label">Explicit</div>
                <div className="taxonomy__detail-meta-value">{cats.filter(c=>c.type==='explicit').length} categories</div>
              </div>
              <div>
                <div className="taxonomy__detail-meta-label">Meta</div>
                <div className="taxonomy__detail-meta-value">{cats.filter(c=>c.type==='meta').length} categories</div>
              </div>
            </div>
            <p className="taxonomy__detail-body">
              Hover or tap a category to see what it contains, whether it's tacit or explicit, and how Phase 1 scopes work against it. The taxonomy decides which capture technique we use against each Alpha candidate, and it's the reason CTA sits at the centre of the Brightbeam approach.
            </p>
          </>
        ) : (
          <>
            <div className="taxonomy__detail-eyebrow">
              {cur.type === 'tacit' ? 'Tacit knowledge' : cur.type === 'explicit' ? 'Explicit knowledge' : 'Meta-knowledge'} · {String(cur.i + 1).padStart(2,'0')} of 12
            </div>
            <h3 className="taxonomy__detail-title">{cur.label}</h3>
            <div className="taxonomy__detail-meta">
              <div>
                <div className="taxonomy__detail-meta-label">Type</div>
                <div className="taxonomy__detail-meta-value" style={{ color: color(cur.type) }}>
                  {cur.type.charAt(0).toUpperCase() + cur.type.slice(1)}
                </div>
              </div>
              <div>
                <div className="taxonomy__detail-meta-label">Capture technique</div>
                <div className="taxonomy__detail-meta-value">{cur.technique}</div>
              </div>
              <div>
                <div className="taxonomy__detail-meta-label">Phase 1 bearing</div>
                <div className="taxonomy__detail-meta-value">{cur.bearing}</div>
              </div>
            </div>
            <p className="taxonomy__detail-body"><strong>Example at Helsinn:</strong> {cur.example}</p>
            {cur.note && <p className="taxonomy__detail-body" style={{marginTop:12}}>{cur.note}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/* =========================================================================
   ProgrammeRow – shows a workstream as a wide card.
   Used in Section 3 Tab A.
   ========================================================================= */
function ProgrammeRows({ rows }){
  return (
    <div className="programme-rows reveal" style={{
      borderTop:'2px solid var(--ink)',
      borderBottom:'2px solid var(--ink)',
      margin:'24px 0',
    }}>
      {rows.map((r, i) => (
        <div key={i} style={{
          display:'grid',
          gridTemplateColumns:'220px 1fr auto',
          gap:'24px',
          padding:'28px 0',
          borderBottom: i < rows.length - 1 ? '1px solid var(--faint)' : 'none',
          alignItems:'start',
        }} className="programme-row">
          <div>
            <div style={{
              fontSize:'var(--fs-caps)', letterSpacing:'var(--ls-caps)',
              textTransform:'uppercase', color:'var(--ember)', fontWeight:700,
              marginBottom:10,
            }}>Workstream {String(i+1).padStart(2,'0')}</div>
            <h3 style={{
              fontSize:'clamp(22px, 2.2vw, 30px)', fontWeight:800,
              letterSpacing:'-0.6px', lineHeight:1.1,
              color:'var(--ink)', margin:0, maxWidth:'14ch',
            }}>{r.title}</h3>
          </div>
          <div>
            <p style={{ fontSize:16, lineHeight:1.6, color:'var(--ink-2)', margin:'0 0 10px', maxWidth:'60ch' }}>
              {r.body}
            </p>
            {r.tags && (
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:12 }}>
                {r.tags.map((t, j) => (
                  <span key={j} style={{
                    padding:'4px 10px', background:'var(--soft)',
                    border:'1px solid var(--faint)',
                    fontSize:11, letterSpacing:'var(--ls-caps-tight)',
                    textTransform:'uppercase', color:'var(--ink)', fontWeight:700,
                  }}>{t}</span>
                ))}
              </div>
            )}
          </div>
          <div style={{
            fontSize:12, letterSpacing:'var(--ls-caps)', textTransform:'uppercase',
            color:'var(--gray)', fontWeight:700, whiteSpace:'nowrap', paddingTop:4,
          }}>{r.when}</div>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   UseCaseCards – the four use cases (Beat 4), equal weight, click to expand
   ========================================================================= */
function UseCaseCards({ cases }){
  const [open, setOpen] = ucS(0);
  return (
    <div className="karr reveal" style={{ gridTemplateColumns:'1fr 1fr' }}>
      {cases.map((c, i) => (
        <button
          key={i}
          className={`karr-card ${open === i ? 'is-open' : ''}`}
          onClick={() => setOpen(open === i ? -1 : i)}
          aria-expanded={open === i}>
          <div className="karr-card__head">
            <div>
              <span style={{
                display:'inline-block',
                fontSize:'var(--fs-caps)', letterSpacing:'var(--ls-caps)',
                textTransform:'uppercase', color:'var(--ember)', fontWeight:700,
                marginBottom:8,
              }}>{c.code}{c.isAlpha ? ' · Alpha candidate' : ''}</span>
              <h3 className="karr-card__role">{c.title}</h3>
              <p className="karr-card__scope">{c.scope}</p>
            </div>
            <span className="karr-card__plus" aria-hidden>+</span>
          </div>
          <div className="karr-card__body">
            <div className="karr-card__body-inner">
              {c.fields.map((f, j) => (
                <div className="karr-card__field" key={j}>
                  <span className="karr-card__field-label">{f.label}</span>
                  {f.value}
                </div>
              ))}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

export {
  HeroReveal, Skinny, Pullout, TypeDivider, Pullquote,
  Cards, Stats, KV, Timeline, Glossary,
  PhaseArc, TaxonomyRadial, KARRCards, ProgrammeRows, UseCaseCards,
};
