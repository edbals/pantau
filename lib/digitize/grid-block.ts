// GridBlock: the editable source for a grid of lots in Map Studio.
//
// The editor keeps grids as first-class, editable entities (prefix / rows / cols
// / bbox / numbering rules / pin) and DETERMINISTICALLY materializes them into
// the flat CanvasUnit[] that the rest of the app (PM viewer, stats, go-live)
// reads. Editing a grid's density or numbering re-materializes it instantly —
// no reliance on the AI's OCR. Pure + framework-free so it's directly testable.

import type { CanvasUnit, UnitType } from '@/components/map/MapCanvas'
import { generateCodes, type SkipRule } from './numbering'

// Gutter left around each cell so lots read as separated tiles. Mirrors
// CELL_GAP_RATIO in grid-parser.ts (kept in sync intentionally).
const CELL_GAP_RATIO = 0.08

// Soft per-cell fields that survive a re-materialize (assignments, type, etc.).
// Geometry, id and unit_code are always recomputed and never taken from an
// override — the layout and the numbering engine own those.
const PROTECTED_KEYS = ['id', 'unit_code', 'x', 'y', 'width', 'height', 'rotation'] as const

export interface GridBlock {
  id: string
  prefix: string
  rows: number
  cols: number
  start: number
  // Normalized 0-1 bounding box the block occupies on the canvas.
  bbox: { x: number; y: number; width: number; height: number }
  skipRules?: SkipRule[]
  // When true (the default), the block inherits canvas_data.globalSkipRules
  // instead of its own skipRules. New + AI-digitized blocks default to true.
  useGlobalRules?: boolean
  unitType?: UnitType
  // Manually-moved blocks act as fixed anchors when re-tidying (SolverBlock.pinned).
  pinned?: boolean
  // Keeps subkon/urgency/type/label per cell across re-materialization. Keyed "row-col".
  cellOverrides?: Record<string, Partial<CanvasUnit>>
}

export function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

// Inverse of the stable id scheme `${gridId}__r{r}c{c}`.
export function parseGridCellId(id: string): { gridId: string; row: number; col: number } | null {
  const m = id.match(/^(.+)__r(\d+)c(\d+)$/)
  if (!m) return null
  return { gridId: m[1], row: Number(m[2]), col: Number(m[3]) }
}

// Reads the current per-cell soft fields off a grid's materialized units and
// folds them into the grid's cellOverrides, so a following materialize keeps
// subkon/urgency/type/etc. Only meaningful (non-default) values are stored.
export function captureCellOverrides(grid: GridBlock, units: CanvasUnit[]): GridBlock {
  const baseType = grid.unitType ?? 'house'
  const overrides: Record<string, Partial<CanvasUnit>> = { ...(grid.cellOverrides ?? {}) }
  for (const u of units) {
    const parsed = parseGridCellId(u.id)
    if (!parsed || parsed.gridId !== grid.id) continue
    const soft: Partial<CanvasUnit> = {}
    if (u.unit_type && u.unit_type !== baseType) soft.unit_type = u.unit_type
    if (u.subcontractor_color) soft.subcontractor_color = u.subcontractor_color
    if (u.urgency && u.urgency !== 'normal') soft.urgency = u.urgency
    if (u.status && u.status !== 'not_started') soft.status = u.status
    if (typeof u.progress_pct === 'number' && u.progress_pct > 0) soft.progress_pct = u.progress_pct
    if (u.label) soft.label = u.label
    const key = cellKey(parsed.row, parsed.col)
    if (Object.keys(soft).length > 0) overrides[key] = soft
    else delete overrides[key]
  }
  return { ...grid, cellOverrides: overrides }
}

// Tight bounding box of a grid's materialized cells — used to resync a grid's
// bbox after its cells are repositioned externally (e.g. by Tidy Layout).
export function gridBoundsFromUnits(gridId: string, units: CanvasUnit[]): GridBlock['bbox'] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let found = false
  for (const u of units) {
    if (parseGridCellId(u.id)?.gridId !== gridId) continue
    found = true
    minX = Math.min(minX, u.x); minY = Math.min(minY, u.y)
    maxX = Math.max(maxX, u.x + u.width); maxY = Math.max(maxY, u.y + u.height)
  }
  return found ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}

// Expands one grid into its individual lot units. Cells fill the bbox in a
// uniform rows x cols grid with an even gutter; ids are stable across edits.
export function materializeGrid(grid: GridBlock, globalRules: SkipRule[] = []): CanvasUnit[] {
  const rows = Math.max(1, Math.floor(grid.rows))
  const cols = Math.max(1, Math.floor(grid.cols))
  // Global rules apply unless the block opts out (useGlobalRules === false).
  const rules = grid.useGlobalRules === false ? (grid.skipRules ?? []) : globalRules
  const codes = generateCodes({
    prefix: grid.prefix,
    start: grid.start,
    count: rows * cols,
    rules,
  })

  const cellW = grid.bbox.width / cols
  const cellH = grid.bbox.height / rows
  const insetX = cellW * CELL_GAP_RATIO
  const insetY = cellH * CELL_GAP_RATIO

  const units: CanvasUnit[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      const base: CanvasUnit = {
        id: `${grid.id}__r${r}c${c}`,
        unit_code: codes[idx] ?? `${grid.prefix}-${idx + 1}`,
        unit_type: grid.unitType ?? 'house',
        x: grid.bbox.x + c * cellW + insetX,
        y: grid.bbox.y + r * cellH + insetY,
        width: cellW - 2 * insetX,
        height: cellH - 2 * insetY,
        rotation: 0,
      }
      const override = grid.cellOverrides?.[cellKey(r, c)]
      units.push(override ? applyOverride(base, override) : base)
    }
  }
  return units
}

// Merges grid overrides while protecting geometry / id / code.
function applyOverride(base: CanvasUnit, override: Partial<CanvasUnit>): CanvasUnit {
  const soft: Partial<CanvasUnit> = { ...override }
  for (const key of PROTECTED_KEYS) delete soft[key]
  return { ...base, ...soft }
}

// Full canvas output: every grid expanded, then the free (hand-drawn / road)
// units that aren't owned by any grid. This is what gets saved as canvas_data.units.
export function materializeCanvas(
  grids: GridBlock[],
  freeUnits: CanvasUnit[] = [],
  globalRules: SkipRule[] = [],
): CanvasUnit[] {
  return [...grids.flatMap(g => materializeGrid(g, globalRules)), ...freeUnits]
}
