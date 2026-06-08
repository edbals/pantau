# Map Studio — Engineering Handoff

> Context for the next engineer picking up the Pantau **denah (site-plan) Map Studio**.
> Written 2026-06-08. Read this before touching the digitize / canvas code.

---

## TL;DR of where we are

The Map Studio (`app/projects/[id]/map/page.tsx` + `components/map/MapCanvas.tsx`)
lets a user upload a site plan, have Gemini digitize it into unit blocks, then
edit/assign on a blueprint-style canvas. It's in good shape: AI detection works,
the editor has zoom/pan, multi-select, undo/redo, snap-to-grid, a manual grid
builder, and per-unit/batch config. **The one unsolved product problem is making
densely-packed narrow lots look good without overlap** (see "Open problem #1").

Everything compiles: `npx tsc --noEmit`, `npm test` (43 pass), `npx eslint` all clean.

---

## How the digitize pipeline works (the important part)

1. **Upload** → `handleDigitize()` in `page.tsx`. It clears units+selection first
   (clean re-run), rotates the image client-side, POSTs to the API.
2. **API** `app/api/v1/projects/[id]/map/digitize/route.ts`:
   - Sends the image to Gemini with `GRID_DETECTION_PROMPT`.
   - **Critical config**: `thinkingConfig: { thinkingBudget: 0 }`. Gemini 2.5/3.5
     are *thinking models*; with thinking ON they burn the output-token budget
     (→ truncated JSON) and take ~38s (→ timeouts). OFF = clean JSON in ~6-12s.
     **Do not remove this.**
   - Model chain: `gemini-2.5-flash` first (most reliable), then `3.5-flash`,
     etc. `2.0-*` are retired (404). Timeout 22s, fails over on hang.
   - Gemini returns **grid SECTIONS** (prefix, rows, cols, start_number,
     bounding_box) — NOT individual cells. This keeps output small/reliable.
3. **Parsing** `lib/digitize/grid-parser.ts` (pure, fully unit-tested):
   - `parseGridResponse` → tolerant: strips markdown fences, handles
     double-encoded JSON, and **brace-matches individual objects if the JSON is
     truncated** (so a partial response still yields usable grids).
   - `expandGridToUnits` → math-expands each section into lot cells with an 8%
     gutter. Cells fill the detected bounding box EXACTLY (see Open problem #1).
   - `buildUnits` → expand + spatial sort + sequential temp_ids.
4. **Numbering** `lib/digitize/numbering.ts` (pure, unit-tested):
   - `generateGridCodes` (skip-list for tetraphobia: 4/13/14), `validateUnitCodes`
     (suffix-aware: `3J-03a` counts as number 3 present; flags real gaps/dupes).

### Reproduction harness (USE THIS — it's how the hard bugs got found)
`scripts/repro/`:
- `gen-siteplan.js` → writes `siteplan.png`, a synthetic denah (4 rows, 2 groups
  split by a road — mirrors the real plans).
- `call-gemini.js` / `call-gemini-nothink.js` → call the REAL Gemini with the
  production prompt, dump full response + `finishReason` + token usage. This is
  how the thinking-token bug was diagnosed.
- `lib/digitize/grid-parser.e2e.test.ts` → gated e2e (needs `GOOGLE_GEMINI_API_KEY`),
  runs the synthetic image through the real production path.

Run: `node scripts/repro/gen-siteplan.js && node scripts/repro/call-gemini-nothink.js gemini-2.5-flash 0`

---

## Open problems (ranked)

### #1 — Making narrow lots look "square / nice" without overlap  ← the big one
The user dislikes the thin tall rectangles. **Widening to square causes adjacent
blocks (lots 1-20 / 21-41 either side of a road) to collide** — we tried 1.5x
widening + re-center and it overlapped badly (reverted in `10ea3f9`). Geometry:
20 square lots across a short band need ~2x the canvas width — impossible in a
fixed footprint.

Current state: lots fill their real bbox (honest proportions), readability via
zoom + 2-line labels. The user still wants better.

**Think outside the box — ideas not yet tried:**
- **Decouple visual layout from the scan.** Stop treating the faded image as
  ground truth for cell geometry. Once the AI gives structure (prefix/rows/cols),
  re-flow each block as its own clean uniform grid with a chosen aspect ratio,
  laid out in a *generated* tidy layout (rows stacked with consistent spacing),
  and drop/!fade the background image. The plan becomes a schematic, not a
  tracing. This is probably the real answer — a "Tidy layout" / "Schematic mode"
  toggle that arranges blocks beautifully regardless of the messy scan.
- **Vertical stacking for dense rows**: if a block has >N cols, wrap it into
  multiple sub-rows so cells can be larger/squarer (like text wrapping).
- **"Square but compact" option** (safe, in-lane): make lots square by shrinking
  ROW HEIGHT to match the thin width, leaving vertical gutters. No overlap. Looks
  sparse but square. Offered to user; not yet built.
- **Fit-to-content rendering**: render each block at its own scale in a flexbox-
  like schematic, with a small "minimap" showing true positions.

### #2 — AI mis-reads start_number at road splits
Gemini sometimes numbers the right block from 25 instead of 21 → false
"Periksa kode unit: hilang 3G-21..24". Not a code bug; AI imprecision. Mitigation
ideas: post-process to detect two same-prefix blocks and auto-renumber the right
one to continue from the left's max+1; or prompt Gemini more explicitly about
road-split continuation; or a one-click "renumber this block" tool.

### #3 — Subkon assignment model
Batch assign is select-then-assign (marquee + click subkon). Paint mode was
removed as redundant. Persistence is fixed (subs save to canvas_data).

---

## Editor architecture quick map

- `components/map/MapCanvas.tsx` — SVG canvas. Key concepts:
  - `baseFrame` = contain-fit of the bg image. `frame` = baseFrame × zoom + pan.
    **ALL rendering + pointer math go through `frame`**, so zoom/pan are uniform.
  - Tools: `select | draw | grid | hand` (paint/delete removed from UI; their
    handlers still exist harmlessly).
  - Multi-select via `selectedIds`/`onSelectionChange`; single `selectedId`/
    `onSelect` kept for the read-only PM viewer.
  - Snap: screen-pixel grid `GRID_PX=22`, Alt bypasses, `snap` prop toggles.
  - Drag inside a selection's bbox moves the whole group (Figma-style).
  - Coordinates are normalized 0-1 vs the image; manual ops now allow `[-1,2]`
    so you can build below/around the plan.
- `components/map/GridSizePicker.tsx` — Google-Docs-style drag-to-pick rows×cols.
- `components/map/StudioStepsHud.tsx` — top progress HUD (Denah→Unit→Subkon→…).
- `page.tsx` — owns state: units, selectedIds, subs, skipNumbers, zoom via canvas,
  undo/redo history (coalesced, units-only), save/load to `canvas_data`.

### Undo/redo note
History is **units-only** and coalesces rapid changes (450ms debounce). Subs /
skipNumbers are NOT in history yet — a good next step is a unified history.

---

## Gotchas / dev quirks

- **Dev server**: `cd /Users/edbert/everything-claude-code/pantau && npm run dev`
  (must cd first). Runs on :3000. The `[id]` dynamic-route folder sometimes needs
  a real request to trigger recompile; logs at `.next/dev/logs/next-development.log`.
- **Don't run `next build` while dev runs** — it clobbers `.next`. Use
  `tsc --noEmit` + a `curl` to the route to verify instead.
- Verifying a page route compiled: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/projects/test-id/map` → 307 (auth redirect) = compiled OK.
- The draft-recovery banner only shows if the localStorage draft differs from
  the server state and wasn't dismissed this session.
- ESLint here is strict (react-hooks rules): no setState-in-effect (use useMemo),
  no ref writes during render (use an effect).

---

## Recent commit trail (newest first)
- `10ea3f9` revert lot widening (overlap fix)
- `40710c7` undo/redo, toolbar rework, subkon rename, build-anywhere, AI 2nd-try fix
- `a26b57f`/`39b09b8` horizontal then two-line labels; hand tool
- `bb0bd65` zoom/pan + label overlap + separated tiles
- `83abf28` (reverted) widen lots
- `489fa08` steps HUD, snap toggle, SPK detach, subkon persistence fix
- `2c0c149` multi-select + batch assign
- `0780593` resizable units + flexible numbering
- `353a686` **the big one**: disable Gemini thinking → fixed digitize entirely

---

## If you do ONE thing
Build **"Schematic / Tidy layout" mode** (Open problem #1, idea 1). It sidesteps
the whole square-vs-overlap fight by generating a clean uniform layout from the
AI's structure instead of tracing the messy scan. That's the 10x move here.
