# Podcast Commentary Format

The podcast section is the editorial voice of the newsletter — original analysis, not episode recap.

## MANDATORY PRE-FLIGHT (read this first)

Before writing a single word of the podcast section:

1. Read `data/podcasts/manifest.json` and list every entry where `week === {current week}`
2. For each matching entry, read the digest at `digestPath` to get the host name, exact podcast title, summary, and `url` / `episodeUrl`
3. Write down the list of available podcasts for this week. This is your whitelist.

**Every podcast reference in the section MUST come from this list.** The host name must match a digest. The podcast name must match a digest's `source` field. The episode URL must match the digest's `url` or `episodeUrl` field.

If you cannot produce an argumentative section from the available digests, write a shorter section, drop a sub-heading, or write a single paragraph disclaimer. **Never invent references.** A post-write verifier (`scripts/editorial-verify-draft.js`) blocks drafts containing unverifiable podcast references — this is not a judgement call. Either the reference is in the whitelist or the draft fails.

Known blocked references (seeded from the Week 15 2026 incident): The AI Exchange, Stratechery podcast, Sinica Podcast, Insurance Innovators Podcast, InsureTech Connect podcast. Do not cite these even if they seem to fit — they are not in the SNI pipeline.

## Section heading

```
## But what set podcast tongues a-wagging?
```

## Structure

3-4 podcast episodes, each presented as an editorial argument — not as a summary of what the host said.

### Opening item

The first item has NO sub-heading. It opens with a specific data point or claim from a named host, with an inline link to the episode mid-sentence:

> [Azeem Azhar on the Exponential View](https://url): his personal AI usage went from 150,000 tokens per day to 870 million in a single day this week — a 5,800x increase.

This opening data point should be the week's most striking podcast moment.

### Subsequent items

Each subsequent item uses a `### ` sub-heading that states an argumentative claim — NOT the episode title:

> ### 60% of companies are exaggerating AI's role in layoffs. The data is clear.

> ### The submarine problem is a workforce problem. And it's yours too.

The heading makes a claim. The paragraph below supports it with evidence from the episode.

### Per-item format

1. **Factual claim** with inline attribution link: `[host name on podcast name](episode-url)` — appears mid-paragraph, not listed below
2. **Evidence development** — specific data points, quotes, named examples from the episode
3. **Implications** for the newsletter's audience: enterprise leaders in regulated industries. The last item should explicitly draw cross-sector parallels.

## Mandatory rules

1. **Zero URL overlap** with any story linked in the tl;dr or sector bullet sections above. Check every URL before including it. If a podcast story was already linked above, find a DIFFERENT insight from the same episode.
2. **No episode recap.** Do not describe what the host discussed. State what the episode reveals and why it matters.
3. **Inline links only.** The podcast URL appears as a markdown link mid-sentence, attributed to the host: `[host name on podcast name](url)`. Never list podcast links below the paragraph.
4. **Cross-sector implications.** At least one item should explicitly connect the podcast insight to multiple sectors covered in the newsletter.

## Worked example (Week 13)

The submarine problem is a workforce problem. And it's yours too.

Chris Power (CEO, Hadrian) and Admiral Robert Goucher [on the a16z podcast](https://a16z.simplecast.com/episodes/submarines-and-the-future-of-defense-manufacturing) described American submarine manufacturing: decades of industrial decline, a skilled workforce that doesn't exist in sufficient numbers, and a technology intervention compressing the timeline. Power: 'Three years ago it was incredibly difficult and now... is pretty fast.' The mechanism isn't AI replacing welders. There aren't enough welders to replace. Software multiplies the output of the ones who exist. The defence context adds a structural accelerant — single-person authority replacing distributed multi-stakeholder accountability — that isn't available in commercial manufacturing. But the underlying logic transfers: when you cannot hire your way to the precision workforce your industry requires, verification and amplification of scarce human skill becomes the primary lever. That's as true in pharmaceutical manufacturing, semiconductor fabrication and specialist insurance underwriting as it is in submarine hulls.

Note: argumentative heading, inline podcast link, specific quotes, cross-sector implications drawn explicitly.
