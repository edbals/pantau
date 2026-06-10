# AI Handoff — Map Studio (Denah Editor)

> Session handoff for the next engineer/AI resuming work. Written 2026-06-10.
> All work lives on branch **`feat/map-studio-numbering-engine`** (8 commits, **not yet pushed / no PR**).
> Base: `main` @ `df0098c`.

---

## ⚠️ Verification status (read first)

Everything below is verified at **compile/type/lint/test level only**:
`npx tsc --noEmit` clean · `npx eslint` clean · `npx vitest run` → **67 tests pass** · map route compiles (`curl … /map` → 307).

It has **NOT** been driven through the live UI — the editor route is **auth-gated** (307 redirect) and no test login was available, so no Playwright/manual interaction pass was run. **The two critical bugs below were reported from real use, not caught by the automated checks.** Treat anything interaction-level as unverified.

Run locally: `npm run dev` (port 3000) · `npx vitest run` · `npx tsc --noEmit`.

---

## ✅ Completed Milestones (this branch)

| Area | What landed |
|---|---|
| **Deterministic numbering engine** | `generateCodes({prefix,start,count,rules})` in [lib/digitize/numbering.ts](lib/digitize/numbering.ts). `SkipRule = { target, action: 'skip' \| 'replace', value? }`. `skip` renumbers past a number; `replace` assigns the **exact** `${prefix}-${value}` (literal, no computed suffix). |
| **GridBlock model** | [lib/digitize/grid-block.ts](lib/digitize/grid-block.ts) — `materializeGrid`/`materializeCanvas` turn editable grids into the flat `CanvasUnit[]`. Stable cell ids, gutter geometry, protected `cellOverrides`. |
| **Premium nav (PR2)** | lucide-react icons (Bahasa labels kept), **spacebar-to-pan**, full **PointerEvents** migration + `touch-action:none`. |
| **Live grid editing (PR3)** | Right-panel config (rows/cols/prefix/start + skip/replace rule editor), **8-handle corner-drag** + drag-to-move of a block's bbox, cells re-flow live. |
| **AI digitize → GridBlocks** | Digitize API returns `detected_grids`/`non_grid_areas`; client instantiates editable `GridBlock[]` (+ roads as free units). Professional loading state (lucide `BrainCircuit` + indeterminate bar). |
| **Copy/Paste** | `Ctrl/Cmd C/V` clones a selected block (rows/cols/size/skip rules) at an offset. |
| **Global vs local numbering** | `globalSkipRules` + `GridBlock.useGlobalRules` (defaults true). Empty-canvas panel = **"Pengaturan Proyek"**; selected block has a **"Gunakan Aturan Proyek"** toggle. Shared [components/map/NumberRulesTable.tsx](components/map/NumberRulesTable.tsx). |
| **Figma "Ratakan" alignment** | Toolbar group: **Align Tops / Align Lefts / Distribute Horizontally** on 2+ selected grid blocks. Replaced the old auto-tidy. |
| **Smart snapping guides** | Grid move/resize snaps edges flush to non-selected blocks within **5px** + dashed **magenta `#ff00ff`** guide lines. |
| **Blueprint opacity** | Top-bar **"Transparansi Denah"** slider + eye toggle bound to background image opacity (before/after). |
| **Removed** | The automated physics/tidy solver (`layout-solver.ts`, `tidy-layout.ts`) was deleted in `cdb1065` — it collapsed grids into a line. |

---

## 📦 Current Data Model — `canvas_data`

Persisted as a JSONB blob on the `projects` row (save route is a blind passthrough).

```ts
canvas_data = {
  units: CanvasUnit[]        // MATERIALIZED OUTPUT — the PM viewer / stats / go-live read this. Contract: never break it.
  grids: GridBlock[]         // editable source of truth for blocks
  freeUnits: CanvasUnit[]    // non-grid units (roads, hand-drawn) = units.filter(u => !parseGridCellId(u.id))
  globalSkipRules: SkipRule[] // project-wide numbering rules
  skipNumbers: number[]      // legacy skip list (kept for validation back-compat)
  subs: { name: string; color: string }[]
}
```

```ts
interface GridBlock {
  id: string                 // e.g. "grid_1718000000000_0"
  prefix: string; rows: number; cols: number; start: number
  bbox: { x: number; y: number; width: number; height: number }   // normalized 0–1
  skipRules?: SkipRule[]     // used only when useGlobalRules === false
  useGlobalRules?: boolean   // DEFAULT TRUE (new + AI blocks inherit globalSkipRules)
  unitType?: UnitType        // default 'house'
  pinned?: boolean           // reserved (Lock/Pin not yet wired)
  cellOverrides?: Record<string, Partial<CanvasUnit>>  // keyed "row-col"; preserves subkon/urgency/type/label across re-materialize
}

interface SkipRule { target: number; action: 'skip' | 'replace'; value?: string }
```

**Key invariant — stable cell ids:** a grid cell's id is **`` `${gridId}__r${row}c${col}` ``**. `parseGridCellId(id)` recovers `{gridId,row,col}`; that's how the editor maps a clicked cell → its block (selection, config panel, handles) and how `freeUnits` is derived (anything whose id does NOT parse). Materialization rule: `useGlobalRules === false ? skipRules : globalRules`.

---

## 🐞 Critical Bugs — FIXED 2026-06-10 (runtime verification still pending)

### 1. "State Amnesia" — save/reload hydration ✅ root-caused + fixed
**Root cause:** NOT the DB (GET route does `select('*')`, `canvas_data` round-trips whole). The culprit was the **localStorage draft**: `MapDraft` stored only `{units}`; autosave + the "Pulihkan" recovery banner restored grid-less (or stale pre-GridBlock) units **without** `grids`/`globalSkipRules` → editor desynced back to flat units.

**Fix:** `MapDraft` now carries `units + grids + globalSkipRules + skipNumbers`; autosave writes all; "Pulihkan" restores all; drafts in the **old format** (no `grids` key while the server has grids) are **discarded** instead of offered; the differs-check compares grids too.

### 2. "Gambar" (manual draw) tool regression ✅ root-caused + fixed
**Root cause:** PR3's grid-cell interception in `handleUnitPointerDown` ran **regardless of the active tool** — with Gambar active, pressing any grid cell selected the block and started a block-MOVE gesture; since a digitized denah is mostly grid cells, drawing appeared dead.

**Fix:** draw/grid presses on a unit now start a draw stroke (shared `beginDraw()` used by both the SVG background and unit handlers). Strokes work anywhere, including over existing units.

### Shipped alongside
- **Tool presets:** Gambar flyout (visible while the draw tool is active) — **Kavling** (`house`, `U-NN`), **Jalan** (`road`, `JLN-NN`, dashed style via existing type styling), **Fasos** (`common_area`, `FAS-NN`). New `drawUnitType` prop on MapCanvas; per-type code series.
- **UX pivot:** the "Transparansi Denah" opacity slider was **removed** (user disliked it). Replaced with a top-bar **"Lihat Denah"** toggle that opens a **draggable floating PiP window** ([components/map/FloatingRefMap.tsx](components/map/FloatingRefMap.tsx)) showing the original blueprint. Canvas background is back to fixed 0.45 opacity.

---

## 🎯 Next Steps (on resume)

1. **Runtime-verify the two bug fixes** with an authenticated session (save → reload keeps blocks; draw works over grid cells; preset types/codes correct; PiP drags).
2. Then the still-deferred items below.

---

## 🔑 Key Files
- [app/projects/[id]/map/page.tsx](app/projects/[id]/map/page.tsx) — Studio state: grids/units/globalSkipRules, save/load, undo-redo (`HistEntry = {units,grids}`), commitGrid, alignment, copy/paste, digitize handler, all panels.
- [components/map/MapCanvas.tsx](components/map/MapCanvas.tsx) — SVG editor: pointer gestures, grid bbox handles + move, smart snapping guides, `bgOpacity`, rendering.
- [lib/digitize/grid-block.ts](lib/digitize/grid-block.ts) — `GridBlock`, `materializeGrid/Canvas`, `parseGridCellId`, `captureCellOverrides`.
- [lib/digitize/numbering.ts](lib/digitize/numbering.ts) — `generateCodes`, `SkipRule`, validation.
- [components/map/NumberRulesTable.tsx](components/map/NumberRulesTable.tsx) — shared skip/replace rules editor (project + per-block).
- [app/api/v1/projects/[id]/map/digitize/route.ts](app/api/v1/projects/%5Bid%5D/map/digitize/route.ts) — Gemini digitize → grid structure.
- Save/load API: [.../map/save/route.ts](app/api/v1/projects/%5Bid%5D/map/save/route.ts) and [.../projects/[id]/route.ts](app/api/v1/projects/%5Bid%5D/route.ts).

## Still deferred (lower priority)
- **Lock/Pin** toggle (`GridBlock.pinned` exists but isn't wired to any action).
- Same-prefix **road-split** sub-block detection on digitize (e.g. `3J-01..20 | 3J-21..41`).
