/**
 * editorial-principles.js — Single source of truth for the editorial
 * principles that gate both the DRAFTING pipeline (web/api/lib/draft-flow.js,
 * routes/editorial.js) and the UPSTREAM analyse + audit pipeline
 * (scripts/editorial-analyse.js, scripts/editorial-audit-upstream.js,
 * config/prompts/editorial-analyse.v1.txt).
 *
 * Both environments import from this module so that when a principle
 * changes, every pipeline that applies it is updated at once. The
 * web/api/lib/draft-flow.js module re-exports the canonical functions
 * for its existing callers; it no longer owns the definitions.
 *
 * The module exports:
 *
 *   - Sector detection (SECTORS, SECTOR_PATTERNS, SECTOR_CEO_LABELS,
 *     detectSectors)
 *
 *   - Section builders (pure text; no LLM calls):
 *       buildEvidenceCalibrationSection()
 *       buildMustCatchPatternsSection()
 *       buildCEOEmpathySection()
 *
 *   - Prompt builders that compose those sections for specific tasks:
 *       buildCEOCritiquePrompt(sector)
 *       buildCEORevisionInstruction(consolidatedNotes)
 *
 * Anything here is pure: deterministic, no I/O, no side effects.
 */

// ── Sector detection ────────────────────────────────────────

export const SECTORS = ['general-ai', 'biopharma', 'medtech', 'manufacturing', 'insurance']

export const SECTOR_PATTERNS = {
  biopharma: /\b(pharma(?:ceutical)?|biotech|drug\s+(?:discovery|development|design|pipeline)|FDA\s+approval|clinical\s+trial|biologic|small\s+molecule|oncolog|vaccine|gene\s+therapy|cell\s+therapy|NICE|EMA|Pfizer|Moderna|Roche|Novartis|GSK|AstraZeneca|MSD|Merck|Eli\s+Lilly|Sanofi|Boehringer|Bayer|Novo\s+Nordisk|Phase\s+[123]|indication|biomarker|pharmacolog|therapeutic|patent\s+cliff)\b/i,
  medtech: /\b(medical\s+device|MRI|CT\s+scan|ultrasound|surgical\s+robot|surgical|implant|diagnostic\s+device|FDA\s+510|CE\s+mark|hospital\s+workflow|EHR|EMR|patient\s+monitor|cardiac\s+rhythm|orthopaedic|orthopedic|in\s+vitro\s+diagnostic|IVD|catheter|endoscop|Medtronic|Boston\s+Scientific|Stryker|Edwards\s+Lifesciences|Intuitive\s+Surgical|Siemens\s+Healthineers|GE\s+Healthcare|Philips\s+Healthcare)\b/i,
  manufacturing: /\b(factory|factories|supply\s+chain|OEE|\bMES\b|\bERP\b|automotive|industrial|lean\s+manufacturing|six\s+sigma|industry\s+4\.0|smart\s+factory|smart\s+manufacturing|plant\s+floor|assembly\s+line|throughput|SCADA|\bPLC\b|industrial\s+IoT|\bIIoT\b|Foxconn|Bosch|Honeywell|GE\s+Vernova|Schneider\s+Electric|Rockwell|Mitsubishi\s+Electric|shop\s+floor)\b/i,
  insurance: /\b(insurer|insurance|premium|underwriting|underwriter|claims\s+handling|reinsuran|actuarial|policyholder|risk\s+pool|actuary|loss\s+ratio|combined\s+ratio|catastrophe\s+model|cat\s+model|catastrophe\s+bond|Lloyds|AIG|Allianz|\bAXA\b|Swiss\s+Re|Munich\s+Re|\bAon\b|Marsh\s+(?:McLennan|&)|Willis\s+Towers|Aviva|Zurich\s+Insurance|Travelers\s+Insurance)\b/i,
  'general-ai': /\b(frontier\s+model|foundation\s+model|AI\s+(?:safety|alignment|lab|developer|company|industry|sector|policy|governance|regulation)|OpenAI|Anthropic|DeepMind|Mistral|Cohere|xAI|Hugging\s+Face|Llama|Claude|GPT-?\d|Gemini|reasoning\s+model|context\s+window|inference\s+cost|model\s+release|capability\s+overhang|RLHF|fine[- ]tuning|pre[- ]training)\b/i,
}

export const SECTOR_CEO_LABELS = {
  'general-ai': 'CEO of an AI-native technology company',
  biopharma: 'CEO of a global pharmaceutical company',
  medtech: 'CEO of a global medical device manufacturer',
  manufacturing: 'CEO of a global industrial manufacturer',
  insurance: 'CEO of a global insurance company',
}

/**
 * Detect which SNI sectors a piece of text addresses. Returns the
 * sectors in canonical order (matching SECTORS). If no specific
 * sector signal is present, returns ['general-ai'] as the default.
 */
export function detectSectors(text) {
  if (typeof text !== 'string' || !text) return ['general-ai']
  const found = new Set()
  for (const [sector, pattern] of Object.entries(SECTOR_PATTERNS)) {
    if (pattern.test(text)) found.add(sector)
  }
  if (found.size === 0) found.add('general-ai')
  return SECTORS.filter(s => found.has(s))
}

// ── Section: evidence calibration ────────────────────────────
// The highest-priority audit category. Over-claim is the hallmark of
// LLM writing. Covers: attribution test (named sources), voicing
// ladder (match claim to evidence level), source-document-not-gospel
// (claims in input documents are not authoritative), ITEATE earns
// directness (closer can only be declarative if body did calibration
// work), and quote rules (quotes are rare).

export function buildEvidenceCalibrationSection() {
  return [
    'EVIDENCE CALIBRATION — the highest-priority audit category. Over-claim is the hallmark of LLM writing and must be eliminated:',
    '',
    'A. ATTRIBUTION TEST. Every named source must pass:',
    '   - Person + verifiable institution (e.g. "Chicago Booth economist Alex Imas", "Anthropic\'s Peter McCrory")',
    '   - Published or institutionally-backed (paper, post, official statement) — not a podcast appearance, not a casual social-media remark',
    '   - Survives the context check (genuinely load-bearing for the argument)',
    '   Pseudonymous figures (e.g. "signüll"), podcast guests cited as such, and unverifiable single-person claims FAIL the test. They must be removed. Engage with the SUBSTANCE of their argument as an idea, not as something they said. If in doubt, leave the podcast and podcaster out.',
    '',
    'B. VOICING LADDER. Every claim must be voiced at the level its evidence supports:',
    '   - Raw datum, primary source, verifiable → state directly',
    '   - Established fact, widely known → common-ground framing ("As we\'re all-too-well aware...")',
    '   - Reported finding from a credible institution → "Research from X suggests...", "Estimates place..."',
    '   - The author\'s inference from the evidence → question or conditional ("Could...?", "If so, we might conclude that...")',
    '   - Inference from an inference → still a question, but the uncertainty must be obvious',
    '   - Beyond three levels of inference → CUT',
    '   FLAG every declarative statement that\'s actually an inference. Rewrite as question or conditional.',
    '',
    'C. SOURCE-DOCUMENT CLAIMS ARE NOT GOSPEL. Claims that appeared in the analysis entry, transcript, or other source documents are themselves subject to the attribution test and the voicing ladder. Do not treat them as authoritative just because they were in the input. Evaluate the claim and voice it at the level its evidence supports.',
    '',
    'D. ITEATE EARNS ITS DIRECTNESS. The ITEATE closer can be more declarative than the body — but only if (1) the body did the calibration work (showed the uncertainty) AND (2) multiple threads in the body converged on the same conclusion. If the body was already declarative throughout, REJECT a confident ITEATE — it has no tension to release.',
    '',
    'E. QUOTES. Direct quotes are rare. A quote survives only if (a) the source passes the attribution test AND (b) the quote contributes more than a paraphrase would. Quotes from non-attributable sources must be paraphrased.',
  ].join('\n')
}

// ── Section: must-catch style patterns ───────────────────────
// The 14 numbered patterns that appear nowhere in Scott's canon and
// must be flagged every time. Includes the 'matters' ban (#14) —
// strict, no substitution, restructure or cut.

export function buildMustCatchPatternsSection() {
  return [
    'MUST-CATCH STYLE PATTERNS — these appear nowhere in Scott\'s canon and must be flagged every time. Scan for each one explicitly:',
    '',
    '1. First-person narrator (\'I keep thinking\', \'I see this in my clients\', \'I think\', \'From my experience\', \'What I find interesting is\'). Scott writes third-person. Rewrite as observation.',
    '',
    '2. Podcast/source framing as conversational context (\'on the [X] podcast this week\', \'last Thursday on [show], [person] said...\', \'[name], the pseudonymous culture commentator\'). Cite sources BRIEFLY and FACTUALLY — never foreground the medium or the occasion.',
    '',
    '3. FALSE CONTRASTS — all forms. This is the hardest pattern to eliminate AND the highest-leakage pattern in upstream audits (8 of 12 patches in a recent audit run). Check for EVERY variant:',
    '   - \'Not X but Y\' / \'not from X but Y\' / \'not for X but for Y\'',
    '   - \'The question isn\'t X, it\'s Y\'',
    '   - \'X isn\'t just Y - it\'s Z\' (including variants like \'doesn\'t just capture X. It Y.\', \'not only X but also Y\')',
    '   - \'Less about X, more about Y\' / \'X is more than just Y\'',
    '   - \'The constraint is X, not Y\' / \'X, not Y\' as punchy closer',
    '   - SOFT STRUCTURAL CONTRASTS (these leak the most): \'Most X. Y is different.\' / \'Most [enterprises/people/firms] do X — [Y reports/shows] something different\' / \'Conventional wisdom says X. The data says Y.\' / \'X. But Y.\' / \'While X, Y\' when setting up opposition rather than concession',
    '   - EM-DASH CONTRAST: \'X — but Y\' / \'X — yet Y\' / \'X — though Y\' used as the structural pivot',
    '   Rewrite each as a positive construction — state what Y is and why it is the case, without setting it against X. If acknowledging a prevailing view is genuinely necessary, do it in two independent positive sentences with no contrast connector.',
    '',
    '3b. SECOND-PERSON ADDRESS — banned outright. Never speak to the reader as \'you\' or use rhetorical/hypothetical \'you\' (\'you should consider\', \'you might think\', \'imagine you are a CEO\', \'picture this scenario\', \'as you read this\'). The Brightbeam voice is third-person observational. The reader is implicit, never invoked.',
    '',
    '3c. SOFT IMPERATIVES — banned. Never instruct the reader to perform mental actions: \'Consider...\', \'Imagine...\', \'Picture...\', \'Take a moment to...\', \'Ask yourself...\', \'Notice that...\', \'Think about...\', \'Suppose...\'. State the observation directly.',
    '',
    '4. FORCED TRIPLING — three short clauses or adjectives in a row. Examples: \'The tools exist. The demand exists. The ROI is measurable.\' / \'Better stories. More inclusive language. Broader access.\' / \'faster, smarter, better\'. Cut to two or expand to a single descriptive sentence.',
    '',
    '5. Reductive fragment chains — \'None of this is X. All of it is Y.\' / \'Not fintech. Not legal. Healthcare.\' — sounds punchy, reads aggrieved. Rewrite in a single measured sentence.',
    '',
    '6. CLICKBAIT TITLES — \'The X Nobody Talks About\', \'The Y Nobody Is Making\', \'That\'s the Z\', \'Here\'s what you need to know about X\', \'The X, and here\'s why\'. Titles in Scott\'s canon are declarative statements or concept labels — \'Why Organisational Speed Now Defines Value\', \'AI Exposure Does Not Mean Job Loss\', \'Two Exponentials Driving the Next AI Wave\'. Rewrite the title.',
    '',
    '7. Pseudo-profundity (\'The key is...\', \'The reality is...\', \'At its core...\', \'The truth is...\', \'Here\'s the thing:\').',
    '',
    '8. Hollow intensifiers (incredibly, fundamentally, truly, absolutely, deeply, actually). Remove; the sentence almost always reads better.',
    '',
    '9. Aggrieved or strident framing (\'deserves more attention\', \'the industry keeps missing\', \'has been ignored\', \'nobody is making\'). Scott\'s voice is analytical, not complaining.',
    '',
    '10. Conclusive overstatement (\'this fundamentally changes...\', \'this is crucial because...\', \'earns a moat that no benchmark can match\', \'solves itself\', \'cannot be overstated\').',
    '',
    '11. Soft imperatives (\'Consider...\', \'Explore...\', \'Ask yourself...\', \'Take a moment to...\').',
    '',
    '12. Transition padding (\'This is where X comes in\', \'Enter: [solution]\', \'And that\'s where things get interesting\').',
    '',
    '13. Rhetorical question + immediate answer (\'Why does this matter? Because...\', \'What\'s the takeaway? Simple:\', \'The better question: ...\').',
    '',
    '14. THE \'MATTERS\' BAN — strict, no exceptions. The word "matters" is banned, and so is the construct: "X matters because Y", "This matters for Z", "What matters is W", "These matter because…". The pattern is the most reliable LLM tell — asserting significance instead of demonstrating it. Do NOT fix this by substitution (do not swap "matters" for "is significant" or "is important" — those are the same pattern). The fix is to RESTRUCTURE: in 90% of cases the sentence is padding and should be CUT entirely; the meaning is already in the surrounding sentences. In other cases the sentences either side need to be rewritten so the consequence is shown rather than asserted. Rarely a real connector sentence is needed — write the actual hinge (name the consequence/implication), don\'t reach for "matters" as a shortcut.',
  ].join('\n')
}

// ── Section: CEO empathy (the four lenses) ────────────────────
// Four lenses to apply when reading material as an industry CEO:
// systemic vs specific, control, empathy before influence, naivety.
// The prompt builders below wrap these lenses with role-framing.

export function buildCEOEmpathySection() {
  return [
    '1. SYSTEMIC vs SPECIFIC. The default assumption must be that the industry has not "got it wrong" — the situation reflects incentives in our complex global economic system and the structure of specific markets. Responsibility is systemic, not specific. FLAG anything that frames the industry, its leaders, or its workers as the cause of a problem when the cause is structural (regulation, capital allocation, market dynamics, customer expectations, accumulated history).',
    '',
    '2. CONTROL. CEOs do not control the macro environment, regulatory regimes, capital markets, geopolitics, or industry-wide path dependencies. FLAG criticism of things that lie outside what an executive can plausibly change. Criticism of decisions executives can make is fair; criticism of conditions they inherit is naive.',
    '',
    '3. EMPATHY before influence. The draft\'s job is to help the reader move forward, not to indict them. FLAG smug, schoolmasterly, sneering, or "told-you-so" tones. FLAG language that assumes the reader is behind, slow, resistant, or in denial. Build on the reader\'s perspective; do not lecture from above.',
    '',
    '4. NAIVETY. FLAG anything that betrays a lack of comprehension of how the industry actually works — supply chains, regulatory cycles, board dynamics, capital constraints, talent markets, the shape of revenue, customer concentration. If the writer wouldn\'t survive a five-minute conversation with a real CEO on this point, mark it.',
  ].join('\n')
}

// ── CEO critique prompt builder ─────────────────────────────

export function buildCEOCritiquePrompt(sector) {
  const label = SECTOR_CEO_LABELS[sector] || `CEO of a ${sector} company`
  return [
    `You are reading the following draft(s) as a ${label} would. This is your industry. Brightbeam is an AI consultancy that wants you and your peers as clients. The draft must not alienate you.`,
    '',
    'Your job: identify anything in the draft(s) that would make a thoughtful CEO in your industry roll their eyes, feel patronised, feel blamed for things outside their control, or judge that the writer does not understand how their business actually works.',
    '',
    'EDITORIAL FRAME — apply these four lenses:',
    '',
    buildCEOEmpathySection(),
    '',
    'Return a numbered list of specific corrections. For each:',
    '- QUOTE the problematic text from the draft (exact words, in single quotes)',
    '- STATE which lens it fails (1, 2, 3, or 4) and why a CEO in your industry would react badly',
    '- PROPOSE a corrected version that preserves the draft\'s editorial point but reframes systemically, acknowledges what the reader cannot control, or removes the smug/naive note',
    '',
    'If the draft has NONE of these issues, return the literal text NO CHANGES and nothing else.',
    '',
    'Be specific and tough. Brightbeam wants this CEO as a client.',
  ].join('\n')
}

// ── CEO revision instruction ────────────────────────────────

export function buildCEORevisionInstruction(consolidatedNotes) {
  return [
    'Apply every correction in the list below to the draft(s) above. Do not skip any.',
    '',
    'These corrections come from imagined readings by CEOs of the industries the draft(s) address. The corrections protect Brightbeam\'s relationship with those clients and potential clients.',
    '',
    'PRESERVE: the draft\'s editorial point, format header, bold title, body length (within ±20%), and ITEATE closer. Apply the corrections as surgical sentence-level rewrites — do not rewrite drafts wholesale.',
    '',
    'MULTI-DRAFT PRESERVATION: if the input contains multiple drafts, preserve ALL of them. Each draft keeps its own format header, bold title, body, and ITEATE closer.',
    '',
    'GUARDRAILS — do not break the existing voice in the process of fixing the empathy:',
    '- Do not introduce "matters" or any of its substitutes ("is significant", "is important", "is worth noting")',
    '- Do not introduce false contrasts ("Not X but Y", "isn\'t X, it\'s Y", "X, not Y")',
    '- Do not introduce first-person narrator ("I keep thinking", "I see this in my clients")',
    '- Do not introduce hollow intensifiers (incredibly, fundamentally, truly, deeply, actually)',
    '- Do not introduce "the reality is", "the key is", "the truth is", "at its core"',
    '- Do not introduce a "the X nobody talks about" headline pattern',
    '',
    'CRITICAL — output format. Your output is streamed directly to the user as the polished response. Begin with the literal characters `## Draft 1:` and nothing before. Do NOT narrate (no "Now I have applied..."), do NOT acknowledge the corrections list, do NOT add preamble. End after the last draft\'s ITEATE.',
    '',
    '## CEO CRITIQUE NOTES',
    '',
    consolidatedNotes,
  ].join('\n')
}
