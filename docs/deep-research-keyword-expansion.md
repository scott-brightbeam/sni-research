# Deep Research Brief: SNI Sector Keyword Expansion

## Context

I run an automated AI news intelligence pipeline (SNI — Sector News Intelligence) that classifies articles into five sectors. Classification works by keyword matching against the article title + first 800 characters. Each sector has three keyword groups:

- **Required Any Group 1 (AI terms):** Article must contain at least one. These signal the article has an AI/ML angle. **THIS LIST IS IDENTICAL FOR ALL SECTORS — one canonical set.**
- **Required Any Group 2 (Sector terms):** Article must also contain at least one. These are terms specific to the sector's domain.
- **Boost (Company/brand names):** Not required, but increase relevance score when present. These surface articles about major players.

Both required groups must match (AND logic). Within each group it's OR logic (any one term is enough). Matching is case-insensitive against title + opening text only.

### Foundational principle

**Group 1 (AI terms) is a single canonical list shared identically across all five sectors.** It must never diverge per sector. Any term that only makes sense for one sector (e.g. "digital twin" for manufacturing, "algorithm" for medtech) belongs in that sector's Group 2, not in Group 1. Company names (OpenAI, Anthropic, etc.) also do not belong in Group 1 — they go in Group 2 or Boost for the relevant sector.

## The five sectors

1. **General AI** — Frontier AI labs, model releases, AI infrastructure, AI policy/regulation, compute/chips, AI safety, agentic AI, enterprise AI platforms
2. **Pharma & Biopharma** — AI in drug discovery, clinical trials, regulatory submissions, genomics, precision medicine, biotech
3. **MedTech** — AI in medical devices, diagnostic imaging, surgical robotics, digital health, wearables, FDA device clearances
4. **Complex & Advanced Manufacturing** — AI in semiconductor fabrication, industrial robotics, factory automation, digital twins, predictive maintenance, supply chain
5. **Insurance** — AI in underwriting, claims, actuarial science, insurtech, reinsurance, parametric insurance, regulatory compliance

## Current keywords (baseline — what exists today)

### Group 1 — AI terms (current, inconsistent across sectors)

The union of all terms currently scattered across sectors:
AI, artificial intelligence, machine learning, deep learning, generative AI, foundation model, large language model, LLM, algorithm, digital twin, physical AI, AI-powered, AI-driven

### Group 2 — Sector terms (current)

**Biopharma:** pharma, biopharma, drug discovery, drug development, clinical trial, FDA approval, FDA clearance, EMA approval, biotech, biopharmaceutical, oncology, genomics, proteomics, therapeutics, small molecule, biologics, vaccine, mRNA, cell therapy, gene therapy

**MedTech:** medical device, medtech, FDA clearance, 510(k), De Novo, digital health, diagnostic imaging, medical imaging, AI-enabled imaging, diagnostic AI, AI diagnostics, surgical robot, surgical system, radiology AI, pathology AI, clinical decision support, wearable health, continuous glucose, CGM, implantable, AI-powered health, health AI, healthcare AI

**Manufacturing:** semiconductor, chip manufacturing, chip fabrication, wafer, fab, HBM, memory chip, advanced manufacturing, industrial AI, factory automation, predictive maintenance, supply chain AI, manufacturing AI, robotics, humanoid robot, industrial robot, autonomous robot, robot, automation, manufacturing

**Insurance:** insurance, insurtech, underwriting, claims processing, actuarial, reinsurance, insurance broker, insurer, cat bond, catastrophe bond, parametric insurance

**General AI:** OpenAI, Anthropic, Google DeepMind, DeepMind, Meta AI, Mistral, xAI, Cohere, AWS Bedrock, Azure OpenAI, Google Cloud AI, agentic AI, AI agents, AI regulation, AI safety, AI model release, AI funding, hyperscaler, AI startup, AI model, chatbot, AGI, GPT, language model, AI company, AI investment, AI chip, AI assistant, AI tool, AI software, AI platform, AI benchmark

### Boost — Companies (current)

**Biopharma:** Merck, Eli Lilly, Pfizer, Roche, AstraZeneca, Novartis, Bristol Myers, BMS, Takeda, Sanofi, Genentech, Regeneron, Moderna, Isomorphic, BioSpace, BioPharma, Grail, Ireland, Irish

**MedTech:** Medtronic, GE HealthCare, Siemens Healthineers, Philips Healthcare, Abbott, Boston Scientific, Stryker, Intuitive Surgical, iRhythm, Butterfly Network, Dexcom, Senseonics, MedTech Dive, MassDevice

**Manufacturing:** Samsung Electronics, TSMC, Intel, NVIDIA, SK hynix, ASML, Siemens, Foxconn, ABB, Rockwell Automation, Fanuc, Agility Robotics, GlobalFoundries

**Insurance:** Munich Re, Swiss Re, AIG, Allianz, Zurich Insurance, Lloyd's, Aviva, Gallagher, Marsh, Aon, mea Platform, Lockton, Insurance Journal, Intelligent Insurer, ERGO

**General AI:** (none currently)

## What I need you to research and produce

### 1. Group 1 — One canonical AI terms list (shared by ALL sectors)

Research what AI/ML terminology appears across all five sectors' trade press. Produce a single comprehensive list. Include:

- Core AI/ML terms (AI, artificial intelligence, machine learning, deep learning, etc.)
- Emerging AI terminology used in 2025–2026 coverage (agentic AI, reasoning model, small language model, multimodal AI, etc.)
- Common abbreviations and variants (LLM, NLP, NLU, CV, GenAI, SLM, RAG, etc.)
- Compound AI phrasings that unambiguously signal AI (AI-powered, AI-driven, AI-enabled, AI-assisted, etc.)
- Exclude: terms that are ambiguous without context ("algorithm", "analytics", "automation", "model" alone, "neural" alone) — these cause false positives
- Exclude: company names — those belong in Group 2 or Boost
- Exclude: sector-specific AI phrasings (e.g. "computational drug design") — those belong in that sector's Group 2

### 2. Group 2 — Sector terms (one list per sector)

For each of the five sectors, research the domain vocabulary that appears in specialist trade press. Include:

**For all sectors:**
- Industry sub-segments and specialties
- Regulatory bodies, frameworks and submission types
- Technical processes, methodologies and product categories
- Common industry abbreviations
- Sector-specific AI phrasings that wouldn't make sense in Group 1 (e.g. "computational drug design", "computer-aided detection", "digital twin", "physical AI")

**Specific gaps I know exist (but research comprehensively, don't limit to these):**
- Biopharma: missing CRISPR, antibody, Phase I/II/III/IV, CRO, CDMO, pharmacovigilance, real-world evidence, companion diagnostic, precision medicine, target identification, hit-to-lead, lead optimisation, ADMET, pharmacokinetics, biomarker, IND, NDA, BLA, EUA, MHRA, PMDA, orphan drug, rare disease, biosimilar, ADC (antibody-drug conjugate), RNA interference, siRNA, PROTAC, molecular glue
- MedTech: missing EHR, EMR, PACS, telemedicine, telehealth, remote patient monitoring, RPM, SaMD (software as medical device), IVD, in vitro diagnostic, point of care, POCT, interoperability, HL7, FHIR, PMA, IDE, breakthrough device, QSR, ISO 13485, MDR, IVDR, CE marking, Class I/II/III
- Manufacturing: missing CNC, additive manufacturing, 3D printing, SCADA, PLC, MES, ERP, Industry 4.0, Industry 5.0, smart factory, IIoT, industrial IoT, edge computing, cobots, collaborative robot, AGV, AMR, pick and place, vision inspection, SPC, lean manufacturing, six sigma, lights-out manufacturing, reshoring, nearshoring, CHIPS Act, foundry, EUV lithography, packaging (in chip context), CoWoS, chiplet
- Insurance: missing loss ratio, combined ratio, Solvency II, IFRS 17, ORSA, telematics, usage-based insurance, UBI, embedded insurance, microinsurance, claims automation, fraud detection, risk modelling, catastrophe modelling, nat cat, peril, exposure management, MGA, MGU, program business, surplus lines, E&S, workers compensation, cyber insurance, D&O, professional indemnity, liability insurance, property insurance, casualty
- General AI: terms like AI model, frontier model, open source model, benchmark, MMLU, token, inference, fine-tuning, RLHF, constitutional AI, chain-of-thought, prompt engineering, API, embedding, vector database, retrieval-augmented generation should probably be here rather than just in search queries

### 3. Boost — Companies, brands and publications (one list per sector)

For each sector, research and provide:

- **Top 25–40 companies** by market presence in that sector (global scope, not just US)
- **Notable AI-focused startups and scale-ups** in each sector (2024–2026 vintage, ones appearing in news)
- **Key industry publications** whose names appear in article text as relevance signals
- **Common abbreviations and trading names** (e.g. "J&J" for Johnson & Johnson, "GSK" for GlaxoSmithKline, "BMS" for Bristol-Myers Squibb)
- **For General AI specifically:** frontier labs (OpenAI, Anthropic, Google DeepMind, Meta AI, Mistral, xAI, Cohere, Stability AI, etc.), major AI companies (NVIDIA, AMD, Broadcom, etc.), cloud/compute providers, prominent AI startups (Perplexity, Hugging Face, Databricks, Scale AI, etc.), key publications (The Information, Semafor, etc.)

### Output format

For each sector, provide three clearly labelled lists. Format as simple comma-separated values:

```
## Sector Name

### Group 1 — AI Terms (CANONICAL — same for all sectors)
[only list once, at the top]

### Group 2 — Sector Terms
term1, term2, term3, ...

### Boost — Companies & Publications
company1, company2, company3, ...
```

Flag any terms with a ⚠️ that might cause false positives, with a brief explanation why.

## Important constraints

- Terms are matched **case-insensitively** against article title + first 800 characters
- **Short terms (2–3 chars)** like "AI", "ML" are fine in Group 1 but risky in Group 2 (e.g. "fab" alone matches "fabulous", "MES" could match names)
- **Company names must be distinctive** enough not to match unrelated content (e.g. "Apple" alone is too generic, but "Apple Health" is fine for medtech; "Meta" alone might be OK given context, but "Amazon" alone is too broad)
- **No need to duplicate terms** already in my current lists — but do include them if you think they should stay, so I have a complete picture
- **Prioritise terms that actually appear in news article text**, not academic jargon that journalists wouldn't use
- **Geographic scope is global** — include European, Asian and emerging market companies and regulatory bodies, not just US
