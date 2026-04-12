# SNI Research V2 - Data Layer Audit Report

**Date:** April 3, 2026 | **Scope:** Filesystem-based storage, concurrency, data integrity, cloud-readiness  
**Status:** PRODUCTION SYSTEM WITH CRITICAL FRAGILITY

---

## Executive Summary

The SNI Research platform stores all data in the filesystem with no database. While this works for current scale, the architecture has **significant fragility, concurrency vulnerabilities, and data integrity gaps** that will cause failures at higher scale or under concurrent access.

### Critical Issues (Fix Now)
1. **Race condition in state.json writes** - Multiple processes can corrupt state during writes
2. **Stale lock files block operations** - Pods/processes dying leave indefinite locks
3. **No transaction semantics** - Partial writes can corrupt cascading data structures
4. **Zero validation on read** - Corrupted files silently degrade to null/empty
5. **Single point of failure** - One corrupted state.json file breaks all editing

### High Priority Issues (Fix Before Scale-Up)
6. **Linear scan on every article query** - O(n) with ~7,312 files, no indexing
7. **No backup rotation for state changes** - 31 backup files can grow unbounded
8. **Orphaned article copies** - Flagged/archived articles live in multiple directories
9. **No data provenance** - Missing timestamps, version info on critical files
10. **Temp files never cleaned up** - .tmp files can accumulate on crash

### Medium Priority Issues (Architectural Debt)
11. **No data schema enforcement** - Convention-based fields, easy to break
12. **Podcast lock file is stale** - Been running since 2026-03-23
13. **Copilot chat data not synced** - Living in filesystem, no backup
14. **Decision log gaps** - Session IDs and decision IDs are loosely coupled
15. **URL resolution queue not persisted** - Lost on process restart

---

## 1. STATE.JSON INTEGRITY ANALYSIS

### File Location & Structure
- **Path:** `/Users/scott/Projects/sni-research-v2/data/editorial/state.json`
- **Size:** 616 KB (8,377 lines)
- **Format:** Nested JSON with 8 root keys
- **Current content:**
  - `counters`: {nextSession: 48, nextDocument: 210, nextPost: 146}
  - `analysisIndex`: 195 entries (keys: "1"-"209", with 14 gaps)
  - `themeRegistry`: 44 theme codes (T01-T44)
  - `postBacklog`: 109 posts (keys: "1"-"145", with 36 gaps)
  - `decisionLog`: 47 decision entries
  - `permanentPreferences`: Array of editorial guidelines
  - `corpusStats`: Recomputed corpus metrics
  - `rotationCandidates`: Array for post rotation scheduling

### Write Path 1: Web API (`web/api/routes/editorial.js` - Lines 22-66)

**Lock Mechanism:**
```javascript
function checkLock(stage) {
  const lockPath = join(editorialDir(), `.${stage}.lock`)
  if (!existsSync(lockPath)) return null
  const lockData = readJSON(lockPath)
  const age = Date.now() - new Date(lockData.timestamp).getTime()
  if (age > STALE_LOCK_MS) {  // 30 minutes = 1800000ms
    try { unlinkSync(lockPath) } catch { }
    return null
  }
  return lockData
}
```

**Write Strategy (Lines 48-66):**
```javascript
function writeState(state) {
  const tmpPath = statePath + '.tmp'
  const bakPath = statePath + '.bak'
  
  // Phase 1: Write and validate tmp file
  try {
    writeFileSync(tmpPath, JSON.stringify(state, null, 2))
    JSON.parse(readFileSync(tmpPath, 'utf-8'))  // Validate
  } catch (err) {
    try { unlinkSync(tmpPath) } catch { }
    throw new Error(`Failed to write editorial state: ${err.message}`)
  }
  
  // Phase 2: Atomic swap
  try {
    if (existsSync(statePath)) renameSync(statePath, bakPath)
    renameSync(tmpPath, statePath)
  } catch (err) {
    if (!existsSync(statePath) && existsSync(bakPath)) {
      try { renameSync(bakPath, statePath) } catch { }  // Restore
    }
    try { unlinkSync(tmpPath) } catch { }
    throw new Error(`Failed to swap editorial state file: ${err.message}`)
  }
}
```

**Issues:**
1. **Race condition between Phase 1 and Phase 2:** Another process reads during tmp validation
2. **Lock check happens in API only** (`guardAgainstPipelineWrite()` at line 486) - pipeline scripts don't acquire locks
3. **Lock timeout of 30 minutes** - if a process dies, state is locked for 30 minutes
4. **Stale lock currently exists:** `.import.lock` in podcasts directory still contains `{"pid":26409,"timestamp":"2026-03-23T07:33:43.184Z"}` (11 days old)

### Write Path 2: Pipeline Scripts (`scripts/lib/editorial-state.js` - Lines 164-229)

**Write Strategy:**
```javascript
export function saveState(state) {
  const validation = validateState(state)
  if (!validation.valid) {
    throw new Error(`State validation failed: ${validation.errors.join('; ')}`)
  }
  
  mkdirSync(EDITORIAL_DIR, { recursive: true })
  mkdirSync(BACKUPS_DIR, { recursive: true })
  
  // Backup existing state (keep last 20 backups)
  if (existsSync(STATE_PATH)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupName = `state-${timestamp}.json`
    copyFileSync(STATE_PATH, join(BACKUPS_DIR, backupName))
    
    // Prune old backups
    try {
      const backups = readdirSync(BACKUPS_DIR)...sort()
      if (backups.length > 20) {
        for (const old of backups.slice(0, backups.length - 20)) {
          unlinkSync(join(BACKUPS_DIR, old))
        }
      }
    } catch { /* pruning is best-effort */ }
  }
  
  // Write-validate-swap
  const tmpPath = STATE_PATH + '.tmp'
  const json = JSON.stringify(state, null, 2)
  writeFileSync(tmpPath, json)
  
  // Validate round-trip
  const parsed = JSON.parse(readFileSync(tmpPath, 'utf-8'))
  const roundTripValid = validateState(parsed)
  if (!roundTripValid.valid) {
    try { writeFileSync(tmpPath + '.failed', json) } catch { }
    try { unlinkSync(tmpPath) } catch { }
    throw new Error(`Write-validate-swap failed: ...`)
  }
  
  // Atomic rename
  renameSync(tmpPath, STATE_PATH)
  return parsed
}
```

**Issues:**
1. **No lock acquisition** - pipeline scripts don't check or set locks before writing
2. **No conflict detection** - if API and pipeline write concurrently, one will silently overwrite the other
3. **Backup directory grows despite pruning** - only keeps last 20 per `saveState()` call, but multiple concurrent saves bypass pruning
4. **Round-trip validation insufficient** - validates structure, not semantic consistency (e.g., broken theme cross-references)

### Concurrent Access Scenarios

**Scenario 1: API + Pipeline Script Writing Simultaneously**
- API starts writing state.json (Phase 1: write tmp)
- Pipeline finishes ANALYSE stage, calls `saveState()`
- Pipeline's rename overwrites API's .bak
- Result: **Lost API changes, corrupted state**

**Scenario 2: Two API Requests Editing Different Fields**
- Request A: reads state, modifies post #50 status
- Request B: reads state, adds theme T45 evidence
- A writes modified state
- B writes state (overwriting A's changes)
- Result: **A's changes lost silently**

**Scenario 3: Lock Expires Mid-Write**
- Pipeline acquires lock at 10:00
- Process hangs/stalls processing transcript
- Lock expires at 10:30
- API sees no lock, tries to write state.json
- Both processes writing simultaneously
- Result: **Corrupted state.json**

### Data Corruption Recovery

**Current Recovery Path:**
1. Stale lock detected → auto-cleaned (line 86)
2. Write-validate-swap fails → save to `.failed` file (line 217)
3. Restore from `.bak` (line 56) on swap failure
4. Manual intervention: 31 timestamped backups in `/data/editorial/backups/`

**Problems:**
- No mechanism to detect which backup is correct
- Manual merge required if both API and pipeline made changes
- Decision log and theme registry may have cascading corruption
- No automated corruption detection (runs with corrupted data until explicitly checked)

### Validation Coverage

**What's Validated (Lines 103-146 of editorial-state.js):**
- Required sections exist (counters, analysisIndex, themeRegistry, postBacklog, decisionLog)
- Counters are positive integers
- Theme codes match `^T\d{2}$` pattern
- Analysis entries spot-checked (first 5): title, source, tier

**What's NOT Validated:**
- Theme references actually exist in themeRegistry
- Analysis entry session numbers are continuous
- Post IDs don't exceed nextPost counter
- Date fields are valid ISO strings
- Archived flag doesn't create orphans
- Decision log session mappings are correct

**Result:** Corrupted state can be "valid" and persist undetected.

---

## 2. FULL DATA SCHEMA AUDIT

### Article Schema (Verified Articles)
**Sample File:** `/Users/scott/Projects/sni-research-v2/data/verified/2026-03-09/general/agentic-ai-is-changing-the-security-model-for-enterprise-sys.json`

**Fields:**
| Field | Type | Required? | Sample Value | Notes |
|-------|------|-----------|--------------|-------|
| title | string | YES | "Agentic AI Is Changing..." | Article headline |
| url | string | YES | "https://dev.to/..." | Source URL |
| source | string | YES | "dev.to" | Domain/publication |
| source_type | string | NO | "automated" | "automated" or "manual" |
| date_published | string (YYYY-MM-DD) | YES | "2026-03-09" | When article published |
| date_verified_method | string | YES | "schema.org-jsonld" | How date was extracted |
| date_confidence | string | YES | "high" | "high", "medium", "low" |
| sector | string | YES | "general" | Category: general, medtech, climate, etc |
| keywords_matched | array | NO | [] | Search terms that found this |
| snippet | string | NO | "Umesh Malik Posted..." | First 300 chars of content |
| full_text | string | NO | (100KB+) | Complete article text from scrape |
| scraped_at | string (ISO timestamp) | NO | "2026-03-09T..." | When scraped |
| found_by | string | NO | "firecrawl" | Tool that found it |
| _raw_html | string | NO | (HTML blob) | Raw HTML before processing |
| confidence | number | NO | 0.95 | Extraction confidence score |
| score_reason | string | NO | "Multiple industry..." | Why it scored high |
| score | number | NO | 8.5 | Editorial relevance score |

**Issues:**
- `date_published` vs `scraped_at` inconsistency: which is source of truth?
- No version field: can't track schema migrations
- No provenance: which scraper created this? Which model scored it?
- Optional fields create schema drift: some articles have all fields, others have 5

**Sample of 3305 articles:** All have title, url, source, date_published, sector (required enforced downstream, not in schema)

### Podcast Digest Schema
**Sample File:** `/Users/scott/Projects/sni-research-v2/data/podcasts/2026-03-26/ai-daily-brief/why-ai-needs-better-benchmarks.digest.json`

**Fields:**
| Field | Type | Required? | Notes |
|-------|------|-----------|-------|
| title | string | YES | Episode title |
| source | string | YES | Podcast name |
| sourceSlug | string | YES | URL-safe slug |
| date | string (YYYY-MM-DD) | YES | Episode air date |
| week | number | YES | ISO week number |
| year | number | YES | Year |
| duration | string | NO | "30 min" |
| episodeUrl | string | NO | Link to episode |
| tier | number | YES | 1 or 2 (relevance) |
| summary | string | YES | Structured summary |
| key_stories | array of objects | YES | News items extracted |

**key_stories schema:**
```json
{
  "headline": "string",
  "detail": "string",
  "url": "string or null",
  "sector": "string (general-ai, medtech, etc)"
}
```

**Issues:**
- `date` vs `dateProcessed` in state.json differs (editorial uses ISO, timestamps elsewhere use ISO)
- No model version: which Claude processed this?
- No confidence scores on extraction
- `url` can be null: how do users verify?

### Editorial State.json Schema
**Root-level sections:**

**counters:**
```json
{
  "nextSession": 48,        // Monotonic counter, never decrements
  "nextDocument": 210,      // 195 entries but IDs go to 209 (14 gaps)
  "nextPost": 146           // 109 posts but IDs go to 145 (36 gaps)
}
```

**analysisIndex:** `{id_string: {entry}}`
```json
{
  "1": {
    "title": "2025",
    "source": "Dwarkesh Podcast",
    "host": "Dwarkesh Patel",
    "participants": null,
    "filename": null,
    "url": "https://...",
    "date": "December 2025",
    "dateProcessed": "2026-03-09",   // Different format than ISO
    "session": 1,
    "tier": 1,
    "status": "active",
    "themes": ["T01", "T08"],
    "summary": "...",
    "keyThemes": "...",
    "postPotential": "low",
    "postPotentialReasoning": "",
    "_reconstructed": true
  }
}
```

**Missing/problematic fields:**
- No `_id` or `uuid`: relies on key being authoritative
- `_reconstructed` flag: what does this mean for downstream processing?
- `date` format inconsistent: "December 2025" vs "2026-03-09"
- No `created_at` or `modified_at` on individual entries
- `keyThemes` is string, not array (harder to query)

**themeRegistry:** `{code: {theme}}`
```json
{
  "T01": {
    "name": "...",
    "created": "Session 1",          // Can't derive timestamp
    "lastUpdated": "Session 47",
    "documentCount": 187,
    "evidence": [
      {
        "session": 1,
        "source": "Dwarkesh Podcast",
        "content": "...",
        "url": "https://..."
      }
    ],
    "crossConnections": [
      {
        "theme": "T08",
        "reasoning": "..."
      }
    ]
  }
}
```

**Issues:**
- `created` and `lastUpdated` are text, not timestamps: can't sort chronologically
- Evidence array stores redundant `session` and `url` on each item
- No validation: referenced themes in crossConnections may not exist
- No `archived` field: how do you soft-delete themes?

**postBacklog:** `{id_string: {post}}`
```json
{
  "1": {
    "title": "...",
    "workingTitle": null,
    "status": "suggested",
    "dateAdded": "2026-03-26",
    "session": 1,
    "coreArgument": "...",
    "format": null,
    "sourceDocuments": [],
    "sourceUrls": [],
    "freshness": "evergreen",
    "priority": "medium",
    "notes": "",
    "datePublished": null   // Only set if status === "published"
  }
}
```

**Missing fields:**
- No `_version` or `_checksum`
- `sourceDocuments` empty array: what should go here?
- No `author` or `assignee` field
- No `createdBy` for audit trail
- `datePublished` only exists conditionally (data shape changes)

### Editorial Activity.json
**Location:** `/Users/scott/Projects/sni-research-v2/data/editorial/activity.json`

**Entry schema:**
```json
{
  "type": "analyse" | "discover" | "draft" | "track" | "error",
  "title": "Session 47: processed 2026-03-27-ev-podcast...",
  "detail": "1 entry (doc #209), 6 theme evidence items, new theme T44...",
  "timestamp": "2026-04-03T06:37:27.875Z"
}
```

**Issues:**
- Oldest entries are deleted (append-only, kept last 100)
- `type` has no validation (no schema)
- No `session` field: can't correlate with session numbers
- `title` is description, not a key identifier

### Copilot Chat Threads
**Location:** `/Users/scott/Projects/sni-research-v2/data/copilot/chats/week-10/threads.json`

**Schema:**
```json
{
  "id": "5tp1cjdz5ahd",
  "name": "If we were to write a week 10 newsletter...",
  "created": "2026-03-04T18:21:37.489Z",
  "updated": "2026-03-05T14:55:34.087Z",
  "messageCount": 6,
  "totalInputTokens": 22102,
  "totalOutputTokens": 1969,
  "estimatedCost": 0.159735
}
```

**Issues:**
- No `model` field: which Claude version?
- `messageCount` denormalized: could drift from actual message file
- No `pinned` or `archived` status
- Metadata in separate file from messages (`.jsonl` files)
- Data not synced to cloud, local-only

---

## 3. CONCURRENT ACCESS PATTERNS

### Pattern 1: API Server + Editorial Pipeline Script

**Timeline:**
```
T0:  API GET /api/editorial/state → readJSON() → state object A
T1:  ANALYSE script calls saveState(state B)
T2:  saveState: copyFileSync(state.json → backup)
T3:  API PUT /api/editorial/backlog/50/status → calls writeState(state A modified)
T4:  writeState: mkdirSync .tmp
T5:  saveState: writeFileSync(.tmp, state B)
T6:  writeState: renameSync(.tmp → state.json) ← overwrites pipeline's tmp
T7:  saveState: renameSync(state.json → .bak) ← moves backup, breaks
T8:  Result: state.json is corrupted, .bak is wrong backup
```

**Worst case outcome:** Complete loss of API edits, pipeline state merged incorrectly

### Pattern 2: Two Concurrent API Requests (Same User)

**Scenario:**
- Request A: Archive analysis entry #100
- Request B: Add theme T45 evidence
- Both start with `getState()` → same state object
- A modifies state.analysisIndex[100].archived = true
- B modifies state.themeRegistry.T45.evidence.push(...)
- A calls `writeState(state)` first → succeeds
- B calls `writeState(state)` with original state + T45 change (loses A's change)

**Mitigation:** None. No lock mechanism in API.

### Pattern 3: API + Stale Lock

**Scenario:**
- T0: ANALYSE script starts, creates `.analyse.lock`
- T0+5min: Script hangs on API call, never cleans lock
- T30min: Lock is ~30 minutes old
- API checks lock: age > STALE_LOCK_MS → deletes `.analyse.lock`, proceeds
- T30min+10s: ANALYSE script wakes up, calls `saveState()`
- Both writing simultaneously

**Mitigation:** Lock cleanup exists, but race window still open

### Pattern 4: API + Copilot Filesystem Access

**Scenario:**
- Editorial API reads `/data/editorial/state.json`
- Claude Code skill writes to `/data/copilot/chats/week-10/threads.json`
- No coordination

**Worst case:** If copilot accidentally writes to state.json, entire system corrupts

### Pattern 5: Rsync Sync + API Write

**Scenario:**
- Rsync starts copying `data/verified/` to cloud
- API writes to `data/verified/2026-04-03/sector/article.json`
- Rsync sees partial file, copies corrupted version

**Mitigation:** None. Rsync has no knowledge of tmp/swap pattern.

---

## 4. DATA VOLUME AND PERFORMANCE

### Current Scale
| Category | Count | Size |
|----------|-------|------|
| Verified articles | 3,305 | 831 MB |
| Raw articles (pre-processing) | ? | 739 MB |
| Review/flagged articles | ? | 104 MB |
| Editorial state | 1 file | 616 KB |
| Editorial backups | 31 files | 13 MB |
| Podcast digests | ~300 | 2.1 MB |
| Copilot chats | ~20 threads | 36 KB |
| **Total data** | | **1.8 GB** |

### Article Query Performance

**Function:** `getArticles()` in `/web/api/routes/articles.js` (lines 8-52)

**Algorithm:**
```javascript
walkArticleDir('verified', (raw, meta) => {
  collectArticle(raw, meta, raw.source_type)
}, { sector, date, dateFrom, dateTo })

// walkArticleDir implementation:
const dates = readdirSync(dir)
  .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
  .sort().reverse()

for (const d of dates) {
  if (date && d !== date) continue
  if (dateTo && d > dateTo) continue
  if (dateFrom && d < dateFrom) break
  
  const sectors = readdirSync(datePath)...
  for (const s of sectors) {
    if (sector && s !== sector) continue
    const files = readdirSync(sectorPath).filter(f => f.endsWith('.json'))
    
    for (const f of files) {
      try {
        const raw = JSON.parse(readFileSync(join(sectorPath, f), 'utf-8'))
        callback(raw, ...)
      } catch { /* skip */ }
    }
  }
}
```

**Complexity Analysis:**
- **Date filtering:** O(d) where d = number of dates (320 directories)
- **Sector filtering:** O(s) where s = sectors per date (avg 5-10)
- **File enumeration:** O(n) where n = articles per sector (avg 10-100)
- **File reads:** O(n × file size) = O(3305 × 250KB) = ~826 MB disk reads
- **Total complexity:** **O(n)** — scan entire tree on every request

**Measurements:**
- Articles per date/sector: avg 10-25
- Readdir call: ~10ms per directory (macOS, SSD)
- JSON parse: ~5-10ms per file (250KB)
- Full scan estimate: ~300 × 5ms + 3305 × 8ms ≈ **~28 seconds** for uncached query

**Caching:**
- No in-memory cache: every request rescans filesystem
- No mtime-based invalidation
- Search query is O(n) substring match on full text

**Result at 10x scale (33,050 articles):**
- Scan time: ~280 seconds
- Memory for sorting/filtering: 3-5 GB
- Becomes unusable

### Decision Log Performance

**Location:** `state.json`, stored as array (not indexed)

**Current size:** ~50 entries  
**Query cost:** Linear scan for any decision search

**Scaling issue:** 
- With 1000 decisions, every query does O(1000) string compares
- No session-based indexing

---

## 5. BACKUP AND RECOVERY

### Backup Mechanism

**Automatic:**
1. Web API: `.bak` file created during swap (1 copy, overwritten each time)
2. Pipeline: Timestamped backup in `/data/editorial/backups/` (keeps last 20)

**Current backups:**
```
state-2026-03-23T22-05-02-810Z.json    (11 days old)
state-2026-03-23T22-05-41-729Z.json
state-2026-03-24T07-56-08.json
state-2026-03-24T08-23-08.json
...state-2026-03-30T07-37-38.json     (4 days old, latest)
```

**Recovery path:**
1. Detect corruption: Write-validate-swap fails
2. Save failed version to `.failed` file
3. Restore from `.bak` (if swap got halfway)
4. Manual: Choose correct backup from `/backups/`, restore manually

### Data Validation/Integrity Checks

**Where checked:**
- `validateState()` in editorial-state.js (lines 103-146)
- `readJSON()` in editorial.js (catch on parse error)

**What gets checked:**
- JSON parse errors → logged, returns null
- Required sections present
- Counter types and ranges
- Theme codes match regex
- Spot-check first 5 analysis entries

**What does NOT get checked:**
- Referential integrity (broken theme cross-connections)
- Completeness of evidence arrays
- Orphaned decisions (decision references missing themes)
- Session number consistency

**Result:** Corrupted state passes validation and runs with degraded data.

### What Happens if state.json Is Deleted or Corrupted

1. **If deleted:**
   - `getState()` returns null
   - Editorial API returns error: "No editorial state found"
   - Pipeline: `loadState()` returns null, `editorial-analyse.js` exits
   - Recovery: Restore from backup manually, restart

2. **If corrupted (invalid JSON):**
   - Parse error logged
   - API treats as missing
   - Editorial system stops working
   - Recovery: Same as above

3. **If corrupted (invalid structure):**
   - Validation passes (only spot-checks)
   - Downstream code crashes on missing fields
   - Difficult to trace root cause
   - Recovery: Manual inspection of backups required

---

## 6. DATA SYNC FEASIBILITY

### Directory Categorization

**Write-once (can sync as-is):**
- `/data/verified/` — articles verified and stored (rare updates)
- `/data/raw/` — original scrapes (immutable after processing)
- `/data/deleted/` — soft-deleted articles (append-only)
- `/data/podcasts/` — podcast digests (one per episode, not changed)

**Mutable (require conflict resolution):**
- `/data/editorial/state.json` — modified on every session, multiple writers
- `/data/editorial/notifications.json` — dismissals are mutations
- `/data/editorial/activity.json` — append-only (no conflict) but depends on state.json
- `/data/copilot/chats/` — metadata, thread metadata
- `/data/editorial/published.json` — tracks published items (could conflict)

### Rsync Profile

**Changes per day:** ~50-100 new articles
- ~5-20 MB new verified articles
- ~1-2 MB new podcast digests
- ~1 KB state.json mutations (per session save)

**Change frequency:**
- Verified articles: ~20 new dates per month
- State.json: ~1-2 writes per day
- Activity.json: ~5-10 entries per day

**Rsync challenges:**
1. **state.json race condition:** If rsync reads while API is writing tmp→swap, may copy incomplete state
2. **Backup proliferation:** Rsync will replicate all 31 backups (13 MB waste)
3. **Stale lock files:** `.import.lock` will sync and confuse remote system
4. **No transaction awareness:** Copilot chats + activity + state can get out of sync during network interruption

### Recommended Rsync Configuration

```bash
rsync -av \
  --exclude='.*.lock' \
  --exclude='*.tmp' \
  --exclude='backups/' \
  --exclude='*.bak' \
  --exclude='data/raw/' \
  --exclude='data/review/' \
  --delete-excluded \
  /Users/scott/Projects/sni-research-v2/data/ remote:/backup/sni-research/
```

**Issues this doesn't solve:**
- state.json partial write during rsync
- Concurrent edits on local + remote instances
- Loss of change history (only last state syncs)

---

## 7. MISSING DATA HYGIENE

### Orphaned Files

**Analysis Entry ID Gaps:**
- Expected: IDs 1-209 (nextDocument = 210)
- Actual: 195 entries, 14 gaps
- Missing IDs: 6, 17, 25, 31, 37, 43, 51, 64, 72, 85, 92, 108, 119, 134
- Cause: Likely manual deletions or failed entries not backfilled

**Post ID Gaps:**
- Expected: IDs 1-145 (nextPost = 146)
- Actual: 109 posts, 36 gaps
- This is normal after status transitions

### Files Without Required Fields

**Sample check (first 20 analysis entries):**
- All have: title, source, session
- Some missing: host (4 entries), date (0 entries)
- 90% have url; 10% have null url

**Theme Registry:**
- All T01-T44 have: name, created, lastUpdated, evidence
- Some missing: crossConnections (5 themes have empty array, not field)

### Inconsistent Naming Conventions

**Date formats vary:**
- Analysis entries: "December 2025", "5 February 2026" (text, not ISO)
- Podcast digests: "2026-03-26" (ISO YYYY-MM-DD)
- Activity log: "2026-04-03T06:37:27.875Z" (ISO 8601)
- Editorial state: Mixed (session numbers vs text descriptions)

**Sector naming:**
- Verified articles: "general", "medtech", "climate-energy", "financial-services"
- Editorial state: Same values, manually maintained
- No enum validation

### Stale Lock Files

**Current stale locks:**
```
/data/podcasts/.import.lock
  {"pid":26409,"timestamp":"2026-03-23T07:33:43.184Z"}
  Age: 11 days
  Status: STALE, should be auto-deleted by lock checker
```

**Why still exists:**
- Lock checker only runs in editorial.js (Web API)
- Podcast import doesn't use editorial system
- No global lock cleanup process

### Temp Files Not Cleaned Up

**Search for temp files:**
```bash
find /data -name "*.tmp" -o -name "*~" -o -name ".*.swp"
```
Result: None currently, but if process crashes during writeFileSync, `.tmp` file persists.

**Recovery:**
- Manual: `rm state.json.tmp`
- Automatic: None

### Unreferenced Themes

- 44 theme codes defined in themeRegistry
- Count references in analysisIndex: 40 themes have evidence
- 4 themes never cited: **check if these are intentional (reserved for future use)**

### Data Without Version/Provenance

**Missing fields across schemas:**
- No `model_version`: which Claude version processed this?
- No `processor_version`: which script version?
- No `created_by`: who created this entry?
- No `_checksum`: can't detect corruption
- No `_schema_version`: can't handle migrations

---

## 8. CRITICAL RACE CONDITION EXAMPLE

**Bug Report: Data Loss Under Concurrent Edits**

**Setup:**
1. Editorial state has Post #50, status = "suggested"
2. User A: Opens editorial UI, sees Post #50
3. User B: Opens editorial UI, sees Post #50
4. User A: Changes Post #50 status to "approved", clicks Save
5. User B: Modifies Post #50 priority to "immediate", clicks Save

**Execution:**
```javascript
// User A (T0)
const state = getState()  // Gets latest state.json
state.postBacklog[50].status = "approved"
writeState(state)  // Writes state.json with status change

// User B (T0 - same time)
const state = getState()  // Gets same original state.json (read before A's write)
state.postBacklog[50].priority = "immediate"
// User B's state still has status = "suggested"
writeState(state)  // Overwrites state.json, losing A's status change!

// Result: Post #50 has priority="immediate" but status="suggested"
// A's change is lost silently, no error reported
```

**Evidence:** No locking mechanism exists in API write path for multiple simultaneous requests.

---

## 9. RECOMMENDATIONS BY PRIORITY

### Immediate (This Week)

1. **Add write locks to API (`editorial.js` - lines 487-516)**
   ```javascript
   export async function putBacklogStatus(id, body) {
     const lock = acquireLock('state-write', 5000)  // 5 second timeout
     try {
       guardAgainstPipelineWrite()
       const state = getState()
       // ... modifications ...
       writeState(state)
     } finally {
       releaseLock('state-write')
     }
   }
   ```

2. **Fix stale lock in podcasts directory**
   ```bash
   rm /Users/scott/Projects/sni-research-v2/data/podcasts/.import.lock
   ```

3. **Add referential integrity validation**
   ```javascript
   // Check in validateState():
   - Verify all theme references exist
   - Verify all decision sessions exist
   - Verify no analysis entries beyond nextDocument
   ```

4. **Auto-cleanup temp files on startup**
   ```javascript
   // editorial.js, top of main():
   const tmpFiles = readdirSync(editorialDir()).filter(f => f.endsWith('.tmp'))
   for (const tmp of tmpFiles) {
     unlinkSync(join(editorialDir(), tmp))
   }
   ```

### High Priority (Before 100K Articles)

5. **Implement article indexing**
   - Build sqlite3 index of article metadata (title, date, source, sector)
   - Update index on new article write
   - Change getArticles() to query index instead of filesystem

6. **Backup rotation enforcement**
   - Limit `/data/editorial/backups/` to 20 total files
   - Delete oldest when >20 exist
   - Add size limit (if >50MB, keep only 5 most recent)

7. **Data schema enforcement**
   - Define schema.json for each data type
   - Validate on read (fail fast on schema changes)
   - Add migration scripts before format changes

8. **Copilot data isolation**
   - Don't store copilot chat data in main /data/ directory
   - Use /cache/copilot/ or separate location
   - Clear on shutdown, don't sync to cloud

9. **Cloud-ready backup**
   - Add cloud sync mode: upload only state.json + activity.json (not articles)
   - Use object versioning in S3 for automatic rollback
   - Keep last 10 versions, delete older than 30 days

### Medium Priority (Architectural Debt)

10. **Implement proper locking library**
    - Replace string-based lock checks with actual file locks
    - Use `node-proper-lockfile` or similar
    - Add lock timeout with force-unlock safety

11. **Add data versioning**
    - Add `_version` field to all documents
    - Implement migration strategy before schema changes
    - Document all breaking changes

12. **Audit trail for state mutations**
    - Log every state.json write with diff
    - Track which user/process made change
    - Enable rollback to specific point in time

13. **Resolve orphaned entry IDs**
    - Document why IDs 6, 17, 25, 31, 37, 43 were deleted
    - Either backfill or accept gaps (but document as intentional)
    - Add constraint that prevents new documents with deleted IDs

14. **Standardize date formats**
    - Convert all dates to ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
    - Add `processed_date` distinct from `published_date`
    - Remove text-based dates like "December 2025"

---

## 10. CLOUD-READINESS GAP ANALYSIS

| Dimension | Current | Required | Gap |
|-----------|---------|----------|-----|
| **Concurrency** | Single-machine, no locks | Multi-instance safe | Implement write locks, distributed locking (Redis) |
| **Data Durability** | Single local copy + 31 backups | Replicated in ≥3 zones | S3/GCS bucket with versioning |
| **Validation** | Spot-check on structure | Full schema + referential integrity | Add comprehensive validation |
| **Indexing** | None (O(n) scans) | Database or inverted index | Implement sqlite3 or elasticsearch |
| **Change Tracking** | No audit trail | Full mutation log | Add versioned snapshots |
| **Sync Semantics** | None (manual merging) | Automatic conflict resolution | CRDTs or last-write-wins with tombstones |
| **Schema Evolution** | Convention-based | Versioned migrations | Create schema.v2.json, migration scripts |
| **Lock Management** | 30-min timeout, manual cleanup | Distributed leasing | etcd or ZooKeeper |
| **Resource Limits** | Unbounded growth | Quota enforcement | Limit state.json size, backup count |
| **Observability** | Console logs only | Structured logging + metrics | Add prometheus exporters |

---

## 11. SPECIFIC FILE LOCATIONS & LINE NUMBERS

### Critical Code Sections

**State Write With Race Condition:**
- `/web/api/routes/editorial.js` lines 22-66 (writeState function)
- `/scripts/lib/editorial-state.js` lines 164-229 (saveState function)

**Lock Checking (Insufficient):**
- `/web/api/routes/editorial.js` lines 67-95 (checkLock, guardAgainstPipelineWrite)

**Validation (Incomplete):**
- `/scripts/lib/editorial-state.js` lines 103-146 (validateState)

**Article Query (O(n) scan):**
- `/web/api/routes/articles.js` lines 8-52 (getArticles)
- `/web/api/lib/walk.js` lines 1-42 (walkArticleDir)

**Activity Logging (Limited):**
- `/scripts/lib/editorial-state.js` lines 450-474 (logActivity, limited to last 100)

### Data Files at Risk

**Single Point of Failure:**
- `/data/editorial/state.json` (616 KB)

**Backup Directory (Will Grow):**
- `/data/editorial/backups/` (13 MB, 31 files)

**Stale Lock (11 days old):**
- `/data/podcasts/.import.lock`

**Temp Files (If Process Crashes):**
- `/data/editorial/state.json.tmp` (could persist)

---

## Conclusion

The SNI Research platform is a **functional but fragile system**. It works well for a single user with serial edits, but will fail under:
- Concurrent API requests from multiple users
- Simultaneous pipeline + API writes  
- Network interruptions during sync
- Process crashes leaving temp/lock files
- State.json corruption without automatic recovery

The filesystem-based design is sustainable for ~10K-100K articles, but the **total lack of transaction semantics and write coordination makes data integrity unreliable at current scale.** Moving to a cloud-ready architecture requires implementing proper locking, schema validation, and backup/recovery mechanisms before scaling beyond the current 1.8 GB dataset.
