/* =========================================================================
   Brightbeam × Helsinn – content data (verbatim from source files)
   ========================================================================= */

export const CONTENT = {

  /* --- Phase-arc data (verbatim from 03-the-business-case.md) --- */
  phases: [
    {
      when: '\n',
      title: 'Phase 1 · Starting the flywheel',
      short: 'IDA-grant-funded work on four prioritised use cases in the non-GMP envelope.',
      long: 'Phase 1 – The current engagement.',
      body: 'IDA-grant-funded work on four prioritised use cases in the non-GMP envelope, the education layer that transfers capability into the Helsinn team and the production of the evidence and artefacts that set up what follows. This is the phase the four use case business cases sit in.',
      tags: ['BDP grant', 'Training Grant', 'Non-GMP', '4–8 months', 'Roadmap · Embed · Builds', '4 prioritised use cases'],
    },
    {
      when: '\n',
      title: 'Phase 2 · Digital transformation',
      short: 'Digital Transformation Grant. Deeper, GMP-grade embedding across manufacturing, quality and supply chain.',
      long: 'Phase 2 – Scaling the adoption.',
      body: 'The IDA\'s Digital Transformation Grant is designed to fund the shape of work that would follow Phase 1 – deeper, GMP-grade embedding of AI into the manufacturing, quality and supply chain functions, using the evidence and the skills Phase 1 produces as the case for investment. Comparable engagements sit at meaningfully larger scale and at higher grant intensity than Phase 1. The specific commercial shape will be confirmed as Phase 1 progresses and as the IDA engagement matures.',
      tags: ['Digital Transformation Grant', 'GMP-grade', 'Higher grant intensity', 'Larger scale'],
    },
    {
      when: '\n',
      title: 'Phase 3 · Becoming AI-native',
      short: 'Pattern repeated across remaining operational domains. Helsinn takes primary ownership of a continuously-learning intelligence layer.',
      long: 'Phase 3 – Embed at scale.',
      body: 'The pattern established in Phase 2 can then be repeated across the remaining operational domains, the captured-judgement artefacts built in earlier phases are extended to cover the full site and the Helsinn team takes primary ownership of a continuously-learning intelligence layer.',
      tags: ['Helsinn-owned', 'Continuously learning', 'Full-site coverage', 'Captured-judgement estate'],
    },
  ],

  /* --- 12-category Unified Taxonomy of Knowledge (verbatim from 04-the-brightbeam-approach.md / Appendix C) --- */
  taxonomy: {
    categories: [
      { label: 'Cognitive',                 short: 'Cognitive',          type: 'tacit',
        technique: 'CDM interviews',
        example: 'Pattern-matching expertise: an engineer diagnosing an anomaly from a sound or a reading before the instrument flags it.',
        bearing: 'Primary category for UC-04 Tacit Knowledge Database.' },
      { label: 'Physical / psychomotor',    short: 'Physical',           type: 'tacit',
        technique: 'Shop-floor observation',
        example: 'Hands-on maintenance skill – the technician who knows from the feel of the tool when a fitting is right.',
        bearing: 'UC-04 maintenance scope; shadowing supplements CDM.' },
      { label: 'Sensory / perceptual',      short: 'Sensory',            type: 'tacit',
        technique: 'CDM · think-aloud',
        example: 'Hearing a bearing go. Seeing a calibration drifting while still inside spec.',
        bearing: 'Core UC-04 surface; informs Calibration Data Trending (Cand. F).' },
      { label: 'Affective / emotional',     short: 'Affective',          type: 'tacit',
        technique: 'Narrative interview',
        example: 'The sense that something is not right – the read that precedes the instrument reading.',
        bearing: 'Captured alongside sensory cues in UC-04.' },
      { label: 'Social / relational',       short: 'Social',             type: 'tacit',
        technique: 'Stakeholder mapping',
        example: 'Knowing who to call, who can be trusted with an ambiguous decision, who owes whom a favour.',
        bearing: 'Contractor/Supplier Review (Cand. G); CMO workflows.' },
      { label: 'Cultural / organisational', short: 'Cultural',           type: 'tacit',
        technique: 'CDM · narrative',
        example: 'Why do we do it this way and not the way the SOP literally says – the compression of years of problem-solving.',
        bearing: 'Shapes tone of every downstream capability.' },
      { label: 'Contextual / environmental',short: 'Contextual',         type: 'tacit',
        technique: 'CDM · site-specific',
        example: 'Site-specific configuration memory – undocumented local adaptations from years of operation.',
        bearing: 'UC-04 engineering scope; the "tube through the ceiling tile" case.' },
      { label: 'Narrative / experiential',  short: 'Narrative',          type: 'tacit',
        technique: 'Incident retrospection',
        example: 'Case memory from past incidents – the procedural narrative behind "how we actually fix this when it breaks".',
        bearing: 'UC-04 maintenance scope; feeds Quality Investigation Support (Cand. L).' },
      { label: 'Documented / explicit',     short: 'Documented',         type: 'explicit',
        technique: 'Document extraction',
        example: 'Site SOPs, batch records, the MES-adjacent procedural corpus.',
        bearing: 'Direct input to every Build.' },
      { label: 'System / data',             short: 'System / data',      type: 'explicit',
        technique: 'Warehouse integration',
        example: 'JD Edwards, Tableau, Cognos histories, maintenance records, calibration logs.',
        bearing: 'Foundation of UC-03, UC-05, UC-06.' },
      { label: 'Ethical / moral',           short: 'Ethical',            type: 'meta',
        technique: 'Governance interview',
        example: 'Compliance judgement – regulatory-regime-specific norms applied to a non-routine decision.',
        bearing: 'Hard prerequisite for Phase 2 GMP scope.' },
      { label: 'Meta-knowledge',            short: 'Meta',               type: 'meta',
        technique: 'Reflection session',
        example: 'Knowing which decisions require which inputs and who to consult. Knowing where the archive ends.',
        bearing: 'Drives the CTA interview plan itself.',
        note: 'Nine of the twelve sit partly or wholly on the tacit side of the continuum. Only documented/explicit and system/data sit decisively on the explicit side.' },
    ],
  },

  /* --- Twelve alpha candidates (verbatim from 06-the-alpha-candidate-set.md) --- */
  useCases: [
    {
      code: 'UC-04 · Initial candidate',
      isAlpha: true,
      title: 'Tacit knowledge database',
      scope: 'Workstream · Builds. Non-GMP. Engineering, maintenance and calibration experts.',
      fields: [
        { label: 'What it is', value: 'A multi-stage capability that captures the critical engineering, maintenance and calibration knowledge currently living in a small number of named individuals\' heads, and surfaces it as a queryable agent that technicians on shift can consult by voice or text. The capture layer uses CTA-led Critical Decision Method interviews with the named experts, plus structured data ingestion from maintenance records, calibration logs and manuals, plus shift handover recording and transcription. The accessible layer is a purpose-built agent accessible on the shop floor.' },
        { label: 'The benefits', value: 'Removes named single points of failure. Means any qualified technician can cover any line. Reduces downtime from knowledge gaps – the \'tube through the ceiling tile\' failure mode, where an undocumented local adaptation caused a manufacturing area shutdown because no one on shift knew it was critical. Scalable to calibration, serialisation and contractor-covered workflows.' },
        { label: 'What Brightbeam brings', value: 'This is a capability Brightbeam has built before. The CTA methodology (Crandall, Klein, Hoffman lineage, 92–94% content validity across NRC, CIA and NASA applications) is one of the Brightbeam-operationalised primitives.' },
        { label: 'Risks and dependencies', value: 'Cooperation of the maintenance team is a prerequisite – this is a change-management question as much as a technical one. Buy-in for shift handover recording needs to be handled carefully, with explicit consent and a framing that positions the recording as protecting the technician, not monitoring them. Access to historical maintenance and calibration records is required; this is a tractable data-access question, not a blocker.' },
      ],
    },
    {
      code: 'UC-03 · Initial candidate',
      title: 'Cognos replacement',
      scope: 'Workstream · Builds. Non-GMP. Finance.',
      fields: [
        { label: 'What it is', value: 'A modern AI-over-data-lake replacement for the current Cognos deployment. The application layer that finance staff currently interact with – segment P&L generation, standard costing, the post-report Excel manipulation – is replaced with a conversational query interface. The standard-costing rule set is captured as structured logic and versioned. The data lake stores the historical Cognos reporting data and ingests new transactional data as it lands.' },
        { label: 'The benefits', value: 'Removes the external-consultant single-point-of-failure risk. Gives Wade and the finance team a modern, queryable, auditable reporting layer that does not require post-report Excel manipulation. Accelerates month-end by removing dependencies in the current cycle.' },
        { label: 'What Brightbeam brings', value: 'Architectural pattern from comparable builds; components available for reuse; a CTA-led scoping phase, in addition to full application analysis, to capture the standard-costing rule set rigorously before it is encoded.' },
        { label: 'Risks and dependencies', value: 'Scoping of the rule set is the key gate – the work cannot finish until that rule set is captured. Access to historical Cognos data is a prerequisite. Clarification of the rule-set complexity (planned in the first two weeks of the Roadmap) determines the build complexity which will ultimately impact the business case.' },
      ],
    },
    {
      code: 'UC-05 · Initial candidate',
      title: 'Tableau Natural-Language overlay',
      scope: 'Workstream · Builds. Non-GMP. Management / cross-functional.',
      fields: [
        { label: 'What it is', value: 'An AI overlay that sits on top of Helsinn\'s existing Tableau deployment via API integration. Staff can generate charts, drill into dashboards and ask natural-language questions during meetings without pre-building the visualisation in advance. Tableau stays; the change is additive, not replacive.' },
        { label: 'The benefits', value: 'Linda currently pre-builds dashboards for meetings and cannot drill further once the meeting begins. The overlay removes that constraint. Management meetings can interrogate the data as questions arise, not against a fixed set of views prepared the previous day. Sunk Tableau investment is preserved; change-management cost is low.' },
        { label: 'What Brightbeam brings', value: 'Pattern reuse from similar overlays. Tableau API integration is a known quantity.' },
        { label: 'Risks and dependencies', value: 'Depends on deployed Tableau version and on the granularity of the permissions layer – both are tractable scoping questions rather than blockers.' },
      ],
    },
    {
      code: 'UC-06 · Initial candidate',
      title: 'Metrics fusion live dashboard',
      scope: 'Workstream · Builds. Non-GMP. Cross-departmental.',
      fields: [
        { label: 'What it is', value: 'A cross-departmental metrics dashboard that consolidates the measures currently fragmented across Helsinn\'s departmental Tableau workbooks, Excel sheets and operational reports into a single live view. Uses the same data-lake architecture as UC-03. Adds AI-driven anomaly surfacing so the dashboard does not just display, it notices.' },
        { label: 'The benefits', value: 'Resolving the aggregation inside the Brightbeam data architecture work unlocks both this dashboard and the Tableau Overlay. The business value is a cross-functional view of performance that is currently impossible to assemble in real time.' },
        { label: 'What Brightbeam brings', value: 'The data-lake work is shared with UC-03, meaning that if both are selected the marginal cost of the second is materially lower than a standalone build. Component reuse from a previous engagement is direct.' },
        { label: 'Risks and dependencies', value: 'Depends on the current-state Metrics Fusion effort and on the outcome of the data-aggregation question. If the existing internal effort is further along than assumed, the Brightbeam work is an acceleration rather than a fresh build, which lowers cost and risk.' },
      ],
    },
    {
      code: 'UC-07 · Initial candidate',
      title: 'CMO inventory intelligence',
      scope: 'Workstream · Builds. Non-GMP. Supply chain / CMO.',
      fields: [
        { label: 'What it is', value: 'An inventory intelligence capability focused on the CMO side of Helsinn\'s supply chain. Surfaces expiry-date risk, movement anomalies and over-ordering patterns across external CMO partners. The Dublin-site stock is already near-optimal, so the value lives at the CMO API level.' },
        { label: 'The benefits', value: 'A comparable system saves millions of pounds annually for an NDA-protected Brightbeam client in a similar segment – the business case is tested, not hypothesised.' },
        { label: 'What Brightbeam brings', value: 'Direct component reuse. The architectural pattern is mature.' },
        { label: 'Risks and dependencies', value: 'The project is gated on data quality. It is not yet clear whether CMO-side expiry-date and movement data is consistently available and accurate.' },
      ],
    },
    {
      code: 'Candidate F · Supplementary',
      title: 'Calibration Data Trending',
      scope: 'GxP-adjacent · likely Phase 2. Bridge from non-GMP Phase 1 into GMP Phase 2.',
      fields: [
        { label: 'Description', value: 'AI-driven analysis of calibration drift and patterns across instruments. GxP-adjacent – likely Phase 2 rather than Phase 1, but included here as it is a natural bridge from the non-GMP Phase 1 into the GMP Phase 2 work. Ties to the tacit-knowledge build (calibration specialist dependency) and to the GMP pathway.' },
      ],
    },
    {
      code: 'Candidate G · Supplementary',
      title: 'Contractor and Supplier Review',
      scope: 'Analytical support for the annual contractor and supplier review cycle.',
      fields: [
        { label: 'Description', value: 'Analytical support for the annual contractor and supplier review cycle. AI handles the analytical and cost-benchmarking component; human judgement (value versus cost, relationship management) stays manual. This is not automation – it is amplification of the judgement that already happens.' },
      ],
    },
    {
      code: 'Candidate H · Supplementary',
      title: 'Energy Monitoring',
      scope: 'AI-driven energy usage analysis · currently blocked on data availability.',
      fields: [
        { label: 'Description', value: 'AI-driven energy usage analysis tied to operational and sustainability targets. Currently blocked on data availability; promoted to the candidate set because the underlying data problem may be tractable.' },
      ],
    },
    {
      code: 'Candidate I · Supplementary',
      title: 'Serialisation Compliance Support',
      scope: 'Non-GMP framing achievable · reporting layer separable from GMP manufacturing actions.',
      fields: [
        { label: 'Description', value: 'AI support for serialisation compliance reporting and anomaly detection. Non-GMP framing is achievable – the reporting layer is separable from the GMP manufacturing actions themselves. Component reuse from a similar build at another Irish-manufacturing client.' },
      ],
    },
    {
      code: 'Candidate J · Supplementary',
      title: 'MES Data Integration',
      scope: '2027 activity · MES selection in progress, implementation targeted for 2027.',
      fields: [
        { label: 'Description', value: 'Framed as a 2027 activity because MES selection is in progress and implementation is targeted for 2027. Included as a candidate because the AI-readiness criteria for the MES selection should sit inside the Roadmap analysis from day one, and because a data-integration alpha is the natural first application of the MES once it goes live.' },
      ],
    },
    {
      code: 'Candidate K · Supplementary',
      title: 'Document Intelligence and Regulatory Filing Support',
      scope: 'Non-GMP components may be Phase 1 · GMP-facing components Phase 2.',
      fields: [
        { label: 'Description', value: 'AI-assisted drafting and review for regulatory filings, SOP revisions and technical documentation. Non-GMP components – the regulatory filing drafting and SOP review workflows – may be potential Phase 1 possibilities. GMP-facing components sit in Phase 2.' },
      ],
    },
    {
      code: 'Candidate L · Supplementary',
      title: 'Quality Investigation Support',
      scope: 'Non-GMP bridge to Phase 2 GMP · designed first touch with quality team.',
      fields: [
        { label: 'Description', value: 'A narrow, non-GMP-facing subset of quality-investigation support that models the tacit-knowledge approach for the quality team without entering GMP territory. Designed as a deliberate bridge to the Phase 2 GMP conversation – a safe, evidence-building first touch with the quality team before the BPCI playbook opens the GMP pathway.' },
      ],
    },
  ],

  /* --- UC-01 / UC-02 called out separately (UC-01 sits inside Embed, not Builds) --- */
  embedUseCases: [
    {
      code: 'UC-01 · inside Embed',
      title: 'New-product and CMO business-assessment capability',
      body: 'A new-product and CMO business-assessment capability that the Helsinn team learns to build for themselves. UC-01 lives inside Embed, not inside Alpha Builds. Brendan currently evaluates CMO and new-product opportunities with weeks of manual cross-functional spreadsheet work; this capability compresses that to hours.',
    },
    {
      code: 'UC-02',
      title: 'Finance budget and variance-monitoring capability',
      body: 'A finance budget and variance-monitoring capability that consolidates Wade\'s three workbooks and puts real-time scenario modelling on top.',
    },
  ],

  /* --- Knowledge-at-Risk Register (verbatim from Appendix D – six colleague entries) --- */
  karr: [
    {
      role: 'Colleague one – engineering',
      scope: 'Named in the 30 March meeting. Single point of failure for engineering and maintenance judgement on specific lines.',
      fields: [
        { label: 'Knowledge held', value: 'Named in the 30 March meeting as a single point of failure for engineering and maintenance judgement on specific lines. The knowledge is a combination of the site\'s original equipment configuration, the undocumented local adaptations that have accumulated over years of operation and the pattern-matching that lets him diagnose an anomaly from a sound or a reading before the instrument flags it.' },
        { label: 'Position on the continuum', value: 'Proximal. The pattern-matching component is sensory/perceptual and strongly tacit. The configuration knowledge is partly explicit but lives alongside procedural assumptions that are not.' },
        { label: 'Taxonomy categories engaged', value: 'Primarily cognitive (pattern-matching expertise), sensory/perceptual, contextual/environmental (site-specific configuration memory) and narrative/experiential (case memory from past incidents). Documented/explicit plays a supporting role.' },
        { label: 'Operational consequence of loss', value: 'An undocumented configuration failure mode, manifesting during an equipment swap, a shift change or a line restart, produces downtime. The 30 March conversation surfaced the \'tube through the ceiling tile\' story – an undocumented local adaptation that caused a manufacturing-area shutdown because no one on shift knew it was critical. That story is the type specimen.' },
        { label: 'Phase 1 tractability', value: 'High. UC-04 is designed around this profile. CDM interviews, DRTs for the named decision points and a shop-floor agent surface are all inside scope.' },
      ],
    },
    {
      role: 'Colleague two – maintenance',
      scope: 'Named in the 30 March meeting alongside colleague one. Maintenance-focused; strongly procedural and narrative.',
      fields: [
        { label: 'Knowledge held', value: 'Named in the 30 March meeting alongside colleague one. Maintenance-focused; strongly procedural and narrative. Carries the \'how we actually fix this when it breaks\' knowledge that sits alongside the formally-documented maintenance schedule.' },
        { label: 'Position on the continuum', value: 'Proximal-to-middle. Procedural knowledge of maintenance routines is partly articulable; the heuristics that guide diagnosis when the routine does not apply are not.' },
        { label: 'Taxonomy categories engaged', value: 'Physical/psychomotor (hands-on maintenance skill), cognitive (diagnostic reasoning), narrative/experiential (case memory).' },
        { label: 'Operational consequence of loss', value: 'Slower recovery from unusual failures; heavier dependence on external vendors for repair decisions the site could historically make in-house; longer mean time to repair on the classes of failure Neil has seen before and the next technician has not.' },
        { label: 'Phase 1 tractability', value: 'High. Same shape as Colleague one. Shift-handover recording extends the capture surface if consent is obtained.' },
      ],
    },
    {
      role: 'Colleague three – engineering',
      scope: 'Named in the 30 March meeting. Engineering-specialism-specific. Design-intent memory.',
      fields: [
        { label: 'Knowledge held', value: 'Named in the 30 March meeting. Engineering-specialism-specific. Carries design-intent memory for specific parts of the plant that are not documented at the level required for non-experts to intervene safely.' },
        { label: 'Position on the continuum', value: 'Proximal-to-middle. Design-intent reasoning sits between contextual and cognitive.' },
        { label: 'Taxonomy categories engaged', value: 'Cognitive, contextual/environmental, meta-knowledge (knowing which decisions require which inputs and who to consult).' },
        { label: 'Operational consequence of loss', value: 'Engineering-change decisions become slower, more expensive and externally dependent.' },
        { label: 'Phase 1 tractability', value: 'High. Capture is directly analogous to the first two entries.' },
      ],
    },
    {
      role: 'Colleague four – the calibration contractor',
      scope: 'Serialisation compliance across Russia, Saudi Arabia, US (levels 4–5). Three days a week; fragile contract.',
      fields: [
        { label: 'Knowledge held', value: 'Calibration expertise across serialisation-compliance regimes including Russia, Saudi Arabia and the US (levels 4–5 compliance per the 30 March meeting). The contractor is at Helsinn three days per week and shares one day per week each with two other companies. The commercial arrangement is fragile: if the contractor departs, Helsinn has stated the contract ends.' },
        { label: 'Position on the continuum', value: 'Proximal (serialisation judgement is heavily contextual and regulatory-interpretive) and distal in parts (compliance documentation is explicit).' },
        { label: 'Taxonomy categories engaged', value: 'Cognitive, contextual/environmental, cultural/organisational (regulatory-regime-specific norms), ethical/moral (compliance judgement), meta-knowledge. Documented/explicit carries the compliance documentation itself.' },
        { label: 'Operational consequence of loss', value: 'Serialisation compliance is a go/no-go constraint for Helsinn\'s export markets. Loss of this contractor without prior knowledge capture is a material risk to the export pipeline.' },
        { label: 'Phase 1 tractability', value: 'Conditional. UC-04 methodology applies directly, but a contractor-side engagement requires contractual cooperation. The Roadmap work in Weeks 1–4 should confirm whether the contractor\'s engagement can be extended to cover CDM sessions, or whether a surrogate capture route (structured shadowing, artefact analysis, interview with Helsinn staff who interact with the contractor) is needed. If cooperation is feasible, this is a high-priority Phase 1 target.' },
      ],
    },
    {
      role: 'Colleague five – engineer on extended sick leave',
      scope: 'Named in the 30 March meeting. Cross-training underway but not complete.',
      fields: [
        { label: 'Knowledge held', value: 'Named in the 30 March meeting. Cross-training is underway but not complete. The risk window is the duration of the leave; the capture window is narrower because direct interview access depends on the individual\'s willingness and health.' },
        { label: 'Position on the continuum', value: 'Middle. Specific content unknown until capture begins.' },
        { label: 'Taxonomy categories engaged', value: 'To be mapped during capture.' },
        { label: 'Operational consequence of loss', value: 'Considered a live concern.' },
        { label: 'Phase 1 tractability', value: 'Medium. Direct CDM is conditional on the engineer\'s availability and willingness. Surrogate capture via shift handovers and interviews with cross-training recipients is available as a fallback. The Roadmap should confirm the preferred approach in Weeks 1–2 in consultation with Brendan.' },
      ],
    },
    {
      role: 'Colleague six – Cognos consultant',
      scope: 'The Cognos standard-costing rule set · the interpretive decisions made across it over years.',
      fields: [
        { label: 'Knowledge held', value: 'The Cognos standard-costing rule set, and the informal interpretive decisions that have been made across it over years of operation. Named in the 30 March meeting as the single point of failure for the Cognos work.' },
        { label: 'Position on the continuum', value: 'Middle-to-distal. The rule set itself is explicit (codified in Cognos); the interpretive history is not.' },
        { label: 'Taxonomy categories engaged', value: 'Documented/explicit (the rule set), system/data (the Cognos-embedded logic), cognitive (interpretive reasoning), narrative/experiential (the history of why each rule is the way it is).' },
        { label: 'Operational consequence of loss', value: 'Loss without prior capture means loss of rule-set interpretive context. Migration to a modern AI-over-data-lake architecture in UC-03 requires the interpretive context to be captured, not just the rules.' },
        { label: 'Phase 1 tractability', value: 'High and urgent. UC-03 cannot fully execute without this capture. The Roadmap discovery for Candidate A scopes the rule set in the first two weeks; CDM-style interview with Mark is the capture vehicle; the DRT produced becomes the specification for the new system.' },
      ],
    },
  ],

  /* --- Team: intentionally empty. Source 11 does not name a team roster. --- */

  /* --- Glossary (verbatim from Appendix B, section 16) --- */
  glossary: [
    { term: 'BDP',                         def: 'IDA Ireland\'s Business Development Programme – the grant vehicle supporting this engagement.' },
    { term: 'BPCI',                        def: 'Biopharma Process and Compliance Institute – the industry body whose 2026 playbook is the GMP-pathway reference for Phase 2 AI use cases.' },
    { term: 'CDDO',                        def: 'The digital-maturity model (Levels 1 to 5) used by IDA assessors to position applicants on a maturity curve. Helsinn is assessed at Level 2 to 3 with a credible path to Level 4 via this engagement.' },
    { term: 'CTA',                         def: 'Cognitive Task Analysis – the established research discipline (Crandall, Klein, Hoffman; Naturalistic Decision Making tradition) Brightbeam operationalises for industrial AI. Validated at 92–94% content validity across NRC, CIA and NASA applications.' },
    { term: 'CDM / DRT',                   def: 'Critical Decision Method – CTA\'s core interview primitive. Decision Requirements Table – the structured artefact that sits between CDM interviews and the AI design.' },
    { term: 'De minimis',                  def: 'The EU state-aid regime (Commission Regulation (EU) 2023/2831) under which the BDP is authorised. Caps total aid to any undertaking at €300,000 over any three fiscal years across all state sources in Ireland.' },
    { term: 'DMSA',                        def: 'Digital Maturity Sustainability Assessment – a Roadmap deliverable on IDA\'s own suggested-outcomes list, submitted to IDA as part of the grant compliance.' },
    { term: 'GMP',                         def: 'Good Manufacturing Practice – the regulatory framework governing pharmaceutical manufacturing. Phase 1 of this engagement is explicitly non-GMP.' },
    { term: 'HPRA',                        def: 'Health Products Regulatory Authority – Ireland\'s medicines regulator.' },
    { term: 'IP retention',                def: 'Brightbeam retains right to IP re-use across the engagement; Helsinn receives the reduced cost and compressed timelines that come from Brightbeam\'s reusable component library. This is the standard Brightbeam commercial model.' },
    { term: 'Judgement layer',             def: 'The layer of AI-native services for regulated industries that captures, preserves and deploys expert human judgement. Helsinn\'s engagement sits inside this category.' },
    { term: 'Phase 1 / Phase 2',           def: 'Phase 1 is the twelve-month BDP-backed engagement described in this proposal, explicitly non-GMP. Phase 2 is the follow-on, likely Digital Transformation Grant-backed, with GMP-facing scope enabled by the 2026 BPCI playbook.' },
    { term: 'Second Nature AI',            def: 'Brightbeam\'s core value proposition: AI embedded into the fabric of operating models in regulated industries.' },
  ],

  /* --- Eight benefit dimensions (verbatim from Appendix E) --- */
  benefits: [
    { code: '01', title: 'Better for humans.',                body: 'The work that gets reclaimed is the work that people never wanted to do. AI-native operation does not mean humans do less. It means humans do more of the work that requires human judgement and less of the work that was only done by humans because there was no alternative.' },
    { code: '02', title: 'Better for profits.',               body: 'The direct savings begin in Phase 1. The indirect benefits – faster month-end, tighter forecast accuracy, fewer deviations reaching the quality-event register, faster resolution of those that do – start landing in Phase 2. The margin uplift from predictive quality, energy optimisation and dynamic scheduling is Phase 3 territory.' },
    { code: '03', title: 'Understanding causation.',          body: 'A pharmaceutical manufacturing operation is a system where small, upstream changes produce large, downstream consequences – in product quality, in deviation frequency, in yield, in cycle time. A site without an intelligence layer runs on correlation and on tribal pattern-matching. A site with one understands causation. This capability begins with the tacit knowledge agent in Phase 1, widens in Phase 2 and becomes the operating condition in Phase 3.' },
    { code: '04', title: 'Trending towards perfection.',      body: 'A site that improves a little every batch, reliably, is a different commercial entity from a site that swings between best-effort and unexpected deviation. The AI flywheel is what makes continuous improvement continuous – not a quarterly review cycle but a live feedback loop from the floor.' },
    { code: '05', title: 'Instant access to everything.',     body: 'The sprawl of data and systems is an access problem. A site lead who has to wait two days for a cross-functional question is a site lead making decisions on stale evidence. Phase 1 starts to remove that latency. Phase 2 removes it structurally. Phase 3 makes the access pattern the default: you ask the facility, and the facility answers.' },
    { code: '06', title: 'Spotting anomalies across domains.',body: 'Most significant deviations in a regulated-industry operation are cross-domain: a quality signal that correlates with a maintenance event that correlates with a supplier change that correlates with an operator shift pattern. No single dashboard catches these because no single dashboard has a view across the domains. A Helsinn-owned intelligence layer does.' },
    { code: '07', title: 'Streamlined audit trails.',         body: 'Every AI-supported decision carries a structured audit trail by design – the data consulted, the model invoked, the version, the human sign-off, the downstream action. The audit burden that currently falls on humans falls on the system. The audit experience – internally, and in HPRA and FDA inspections – moves from defensive to confident.' },
    { code: '08', title: 'Reducing energy costs.',            body: 'Manufacturing energy is one of the most responsive variables to intelligent scheduling and predictive load management. In a site where HVAC, clean-utility loads and line scheduling are jointly optimised by an intelligence layer, energy envelope reductions of 10–20% are the reported external range – consistent across Deloitte\'s smart-manufacturing research and BCG\'s biopharma investigations.' },
  ],

  /* --- External sources cited in Appendix E (verbatim list) --- */
  sources: [
    'McKinsey, The AI transformation manifesto, April 2026',
    'McKinsey, The state of AI: How organisations are rewiring to capture value, 2025',
    'BCG, Closing the AI impact gap, 2025',
    'BCG, Agentic AI in biopharma: game-changing efficiency, 2025',
    'Gartner, Enterprises to abandon assistive AI for outcome-focused workflow by 2028, April 2026',
    'Gartner, 40% of agentic AI projects will be cancelled by 2027, June 2025',
    'MIT Project NANDA, The GenAI Divide: State of AI in Business 2025',
    'Stanford HAI, 2025 AI Index Report',
    'Harvard Business Review, Could Gen AI end incumbent firms\' competitive advantage?, November 2024',
    'Deloitte, Smart manufacturing, digital supply chains may help pharma boost value',
    'Pharmaceutical Technology, Industry Outlook 2026: Navigating AI, Sustainability and Operational Resilience',
    'CB Insights, Pharma AI readiness: How the 50 largest companies by market cap stack up, 2025',
    'IMD, Future Readiness Indicator – Pharmaceuticals 2025',
    'FDA, Considerations for the Use of Artificial Intelligence to Support Regulatory Decision-Making for Drug and Biological Products (draft guidance), January 2025',
    'EMA, Reflection Paper on the Use of Artificial Intelligence in the Medicinal Product Lifecycle',
    'Coherent Solutions summary of Eli Lilly–NVIDIA pharma AI supercomputer announcement, October 2025',
    'IDA Ireland, Adapt Intelligently 2025–2029 strategy',
  ],

  brightbeamCanon: [
    'Why Create a New Category? editorial, March 2026',
    'Second Nature Manufacturing brochure',
    'AI Flywheel brochure',
    'The Compounding Cost of AI deck',
    'Brightbeam Roadmap brochure',
    'Investor Outline February 2026',
    'SNM Vision and Use Cases deck',
  ],
};
