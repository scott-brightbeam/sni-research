/* =========================================================================
   Brightbeam × Helsinn – section pages
   Exposes SecHome, SecContext, SecProposal, SecTacit, SecAIN, SecWhyBB
   ========================================================================= */

import React from 'react';
import { CONTENT } from './content.jsx';
import { SectionPage, PageHead, Sub, Tabs, setHash } from './shell.jsx';
import {
  HeroReveal, Pullquote, KV, Timeline, Glossary,
  PhaseArc, TaxonomyRadial,
} from './components.jsx';
const { useState: sS, useEffect: sE, useMemo: sM } = React;

/* ======================== HOME ======================== */
function SecHome(){
  // Hero words for the 'electricity' reveal.
  // Timing is hand-tuned: the two ember phrases arrive late, heavier, with a
  // beat before each – so the phrase lands with cadence, not a typewriter.
  const words = [
    { text: 'AI',            delay:   0 },
    { text: 'will',          delay:  80 },
    { text: 'become',        delay: 160 },
    { text: 'second',        delay: 540, ember: true },  // held-beat
    { text: 'nature,',       delay: 680, ember: true },
    { text: 'embedded',      delay: 1240 },
    { text: 'so',            delay: 1310 },
    { text: 'far',           delay: 1380 },
    { text: 'into',          delay: 1450 },
    { text: 'the',           delay: 1520 },
    { text: 'operating',     delay: 1590 },
    { text: 'model',         delay: 1660 },
    { text: 'that',          delay: 1730 },
    { text: 'its',           delay: 1800 },
    { text: 'presence',      delay: 1870 },
    { text: 'practically',   delay: 1940 },
    { text: 'disappears',    delay: 2010 },
    { text: '–',             delay: 2340, ember: true, glow: true },  // second beat
    { text: 'like',          delay: 2480, ember: true, glow: true },
    { text: 'electricity.',  delay: 2620, ember: true, glow: true },
  ];

  return (
    <div className="home" data-screen-label="01 Home">
      <section className="hero">
        <p className="hero__crumb">
          <span className="ember">Released</span> 23 April 2026
        </p>
        <HeroReveal lines={words}/>
        <p className="hero__lede">
          This is the <strong>Phase 1 Brightbeam proposal for Helsinn Birex</strong>. It is IDA-funded and non-GMP. Every page of the document is navigable and deep-linkable. Email Scott Wilkinson with all your remaining questions: <a href="mailto:scott.wilkinson@brightbeam.com">scott.wilkinson@brightbeam.com</a>.
        </p>
        <div className="hero__meta">
          <div className="hero__meta-item">
            <div className="hero__meta-label">Programme</div>
            <div className="hero__meta-val">Phase 1 · Foundations</div>
          </div>
          <div className="hero__meta-item">
            <div className="hero__meta-label">Grant vehicle</div>
            <div className="hero__meta-val">IDA · 50% intensity</div>
          </div>
          <div className="hero__meta-item">
            <div className="hero__meta-label">Duration</div>
            <div className="hero__meta-val">Six to nine months</div>
          </div>
          <div className="hero__meta-item">
            <div className="hero__meta-label">Workstreams</div>
            <div className="hero__meta-val">Roadmap · Builds · Embed</div>
          </div>
        </div>
      </section>

      <section className="home-exec reveal" style={{fontFamily:'Arial'}}>
        <p className="home-exec__eyebrow">§ Executive summary</p>
        <div className="home-exec__body">
          <p style={{fontWeight: 800, fontFamily: 'Arial'}}>Helsinn Birex is rewriting its three-to-five-year digital transformation strategy. The work of this proposed engagement is to put the intelligence layer inside that strategy.</p>
          <p>Not a parallel 'AI initiative' alongside it – AI will be integrated into the transformation itself, so that the next generation of Helsinn's operating model is continuously intelligent by design.</p>
          <p>To achieve this, Brightbeam proposes a 6-to-9-month Phase 1 engagement with three workstreams running in parallel.</p>
          <ul>
            <li style={{fontSize:'22px'}}>A strategy Roadmap workstream will deliver a defensible multi-year programme with the AI layer explicitly and tightly mapped.</li>
            <li style={{fontSize:'22px'}}>A coaching Embed workstream will train the Helsinn leadership and the operational teams to use AI natively in their daily work.</li>
            <li style={{fontSize:'22px'}}>A Builds workstream delivers at least two – and up to four – production-ready code bases drawn from a menu of candidate use cases developed during the Roadmap stream, with Helsinn deciding which are built.</li>
          </ul>
          <p>The Builds workstream in Phase 1 is non-GMP by design. This is a deliberate sequencing: we will amass evidence, credibility and a track record outside GMP first, so that the conversation with the quality team – and HPRA – starts from a position of demonstrated safety and rigour rather than faith and speculation.</p>
          <p>The BPCI playbook, which Brightbeam co-authors, opens the GMP pathway in Phase 2, with the aim of HPRA involvement already secured.</p>

          <h3 style={{fontFamily:'Arial', fontWeight:800, marginTop:'2.4em'}}>Why now?</h3>
          <p>Brightbeam is better positioned than most to understand that the sector's operating model is actively shifting. AI bolted onto the side of existing workflows is behind us. AI driving the architecture of the workflow itself is the direction of travel.</p>
          <p>And with good reason – the evidence from Gartner, BCG, HBR and Stanford's AI Index all points the same way. The digital intelligence winners are those rewriting the work, not simply augmenting the worker – and the window in which to compete is narrowing.</p>

          <h3 style={{fontFamily:'Arial', fontWeight:800, marginTop:'2.4em'}}>Why Brightbeam?</h3>
          <p>We are, without fear of contradiction, the leading builder and integrator of digital intelligence in Ireland's regulated industries. Our methodology is not only proven and battle-honed, it is grounded in peer-reviewed studies and published validity. We have considerable experience of the IDA application process and our Apple partnership provides architecture options most have yet to discover.</p>
          <p>We also have four comparable engagements currently in flight. Each is a regulated manufacturer larger than Helsinn. Each has embraced this programme. Each is shipping production outcomes. The delivery scaffolding which achieves this is fully explained in this document.</p>
          <p>And we have another 21 similar clients, many of whom are even further advanced.</p>

          <p>The commercial structure of this proposal is shaped around two IDA grant mechanisms: the Business Development Programme (BDP) and the Training Grant.</p>
          <p>The total engagement value is €800,000, with half of it being borne by Helsinn. Brightbeam will support a BDP application with a target grant of €300,000, leaving a net cost to Helsinn of €300,000. And a second grant application to the IDA Training Grant fund for another €100,000 in funding – with the total cost again being split 50-50.</p>
          <p>A small grant-application support fee of €10,000 is required outside the eligible consultancy work to cover the application scoping, writing and preparatory work.</p>
          <p>Helsinn now benefits from the compressed timelines and lower delivery cost that come from Brightbeam's reusable component library. In return, we ask that Helsinn agrees to sit inside our reference roster of named medtech clients.</p>

          <h3 style={{fontFamily:'Arial', fontWeight:800, marginTop:'2.4em'}}>Next steps</h3>
          <p>We would welcome a session with the Helsinn team to walk through the operating model, the use-case slate and the Phase 2 shape, and to agree a timeline for the application. Phase 1 begins on grant award.</p>

          <p>We look forward to working with your team.</p>
        </div>
      </section>

      <section className="home-cards reveal">
        <div className="home-cards__head">
          <p className="home-cards__label">The proposal, in four sections.</p>
        </div>
        <div className="home-cards__grid home-cards__grid--4">
          <HomeCard num="02" to="context" section="Context & Case"
            headline={<>What's our <span className="ember">starting</span> point?</>}
            desc="Where Helsinn Dublin is today and the business case for acting now."/>
          <HomeCard num="03" to="proposal" section="The proposal"
            headline={<>Three <span className="ember">workstreams</span>. The Phase 1 plan.</>}
            desc="Programme shape, commercials, governance. Three tabs, grant-shaped."/>
          <HomeCard num="04" to="tacit" section="Tacit knowledge"
            headline={<>The <span className="ember">twelve</span> categories of what Helsinn knows.</>}
            desc="The Unified Taxonomy. Why capture matters. The knowledge-at-risk register."/>
          <HomeCard num="05" to="aimn" section="Becoming AI-native"
            headline={<>Becoming AI-native: the <span className="ember">wider ambition</span>.</>}
            desc="The destination. The three-phase arc. What changes for Helsinn."/>
        </div>
      </section>
    </div>
  );
}

function HomeCard({ num, to, section, headline, desc }){
  return (
    <a className="home-card" href={'#' + to}
      onClick={(e)=>{
        e.preventDefault(); setHash(to); window.dispatchEvent(new HashChangeEvent('hashchange'));
        window.scrollTo({top:0,behavior:'instant'});
      }}>
      <span className="home-card__num"><span className="ember">§</span> {num}</span>
      <span className="home-card__section">{section}</span>
      <h3 className="home-card__headline">{headline}</h3>
      <span className="home-card__arrow" aria-hidden>→</span>
    </a>
  );
}

/* ======================== 02 CONTEXT & BUSINESS CASE ======================== */
function SecContext(){
  return (
    <SectionPage
      sectionId="context" sectionNum="02" sectionTitle="Context & Case"
      prevLink={{ id:'home', title:'Home' }}
      nextLink={{ id:'proposal', title:'The proposal' }}>

      <PageHead
        eyebrow="Context & Case"
        title={<>What's our <span className="ember">starting</span> point?</>}
        lede="Helsinn Birex Dublin is the group's principal finished-pharmaceuticals manufacturing site. With approximately 200 employees at Damastown, it coordinates the group supply chain across the API plant in Biasca and the Lugano head office."
      />

      <Sub id="starting-point" title="The situation today.">
        <p>The business operates inside a conservative quality culture that reflects the product set. Patient harm caused by quality failure in oncology support and rare-disease medicines is non-recoverable and comprehensively treated as such.</p>

        <p>Many of the group's infrastructure decisions have historically been made in Lugano. ERP (JD Edwards 9.2, mid-upgrade; full ERP enhancement scoped for 2026–2027) and data-server infrastructure sit there, creating a data-sovereignty consideration whenever the group contemplates systems that would send data into a cloud platform outside the group's control.</p>

        <p>MES selection is currently in flight. Implementation is targeted for 2027 and the outcome of that selection will shape the long-run manufacturing data layer.</p>

        <p>Dublin's known digital estate includes Microsoft 365, a Tableau footprint that is in use across all departments, a long-standing segmented P&amp;L system, 'Cognos', with a €22,000 annual licence that is dependent on an external consultancy and three siloed Excel-based budgeting workbooks for IT, engineering and maintenance.</p>

        <p>Much critical operational knowledge – maintenance, calibration, engineering change – lives in the heads of a small number of named individuals, two of whom have been flagged as single points of failure.</p>

        <p>This proposal, and the roadmap it will deliver, treats AI as the intelligence layer inside the digital transformation strategy.</p>
        <Pullquote>AI is not the programme. The programme is the transformation.</Pullquote>
        <p>Brightbeam's objective is to ensure that AI becomes a leading part of how Helsinn's transformation becomes durable.</p>

        <p>The 30 March onsite produced a shared view of where to start.</p>

        <p>Four use cases were prioritised in principle:</p>
        <ol className="uc-spine">
          <li className="uc-spine__row">
            <div className="uc-spine__code">UC-01</div>
            <div className="uc-spine__body">
              <h4 className="uc-spine__title">Business-assessment capability</h4>
              <p className="uc-spine__desc">A new-product and CMO business-assessment capability that the Helsinn team learns to build for themselves.</p>
            </div>
          </li>
          <li className="uc-spine__row">
            <div className="uc-spine__code">UC-02</div>
            <div className="uc-spine__body">
              <h4 className="uc-spine__title">Finance variance monitoring</h4>
              <p className="uc-spine__desc">A finance budget and variance-monitoring capability that consolidates Wade's three workbooks and puts real-time scenario modelling on top.</p>
            </div>
          </li>
          <li className="uc-spine__row">
            <div className="uc-spine__code">UC-03</div>
            <div className="uc-spine__body">
              <h4 className="uc-spine__title">Cognos replacement</h4>
              <p className="uc-spine__desc">Removes a €22,000 licence and a single-point-of-failure consultant dependency.</p>
            </div>
          </li>
          <li className="uc-spine__row">
            <div className="uc-spine__code">UC-04</div>
            <div className="uc-spine__body">
              <h4 className="uc-spine__title">Tacit-knowledge capture</h4>
              <p className="uc-spine__desc">Turns the most critical engineering and maintenance judgement into a permanent, shared, queryable asset.</p>
            </div>
          </li>
        </ol>

        <p>A Tableau overlay (UC-05) and a Metrics Fusion dashboard (UC-06) were agreed as near-term adjacents. CMO inventory intelligence (UC-07) was flagged as conditional on data quality. The GMP-facing ideas stay out of Phase 1 by design.</p>

        <p>In accordance with considerable experience elsewhere, we expect the Roadmap process to reveal many other possibilities and for the final prioritisation list to change.</p>

        <p>This proposal is for the plan of work that turns those final use cases into a delivered, grant-funded, production-ready vehicle, fully integrated with the ongoing digital transformation.</p>
      </Sub>

      <Sub id="business-case" title="The business case.">
        <p>Helsinn Dublin is not short of operational discipline. What it does need in greater abundance – in common with most pharmaceutical manufacturers of its generation – is the ability to turn existing data and operational expertise into continuous, shared intelligence. In short, it needs to become AI-native. And for that, AI must become second nature, embedded so far into the operating model that its presence practically disappears – like electricity or general computing.</p>

        <h3>The wider ambition: AI-native</h3>
        <p>This Phase 1 proposal will be the first step in a far greater trajectory. The destination is an AI-native Helsinn – an operation where the systems that run the site, the models that analyse the data and the people who exercise judgement, work as one integrated intelligence that compounds in capability year-on-year.</p>
        <p>'AI-native' describes something far more than a site that uses AI tools. It is an organisation whose decisions, data flows and all forms of knowledge have been restructured so that AI is inseparable from how the work actually gets done.</p>
        <p>The first generation of digital transformations bolted SaaS onto existing processes. The AI-native generation is currently redesigning the process around what human judgement and digital intelligence, working closely, can achieve together.</p>
        <p>Most analysts who have looked at the last eighteen months of enterprise AI reach the same conclusion.</p>
        <p>Organisations deploying generative AI at the edges of their workflows, without changing the operating model around them, have largely seen no measurable bottom-line effect.</p>
        <p>McKinsey's State of AI 2025 survey put the share of adopters with no measurable business impact at roughly four in five. MIT's Project NANDA study, published last autumn, put the no-impact figure sharper still at 95%.</p>
        <p>In contrast, BCG's review of AI in biopharma found the leading quartile of adopters several multiples ahead of the mid-tier on productivity gains, with the gap widening rather than closing. Last month Gartner, in its manufacturing outlook, described the next three years as the window in which that gap becomes structurally difficult to close.</p>
        <p>Many different studies. But the same ultimate conclusion. Deploying AI tools at the edge of the workflow produces thin results. Restructuring the operating model around AI produces material ones.</p>
        <p>However, this process of adoption and transformation must start somewhere. And small-scale success that can then be built out rapidly always outperforms multi-year, large-scale projects that risk failure before they have begun – because the technology will necessarily be outdated before it reaches production.</p>
        <p>Regulated pharmaceutical manufacturing is perhaps where this gap matters most, and where the work required to close it is most specific.</p>
        <p>Deviation histories, process validation records, maintenance logs, tacit operator know-how – this structured-plus-narrative data is what modern AI reads, reasons over and queries at scale better than any previous generation of analytics.</p>
        <p>Becoming AI-native is therefore no longer the ambition of the most forward-leaning sites. It is the trajectory every regulated manufacturer of Helsinn's generation is going to need to be on to remain competitive through the second half of this decade. For Helsinn Dublin, the arc we are proposing has three phases.</p>

        <h3>Phase 1: The current engagement</h3>
        <p>IDA-grant-funded work on four prioritised use cases in the non-GMP envelope, the education layer that transfers capability into the Helsinn team and the production of the evidence and artefacts that set up what follows. This is the phase the four use case business cases below sit in.</p>

        <h3>Phase 2: Digital transformation</h3>
        <p>The IDA's Digital Transformation Grant is designed to fund the shape of work that would follow Phase 1 – deeper, GMP-grade embedding of AI into the manufacturing, quality and supply chain functions, using the evidence and the skills Phase 1 produces as the case for investment. Comparable engagements sit at meaningfully larger scale and at higher grant intensity than Phase 1. The specific commercial shape will be confirmed as Phase 1 progresses and as the IDA engagement matures.</p>

        <h3>Phase 3: Embed at scale</h3>
        <p>The pattern established in Phase 2 can then be repeated across the remaining operational domains, the captured-judgement artefacts built in earlier phases are extended to cover the full site and the Helsinn team takes primary ownership of a continuously-learning intelligence layer.</p>

        <p>The specific prize in each phase is captured by its own business case. The wider objective – the reason the first use cases are a starting point rather than an endpoint – is the set of benefits that accrues along the way. Reclaimed senior capacity. Resilience to the loss of tacit expertise. Capability that compounds across every subsequent AI investment. A site that makes better decisions faster, with better evidence. IDA positioning that establishes the case for Phase 2 and Phase 3. The margin profile of a site running as a continuous intelligence rather than as a series of spreadsheets.</p>

        <p>Helsinn Dublin has the operational maturity, the IDA relationship and the ambition to move in this window. The four use cases costed and scoped below are the first proofpoints of that wider ambition.</p>

        <h3>The four initial use cases</h3>
        <p>The business cases for the current four prioritised use cases are concrete and bounded. Final values and expected rates of ROI will be delivered during Roadmap delivery.</p>

        <h3>One: Capability that compounds</h3>
        <p>UC-01 is an education-led engagement. The Helsinn team does not receive a finished AI application at the end of it – the Helsinn team learns to use off-the-shelf tools to best effect, understand the limits of those tools, what engineer-led AI builds can achieve – and how to best facilitate the transition from its current state to one of being AI-native.</p>
        <p>This skills transfer from Brightbeam to Helsinn is the cornerstone of all value that will be delivered. It is the essential ingredient that ensures not only momentum but velocity is embedded into the transformation. Every subsequent spend on AI will benefit from a site where the necessary skill sets are ubiquitous across the team. The gains from the entire programme will, by correct sequencing, be multiplied.</p>

        <h3>Two: Financial value via speed, quality and continuity</h3>
        <p>Wade carries three Excel budgets; Brendan evaluates CMO and new-product opportunities with weeks of manual cross-functional spreadsheet work; and Linda pre-builds Tableau dashboards for meetings. Engineers and maintenance teams carry tacit knowledge that, when lost, will be at best expensive to recover. And at worst will be irrecoverable.</p>
        <p>These costs are not an invoice line – they represent groups of talented people spending days on work that an AI model can do – and knowledge that can be democratised across the entire organisation. The developments to achieve these outcomes will only take weeks. And then the benefits will be felt forever moving forwards. When implemented, AI will deliver the required outcomes in seconds.</p>
        <p>And once seniors are freed up, with tacit knowledge liberated, continuity would be maintained and the team will have time for their abilities and judgement to add further quality, speed and direct financial value to the business. Helsinn Dublin will move faster, achieve more, and deliver compounding levels of quality. Margins can also be expected to increase.</p>
        <p>The business case for this is far from metaphorical, theoretical or ephemeral. The delta the programme creates will be measurable. Firstly, the organisational impact will be clear via existing metrics. Secondly, we track 'AI Added Value' (AI-AV) on a monthly basis. This measures the revenue and margin benefits, alongside the implied cost of delivering the additional capability and capacity without the use of AI – via human labour, external suppliers and other digital costs. All of which leads to a simple ROI calculation.</p>

        <h3>Three: Risk reduction</h3>
        <p>The single points of failure in engineering and maintenance represent a brittle dependency which could, in the worst case, lead to significant commercial impact. Even if the risk likelihood is judged as low, the potential of the impact is high. As this risk is currently open, full mitigation will add direct and measurable value.</p>
        <p>The digital intelligence will not replace people with tacit knowledge. AI will capture what they know so that it survives their next holiday, their next illness and their retirement. It will also increase the effectiveness of colleagues. All staff will have access to the very best information. Everyone will become a top performer.</p>
        <p>Cognos is also a live risk. Replacing the system with a modern AI-over-data-lake architecture removes the dependency and replaces a potentially brittle legacy system with one that Helsinn's own staff can query, extend and audit.</p>

        <h3>Four: Higher grant intensity unlocked</h3>
        <p>The IDA has a clear strategic direction for Ireland as an AI-native manufacturing base – the Adapt Intelligently 2025–2029 strategy names it explicitly. The BDP grant that supports this engagement is designed for exactly the shape of work in this proposal.</p>
        <p>The follow-on Digital Transformation Grant can then be expected to be available during Phase 2. All on the back of the evidence the Phase 1 grant-funded work produces – establishing the case for meaningfully larger investment at higher grant intensity.</p>
      </Sub>

    </SectionPage>
  );
}

/* ======================== 03 THE PROPOSAL (3 tabs) ======================== */
function SecProposal({ tab }){
  const tabs = [
    { id:'shape',       label:'The programme shape' },
    { id:'commercials', label:'The commercials' },
    { id:'detail',      label:'The detail' },
  ];
  const [value, setValue] = sS(tab || 'shape');
  sE(()=>{ if (tab) setValue(tab) }, [tab]);

  const onChangeTab = (t) => {
    setValue(t);
    setHash('proposal', t);
    window.scrollTo({top:0, behavior:'instant'});
  };

  let body = null;
  if (value === 'shape')             body = <ProposalShape/>;
  else if (value === 'commercials')  body = <ProposalCommercials/>;
  else                                body = <ProposalDetail/>;

  return (
    <SectionPage
      sectionId="proposal" sectionNum="03" sectionTitle="The proposal"
      prevLink={{ id:'context', title:'Context & business case' }}
      nextLink={{ id:'tacit', title:'Tacit knowledge' }}>
      {body}
    </SectionPage>
  );
}

function ProposalShape(){
  return (
    <>
      <PageHead
        eyebrow="The programme shape"
        title={<>Three <span className="ember">workstreams.</span><br/>And the Build candidates.</>}
        lede="The deliveries will run in parallel. The shape of each workstream is well-defined; the internal choices made inside each are how the final Roadmap adds its ultimate value."
      />
      <Sub id="streams" title="The three workstreams.">
        <h3>The Roadmap</h3>
        <p>This is the structural backbone of the engagement. It runs across the full delivery window.</p>
        <p>The outputs are:</p>
        <ol>
          <li>A multi-year AI roadmap explicitly mapped inside the digital transformation parent;</li>
          <li>An AI technology architecture blueprint, likely a mix of cloud and on-prem Apple Silicon, with air-gapped external-model access where appropriate;</li>
          <li>A prioritised use-case portfolio with business cases for each, drawn from and beyond the twelve candidates which are included below;</li>
          <li>A Digital Maturity Sustainability Assessment (DMSA) per the IDA's own suggested deliverable list;</li>
          <li>A change-management framework that names the people, rhythms and governance that make transformation stick; and</li>
          <li>A Phase 2 trajectory that sets up the Digital Transformation Grant application.</li>
        </ol>
        <p>The Roadmap is also the workstream that picks which use cases get built. Between two and four from the candidate set will be selected during the work, with Helsinn making the call against Brightbeam's assessment of data readiness, business-case strength, integration complexity and alignment with the site's operational priorities.</p>
        <p>Methodology for the Roadmap is the CTA-led approach described in Section 4.</p>
        <p>In practical terms, this is a four-phase shape over at least six months:</p>
        <ol>
          <li>Discovery and current-state mapping (Weeks 1–4);</li>
          <li>Future-state definition and use-case portfolio (Weeks 5–10);</li>
          <li>Strategy finalisation and build selection (Weeks 11–14);</li>
          <li>Build plus ongoing Roadmap governance and the Phase 2 grant runway preparation (Weeks 15+).</li>
        </ol>

        <h3>Embed coaching</h3>
        <p>The Embed workstream is the capability and skills workstream. It runs in parallel with the Roadmap from Week 2 onward.</p>
        <p>The outputs are:</p>
        <ol>
          <li>A site cohort fluent in applying off-the-shelf AI tools to their work at a task level;</li>
          <li>A leadership team fully conversant with what standalone AI apps cannot do, what needs to be built and why;</li>
          <li>Leadership and operational cohorts trained on the specific AI capabilities the Builds bring into the site;</li>
          <li>A curated internal prompt library and working-pattern playbook; and</li>
          <li>A set of named AI Champions inside the Helsinn operational teams who carry the capability forward.</li>
        </ol>
        <p>Structure is cohort-based: four three-hour training modules plus four sixty-minute coaching sessions per cohort, with each cohort building a capstone artefact against their own workflow.</p>
        <p>This is the same shape Brightbeam is using for multiple biopharma clients, as well as other clients including Ibec's 300-staff transformation and other IDA-backed client sites.</p>
        <p>Across all programmes, we see 87% of prior-programme participants adopting AI as a default method for daily tasks, 92% reporting confidence with complex AI tasks and 35% average productivity increases across all trained cohorts.</p>
        <p>Brightbeam cannot promise those numbers for Helsinn – it is what we expect to deliver and will aim even higher. We will measure Helsinn's outcomes against a baseline established in the first weeks of the engagement.</p>
        <p>UC-01 – the new-product and CMO business-assessment capability – lives inside Embed, not inside Alpha Builds.</p>

        <h3>AI Builds</h3>
        <p>The Builds workstream is the core capability-delivery workstream. We expect each one to be allocated between €75,000 – €150,000, depending on agreed scope and requirements.</p>
        <p>The Roadmap work will turn the final identified candidate set into the commissioned set. Helsinn can substitute, defer or replace any of the candidates in the set during Roadmap work.</p>
        <p>Each Build is a Discovery-to-Live execution: a scoped CTA-led design phase, a production-ready build against Helsinn's chosen data and infrastructure, user testing with named Helsinn staff, and handover with documentation, training and a Beta-to-Live trajectory.</p>
        <p>Brightbeam brings a reusable component library to this workstream. Components from comparable projects across our client base – accelerate delivery and reduce the per-build cost below what a bespoke-from-zero build would cost.</p>

        <h3>How the workstreams reinforce</h3>
        <p>The delivery package outlined above is not three separate consultancy streams stapled together. They are three facets of one engagement and each is designed to amplify the others.</p>
        <p>The Roadmap identifies the judgement points that matter most. The Embed training teaches Helsinn's people how to use AI against those same judgement points. The Builds deliver working AI capabilities against a subset of those judgement points.</p>
        <p>Every artefact the Roadmap produces – a DRT, a future-state map, a use-case business case – is reused in the Embed coaching and in the Alpha build design. Every working capability delivered by an Alpha becomes a training example in the Embed cohort. Every cohort-produced capstone from Embed feeds back into the use-case portfolio in the Roadmap.</p>
        <p>The engagement closes with all three workstreams aligned on the same small number of artefacts: a live Roadmap that Helsinn owns, an AI-literate cohort that uses it, and two to four production capabilities that prove it.</p>
      </Sub>

      <Sub id="usecases" title="The candidate set.">
        <p>Twelve candidates are presented here.</p>
        <p>The first five are the headline set: the candidates with the strongest business cases based on the 30 March conversation. The next seven are a supplementary set: candidates that surfaced in the meeting or from Brightbeam's work at comparable sites, presented in less detail, available for further consideration during the Roadmap.</p>
        <p>Alongside other use cases yet to be documented here.</p>

        <h3>The initial candidates</h3>

        <h4>UC-04: Tacit knowledge database</h4>
        <p><strong>What it is.</strong> A multi-stage capability that captures the critical engineering, maintenance and calibration knowledge currently living in a small number of named individuals' heads, and surfaces it as a queryable agent that technicians on shift can consult by voice or text.</p>
        <p>The capture layer uses CTA-led Critical Decision Method interviews with the named experts, plus structured data ingestion from maintenance records, calibration logs and manuals, plus shift handover recording and transcription. The accessible layer is a purpose-built agent accessible on the shop floor.</p>
        <p><strong>The benefits.</strong> Removes named single points of failure. Means any qualified technician can cover any line. Reduces downtime from knowledge gaps – the 'tube through the ceiling tile' failure mode, where an undocumented local adaptation caused a manufacturing area shutdown because no one on shift knew it was critical. Scalable to calibration, serialisation and contractor-covered workflows.</p>
        <p><strong>What Brightbeam brings.</strong> This is a capability Brightbeam has built before. The CTA methodology (Crandall, Klein, Hoffman lineage, 92–94% content validity across NRC, CIA and NASA applications) is one of the Brightbeam-operationalised primitives.</p>
        <p><strong>Risks and dependencies.</strong> Cooperation of the maintenance team is a prerequisite – this is a change-management question as much as a technical one. Buy-in for shift handover recording needs to be handled carefully, with explicit consent and a framing that positions the recording as protecting the technician, not monitoring them. Access to historical maintenance and calibration records is required; this is a tractable data-access question, not a blocker.</p>

        <h4>UC-03: Cognos replacement</h4>
        <p><strong>What it is.</strong> A modern AI-over-data-lake replacement for the current Cognos deployment. The application layer that finance staff currently interact with – segment P&amp;L generation, standard costing, the post-report Excel manipulation – is replaced with a conversational query interface. The standard-costing rule set is captured as structured logic and versioned. The data lake stores the historical Cognos reporting data and ingests new transactional data as it lands.</p>
        <p><strong>The benefits.</strong> Removes the external-consultant single-point-of-failure risk. Gives Wade and the finance team a modern, queryable, auditable reporting layer that does not require post-report Excel manipulation. Accelerates month-end by removing dependencies in the current cycle.</p>
        <p><strong>What Brightbeam brings.</strong> Architectural pattern from comparable builds; components available for reuse; a CTA-led scoping phase, in addition to full application analysis, to capture the standard-costing rule set rigorously before it is encoded.</p>
        <p><strong>Risks and dependencies.</strong> Scoping of the rule set is the key gate – the work cannot finish until that rule set is captured. Access to historical Cognos data is a prerequisite. Clarification of the rule-set complexity (planned in the first two weeks of the Roadmap) determines the build complexity which will ultimately impact the business case.</p>

        <h4>UC-05: Tableau Natural-Language overlay</h4>
        <p><strong>What it is.</strong> An AI overlay that sits on top of Helsinn's existing Tableau deployment via API integration. Staff can generate charts, drill into dashboards and ask natural-language questions during meetings without pre-building the visualisation in advance. Tableau stays; the change is additive, not replacive.</p>
        <p><strong>The benefits.</strong> Linda currently pre-builds dashboards for meetings and cannot drill further once the meeting begins. The overlay removes that constraint. Management meetings can interrogate the data as questions arise, not against a fixed set of views prepared the previous day. Sunk Tableau investment is preserved; change-management cost is low.</p>
        <p><strong>What Brightbeam brings.</strong> Pattern reuse from similar overlays. Tableau API integration is a known quantity.</p>
        <p><strong>Risks and dependencies.</strong> Depends on deployed Tableau version and on the granularity of the permissions layer – both are tractable scoping questions rather than blockers.</p>

        <h4>UC-06: Metrics fusion live dashboard</h4>
        <p><strong>What it is.</strong> A cross-departmental metrics dashboard that consolidates the measures currently fragmented across Helsinn's departmental Tableau workbooks, Excel sheets and operational reports into a single live view.</p>
        <p>Uses the same data-lake architecture as UC-03. Adds AI-driven anomaly surfacing so the dashboard does not just display, it notices.</p>
        <p><strong>The benefits.</strong> Resolving the aggregation inside the Brightbeam data architecture work unlocks both this dashboard and the Tableau Overlay. The business value is a cross-functional view of performance that is currently impossible to assemble in real time.</p>
        <p><strong>What Brightbeam brings.</strong> The data-lake work is shared with UC-03, meaning that if both are selected the marginal cost of the second is materially lower than a standalone build. Component reuse from a previous engagement is direct.</p>
        <p><strong>Risks and dependencies.</strong> Depends on the current-state Metrics Fusion effort and on the outcome of the data-aggregation question. If the existing internal effort is further along than assumed, the Brightbeam work is an acceleration rather than a fresh build, which lowers cost and risk.</p>

        <h4>UC-07: CMO inventory intelligence</h4>
        <p><strong>What it is.</strong> An inventory intelligence capability focused on the CMO side of Helsinn's supply chain. Surfaces expiry-date risk, movement anomalies and over-ordering patterns across external CMO partners. The Dublin-site stock is already near-optimal, so the value lives at the CMO API level.</p>
        <p><strong>The benefits.</strong> A comparable system saves millions of pounds annually for an NDA-protected Brightbeam client in a similar segment – the business case is tested, not hypothesised.</p>
        <p><strong>What Brightbeam brings.</strong> Direct component reuse. The architectural pattern is mature.</p>
        <p><strong>Risks and dependencies.</strong> The project is gated on data quality. It is not yet clear whether CMO-side expiry-date and movement data is consistently available and accurate.</p>

        <h3>Supplementary candidates</h3>
        <p>The seven supplementary candidates below are presented with even lighter specification. Each is available for the Roadmap to evaluate – alongside other candidates not yet documented.</p>
        <p><strong>Candidate F:</strong> Calibration Data Trending. AI-driven analysis of calibration drift and patterns across instruments. GxP-adjacent – likely Phase 2 rather than Phase 1, but included here as it is a natural bridge from the non-GMP Phase 1 into the GMP Phase 2 work. Ties to the tacit-knowledge build (calibration specialist dependency) and to the GMP pathway.</p>
        <p><strong>Candidate G:</strong> Contractor and Supplier Review. Analytical support for the annual contractor and supplier review cycle. AI handles the analytical and cost-benchmarking component; human judgement (value versus cost, relationship management) stays manual. This is not automation – it is amplification of the judgement that already happens.</p>
        <p><strong>Candidate H:</strong> Energy Monitoring. AI-driven energy usage analysis tied to operational and sustainability targets. Currently blocked on data availability; promoted to the candidate set because the underlying data problem may be tractable.</p>
        <p><strong>Candidate I:</strong> Serialisation Compliance Support. AI support for serialisation compliance reporting and anomaly detection. Non-GMP framing is achievable – the reporting layer is separable from the GMP manufacturing actions themselves. Component reuse from a similar build at another Irish-manufacturing client.</p>
        <p><strong>Candidate J:</strong> MES Data Integration. Framed as a 2027 activity because MES selection is in progress and implementation is targeted for 2027. Included as a candidate because the AI-readiness criteria for the MES selection should sit inside the Roadmap analysis from day one, and because a data-integration alpha is the natural first application of the MES once it goes live.</p>
        <p><strong>Candidate K:</strong> Document Intelligence and Regulatory Filing Support. AI-assisted drafting and review for regulatory filings, SOP revisions and technical documentation. Non-GMP components – the regulatory filing drafting and SOP review workflows – may be potential Phase 1 possibilities. GMP-facing components sit in Phase 2.</p>
        <p><strong>Candidate L:</strong> Quality Investigation Support (non-GMP bridge to Phase 2 GMP). A narrow, non-GMP-facing subset of quality-investigation support that models the tacit-knowledge approach for the quality team without entering GMP territory. Designed as a deliberate bridge to the Phase 2 GMP conversation – a safe, evidence-building first touch with the quality team before the BPCI playbook opens the GMP pathway.</p>

        <h3>How the roadmap selects</h3>
        <p>Roadmap selection will use four criteria: business-case strength, data readiness, integration complexity and alignment with the site's operational priorities. Each candidate is scored during Roadmap work. The top two to four are commissioned against the budget envelope, with Helsinn's leadership making the call against Brightbeam's assessment.</p>
      </Sub>

      <Sub id="alpha" title="Selecting the candidates.">
        <p>Roadmap selection will use four criteria: business-case strength, data readiness, integration complexity and alignment with the site's operational priorities. Each candidate is scored during Roadmap work. The top two to four are commissioned against the budget envelope, with Helsinn's leadership making the call against Brightbeam's assessment of data readiness, business-case strength, integration complexity and alignment with the site's operational priorities.</p>
        <p>Each Build is a Discovery-to-Live execution: a scoped CTA-led design phase, a production-ready build against Helsinn's chosen data and infrastructure, user testing with named Helsinn staff, and handover with documentation, training and a Beta-to-Live trajectory.</p>
      </Sub>

      <Sub id="gmp" title="Phase 2 and the GMP pathway.">
        <p>Phase 1 is non-GMP. But we will be well-prepared for Phase 2, with the pathway already being prepared. Brightbeam is co-authoring the BPCI playbook for 2026, which aims to deliver HPRA-signed guidance on a defined set of GMP AI use cases.</p>
        <p>When that playbook publishes, the Helsinn GMP AI conversation can start from authoritative guidance rather than from interpretation. The Phase 1 work in this proposal generates exactly the evidence base – the methodology, the governance, the track record – that makes that Phase 2 conversation as straightforward as possible.</p>
        <p>Three candidates in the supplementary set (Calibration Data Trending, Quality Investigation Support, and the GMP components of Document Intelligence) are the designed bridges from Phase 1 into Phase 2. Each is scoped non-GMP in Phase 1 by design; each extends naturally into the GMP space once the playbook opens the regulatory path.</p>
        <p>Phase 2 scope, timing and commercial shape are not part of this proposal. They are part of the follow-on conversation, supported by the Roadmap's trajectory. The expected vehicle is an IDA Digital Transformation Grant application.</p>
        <p>Appendix G sets the wider Phase 2 and Phase 3 arc out in more detail, covering the industry consensus, the regulatory environment and the benefits that accrue through each phase.</p>
      </Sub>
    </>
  );
}

function ProposalCommercials(){
  return (
    <>
      <PageHead
        eyebrow="The commercials"
        title={<>The <span className="ember">investment,</span> the grant, the timeline.</>}
        lede="The commercial shape sits inside two IDA grants. The BDP – up to 50% on eligible consultancy, capped at €300,000 per applicant across any rolling three-year period – funds the Roadmap and Build workstreams. A separate IDA Training Grant covers the Embed workstream."
      />
      <Sub id="investment" title="Investment numbers.">
        <p>The BDP is a consultancy grant issued under the Industrial Development Act 1993 (Section 8(c) as amended) and the De minimis aid regime (Commission Regulation (EU) 2023/2831).</p>
        <div className="figband reveal" aria-hidden>
          <div className="figband__fig">
            <p className="figband__n">€800<span className="figband__u">k</span></p>
            <p className="figband__l">programme</p>
          </div>
          <div className="figband__fig">
            <p className="figband__n">€400<span className="figband__u">k</span></p>
            <p className="figband__l">in grants</p>
          </div>
          <div className="figband__fig">
            <p className="figband__n">€400<span className="figband__u">k</span></p>
            <p className="figband__l">to Helsinn</p>
          </div>
          <div className="figband__fig">
            <p className="figband__n">50<span className="figband__u">%</span></p>
            <p className="figband__l">funded</p>
          </div>
        </div>
        <p>It funds up to 50% of eligible consultancy cost, capped at €300,000 per applicant across any rolling three-year period. The day-rate cap is €1,500/day, inclusive of travel and subsistence. The minimum engagement is 7 consultancy days; the maximum is 400. The grant is reimbursement-based, drawn down against delivered milestones.</p>
        <p>The proposed €300,000 IDA / €300,000 Helsinn split for the BDP follows other IDA applications and fits the BDP mechanics precisely. The 400-day envelope at €1,500/day produces exactly €600,000 of eligible consultancy across the Roadmap and Build workstreams; team composition fits inside 400 person-days; the 50% grant rate against that envelope produces the €300,000 BDP grant target. The Embed workstream is funded separately under the IDA Training Grant. Helsinn's De minimis position in Ireland is assumed clean relative to the BDP ceiling, which is to be confirmed during application preparation.</p>
        <p>The €10,000 bridge fee covers the grant-application work itself, across both the BDP and Training Grant submissions. That work is not eligible for either grant. The bridge fee is, in our experience, the break-even commercial reality of Brightbeam carrying the activities.</p>
        <p>Brightbeam's standard commercial terms apply: Brightbeam retains the right to IP re-use across the engagement; Helsinn receives the reduced cost and compressed timelines that come from Brightbeam's reusable component library. The IP-retention model is the engine of the reuse – it is what allows the per-build estimates to sit at €75,000 – €150,000 rather than at a from-zero bespoke build cost.</p>
        <p>Milestone draw-down shape aligns with Brightbeam's pattern on other IDA-backed engagements: the Roadmap milestones produce the bulk of the grant draw-down schedule, with Alpha Builds draw-downs tracking each alpha's Discovery-to-Alpha completion. A detailed milestone schedule is produced during the contract phase.</p>
        <p>There are three points Helsinn's finance team will want flagged.</p>
        <p>First, the BDP is reimbursement-in-arrears – Helsinn pays Brightbeam per the milestone schedule, and IDA reimburses Helsinn against submitted claims. Helsinn carries the working-capital exposure during the period between payment and reimbursement.</p>
        <p>Second, any Brightbeam work delivered before IDA approval is ineligible for grant reimbursement; any demo and concept work Brightbeam does for Helsinn ahead of contract is therefore absorbed as Brightbeam or Helsinn cost and is not part of this commercial envelope.</p>
        <p>Third, the De minimis position must be clean – Helsinn in Ireland cannot have received more than €300,000 in De minimis aid from any combined state source over the prior three fiscal years or the BDP grant would breach the ceiling. This is normally straightforward; we confirm it during application preparation.</p>
        <p>Here is the proposed breakdown of numbers. They can be lowered to suit Helsinn's desired target cost. These are the maximum the grant permits – and typical of other successful applications we have led:</p>
        <KV
          rows={[
            { label:'Workstream A – Roadmap',  value:'€250,000' },
            { label:'Workstream B – Embed',    value:'€200,000' },
            { label:'Workstream C – Build',    value:'€350,000' },
          ]}
          total={{ label:'Total engagement value', value:'€800,000' }}
        />
        <KV
          rows={[
            { label:'IDA BDP grant target',      value:'€300,000' },
            { label:'IDA Training Grant target', value:'€100,000' },
            { label:'Total grant target',        value:'€400,000' },
          ]}
          total={{ label:'Net cost to Helsinn', value:'€400,000' }}
        />
        <KV rows={[{ label:'Grant-application support work', value:'€10,000' }]}/>
      </Sub>

      <Sub id="bdp" title="IDA BDP application mapping.">
        <p>The BDP application is prepared and submitted by Helsinn, with Brightbeam's proposal attached as the description of the consultancy work. The shape follows the established pattern: Brightbeam provides the consultancy proposal; Helsinn's assigned IDA Project Executive reviews before submission; the application is signed off by Helsinn's authorising officer; IDA processes and approves; delivery begins only after approval.</p>
        <p>The application content blocks map to this engagement as follows.</p>
        <ul>
          <li>Section 1 of the form (company information) is Helsinn's entry.</li>
          <li>Section 2 (company profile) is Helsinn's entry.</li>
          <li>Section 3 (project overview and scope) is where revised versions of this proposal become the primary reference: the project title is the Helsinn Digital Transformation engagement with AI embedded; classification is Digital Transformation Project; project location is the Helsinn Dublin site; the project summary, breakdown of activities, internal team and expected outcomes are drawn directly from this proposal, including the DMSA, the transformation plan and the business-case documentation that the Roadmap workstream produces.</li>
          <li>Section 4 of the form (business development expenditure) is the commercial section of this proposal: named consulting firm is Brightbeam, day rate sits at or below the €1,500 cap, consultancy days sit at 400, total consultancy cost at €600,000, grant for consultancy at 50% to the €300,000 cap.</li>
          <li>Section 5 (trading and employment position) is Helsinn's entry and requires latest audited accounts (no more than two years old) to be with the assigned IDA Project Executive before the application lands. This is a Helsinn action and a checkpoint for the application preparation work.</li>
          <li>Section 6.A (Digital Transformation Project declarations) and Section 7 (company declarations, De minimis disclosure, DMSA commitment) are Helsinn's entries. The DMSA is on the IDA's own suggested-outcomes list and is part of the Roadmap deliverables in Section 5.1 of this proposal.</li>
          <li>Section 9 (beneficial ownership) is Helsinn's entry.</li>
        </ul>
        <p>Brightbeam's responsibility on the application side is the consultancy proposal (this outline document, updated, evolved and adapted for the application), the consultancy description in Section 3 and the Section 4 figures.</p>
        <p>Helsinn's Project Executive must be in the conversation before submission – applications not pre-discussed with the Project Executive may not be processed. Identifying Helsinn's Project Executive, if not already assigned, is the first operational checkpoint.</p>
      </Sub>

      <Sub id="timeline" title="Timeline.">
        <p>The engagement runs at least six months. The shape below is indicative; exact milestones are fixed during contract phase.</p>
        <Timeline rows={[
          { when:'Weeks 1–4',  what:<><strong>Mobilisation and discovery.</strong> Roadmap discovery (current-state mapping, CTA-led interviews, data-access confirmation). Embed baseline assessment and Cohort 1 enrolment. Build candidate-set confirmation and selection criteria agreed.</> },
          { when:'Weeks 5–10', what:<><strong>Future-state and alpha design.</strong> Roadmap future-state definition, use-case portfolio expansion, DMSA draft. Embed Cohort 1 delivery (four 3-hour modules, four 60-minute coaching sessions). Alpha 1 and Alpha 2 Discovery and design work; Alpha 1 build begins.</> },
          { when:'Weeks 11–14', what:<><strong>Strategy finalisation and alpha build.</strong> Roadmap strategy finalisation, alpha selection confirmed, Phase 2 trajectory drafted. Embed Cohort 1 capstone delivery, Cohort 2 enrolment. Alpha 1 and Alpha 2 build continues; Alpha 1 reaches beta-ready state.</> },
          { when:'Weeks 15+',  what:<><strong>Build and embed scale.</strong> Build 3 and (if commissioned) Build 4 Discovery and build. Embed Cohort 2 and Cohort 3 delivery. Roadmap ongoing governance, monthly steering meetings, IDA relationship management. Production readiness and handover preparation. All builds reach production-ready state. Embed final cohorts. Roadmap refines the Phase 2 trajectory, Digital Transformation Grant framing initiated.</> },
        ]}/>
      </Sub>

      <Sub id="assumptions" title="Assumptions, dependencies, exclusions.">
        <h3>Assumptions</h3>
        <ul>
          <li>Phase 1 is non-GMP across all scope; GMP-facing AI use cases are Phase 2 work.</li>
          <li>Helsinn's assigned IDA Project Executive is identifiable inside the first two weeks of application preparation.</li>
          <li>Helsinn's audited accounts (latest two years, P&amp;L and balance sheet) are available for the Project Executive.</li>
          <li>Helsinn's Irish group De minimis position over the prior three fiscal years is clean relative to the €300,000 ceiling. The BDP application lands at the 50% grant intensity and the €300,000 cap – the IDA assesses case-by-case; the application is written to the maximum intensity.</li>
        </ul>
        <h3>Dependencies</h3>
        <ul>
          <li>Access to Helsinn's current Tableau deployment, Cognos historical data, Excel budget workbooks, maintenance records and calibration logs as needed per build.</li>
          <li>Cooperation of the named experts identified in the Roadmap's CTA interview plan.</li>
          <li>Availability of the Helsinn workstream leads to the fortnightly working cadence.</li>
          <li>MES selection decision is a data-architecture input to the Roadmap but not a gate on the Phase 1 engagement.</li>
        </ul>
        <h3>Exclusions</h3>
        <ul>
          <li>AP invoice automation (RPA-style) is explicitly out of scope.</li>
          <li>Tableau replacement is out of scope – only the AI overlay is in scope.</li>
          <li>GMP-facing AI use cases are out of Phase 1 scope.</li>
        </ul>
      </Sub>
    </>
  );
}

function ProposalDetail(){
  return (
    <>
      <PageHead
        eyebrow="The detail"
        title={<>Governance, <span className="ember">risk,</span> and next steps.</>}
        lede="How the engagement runs week-to-week, how decisions get made, and the artefacts Phase 1 produces – including the BDP technical appendix."
      />
      <Sub id="governance" title="Governance, risk and change.">
        <h3>Governance</h3>
        <p>The engagement runs against a fortnightly working cadence and a monthly steering cadence. The working cadence is the Brightbeam delivery lead in conversation with the named Helsinn workstream leads. The steering cadence is a two-hour monthly review with Helsinn's executive, chaired jointly by Helsinn's Sponsor and Brightbeam's engagement partner, with the Roadmap artefact as the standing reference document.</p>
        <p>IDA engagement follows our current playbook: monthly calls with the IDA Project Executive, invitations to alpha demonstrations, interim strategy presentations shared with the Project Executive ahead of formal submissions. This is not incidental – the IDA relationship is key to the engagement's success.</p>
        <p>Decisions that modify the Roadmap, substitute an Alpha candidate, or change the commercial envelope are steering-committee decisions.</p>
        <p>Decisions within an agreed workstream are taken at the working level. Decisions that affect the BDP submission are escalated to Helsinn's authorising officer.</p>

        <h3>Risk</h3>
        <p>AI technologies in the LLM space are characterised by rapid evolution, emergent capabilities, and probabilistic outcomes that create significant uncertainty in traditional project planning approaches. Brightbeam recognises this and builds it into the engagement structure from the start.</p>
        <p>Four risk categories are tracked continuously.</p>
        <p><strong>Technical risk:</strong> The possibility that a chosen model, architecture or integration pattern does not produce the business outcome within the time budget. Mitigation: the CTA-led discovery work that precedes any Alpha build; the reusable component library that reduces novelty risk; the production-ready prototype definition that forces a build to be demonstrably working before Alpha exit.</p>
        <p><strong>Regulatory risk:</strong> The possibility that an AI output or AI-supported decision is challenged by HPRA, by Helsinn's quality team or by an auditor. <strong>Mitigation:</strong> Phase 1 is explicitly non-GMP; every output is human-reviewed; the BPCI playbook supplies the GMP-pathway cover in Phase 2.</p>
        <p><strong>Organisational risk:</strong> The possibility that the built capabilities do not land because the people who would use them are not ready. <strong>Mitigation:</strong> the Embed workstream, which is sized and shaped precisely to resolve this risk.</p>
        <p><strong>Financial risk:</strong> The possibility that the BDP grant is not approved, is approved at a reduced rate or is delayed. Mitigation: Brightbeam's established IDA relationship and application track record; the engagement is workable (at reduced pace) even if the grant is partial rather than full.</p>
        <p>A live risk register is maintained inside the engagement and reviewed at each steering meeting.</p>

        <h3>Change management</h3>
        <p>The Embed workstream is the engagement's core change-management engine. The training will create a focal point of adoption, create the required culture and establish AI governance as capabilities evolve.</p>
        <p>Three further change-management points sit outside it.</p>
        <p>A named AI Lead role at Helsinn is a Roadmap recommendation rather than a pre-condition – central ownership of the AI agenda is how most successful transformations stabilise, and the Roadmap builds the case for the role inside Helsinn rather than imposing it from outside.</p>
        <p>A Champions cohort drawn from the Embed programme is the internal mechanism that carries the capability forward after Brightbeam exits.</p>
        <p>A documentation discipline – every build produces documentation that a Helsinn-native team can maintain, in the format Helsinn's engineers already use – is the guard against the vendor-lock-in failure mode that commonly follows consultancy engagements.</p>
      </Sub>


      <Sub id="appa" title="BDP technical reference.">
        <p>This appendix summarises the BDP scheme mechanics that inform the proposal structure.</p>
        <p>The Business Development Programme (BDP) is an IDA Ireland consultancy grant issued under the Industrial Development Act 1993 (Section 8(c) as amended) and the De minimis aid regime (Commission Regulation (EU) 2023/2831 of 13 December 2023). The scheme pays up to 50% of eligible consultancy cost, capped at €300,000 per applicant across any rolling three-year period. Consultancy day rates are capped at €1,500/day inclusive of travel, subsistence and out-of-pocket expenses. Minimum project size is 7 consultancy days; maximum is 400. Projects are classified either as Digital Transformation Projects or Non-Digitalisation Projects; the Helsinn application is a Digital Transformation Project.</p>
        <p>The consultant must be listed on the IDA-supplied consultancy database. Brightbeam is on the list.</p>
        <p>The grant is reimbursement-based: milestones are delivered, claims are submitted, IDA reimburses. Project start date must post-date IDA approval; pre-approval expenditure is ineligible.</p>
        <p>Three application-preparation actions sit with Helsinn. The application must be discussed with Helsinn's assigned IDA Project Executive before submission. Latest audited accounts (no more than two years old) must be with the Project Executive before the application lands. De minimis aid received across all state-aid sources over the prior three fiscal years must be disclosed; false disclosure can trigger grant recovery.</p>
        <p>One further recovery trigger applies during delivery: the applicant must make 'a genuine effort to implement the consultant's recommendations'. The Roadmap workstream structure – with Helsinn-owned governance, documented decisions and a Phase 2 trajectory – is designed to satisfy this requirement comfortably.</p>
        <p>The Digital Transformation Grant is a distinct, larger scheme, positioned as the Phase 2 follow-on to a successful BDP engagement. It is not in scope for this proposal. The Phase 2 trajectory in the Roadmap positions the Digital Transformation Grant application with the evidence generated by the Phase 1 BDP work.</p>
      </Sub>

      <Sub id="close" title="Next steps.">
        <p>Two actions will move us forward.</p>
        <p><strong>1. Helsinn and Brightbeam align on the BDP application timeline.</strong></p>
        <p>The target is to have the application lodged with IDA inside 3–4 weeks of proposal acceptance. The first action inside that window is to confirm Helsinn's assigned IDA Project Executive and to introduce Brightbeam into that conversation.</p>
        <p><strong>2. The paperwork cadence.</strong></p>
        <p>Proposal acceptance triggers SOW drafting (inside one week), SOW signature (inside two weeks), BDP application preparation (in parallel across the first six weeks post-signature), BDP application submission (week six to eight), IDA review, and engagement kick-off on IDA approval.</p>
        <p>The Roadmap workstream is the earliest part of the engagement that can start, once IDA approval lands. Embed can start in parallel from Week 2. Alpha 1 Discovery starts at Week 5.</p>
      </Sub>
    </>
  );
}

/* ======================== 04 TACIT KNOWLEDGE ======================== */
function SecTacit(){
  return (
    <SectionPage
      sectionId="tacit" sectionNum="04" sectionTitle="Tacit knowledge"
      prevLink={{ id:'proposal', title:'The proposal' }}
      nextLink={{ id:'aimn', title:'Becoming AI-native' }}>
      <PageHead
        eyebrow="Tacit knowledge"
        title={<>The <span className="ember">twelve</span> categories of what Helsinn knows.</>}
        lede="Tacit knowledge is the expertise that is not written down. It is the difference between a site that runs well and one that almost runs well. Phase 1 treats it as an asset class with its own capture discipline."
      />

      <Sub id="why" title="The background of tacit knowledge.">
        <p>The working definition comes from Michael Polanyi's The Tacit Dimension (1966): 'We know more than we can tell'.</p>
        <p>Polanyi's argument, developed through a career in philosophy of science, is that human expertise is structured on two levels. A skilled performer attends from a background of subsidiary particulars to a focal task. The subsidiary particulars – the feel of the tool in the hand, the pattern of the instrument reading, the sense that something is not right – are known but not articulated.</p>
        <p>The focal task is articulated; the subsidiary is not. Articulation strips the subsidiary away and changes the performance.</p>
        <p>Three decades of later scholarship sharpened the definition. Collins (2010) distinguished three kinds of tacit knowledge: somatic (in the body, like riding a bicycle), relational (kept tacit by social relations, like the reasons you did not tell a colleague the whole story) and collective (embedded in social practice, like the culture of a particular plant). Blackler (1995) organised organisational knowledge into five forms: embodied, embraided, encultured, embedded and encoded – a framework widely used in knowledge-management research.</p>
        <p>Nonaka and Takeuchi (1995) formalised the four-mode SECI model of knowledge transfer: Socialisation, Externalisation, Combination, Internalisation. Each mode describes a distinct pathway between tacit and explicit knowledge. The point these scholars converge on is that tacit knowledge is not 'knowledge that happens not to be written down yet'. It is structurally distinct from explicit knowledge and cannot be transferred by the same mechanisms.</p>
        <p>Brightbeam's working synthesis of this literature – the Unified Taxonomy of Knowledge – divides knowledge into twelve categories: cognitive, physical/psychomotor, sensory/perceptual, affective/emotional, social/relational, cultural/organisational, contextual/environmental, narrative/experiential, documented/explicit, system/data, ethical/moral and meta-knowledge.</p>
        <p>Nine of the twelve sit partly or wholly on the tacit side of the continuum. Only documented/explicit and system/data sit decisively on the explicit side.</p>
        <p>The consequence matters for Helsinn. Transaction data – the data that lives in JD Edwards, in Tableau, in the maintenance record system, in the calibration logs – occupies exactly two of those twelve categories.</p>
        <p>The other ten are, by design, not in those systems. They live in the heads of Brian Nolan, Neil Ryan, Jason Roberts, the calibration contractor, the engineer on extended leave and in the site's shared cultural memory. No volume of transaction data will recover them.</p>

        <h3>Why tacit knowledge erodes</h3>
        <p>Tacit knowledge erodes along four pathways, and all four will be active at Helsinn Dublin.</p>
        <p>The first is retirement and departure. When a senior engineer leaves, the relational and contextual knowledge they hold leaves with them. The relational tacit knowledge – knowing who to call, who can be trusted with an ambiguous decision, who owes whom a favour – is invisible until the person who held it is gone. Helsinn has named examples: the engineer on extended sick leave, the calibration contractor whose contract is fragile, the retiring specialists who carry the original equipment-commissioning memory.</p>
        <p>The second is generational turnover inside the site. The people who joined Helsinn Dublin when the plant commissioned and who lived through the early process-tuning decades are, on average, closer to retirement than to mid-career. The procedural-narrative knowledge they hold – 'why do we do it this way and not the way the SOP literally says' – is the compression of years of problem-solving that the current written SOPs do not capture. When they leave, the next generation inherits the SOP, not the compression.</p>
        <p>The third is contractor dependency. Where a site depends on external specialists – the Cognos consultant, the calibration contractor – the tacit knowledge of the specialist does not accrue to the site. It accrues to the specialist. The site pays for access to it. When the commercial relationship ends, the knowledge ends with it. At Helsinn this is explicit: the calibration contractor is shared with two other companies and the contract could end; Mark, the Cognos consultant, is a named single point of failure for the standard-costing rule set.</p>
        <p>The fourth is digital change. When a site changes its ERP, its MES, or its core reporting stack, the people who understood the old system inherit an asset that is now orphaned. The procedural knowledge of how to read, adjust and trust the old system is valuable until the week the new system goes live. After that week, it is dead weight. Helsinn is about to go through this cycle twice: the JD Edwards 9.2 enhancement and the MES implementation.</p>
        <p>All four pathways are active at Helsinn today. Brightbeam has the method to solve each.</p>
      </Sub>

      <Sub id="taxonomy" title="The Unified Taxonomy of Knowledge.">
        <p>Twelve categories, organised by type. Hover or tap any slice to see what it contains, the capture technique Brightbeam runs against it, and its bearing on Phase 1 scope.</p>
        <TaxonomyRadial data={CONTENT.taxonomy}/>
        <p>Brightbeam's working synthesis of the literature – the Unified Taxonomy of Knowledge – divides knowledge into twelve categories: cognitive, physical/psychomotor, sensory/perceptual, affective/emotional, social/relational, cultural/organisational, contextual/environmental, narrative/experiential, documented/explicit, system/data, ethical/moral and meta-knowledge.</p>
        <p>Nine of the twelve sit partly or wholly on the tacit side of the continuum. Only documented/explicit and system/data sit decisively on the explicit side.</p>
      </Sub>

      <Sub id="method" title="About our capture method.">
        <p>Cognitive Task Analysis is a family of research methods developed over four decades in the Naturalistic Decision Making tradition (Klein, Crandall, Hoffman, Ross and colleagues; the canonical reference is Crandall, Klein and Hoffman, Working Minds: A Practitioner's Guide to Cognitive Task Analysis, MIT Press, 2006).</p>
        <p>Developed through fieldwork in nuclear operations, aviation, military command, clinical medicine and intelligence analysis – domains where expert performance matters enough to be studied in detail and where the cost of losing expertise is high – the published content-validity evidence sits at 92–94% across NRC, CIA and NASA applications.</p>
        <p>Brightbeam operationalises CTA for AI through three primitives. These are the primitives used on every UC-04-shaped engagement in the Brightbeam portfolio.</p>
        <p>The first is the Critical Decision Method (CDM), the core CTA interview protocol developed at Klein Associates. A CDM interview walks a named expert through a specific past incident in reverse and then forward in progressively finer passes – identifying the cues the expert attended to, the options considered, the options rejected, the mental simulations run and the knowledge drawn on at each decision point. CDM is deliberately retrospective because retrospective accounts make tacit knowledge available to reflection in a way that generic questions do not. It is also deliberately incident-anchored because the cognitive basis of expert judgement is most visible when the situation is non-routine.</p>
        <p>The second is the Decision Requirements Table (DRT). A DRT is a structured artefact that sits between the CDM interviews and the AI build. Each row captures a specific decision the expert makes; each column captures the cues they use, the cognitive challenges they face, the knowledge categories they draw on and the decision strategies that separate expert performance from novice performance. The DRT is the primary handover artefact from elicitation to design. It is the document the AI build team works against; it is also the document the quality team can read, challenge and sign.</p>
        <p>The third is the knowledge category map. For each decision captured in the DRT, the methodology tags which of the twelve taxonomy categories the decision draws on. This makes two things visible. One: which categories are heavily relied on and therefore critical to protect. Two: which categories are absent from the transactional data the site already has and therefore require deliberate capture. The map is the diagnostic that guides which capture modalities are needed – structured interview, shift-handover recording, shop-floor observation, artefact analysis, or some combination.</p>
        <p>The agent layer that sits on top of the captured knowledge is a secondary technical primitive. It is an important primitive – the site needs a tool it can use, not a binder of interview transcripts – but the durable value is in the captured artefacts, not in any particular model or interface. Models change. DRTs, once captured, are stable documents that can be redeployed against whatever model is current when the next upgrade cycle lands.</p>

        <h3>Why this is defensible</h3>
        <p>A generic 'interview the senior engineers and see what comes out' approach fails in three specific ways that the CTA-led approach does not.</p>
        <p>First, it captures the wrong things. Unstructured interviews privilege what experts find easiest to articulate – high-level process descriptions, SOPs as they are written, recent frustrations. The subsidiary particulars Polanyi identified, the pattern-matching Klein documented and the sensory cues that Working Minds catalogues do not come out of unstructured conversation. They come out of CDM-style probing anchored on specific incidents.</p>
        <p>Second, it does not produce a reusable artefact. A binder of transcripts is not something a quality team can audit or a build team can work against. The DRT is structured, categorical and re-readable. It is the artefact that converts a conversation into an engineering input.</p>
        <p>Third, it has no defensible validity position. A quality team asked to accept an AI system built on unstructured interviews has nothing to point at. A quality team asked to accept an AI system built on CTA has a body of peer-reviewed research, a set of validation studies across NRC, CIA and NASA and a methodology that is taught at MIT, Ohio State and MITRE. This distinction is not cosmetic. It is the difference between an approach a conservative quality culture can sign and an approach it cannot.</p>

        <h3>What Helsinn receives from UC-04</h3>
        <p>Four categories of captured artefact, each reusable and each extending well beyond the single alpha.</p>
        <p>One, a set of DRTs for the named critical decisions in Helsinn's engineering, maintenance and calibration workflows. These are living documents; Helsinn owns them; they extend as new expert interviews are run in later phases.</p>
        <p>Two, a knowledge-category map for Helsinn's operational estate, showing which of the twelve taxonomy categories are concentrated in which people and which are absent from transactional data. This is the diagnostic that drives the knowledge-at-risk register and informs every subsequent capture engagement.</p>
        <p>Three, a working agent deployed against Helsinn's environment, callable from the shop floor, that lets any qualified technician consult captured engineering and maintenance judgement in plain language. This is the outcome the maintenance team will feel.</p>
        <p>Four, a methodology playbook adapted to Helsinn's site-specific conditions. The methodology is Brightbeam's, but the playbook is Helsinn's. When UC-04 extends from engineering and maintenance into calibration, serialisation or quality investigation, the playbook is the artefact the Helsinn team reaches for.</p>

        <h3>How this thesis connects to the wider engagement</h3>
        <p>The thesis does not live only inside UC-04. Three more of the twelve candidates in Section 6 are direct applications of the same approach:</p>
        <ul>
          <li>Calibration Data Trending bridges the methodology to GMP-adjacent calibration expertise;</li>
          <li>Contractor and Supplier Review extends it into the external-knowledge domain;</li>
          <li>Quality Investigation Support models the approach for the quality team as the deliberate Phase 2 bridge.</li>
          <li>The Roadmap workstream uses CTA as its discovery primitive;</li>
          <li>The Embed workstream teaches named Helsinn staff to run CTA-lite interviews themselves, so that the methodology does not exit the site when Brightbeam does.</li>
        </ul>
      </Sub>
    
      <Sub id="karr" title="Knowledge-at-risk register (indicative)." bodyClass="karr-v2">
        <p>This section is presented as an indicative Phase 1 deliverable. The full register is produced inside Roadmap discovery using the CTA-led knowledge-category map. The version below is the initial cut based on what the initial meeting and the Brightbeam intake captured.</p>

        <h3>Purpose and structure</h3>
        <p>The knowledge-at-risk register is a diagnostic artefact. It maps the individuals whose tacit knowledge is most consequential to Helsinn Dublin's operations against two axes: the position of that knowledge on the proximal-distal continuum (how tacit it is), and the knowledge categories it occupies (what kind of knowledge it is).</p>
        <p>Each entry carries a Phase 1 tractability rating – whether capture is inside the first engagement or deferred to Phase 2.</p>
        <p>The register is not an HR document. It does not record personal risk factors (health, intention to leave, retirement plans). It records operational risk: what would be lost to the site if this knowledge were not captured, regardless of who holds it today.</p>
        <p>Five individuals and one contractor role are included below. The final register will extend further. Each entry follows the same structure: who, what knowledge they hold, where that knowledge sits on the proximal-distal continuum, which of the twelve taxonomy categories it occupies, the operational consequence of loss, and the Phase 1 tractability.</p>

        <h3>Initial entries</h3>

        <h4>Colleague one – engineering</h4>
        <p><strong>Knowledge held.</strong> Named in the 30 March meeting as a single point of failure for engineering and maintenance judgement on specific lines. The knowledge is a combination of the site's original equipment configuration, the undocumented local adaptations that have accumulated over years of operation and the pattern-matching that lets him diagnose an anomaly from a sound or a reading before the instrument flags it.</p>
        <p><strong>Position on the continuum.</strong> Proximal. The pattern-matching component is sensory/perceptual and strongly tacit. The configuration knowledge is partly explicit but lives alongside procedural assumptions that are not.</p>
        <p><strong>Taxonomy categories engaged.</strong> Primarily cognitive (pattern-matching expertise), sensory/perceptual, contextual/environmental (site-specific configuration memory) and narrative/experiential (case memory from past incidents). Documented/explicit plays a supporting role.</p>
        <p><strong>Operational consequence of loss.</strong> An undocumented configuration failure mode, manifesting during an equipment swap, a shift change or a line restart, produces downtime. The 30 March conversation surfaced the 'tube through the ceiling tile' story – an undocumented local adaptation that caused a manufacturing-area shutdown because no one on shift knew it was critical. That story is the type specimen.</p>
        <p><strong>Phase 1 tractability.</strong> High. UC-04 is designed around this profile. CDM interviews, DRTs for the named decision points and a shop-floor agent surface are all inside scope.</p>

        <h4>Colleague two – maintenance</h4>
        <p><strong>Knowledge held.</strong> Named in the 30 March meeting alongside colleague one. Maintenance-focused; strongly procedural and narrative. Carries the 'how we actually fix this when it breaks' knowledge that sits alongside the formally-documented maintenance schedule.</p>
        <p><strong>Position on the continuum.</strong> Proximal-to-middle. Procedural knowledge of maintenance routines is partly articulable; the heuristics that guide diagnosis when the routine does not apply are not.</p>
        <p><strong>Taxonomy categories engaged.</strong> Physical/psychomotor (hands-on maintenance skill), cognitive (diagnostic reasoning), narrative/experiential (case memory).</p>
        <p><strong>Operational consequence of loss.</strong> Slower recovery from unusual failures; heavier dependence on external vendors for repair decisions the site could historically make in-house; longer mean time to repair on the classes of failure Neil has seen before and the next technician has not.</p>
        <p><strong>Phase 1 tractability.</strong> High. Same shape as Colleague one. Shift-handover recording extends the capture surface if consent is obtained.</p>

        <h4>Colleague three – engineering</h4>
        <p><strong>Knowledge held.</strong> Named in the 30 March meeting. Engineering-specialism-specific. Carries design-intent memory for specific parts of the plant that are not documented at the level required for non-experts to intervene safely.</p>
        <p><strong>Position on the continuum.</strong> Proximal-to-middle. Design-intent reasoning sits between contextual and cognitive.</p>
        <p><strong>Taxonomy categories engaged.</strong> Cognitive, contextual/environmental, meta-knowledge (knowing which decisions require which inputs and who to consult).</p>
        <p><strong>Operational consequence of loss.</strong> Engineering-change decisions become slower, more expensive and externally dependent.</p>
        <p><strong>Phase 1 tractability.</strong> High. Capture is directly analogous to the first two entries.</p>

        <h4>Colleague four – the calibration contractor</h4>
        <p><strong>Knowledge held.</strong> Calibration expertise across serialisation-compliance regimes including Russia, Saudi Arabia and the US (levels 4–5 compliance per the 30 March meeting).</p>
        <p>The contractor is at Helsinn three days per week and shares one day per week each with two other companies. The commercial arrangement is fragile: if the contractor departs, Helsinn has stated the contract ends.</p>
        <p><strong>Position on the continuum.</strong> Proximal (serialisation judgement is heavily contextual and regulatory-interpretive) and distal in parts (compliance documentation is explicit).</p>
        <p><strong>Taxonomy categories engaged.</strong> Cognitive, contextual/environmental, cultural/organisational (regulatory-regime-specific norms), ethical/moral (compliance judgement), meta-knowledge. Documented/explicit carries the compliance documentation itself.</p>
        <p><strong>Operational consequence of loss.</strong> Serialisation compliance is a go/no-go constraint for Helsinn's export markets. Loss of this contractor without prior knowledge capture is a material risk to the export pipeline.</p>
        <p><strong>Phase 1 tractability.</strong> Conditional. UC-04 methodology applies directly, but a contractor-side engagement requires contractual cooperation. The Roadmap work in Weeks 1–4 should confirm whether the contractor's engagement can be extended to cover CDM sessions, or whether a surrogate capture route (structured shadowing, artefact analysis, interview with Helsinn staff who interact with the contractor) is needed. If cooperation is feasible, this is a high-priority Phase 1 target.</p>

        <h4>Colleague five – engineer on extended sick leave</h4>
        <p><strong>Knowledge held.</strong> Named in the 30 March meeting. Cross-training is underway but not complete. The risk window is the duration of the leave; the capture window is narrower because direct interview access depends on the individual's willingness and health.</p>
        <p><strong>Position on the continuum.</strong> Middle. Specific content unknown until capture begins.</p>
        <p><strong>Taxonomy categories engaged.</strong> To be mapped during capture.</p>
        <p><strong>Operational consequence of loss.</strong> Considered a live concern.</p>
        <p><strong>Phase 1 tractability.</strong> Medium. Direct CDM is conditional on the engineer's availability and willingness. Surrogate capture via shift handovers and interviews with cross-training recipients is available as a fallback. The Roadmap should confirm the preferred approach in Weeks 1–2 in consultation with Brendan.</p>

        <h4>Colleague six – Cognos consultant</h4>
        <p><strong>Knowledge held.</strong> The Cognos standard-costing rule set, and the informal interpretive decisions that have been made across it over years of operation. Named in the 30 March meeting as the single point of failure for the Cognos work.</p>
        <p><strong>Position on the continuum.</strong> Middle-to-distal. The rule set itself is explicit (codified in Cognos); the interpretive history is not.</p>
        <p><strong>Taxonomy categories engaged.</strong> Documented/explicit (the rule set), system/data (the Cognos-embedded logic), cognitive (interpretive reasoning), narrative/experiential (the history of why each rule is the way it is).</p>
        <p><strong>Operational consequence of loss.</strong> Loss without prior capture means loss of rule-set interpretive context. Migration to a modern AI-over-data-lake architecture in UC-03 requires the interpretive context to be captured, not just the rules.</p>
        <p><strong>Phase 1 tractability.</strong> High and urgent. UC-03 cannot fully execute without this capture. The Roadmap discovery for Candidate A scopes the rule set in the first two weeks; CDM-style interview with Mark is the capture vehicle; the DRT produced becomes the specification for the new system.</p>
      </Sub>

      </SectionPage>
  );
}

/* ======================== 05 BECOMING AI-NATIVE ======================== */
function SecAIN(){
  return (
    <SectionPage
      sectionId="aimn" sectionNum="05" sectionTitle="Becoming AI-native"
      prevLink={{ id:'tacit', title:'Tacit knowledge' }}>
      <PageHead
        eyebrow="§ 05 · Becoming AI-native · Appendix E"
        title={<>Becoming AI-native: the <span className="ember">wider ambition</span>.</>}
        lede="This section makes the case for the underlying purpose of the engagement."
      />

      <Sub id="destination" title="What AI-native means in our vocabulary.">
        <p>An AI-native operation is one in which digital intelligence is not an adjacent capability that sits alongside the operating model, but a constitutive element of how the operating model works. In an AI-native manufacturing site, operational data is continuously ingested and interpreted; operators and managers hold conversations with the site itself rather than with a stack of dashboards; deviations are understood in context before they become problems; tacit knowledge is captured as it is used rather than lost at retirement; and the site improves batch on batch, shift on shift, decision on decision, because every human action and every machine event is feeding a layer of intelligence that learns.</p>
        <p>Brightbeam calls the end state of this arc a 'seemingly-sentient facility'. You walk the floor, you ask the facility itself what its GMP status is, what is trending out of tolerance, what is at risk on tomorrow's schedule, what ought to be optimised this week – and the facility answers, because the intelligence that knows those things has been embedded in the workflows that generate them. This is not a product Brightbeam sells. It is the direction of travel for every serious manufacturer in a regulated industry, and Brightbeam is the services partner that walks that arc with the client.</p>
        <p>Thus, AI-native organisations are those that have rearchitected how they build and run work, with digital intelligence deployed across the whole life cycle and humans acting as orchestrators of AI agents against re-designed workflows. Workflow redesign is emerging as the single strongest predictor of enterprise-level AI impact. According to McKinsey high-performing organisations are nearly three times more likely than others to have fundamentally redesigned individual workflows. The point is not that AI gets bolted onto the current way of working; the point is that the current way of working is rewritten around the presence of AI.</p>
        <p>The Brightbeam position is that, for a regulated manufacturer, this rewriting happens layer by layer, system by system and judgement point by judgement point.</p>
        <Pullquote>It does not happen as a big-bang replatforming.</Pullquote>
        <p>That is why the Phase 1 engagement is built the way it is – a roadmap that sees the whole arc, a build programme that validates the architecture a slice at a time and an embed programme that moves the AI-native operating model from the leadership team into the operational cohort as the capabilities arrive.</p>
      </Sub>

      <Sub id="survival" title="Why AI-native has become a survival question.">
        <p>The strong external consensus in mid 2026 is that the window for organisational AI adoption has already closed for followers and is now closing for fast-seconds. This is not a consensus from one school of thought – it is a consensus across the major strategy houses, the leading academic research programmes and the primary public-market analysts.</p>
        <p>McKinsey's State of AI 2025 finds that 88% of organisations now use AI in some form, but only 5.5% qualify as 'AI high performers' – organisations reporting more than 5% EBIT impact from their AI work. Eighty-one per cent of adopters report no meaningful bottom-line impact. The differentiator is not the technology, which is broadly available; it is whether the organisation has done the workflow redesign work that translates the technology into value. MIT's Project NANDA study of enterprise GenAI puts the same point harder: 95% of corporate GenAI pilots fail to produce measurable business return, despite $30–40 billion in cumulative enterprise spend. The reason is not that the technology does not work. The reason is that most organisations have bought the technology without doing the organisational work that makes it land.</p>
        <p>BCG's 2025 AI-impact research reports that AI leaders are growing revenues at roughly double the rate of AI laggards and delivering about 40% greater cost savings. Their analysis of where the value comes from is stark: 10% sits in the algorithms, 20% sits in the technology infrastructure and 70% sits in the people, the processes and the change management. The firms that pull ahead are the ones that invest five to one in people relative to technology. McKinsey's figures confirm the ratio: for every dollar invested in technology, the winners invest five dollars in people.</p>
        <p>Gartner's public forecast goes further on the penalty for standing still. By 2030, Gartner expects software companies that layer bolt-on AI over legacy applications, rather than redesigning for agentic execution, to face margin compression of up to 80%. That is an eighty-per-cent reduction in margin – not a 'slower growth' penalty but a structural destruction of profitability – for the organisations that treat AI as a feature rather than an architecture. Gartner's companion prediction is that by 2028 most enterprises will have stopped paying for assistive AI (the copilots and smart advisors of the current era) and will instead pay only for platforms that commit to workflow outcomes.</p>
        <p>Harvard Business Review's analysis frames the same question from the incumbent's side. Gen AI threatens the competitive moats of established companies in industries that have historically been difficult for new entrants to penetrate. The incumbents that survive, HBR argues, will be the ones that can protect and extend the moats that remain – strong brand, proprietary data assets, deep operational relationships and regulated-environment credibility – by building an AI layer that is native to their operating model, rather than allowing that moat to decay while a new-model competitor builds a better one around them. Stanford's 2025 AI Index notes that the gap between leaders and laggards is widening year on year, and widening faster in industries with high data volumes and high decision density – which is exactly the description of regulated pharmaceutical manufacturing.</p>
        <p>For a biopharma manufacturer, this has a specific edge. The CB Insights 2025 pharma AI-readiness index and the IMD 2025 Pharmaceutical Future Readiness Indicator both find that the top decile of pharmaceutical companies – Johnson &amp; Johnson, Roche, AstraZeneca, Eli Lilly – are now five times ahead of the broader industry in AI maturity and are extending that lead every quarter. Pharmaceutical Technology's 2026 outlook describes 2026 as the year pharma manufacturing moves from 'incremental technological pilots' to 'profound system-level change'. The year, in other words, in which the industry as a whole crosses the line from AI-aware to wanting to be AI-native.</p>
        <p>This is the landscape in which Helsinn is taking its decision. The decision is not whether to adopt AI – that question is settled across the industry and for the site itself. The decision is how quickly to move from AI-aware to AI-native, and how to do that in a way that preserves the quality culture Helsinn has spent decades building.</p>
      </Sub>

      <Sub id="regulation" title="The regulatory environment is aligning, not closing.">
        <p>A common reason for a regulated manufacturer to wait is the expectation that the regulator will constrain what AI is permitted to do before the organisation can deploy it. The opposite is happening. The FDA's January 2025 draft guidance on AI in drug and biological product development covers nonclinical, clinical, postmarketing and manufacturing use of AI, and sets out a risk-based credibility framework – context of use, model performance, life-cycle maintenance – that tells manufacturers exactly what evidence a regulator expects when AI is embedded in a quality decision. The EMA's Reflection Paper on AI in the medicinal product life cycle takes a similar posture for Europe.</p>
        <p>The implication is not that AI in GMP is permitted today by default – it is not. The implication is that the regulatory pathway is visible, the evidence standard is published and the manufacturers who build the evidence base first are the ones who will pass through that pathway first. The BPCI playbook that Brightbeam co-authors for 2026 is written against this regulatory backdrop. Phase 1 of the Helsinn engagement is deliberately non-GMP precisely so that the evidence base for Phase 2 GMP work is built cleanly, and so that the HPRA conversation in Phase 2 starts from demonstrated rigour rather than from speculation.</p>
        <p>The direction of travel is clear. The regulators are moving from a posture of 'what is AI and how should we control it?' to a posture of 'here is the evidence framework – produce it'. Manufacturers who wait for a settled regulatory answer before starting will not find themselves at the front of the queue; they will find themselves behind manufacturers who used the current window to accumulate the evidence the regulators will ask for.</p>
      </Sub>

      <Sub id="position" title="Our position.">
        <p>Brightbeam's own published position aligns cleanly with the external consensus.</p>
        <Pullquote>The cost of standing still is not static, it is compounding.</Pullquote>
        <p>Flywheels of digital intelligence, once started, widen any initial lead because every cycle improves what came before. Organisational fluency compounds on top of technical capability: a site that has become fluent in AI attracts the talent that knows how to make AI work, which accelerates the next cycle. The honest risk, which Brightbeam does not hide from clients, is that the standing-still organisation does not merely plateau – it slips backward in relative terms every month the leading edge moves on without it.</p>
        <p>The Brightbeam position, therefore, is that AI-native is now a survival condition for any regulated manufacturer.</p>
      </Sub>

      <Sub id="phase1" title="Phase 1: Starting the flywheel.">
        <p>Phase 1's current purpose – purely looked at on the tactical level – is to reclaim management capacity, remove named live risks, establish in-house AI capability and position the Phase 2 grant trajectory. But its purpose at the strategic level is far larger. Phase 1 is the act of starting the AI flywheel inside Helsinn – the first turn of the cycle that Brightbeam's canon describes as Focus, Build, Embed, with the optional Invent branch held in reserve.</p>
        <p>In flywheel terms, Phase 1 does three things:</p>
        <ol>
          <li>The Roadmap workstream is the first turn of strategy: it establishes the multi-year direction, identifies the real judgement bottlenecks in the operation, selects the highest-value first targets and writes the architecture that later turns of the flywheel will run on.</li>
          <li>The Builds workstream is the first turn of Build: it puts two to four production-ready AI capabilities on site within the twelve months, proving the approach on real data, real workflows and real users.</li>
          <li>The Embed workstream is the first turn of multiplying the impact of the two others: it moves a leadership cohort and an operational cohort from AI-curious to AI-fluent, through a combination of coaching, capstone artefacts and the UC-01 capability that the Helsinn team learns to build for itself.</li>
        </ol>
        <p>By the end of Phase 1, Helsinn will have started the AI flywheel. The organisation will have seen production AI work against its own data. A cohort of its own people will be competent in operating and extending the work. The roadmap that describes the next two to four years will be an artefact Helsinn owns, not an artefact Brightbeam has left on a shelf. The Phase 2 grant application will be drafted, costed and positioned against demonstrated evidence rather than against aspiration.</p>
        <p>The benefits that accrue in Phase 1 are not deferred benefits – they are operational ones. The tacit knowledge agent reduces the single-point-of-failure risk on the two engineering and maintenance individuals who have been flagged as irreplaceable. The Cognos replacement removes cost and the associated external-consultant single point of failure. The finance budget capability consolidates Wade's three workbooks and puts real-time scenario modelling on top of them. The business-assessment capability, delivered through UC-01 and owned by the Helsinn team, turns weeks of cross-functional spreadsheet work into hours.</p>
      </Sub>

      <Sub id="phase2" title="Phase 2: Scale and integration.">
        <p>Phase 2's vehicle is the IDA's Digital Transformation Grant (DTG) or its successor programme, structured for larger-scale, cross-function digitalisation work at the plant level, with higher grant intensity than the BDP. It is the appropriate vehicle for the integration work that Phase 2 requires.</p>
        <p>Phase 2's purpose is to move from 'AI capabilities on the site' to 'AI embedded across the site'. The architectural pattern – on-prem Apple Silicon, with air-gapped external model access where appropriate, and the Helsinn-owned data lake – is extended to the operational systems it was not yet touching in Phase 1. The CTA-led judgement-layer work expands out of the leadership tier and into the operational tier where the same decision patterns recur at higher volume. The MES selection lands inside the AI layer rather than outside it, which means the MES deployment and the AI capability build reinforce each other rather than compete for integration work.</p>
        <p>The concept that Brightbeam uses internally for this shape of Phase 2 work is CI-Ops – Continuous Intelligence Operations. The shape is a standing capability pod embedded in the Helsinn operation, with access to the reusable component library built up during Phase 1 and extended across comparable sites.</p>
        <p>The Phase 2 benefits stack on top of those from Phase 1.</p>
        <p>The tacit knowledge agent that captured two individuals' expertise in Phase 1 becomes a site-wide knowledge graph in Phase 2 – every operator, every calibration technician, every maintenance lead feeds it and queries it.</p>
        <p>The finance capability that consolidated Wade's workbooks in Phase 1 becomes a rolling cross-functional view that the site lead can query live during a management meeting. The MES data lands in the Helsinn data lake rather than in a group IT system elsewhere, which means the conversation Lugano has with Dublin about AI shifts from 'can we do this?' to 'we are doing this and here is the evidence'. The Cognos replacement from Phase 1 is absorbed into a unified reporting layer that serves the whole site, not just finance.</p>
        <p>The judgement layer becomes legible at this point. Helsinn's critical decisions – which batch to prioritise under supply-chain disruption, which CMO to onboard, which deviation signal to escalate, which calibration window to align to a production plan – are decisions Helsinn is already making. What Phase 2 does is capture the judgement that sits behind each of those decisions as a structured artefact and build AI that supports that judgement against live data. This is what Brightbeam means by the judgement layer of AI-native services for regulated industries. In Phase 2, the judgement layer becomes a concrete feature of how the Helsinn site operates.</p>
        <p>The benefits accrue in the specific dimensions the business cares about. Measurable business risk falls, because the single-point-of-failure patterns identified in Phase 1 are now systematically being remediated across the site rather than on the two initially identified. Quality of outputs rises, because the decisions feeding the quality system are informed by more data, more context and more captured judgement. Operational efficiency improves, because decisions are made against more and higher quality data points.</p>
      </Sub>

      <Sub id="phase3" title="Phase 3: embed at scale to become AI-native.">
        <p>Phase 3 is a mid 2027-and-beyond horizon. Its purpose is to cross the line from 'AI embedded across the site' to 'AI-native as a live operating model' – the 'seemingly-sentient facility'.</p>
        <PhaseArc phases={CONTENT.phases} initial={0}/>
      </Sub>

      <Sub id="benefits" title="Benefits that accrue along the way.">
        <p>The benefits of an AI-native trajectory are not back-loaded. This is the point that Phase 1 alone makes, and the point that the arc compounds. A deliberate reading of the external research and Brightbeam's own retrospective outcomes identifies eight benefit dimensions that accrue through the three phases. Every one of them shows up in Phase 1, deepens through Phase 2 and becomes structural by Phase 3.</p>
        <p><strong>Better for humans.</strong> The work that gets reclaimed is the work that people never wanted to do. AI-native operation does not mean humans do less. It means humans do more of the work that requires human judgement and less of the work that was only done by humans because there was no alternative.</p>
        <p><strong>Better for profits.</strong> The direct savings begin in Phase 1. The indirect benefits – faster month-end, tighter forecast accuracy, fewer deviations reaching the quality-event register, faster resolution of those that do – start landing in Phase 2. The margin uplift from predictive quality, energy optimisation and dynamic scheduling is Phase 3 territory.</p>
        <p><strong>Understanding causation.</strong> A pharmaceutical manufacturing operation is a system where small, upstream changes produce large, downstream consequences – in product quality, in deviation frequency, in yield, in cycle time. A site without an intelligence layer runs on correlation and on tribal pattern-matching. A site with one understands causation: a deviation signal in one line is traced through the process history to its root cause; a yield variance in one batch is linked to a raw-material lot or a calibration interval; a delay on a CMO line is attributed to the real upstream driver rather than to the most visible one. This capability begins with the tacit knowledge agent in Phase 1, widens in Phase 2 and becomes the operating condition in Phase 3.</p>
        <p><strong>Trending towards perfection.</strong> A site that improves a little every batch, reliably, is a different commercial entity from a site that swings between best-effort and unexpected deviation. The AI flywheel is what makes continuous improvement continuous – not a quarterly review cycle but a live feedback loop from the floor. The improvement is not dramatic in any single batch. It is relentless across many.</p>
        <p><strong>Instant access to everything.</strong> The sprawl of data and systems is an access problem. A site lead who has to wait two days for a cross-functional question is a site lead making decisions on stale evidence. Phase 1 starts to remove that latency. Phase 2 removes it structurally. Phase 3 makes the access pattern the default: you ask the facility, and the facility answers.</p>
        <p><strong>Spotting anomalies across domains.</strong> Most significant deviations in a regulated-industry operation are cross-domain: a quality signal that correlates with a maintenance event that correlates with a supplier change that correlates with an operator shift pattern. No single dashboard catches these because no single dashboard has a view across the domains. A Helsinn-owned intelligence layer does. The capability begins in Phase 2 and matures through Phase 3.</p>
        <p><strong>Streamlined audit trails.</strong> This is the regulated-industry-specific benefit. Every AI-supported decision carries a structured audit trail by design – the data consulted, the model invoked, the version, the human sign-off, the downstream action. The audit burden that currently falls on humans falls on the system. The audit experience – internally, and in HPRA and FDA inspections – moves from defensive to confident. The groundwork is laid in Phase 1 (the CTA artefacts themselves are audit-ready) and matures through Phase 2 and Phase 3.</p>
        <p><strong>Reducing energy costs.</strong> Manufacturing energy is one of the most responsive variables to intelligent scheduling and predictive load management. In a site where HVAC, clean-utility loads and line scheduling are jointly optimised by an intelligence layer, energy envelope reductions of 10–20% are the reported external range – consistent across Deloitte's smart-manufacturing research and BCG's biopharma investigations. This is a Phase 2 and Phase 3 benefit; it requires the cross-system data layer to be real before it becomes addressable.</p>
      </Sub>

    </SectionPage>
  );
}

/* ======================== 06 WHY BRIGHTBEAM ======================== */
function SecWhyBB(){
  return (
    <SectionPage
      sectionId="why" sectionNum="06" sectionTitle="Why Brightbeam"
      prevLink={{ id:'aimn', title:'Becoming AI-native' }}
      nextLink={{ id:'home', title:'Home' }}>
      <PageHead
        eyebrow="§ 06 · Why Brightbeam"
        title={<>Helsinn has the <span className="ember">right of selection</span> and the right of scrutiny.</>}
        lede="The Brightbeam answer sits on four lines of evidence."
      />

      <Sub id="opening" title="Four lines of evidence.">
        <p>Helsinn has the right of selection and the right of scrutiny. The Brightbeam answer sits on four lines of evidence.</p>
      </Sub>

      <Sub id="track" title="A delivery track record in the same shape of engagement.">
        <p>Brightbeam has IDA-backed engagements of the same shape live and complete. Each has shipped production outcomes; each has generated reusable components that may accelerate Helsinn's delivery. The clients are the reference roster Helsinn would enter on the back of this engagement.</p>
      </Sub>

      <Sub id="methodology" title="A methodology grounded in published validity.">
        <p>Cognitive Task Analysis is an established research discipline, not a Brightbeam invention. The 92–94% content validity figures across NRC, CIA and NASA applications are published in the academic literature and reviewed in Crandall, Klein and Hoffman's Working Minds. Brightbeam operationalises CTA for AI in complex, regulated industries; we do not claim ownership of the methodology. That matters to Helsinn's quality team. A methodology with published validity is a methodology that a conservative quality culture can defend internally.</p>
      </Sub>

      <Sub id="grant" title="Our grant experience.">
        <p>Brightbeam is on the IDA consultancy preferred list. Shane Owens (Head of Life Science and MedTech at IDA) leads Pharma/MedTech submissions. Brightbeam is also the author of the positioning playbook that turns a successful BDP engagement into a Phase 2 Digital Transformation Grant application. That playbook is the approach Brightbeam uses across its IDA-backed cohort.</p>
      </Sub>

      <Sub id="infra" title="Operational infrastructure match.">
        <p>The on-prem Apple Silicon architecture resolves Helsinn Dublin's data-sovereignty question relative to Lugano. Brightbeam's Apple partnership makes this straightforward. The engagement is not forced into a cloud conversation; nor is it forced into a technology choice that cannot be defended.</p>
      </Sub>

      <Sub id="close" title="The cumulative effect.">
        <p>The cumulative effect is an engagement that does not ask Helsinn to take a leap of faith on methodology, on delivery, on regulatory positioning or on infrastructure.</p>
      </Sub>

      <Sub id="glossary" title="Glossary.">
        <Glossary items={CONTENT.glossary}/>
      </Sub>
    </SectionPage>
  );
}

export {
  SecHome, SecContext, SecProposal, SecTacit, SecAIN, SecWhyBB,
};
