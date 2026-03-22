# Attribution UI Design

## Goal

Add a Sources page showing query/layer productivity across all pipeline runs, plus found_by badges in the article detail panel. This is Phase 2 of the multi-layer sourcing project — the pipeline changes (Phase 1) are on branch `claude/lucid-sinoussi`.

## Architecture

Two new API endpoints in `web/api/routes/sources.js`. One new React page `Sources.jsx` with a `useSources` hook. Minor addition to the existing article detail panel in `Articles.jsx`.

All data comes from existing files: `data/last-run-*.json` (run stats), `data/source-health.json` (feed/headline source health), and article JSONs (found_by arrays).

## Prerequisites

The multi-layer sourcing branch must be merged to master first. Until then, only the Mar 5 test run has `queryStats`/`headlineStats`. The UI handles old-format runs gracefully (layerTotals: null).

---

## API Endpoints

### `GET /api/sources/overview`

Single endpoint for page load. Globs all `data/last-run-*.json`, reads each, pre-aggregates layer totals server-side.

```json
{
  "runs": [
    {
      "date": "2026-03-05",
      "saved": 510,
      "flagged": 92,
      "fetchErrors": 584,
      "paywalled": 489,
      "elapsed": "11257s",
      "layerTotals": {
        "L1": { "queries": 69, "saved": 120, "errors": 45 },
        "L2": { "queries": 25, "saved": 80, "errors": 12 },
        "L3": { "queries": 30, "saved": 95, "errors": 20 },
        "L4": { "queries": 207, "saved": 180, "errors": 90 },
        "headlines": { "sources": 5, "found": 376, "errors": 2 },
        "rss": { "saved": 35, "errors": 0 }
      }
    },
    {
      "date": "2026-03-04",
      "saved": 59,
      "flagged": 8,
      "fetchErrors": 12,
      "paywalled": 15,
      "elapsed": "234s",
      "layerTotals": null
    }
  ],
  "health": {
    "Financial Times AI": { "lastSuccess": "...", "consecutiveFailures": 0, "lastError": null },
    "Harvard Business Review AI": { "lastSuccess": null, "consecutiveFailures": 1, "lastError": "HTTP 404" }
  }
}
```

**Layer aggregation logic:** Parse queryStats key prefixes — keys starting with `"L1:"` aggregate into L1, `"L2:"` into L2, etc. `"HL:"` prefix aggregates into headlines. RSS totals come from run stats fields directly (saved minus query-attributed saves, or from feedStats if present).

**Old-format runs:** No `queryStats` key → `layerTotals: null`. Basic stats (saved, flagged, fetchErrors, paywalled, elapsed) still present.

### `GET /api/sources/runs/:date`

Full query-level detail for drill-down. Only loaded when user selects a specific run.

```json
{
  "date": "2026-03-05",
  "saved": 510,
  "window": { "startDate": "2026-02-27", "endDate": "2026-03-05" },
  "queryStats": {
    "L1: biopharma OpenFold3 AI structural biology consortium Februar": {
      "results": 20, "new": 20, "saved": 2, "paywalled": 0, "errors": 2
    }
  },
  "headlineStats": {
    "sources": 5, "headlines": 148, "searched": 148, "found": 376, "errors": 2
  }
}
```

For old-format runs: `queryStats: null, headlineStats: null` with basic stats only.

---

## Sources Page Layout

Four sections, top to bottom:

### Header bar

- Page title "Sources" on the left
- Run selector dropdown on the right (dates from `runs[]`, newest first)
- Selected run shows inline summary: "510 saved, 584 errors, 489 paywalled — 3h 7m"
- Old-format runs show: "59 saved, 12 errors — 3m 54s (legacy run)"

### Section 1: Articles Over Time (stacked area chart)

- X-axis: dates from all runs
- Y-axis: article count
- Stacked areas: L1, L2, L3, L4, Headlines, RSS (each a distinct colour)
- Old-format runs show as single "Total" area (grey)
- Hover tooltip shows per-layer breakdown for that date
- Inline SVG (same approach as Dashboard sector bar chart — no charting library)
- Full width, ~200px tall

### Section 2: Layer Summary (cards)

- Six horizontal cards: L1, L2, L3, L4, Headlines, RSS
- Each card shows: saved count, error count, query count
- Colour-coded by layer
- Greyed out for legacy runs (layerTotals: null)
- Cards show data from the currently selected run

### Section 3: Query Table

Appears when a new-format run is selected. Data loaded lazily via drill-down endpoint.

- Sortable table: Label | Results | New | Saved | Paywalled | Errors
- Search box filters by query text
- Layer filter buttons (L1, L2, L3, L4, HL) — toggleable, multi-select
- Rows colour-coded by layer (subtle left border)
- Sorted by Saved descending by default
- For old-format runs: "No per-query data available for this run" placeholder

### Section 4: Source Health

- Table: Source Name | Status | Last Success | Failures | Last Error
- Status indicator: green (0 failures), amber (1-2), red (3+)
- Always visible regardless of selected run

---

## found_by in Article Detail Panel

In `Articles.jsx`, add "Discovered by" field to the existing metadata `<dl>`:

- Colour-coded badges for each `found_by` entry
- Badge format: layer prefix tag (L1, L2, L3, L4, RSS, HL) + truncated query text on hover tooltip
- Multiple discoveries: all badges in a wrapping row
- Missing/empty found_by: "Unknown" in muted text
- No new hook — data comes from existing article detail fetch

---

## Data Flow

### useSources hook

```
web/app/src/hooks/useSources.js
```

On mount: `GET /api/sources/overview` → sets overview (runs + health), auto-selects newest run.

`selectRun(date)`:
- Updates selected run summary from overview data
- If `layerTotals !== null`: fetches `GET /api/sources/runs/:date`
- Caches detail in a `Map<date, detail>` to avoid refetching
- If `layerTotals === null`: sets detail to null (old run)

Return shape:

```js
{
  overview: {
    runs: [...],
    health: {...}
  },
  selectedRun: {
    summary: { date, saved, flagged, layerTotals, ... },
    detail: { queryStats, headlineStats, window } | null
  },
  loading: boolean,
  detailLoading: boolean,
  error: string | null,
  selectRun: (date) => void
}
```

### Component tree

```
Sources (page)
  ├── RunSelector (dropdown + inline summary)
  ├── ArticlesChart (stacked area from overview.runs)
  ├── LayerCards (from selectedRun.summary.layerTotals)
  ├── QueryTable (from selectedRun.detail.queryStats)
  │   ├── search input + layer filter buttons
  │   └── sortable table rows
  └── HealthTable (from overview.health)
```

All components inline in Sources.jsx. Extract only if complexity demands it.

### Error handling

- Overview fetch fails: error state with retry button
- Detail fetch fails: error inline in query table section only
- Source health missing: "No health data" placeholder
- Old runs: layer cards greyed out, query table shows placeholder

---

## Layer Colours

Assign a CSS custom property per layer (added to tokens.css):

| Layer | Colour | Purpose |
|-------|--------|---------|
| L1 | Blue (sector sweep) | `--colour-layer-l1` |
| L2 | Teal (source targeting) | `--colour-layer-l2` |
| L3 | Purple (cross-sector) | `--colour-layer-l3` |
| L4 | Orange (daily experiment) | `--colour-layer-l4` |
| Headlines | Pink | `--colour-layer-hl` |
| RSS | Green | `--colour-layer-rss` |

---

## Files to Create/Modify

**Create:**
- `web/api/routes/sources.js` — getOverview, getRunDetail
- `web/api/tests/sources.test.js`
- `web/app/src/pages/Sources.jsx`
- `web/app/src/pages/Sources.css`
- `web/app/src/hooks/useSources.js`

**Modify:**
- `web/api/server.js` — wire source routes
- `web/app/src/App.jsx` — add Sources route
- `web/app/src/components/layout/Sidebar.jsx` — add Sources nav item
- `web/app/src/pages/Articles.jsx` — add found_by badges to detail panel
- `web/app/src/pages/Articles.css` — found_by badge styles
- `web/app/src/styles/tokens.css` — layer colour tokens

**Do not modify:** `scripts/`, `config/`, pipeline code
