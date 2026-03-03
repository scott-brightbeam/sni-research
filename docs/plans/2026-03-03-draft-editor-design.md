# Phase 2: Draft Editor Design

Approved 2026-03-03. Covers API, UI, and data flow for the side-by-side draft editor.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Eval scores | Placeholder panel | Pipeline doesn't generate `evaluate-week-N.json` yet; panel shows "No data" until it does |
| Editor component | Plain textarea | Zero deps, matches project philosophy, sufficient for newsletter editing |
| Markdown renderer | react-markdown | ~50KB, React-native, supports custom renderers for link badges and review highlights |
| Review flags | Inline markers in preview | Highlighted text with tooltip on click; non-intrusive |
| Link badges | Icon after each link | Small checkmark/X after rendered links; hover shows HTTP status |
| Week navigation | Auto-detect latest + prev/next | Scan `output/` for `draft-week-*.md`, arrows at bounds disabled |
| API approach | Single bundled endpoint | One GET returns everything; PUT returns full bundle after save |

---

## API Layer

### `GET /api/draft?week=N`

Returns the full draft bundle. If `week` is omitted, auto-detects the latest week by scanning `output/` for `draft-week-*.md` files.

```json
{
  "week": 9,
  "draft": "# Full markdown content...",
  "review": {
    "overall_pass": false,
    "word_count": 3847,
    "prohibited_found": [{ "line": 12, "text": "...", "term": "..." }]
  },
  "links": {
    "summary": { "total": 23, "ok": 23, "dead": 0 },
    "results": [{ "url": "...", "status": "ok", "httpStatus": 200, "responseTimeMs": 340 }]
  },
  "evaluate": null,
  "availableWeeks": [7, 8, 9]
}
```

File reads:
- `output/draft-week-N.md` — required, 404 if missing
- `output/review-week-N.json` — `null` if missing
- `output/links-week-N.json` — `null` if missing
- `output/evaluate-week-N.json` — `null` if missing

### `PUT /api/draft?week=N`

Body: `{ "draft": "# Updated markdown..." }`

Writes to `output/draft-week-N.md`. Returns 404 if file doesn't exist (no creating drafts for arbitrary weeks). On success, re-reads all data and returns the same full bundle shape as GET — save and refresh in one round trip.

### `GET /api/draft/history?week=N`

Returns which output artifacts exist for a given week:

```json
{
  "week": 9,
  "artifacts": {
    "draft": true,
    "review": true,
    "links": true,
    "evaluate": false
  }
}
```

### Implementation

New file: `web/api/routes/draft.js` with `getDraft(query)`, `saveDraft(query, body)`, `getDraftHistory(query)`. Follows existing route handler pattern (exported async functions, imported by `server.js`).

---

## UI Layout

```
┌──────────────────────────────────────────────────────┐
│ Draft — Week 9          ◀ ▶    [Save]    [Review ●]  │
├───────────────────────────┬──────────────────────────┤
│                           │                          │
│   Textarea editor         │   Rendered preview       │
│   (raw markdown)          │   (react-markdown)       │
│                           │                          │
│                           │   Link ✓ badges          │
│                           │   Prohibited highlights  │
│                           │                          │
├───────────────────────────┴──────────────────────────┤
│ Evaluation: No data available          3847 words    │
└──────────────────────────────────────────────────────┘
```

### Toolbar

- Week label ("Draft — Week 9") + prev/next arrows (disabled at bounds of `availableWeeks`)
- Save button: enabled when draft is dirty, shows brief "Saved" confirmation
- Review status pill: green "Pass" or red "N issues" — click toggles highlight visibility

### Editor pane (left)

- Plain `<textarea>`, full available height
- Monospace font, `--card-bg` background
- Controlled component, syncs to state on change

### Preview pane (right)

- `react-markdown` rendering current textarea content
- Live preview, debounced 300ms
- Lora/Poppins fonts matching design system
- Custom renderers for link badges and review highlights

### Bottom bar

- Evaluation scores placeholder ("No evaluation data" or scores when available)
- Word count from current editor content (live)

### New files

- `web/app/src/pages/Draft.jsx` — rewrite of placeholder
- `web/app/src/pages/Draft.css` — two-pane layout styles
- `web/app/src/hooks/useDraft.js` — fetch/save/dirty state management

No new shared components. Link badges and review highlights handled inline via custom react-markdown renderers.

---

## Data Flow

### Initial load

1. `useDraft()` calls `GET /api/draft` (no week → auto-detect latest)
2. Response populates: textarea state, preview render, highlight map, link badge map, week nav state
3. Hook returns `{ draft, review, links, evaluate, week, availableWeeks, loading, error, dirty, save, setDraft, setWeek }`

### Editing

1. User types → textarea state updates
2. Debounced (300ms) copy feeds preview render
3. Dirty flag activates (textarea !== last-saved content)
4. Word count updates live from textarea

### Saving

1. Click Save → `PUT /api/draft?week=N` with `{ draft: textareaContent }`
2. Response (full bundle) replaces all state
3. Dirty flag resets. Brief "Saved" confirmation on button.

### Week navigation

1. Prev/next → `useDraft` refetches with new week number
2. If dirty, show "Unsaved changes" confirmation before navigating
3. Arrows disabled at bounds of `availableWeeks`

### Review highlights

1. Custom react-markdown text renderer scans each text node
2. Matches `prohibited_found` terms → wraps in `<mark>` with `--terra` background + tooltip
3. Toggle via review status pill in toolbar (`showReviewFlags` state)

### Link badges

1. Custom react-markdown link renderer wraps each `<a>`
2. Looks up URL in links result map
3. Appends icon: `✓` green (ok), `✗` red (dead), nothing if URL not in results
4. Hover tooltip shows HTTP status + response time

### Error handling

- 404 on GET → "No draft found for this week" empty state
- Save failure → inline error message, dirty flag stays true
- Network error → standard `{ loading, error }` hook pattern

---

## Dependencies

- `react-markdown` (~50KB) — add to `web/app/package.json`
- No other new dependencies
