# Draft Source-Claim Verification

Verify that every factual claim in the newsletter draft is supported by its linked source article.

## Process

For each factual claim in the draft that includes a markdown link `[claim](url)`:

1. **Identify the claim** — the specific number, quote, date, attribution or factual statement
2. **Read the source article** from `data/verified/` (find the article by matching the URL)
3. **Compare** — does the article actually contain the claimed information?

## Classification

Rate each claim:

- **VERIFIED** — the claim matches the source article. The number, quote or fact appears in the article text.
- **PARAPHRASED** — the concept is in the source but the wording differs. Acceptable if meaning is preserved.
- **UNVERIFIED** — the source article does not contain the claimed information. Flag with `[Editorial note: verify]`.
- **NO SOURCE** — the claim has no linked article. Flag for the editor.
- **PROJECTED** — external knowledge not from the linked source was imported into the claim. Flag if the projected information could be wrong.

## What to check

- Dollar figures and percentages
- Direct quotes (are these the speaker's actual words?)
- Attribution (is the claim attributed to the correct person/organisation?)
- Dates (did the event happen when the draft says it did?)
- Company/product names (spelled correctly, referring to the right entity?)
- Causal claims ('X caused Y' — does the source actually establish this causation?)

## Output

For each section of the draft, report:

```
## [Section name]
- [claim]: VERIFIED (source confirms)
- [claim]: UNVERIFIED — source says [actual text]. Suggested fix: [correction]
- [claim]: NO SOURCE — no linked article for this claim
```

## Rules

1. Read the actual article content — do not verify from memory
2. A claim is UNVERIFIED if the source says something different, even slightly
3. Paraphrasing is acceptable if meaning is preserved — flag only if meaning changes
4. Every UNVERIFIED claim must include what the source actually says and a suggested correction
5. Do not fabricate corrections — if you don't know the correct fact, flag it for editorial verification
