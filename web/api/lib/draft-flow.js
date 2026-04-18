/**
 * draft-flow.js — Pure helpers for the editorial-chat draft pipeline.
 *
 * Extracted from routes/editorial.js so the logic is unit-testable and
 * the streaming handler in the route stays focused on I/O.
 *
 * The pipeline is:
 *   1. Build the draft-mode system-prompt addendum (buildDraftAddendum)
 *   2. Generate the draft (streaming, possibly across tool rounds)
 *   3. Detect whether the accumulated text looks like a finished draft
 *      (detectDraftOutput) — including multi-draft outputs
 *   4. If it does, run an internal style audit + revision pass
 *   5. Otherwise, strip the tool-call narrative and stream what we have
 *      (extractDraftContent)
 */

// ── Draft-mode system-prompt addendum ────────────────────────
// Deliberately avoids "write ONE complete draft". The writing preferences
// file (data/editorial/writing-preferences.md) mandates THREE format
// options per first draft, and the UI (Editorial.jsx) hard-codes
// "Generate THREE complete drafts..." on backlog-triggered requests.
// Forcing ONE here caused the 17 Apr 2026 multi-draft regression.
export function buildDraftAddendum(isDraftMode) {
  if (!isDraftMode) return ''
  return [
    '',
    '',
    'IMPORTANT — draft mode. Follow this exact workflow:',
    '',
    'STEP 1 — Gather source material via tools (up to 6 tool rounds).',
    '  Fetch: the backlog item (get_backlog_item), the source analysis entry (get_analysis_entry), at least 2 reference posts in candidate formats (search_published_posts + get_published_post). Stop calling tools as soon as you have enough to draft.',
    '',
    'STEP 2 — WRITE THE DRAFTS. This is the primary deliverable.',
    '  Once you stop calling tools, your next response MUST contain the drafts. Do NOT end your turn without producing them. Do NOT say "I have what I need" — just start writing.',
    '',
    'FORMAT — Three drafts, one of each format, chosen from:',
    '  1. News Decoder — current event → deeper signal',
    '  2. Concept Contrast — stark before/after comparison',
    '  3. Quiet Observation — smaller, sharper insight others miss',
    '  4. Practitioner\'s Take — how Scott actually does the thing',
    '  5. Behavioural Paradox — surprising contradiction → psychology → framework',
    '  6. Honest Confession — genuine mistake or evolution in thinking',
    '',
    'STRUCTURE — Each draft MUST have:',
    '  - Header: `## Draft 1: News Decoder` (or the chosen format)',
    '  - Bold title line: `**The Title Here**`',
    '  - Body (200-400 words, UK English, Scott\'s analytical observer voice)',
    '  - ITEATE closer starting with "So what\'s today\'s in-the-end-at-the-end?" — 1-3 sentences that crystallise, never restate',
    '',
    'VOICE — critical, and the place drafts most often break:',
    '  - Third-person analytical, NOT first-person confessional. Scott is not the subject of his own posts.',
    '  - NEVER write: "I keep thinking", "I see this in my clients", "I think more importantly", "From my experience", "What I find interesting" — none of these appear in Scott\'s canon.',
    '  - "We" is fine and expected for Brightbeam collective voice: "At Brightbeam we...", "Yesterday we wrote...", "We expect that...".',
    '  - Cite sources briefly and factually. "Research from Anthropic suggests X" ✓. "Chamath Palihapitiya\'s post pulled 1.2m views" ✓. "On the [X] podcast this week, [person] said Y" ✗. Never foreground the medium.',
    '',
    'STYLE — Obey the prohibited-language list strictly:',
    '  No false contrasts (\'Not X but Y\'), no pseudo-profundity (\'The reality is...\'), no hollow intensifiers (actually, incredibly, fundamentally), no reductive fragment chains (\'None of this. All of it.\'), no aggrieved framing (\'deserves more attention\', \'the industry keeps missing\'). Scott\'s voice is analytical and humane, not strident or confessional.',
    '',
    'OUTPUT — Go straight into `## Draft 1:` once tools are done. No preamble like "Here are three drafts" or "I\'ll now draft" — just the drafts, back-to-back.',
  ].join('\n')
}

// ── Draft output detection ──────────────────────────────────
// Returns true when the accumulated text from the initial generation
// looks like a draft (single or multi) that warrants the style audit.
// Previously only checked for "in-the-end-at-the-end", which missed
// multi-draft outputs where the first draft hadn't reached its ITEATE
// by the time generation ended or truncated.
export function detectDraftOutput(text, { willAudit = true, minLength = 300 } = {}) {
  if (!willAudit) return false
  if (typeof text !== 'string' || text.length < minLength) return false
  const lower = text.toLowerCase()
  if (lower.includes('in-the-end-at-the-end')) return true
  // Multi-draft markers: "## DRAFT 1", "Draft 1:", "**Draft 1**",
  // "Format 1:", or a numbered heading with a format name after it.
  if (/(?:^|\n)\s*(?:#{1,3}\s*)?draft\s*\d\b|(?:^|\n)\s*(?:#{1,3}\s*)?format\s*\d\b/i.test(text)) return true
  // Markdown-style draft sections with common format names
  if (/(?:^|\n)\s*#{1,3}\s*(?:news\s*decoder|concept\s*contrast|quiet\s*observation|practitioner|behavioural|honest\s*confession)/i.test(text)) return true
  return false
}

// ── Draft extraction ─────────────────────────────────────────
// When the audit pass can't run (e.g. a short output that doesn't look
// like a draft but isn't empty either), the fallback path streams
// whatever we have to the user. This helper strips the model's
// inter-tool narrative ("I'll start by gathering the source material…",
// "Good, I have enough context. Let me now draft the posts.") so the
// user sees the content rather than the process. If no draft markers
// are found, return the text unchanged.
export function extractDraftContent(text) {
  if (typeof text !== 'string' || !text) return text

  // Search for the first draft-start marker. Markers may appear mid-line
  // (streamed tool narrative concatenated with the first heading, no
  // intervening newline) so we DON'T anchor to line-start. Order matters:
  // prefer the explicit DRAFT N heading, then FORMAT N, then a format-
  // named heading, then an opening bold-title after a --- rule.
  const candidates = [
    /#{1,3}\s*draft\s*\d\b/i,
    /#{1,3}\s*format\s*\d\b/i,
    /#{1,3}\s*(?:news\s*decoder|concept\s*contrast|quiet\s*observation|practitioner|behavioural\s*paradox|honest\s*confession)/i,
    /---\s*\n+\s*\*\*[^*\n]+\*\*/,
  ]
  let bestIdx = -1
  for (const re of candidates) {
    const match = text.match(re)
    if (match && match.index != null) {
      if (bestIdx === -1 || match.index < bestIdx) bestIdx = match.index
    }
  }
  if (bestIdx === -1) return text

  // Back up to the closest preceding newline so headings render on their
  // own line in the stream. If there's no newline before the match,
  // prepend two newlines so downstream renderers see a clean boundary.
  const prefix = text.slice(0, bestIdx)
  const lastNewlineBefore = prefix.lastIndexOf('\n')
  if (lastNewlineBefore === -1) {
    return '\n\n' + text.slice(bestIdx).trimStart()
  }
  return text.slice(lastNewlineBefore + 1).trimStart()
}

// ── Audit prompt builder ────────────────────────────────────
// Multi-draft aware audit system prompt. Mentions "draft(s)" and
// reminds the auditor that the output may contain several drafts in
// different formats, each with its own opening and closer.
export function buildAuditSystemPrompt({ vocabSection = '' } = {}) {
  return [
    'You are a writing style auditor. Compare the draft(s) against the reference posts and rules below. Be ruthless — false positives are better than missed patterns.',
    '',
    'The draft output may contain a SINGLE post or MULTIPLE posts in different LinkedIn formats (News Decoder, Concept Contrast, Quiet Observation, Practitioner\'s Take, Behavioural Paradox, Honest Confession). When multiple drafts are present, audit EACH one independently and report corrections per-draft.',
    '',
    'Return ONLY a numbered list of specific corrections. For each: quote the problematic text, state what rule it breaks, give the corrected replacement text.',
    '',
    'EVIDENCE CALIBRATION — the highest-priority audit category. Over-claim is the hallmark of LLM writing and must be eliminated:',
    '',
    'A. ATTRIBUTION TEST. Every named source in the draft must pass:',
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
    '',
    'MUST-CATCH STYLE PATTERNS — these appear nowhere in Scott\'s canon and must be flagged every time. Scan for each one explicitly:',
    '',
    '1. First-person narrator (\'I keep thinking\', \'I see this in my clients\', \'I think\', \'From my experience\', \'What I find interesting is\'). Scott writes third-person. Rewrite as observation.',
    '',
    '2. Podcast/source framing as conversational context (\'on the [X] podcast this week\', \'last Thursday on [show], [person] said...\', \'[name], the pseudonymous culture commentator\'). Cite sources BRIEFLY and FACTUALLY — never foreground the medium or the occasion.',
    '',
    '3. FALSE CONTRASTS — all forms. This is the hardest pattern to eliminate; check for ALL variants:',
    '   - \'Not X but Y\' / \'not from X but Y\' / \'not for X but for Y\'',
    '   - \'The question isn\'t X, it\'s Y\'',
    '   - \'X isn\'t just Y - it\'s Z\' (including variants like \'doesn\'t just capture X. It Y.\', \'not only X but also Y\')',
    '   - \'Less about X, more about Y\' / \'X is more than just Y\'',
    '   - \'The constraint is X, not Y\' / \'X, not Y\' as punchy closer',
    '   Rewrite each as a positive construction — state what Y is and why it matters, without setting it against X.',
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
    '',
    'ALSO CHECK:',
    '- Prohibited vocabulary (leverage, utilise, robust, streamline, delve, ecosystem, unlock, harness, paradigm, etc.)',
    '- Single quotes only (never double)',
    '- Opening-line concreteness — specific person/company/number/event, not abstract framing',
    '- ITEATE quality — each draft must CRYSTALLISE a fresh insight, not restate the argument',
    '- Evidence citation pattern: named source + specific figure + editorial interpretation',
    '- Brightbeam "we" voice is allowed and expected for collective positioning lines (\'At Brightbeam we...\', \'We expect that...\'). Solo \'I\' narrator is NOT.' + vocabSection,
  ].join('\n')
}

// ── Sector detection ────────────────────────────────────────
// Identifies which of the five SNI sectors a draft addresses, so the
// CEO empathy critique below can run one read per sector mentioned.
// Heuristic, deterministic — keyword/entity match, not an LLM call.
// If no sector-specific signal is present, the draft is treated as
// general-ai (the default audience for AI-industry-wide observations).
export const SECTORS = ['general-ai', 'biopharma', 'medtech', 'manufacturing', 'insurance']

const SECTOR_PATTERNS = {
  biopharma: /\b(pharma(?:ceutical)?|biotech|drug\s+(?:discovery|development|design|pipeline)|FDA\s+approval|clinical\s+trial|biologic|small\s+molecule|oncolog|vaccine|gene\s+therapy|cell\s+therapy|NICE|EMA|Pfizer|Moderna|Roche|Novartis|GSK|AstraZeneca|MSD|Merck|Eli\s+Lilly|Sanofi|Boehringer|Bayer|Novo\s+Nordisk|Phase\s+[123]|indication|biomarker|pharmacolog|therapeutic|patent\s+cliff)\b/i,
  medtech: /\b(medical\s+device|MRI|CT\s+scan|ultrasound|surgical\s+robot|surgical|implant|diagnostic\s+device|FDA\s+510|CE\s+mark|hospital\s+workflow|EHR|EMR|patient\s+monitor|cardiac\s+rhythm|orthopaedic|orthopedic|in\s+vitro\s+diagnostic|IVD|catheter|endoscop|Medtronic|Boston\s+Scientific|Stryker|Edwards\s+Lifesciences|Intuitive\s+Surgical|Siemens\s+Healthineers|GE\s+Healthcare|Philips\s+Healthcare)\b/i,
  manufacturing: /\b(factory|factories|supply\s+chain|OEE|\bMES\b|\bERP\b|automotive|industrial|lean\s+manufacturing|six\s+sigma|industry\s+4\.0|smart\s+factory|smart\s+manufacturing|plant\s+floor|assembly\s+line|throughput|SCADA|\bPLC\b|industrial\s+IoT|\bIIoT\b|Foxconn|Bosch|Honeywell|GE\s+Vernova|Schneider\s+Electric|Rockwell|Mitsubishi\s+Electric|shop\s+floor)\b/i,
  insurance: /\b(insurer|insurance|premium|underwriting|underwriter|claims\s+handling|reinsuran|actuarial|policyholder|risk\s+pool|actuary|loss\s+ratio|combined\s+ratio|catastrophe\s+model|cat\s+model|catastrophe\s+bond|Lloyds|AIG|Allianz|\bAXA\b|Swiss\s+Re|Munich\s+Re|\bAon\b|Marsh\s+(?:McLennan|&)|Willis\s+Towers|Aviva|Zurich\s+Insurance|Travelers\s+Insurance)\b/i,
  'general-ai': /\b(frontier\s+model|foundation\s+model|AI\s+(?:safety|alignment|lab|developer|company|industry|sector|policy|governance|regulation)|OpenAI|Anthropic|DeepMind|Mistral|Cohere|xAI|Hugging\s+Face|Llama|Claude|GPT-?\d|Gemini|reasoning\s+model|context\s+window|inference\s+cost|model\s+release|capability\s+overhang|RLHF|fine[- ]tuning|pre[- ]training)\b/i,
}

export function detectSectors(text) {
  if (typeof text !== 'string' || !text) return ['general-ai']
  const found = new Set()
  for (const [sector, pattern] of Object.entries(SECTOR_PATTERNS)) {
    if (pattern.test(text)) found.add(sector)
  }
  if (found.size === 0) found.add('general-ai')
  return SECTORS.filter(s => found.has(s))
}

// ── CEO critique prompt builder ─────────────────────────────
// Reads the draft from the perspective of an industry CEO. Brightbeam
// wants these CEOs as clients — the critique catches anything that
// would alienate them: blame for things outside their control,
// systemic-as-specific framing, smug or naive notes.
export const SECTOR_CEO_LABELS = {
  'general-ai': 'CEO of an AI-native technology company',
  biopharma: 'CEO of a global pharmaceutical company',
  medtech: 'CEO of a global medical device manufacturer',
  manufacturing: 'CEO of a global industrial manufacturer',
  insurance: 'CEO of a global insurance company',
}

export function buildCEOCritiquePrompt(sector) {
  const label = SECTOR_CEO_LABELS[sector] || `CEO of a ${sector} company`
  return [
    `You are reading the following draft(s) as a ${label} would. This is your industry. Brightbeam is an AI consultancy that wants you and your peers as clients. The draft must not alienate you.`,
    '',
    'Your job: identify anything in the draft(s) that would make a thoughtful CEO in your industry roll their eyes, feel patronised, feel blamed for things outside their control, or judge that the writer does not understand how their business actually works.',
    '',
    'EDITORIAL FRAME — apply these four lenses:',
    '',
    '1. SYSTEMIC vs SPECIFIC. The default assumption must be that the industry has not "got it wrong" — the situation reflects incentives in our complex global economic system and the structure of specific markets. Responsibility is systemic, not specific. FLAG anything that frames the industry, its leaders, or its workers as the cause of a problem when the cause is structural (regulation, capital allocation, market dynamics, customer expectations, accumulated history).',
    '',
    '2. CONTROL. CEOs do not control the macro environment, regulatory regimes, capital markets, geopolitics, or industry-wide path dependencies. FLAG criticism of things that lie outside what an executive can plausibly change. Criticism of decisions executives can make is fair; criticism of conditions they inherit is naive.',
    '',
    '3. EMPATHY before influence. The draft\'s job is to help the reader move forward, not to indict them. FLAG smug, schoolmasterly, sneering, or "told-you-so" tones. FLAG language that assumes the reader is behind, slow, resistant, or in denial. Build on the reader\'s perspective; do not lecture from above.',
    '',
    '4. NAIVETY. FLAG anything that betrays a lack of comprehension of how the industry actually works — supply chains, regulatory cycles, board dynamics, capital constraints, talent markets, the shape of revenue, customer concentration. If the writer wouldn\'t survive a five-minute conversation with a real CEO on this point, mark it.',
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
// Applies the consolidated CEO critique notes to the draft. Same
// streaming/output rules as the style revision — straight into
// `## Draft 1:`, no preamble, preserve all drafts.
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

// ── Revision prompt builder ──────────────────────────────────
// Explicitly instructs the model to preserve ALL drafts if multiple
// are present, and to strip any pre-draft narrative.
export function buildRevisionInstruction(auditText) {
  return [
    'Apply every correction in the list below to the draft(s) above. Do not skip any.',
    '',
    'MULTI-DRAFT PRESERVATION: if the input contains multiple drafts, preserve ALL of them. Each draft keeps its own format header, bold title, body, and ITEATE closer.',
    '',
    'HOW TO APPLY each correction:',
    '- Locate the exact quoted text in the draft.',
    '- Apply the correction. If the correction is a simple word swap, swap. If the correction requires RESTRUCTURING (false contrasts, forced tripling, clickbait titles cannot be fixed by word swaps — they need sentence-level rewriting), restructure.',
    '- If applying one correction causes another violation, fix that too.',
    '',
    'VERIFY before returning. Scan your output and confirm it contains NONE of these patterns. If any survive, rewrite:',
    '- \'Not X but Y\' (including \'not from X but Y\', \'not for X but Y\', \'rather than X, Y\', \'not through X but Y\')',
    '- \'X, not Y\' as a punchy closer (e.g. \'the constraint is ambition, not capability\')',
    '- \'isn\'t X, it\'s Y\' / \'isn\'t X. It\'s Y.\' / \'wasn\'t X but Y\' / \'doesn\'t X. It Y.\'',
    '- \'X isn\'t just Y — it\'s Z\' / \'not only X but Y\' / \'X, but it\'s also Y\'',
    '- Any three short clauses in a row (\'The tools exist. The demand exists. The ROI is measurable.\')',
    '- Any three short noun phrases as sentences (\'Better stories. More inclusive language. Broader access.\')',
    '- Clickbait titles: \'The X Nobody Talks About\', \'That\'s the Y\', \'Here\'s why X\', \'The X Problem (And the Fix)\'',
    '- Foregrounded podcast/medium framing (\'on the [X] podcast\', \'on [show] this week\')',
    '- First-person narrator (\'I keep thinking\', \'I see this\', \'from my experience\')',
    '- Hollow intensifiers: actually, incredibly, truly, fundamentally, deeply',
    '- The word "matters" anywhere — and the construct it creates ("X matters because Y", "This matters for…", "What matters is…"). Do not substitute "is significant" / "is important" / "is worth noting" — same pattern. CUT the sentence (it\'s usually padding) or restructure so the consequence is shown, not asserted.',
    '',
    'If the ITEATE closer uses any of these patterns, rewrite it. The ITEATE is the final impression; it must be clean.',
    '',
    'CRITICAL — output format. Your output is streamed directly to the user as the polished response. Begin with the literal characters `## Draft 1:` and nothing before. Do NOT:',
    '- Narrate your evaluation process (\'Now I have the full picture...\', \'The source fails the attribution test...\', \'Let me apply the corrections precisely...\')',
    '- Acknowledge the corrections list (\'I\'ve applied all 20 corrections...\', \'Here are the revised drafts...\')',
    '- Add any preamble, transition text, or meta-commentary before the first draft header',
    '- Include audit notes, correction explanations, or post-draft commentary',
    '- Inter-tool narrative (\'Let me fetch...\', \'Good, I have enough...\')',
    '',
    'The user reads exactly what you write. Anything before `## Draft 1:` becomes garbage in their UI. Start with the draft header. End after the last draft\'s ITEATE.',
    '',
    '## CORRECTIONS TO APPLY',
    '',
    auditText,
  ].join('\n')
}
