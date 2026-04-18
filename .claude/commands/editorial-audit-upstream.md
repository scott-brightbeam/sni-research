Apply the Brightbeam editorial principles to upstream raw material in `data/editorial/state.json` — analysis entries, theme evidence, and backlog items — so the material is already clean before the drafting stage reads it.

**Model requirement:** Use Opus 4.7 with the 1M-context window (`claude-opus-4-7[1m]`). The audit reasons across batches of related material at once; 1M context is the point.

**Runs under your Claude Code subscription.** No external API calls, no metered cost. All reasoning is done in this session; the Bash script beneath is deterministic tooling (target selection, patch application, idempotency via `state.editorialAudits[]`).

## Instructions

### 1. Plan

Run this to get the list of targets and the audit system prompt:

```bash
bun scripts/editorial-audit-upstream.js --list-targets \
  --since "$(date -u -v-1d +%Y-%m-%d 2>/dev/null || date -u -d '1 day ago' +%Y-%m-%d)"
```

Alternative selection flags (use one):

- `--ids 44,T01:0,118` — audit specific items (numeric for analysis/backlog; `T##:N` for theme evidence)
- `--suggested-backlog` — retrofit: all `status: suggested` posts plus every analysis entry they cite
- `--limit N` — cap total targets per run

The command prints a single JSON object with `{ auditVersion, totalTargets, systemPrompt, batches: [{ batchIndex, targets, rendered }, …] }`. If `totalTargets === 0`, stop — there's nothing to do.

### 2. Reason

For each batch in `batches`, read its `rendered` text (the audit material) and apply the principles from the `systemPrompt` field AND from the shared preferences doc at `data/editorial/writing-preferences.md`.

**The four principle categories, each of which must be checked for every target:**

**A. Evidence calibration.** Every claim voiced at the level its evidence supports.

- Attribution test: named sources must be person + verifiable institution + published/institutionally-backed. Pseudonymous figures, podcast-guest claims cited as such, and unverifiable single-person claims FAIL — rewrite to de-attribute or cut.
- Voicing ladder: raw datum → state directly; inference → question or conditional; beyond three levels of inference → CUT.
- Source-document claims are NOT gospel. Claims that appeared in the transcript are themselves subject to the attribution test and voicing ladder.
- ITEATE earns its directness only if the body did the calibration work.

**B. The 14 must-catch style patterns.** First-person narrator, podcast framing, false contrasts (all variants), forced tripling, reductive fragments, clickbait titles, pseudo-profundity, hollow intensifiers, aggrieved framing, conclusive overstatement, soft imperatives, transition padding, rhetorical-question-plus-answer, and above all the **"matters" ban** (word AND construct — restructure or CUT, never substitute "is significant" / "is important" / "is worth noting").

**C. CEO empathy (four lenses).** Apply to ALL three output types:

1. **Systemic vs specific.** Responsibility lies in incentives and market structure, not in industry choices. Flag blame framed as industry/people when the cause is structural.
2. **Control.** Criticise decisions executives can make; never conditions they inherit.
3. **Empathy before influence.** No smug, schoolmasterly, told-you-so tones.
4. **Naivety.** If you wouldn't survive a five-minute conversation with a real CEO on the point, rewrite it.

**D. Prohibited vocabulary.** leverage, utilise, robust, streamline, delve, ecosystem, unlock, harness, paradigm, game-changer, landscape — cut.

### 3. Produce patches

For each target that breaches a principle, emit a patch. For each target that reads clean, emit nothing (its ID still ends up in `auditedTargetIds` so the next run skips it).

Write patches to a temp file — `/tmp/editorial-audit-patches-$(date +%s).json` — in this shape:

```json
{
  "analysisPatches": [
    { "id": "309", "field": "summary", "oldValue": "<exact current text>", "newValue": "<rewritten>", "ruleBroken": "matters-ban" }
  ],
  "themeEvidencePatches": [
    { "id": "T01:2", "field": "claim", "oldValue": "...", "newValue": "...", "ruleBroken": "attribution-test" }
  ],
  "backlogPatches": [
    { "id": "44", "field": "coreArgument", "oldValue": "...", "newValue": "...", "ruleBroken": "ceo-specific-not-systemic" }
  ],
  "auditedTargetIds": [
    { "kind": "analysis", "id": "309" },
    { "kind": "theme-evidence", "id": "T01:2" },
    { "kind": "backlog", "id": "44" }
  ]
}
```

Hard rules:

- **`oldValue` must match the current field text exactly** (whitespace differences are tolerated — line breaks are not). If you're uncertain, re-read the field with `jq '.analysisIndex["309"].summary' data/editorial/state.json` before writing the patch.
- **`newValue: null`** means "I cannot confidently rewrite this without breaking the editorial point" — the item is flagged in the audit log but the field is unchanged.
- Whitelisted fields: `summary`, `keyThemes`, `postPotentialReasoning` (analysis); `claim`, `content`, `significance` (theme evidence); `title`, `coreArgument`, `notes` (backlog). Patches to any other field are rejected by the applier.
- **Do NOT introduce a new banned pattern while fixing another.** Swapping "matters" for "is significant" is the same pattern. Restructure the sentence or cut it.
- **`auditedTargetIds` must include every target you reviewed**, whether it produced a patch or not. Clean-reviewed items are recorded in the audit log so future runs skip them.

### 4. Apply

```bash
bun scripts/editorial-audit-upstream.js --apply-patches /tmp/editorial-audit-patches-TIMESTAMP.json
```

The applier:

- Verifies `oldValue` matches current state (if not, the patch is skipped and logged — patches against stale snapshots must NOT silently corrupt the state).
- Writes new values via the existing write-validate-swap (`state.json.tmp` → parse-back → `.bak` backup → atomic rename).
- Appends one `editorialAudits[]` record per reviewed target (patched or clean) with `auditVersion`, `kind`, `id`, `patches: [...]`.

Print the applier summary to the user: how many patches applied, skipped, and clean-audits recorded.

### 5. Report

One short paragraph for the user:

- N targets reviewed across M batches
- X patches applied, Y skipped (stale oldValue), Z targets clean
- One or two representative examples of what changed, if any (quote the old and new values)

### Troubleshooting

- **Skipped patches (oldValue mismatch)**: state.json was edited between `--list-targets` and `--apply-patches`. Re-run `--list-targets` to pick up fresh content.
- **0 targets returned**: either everything in the window has already been audited at `auditVersion`, or the `--since` cutoff is too recent. Widen with `--since YYYY-MM-DD`, or use `--force-all-versions` to re-audit.
- **JSON too large for one reasoning pass**: the `--batch-size N` flag caps targets per batch. Default is 8; go lower if a single batch feels too much.
