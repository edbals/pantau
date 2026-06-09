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
  unitType?: UnitType
  // Manually-moved blocks act as fixed anchors when re-tidying (SolverBlock.pinned).
  pinned?: boolean
  // Keeps subkon/urgency/type/label per cell across re-materialization. Keyed "row-col".
  cellOverrides?: Record<string, Partial<CanvasUnit>>
}

export function cellKey(row: number, col: number): string {
  return `${row}-${col}`
}

// Expands one grid into its individual lot units. Cells fill the bbox in a
// uniform rows x cols grid with an even gutter; ids are stable across edits.
export function materializeGrid(grid: GridBlock): CanvasUnit[] {
  const rows = Math.max(1, Math.floor(grid.rows))
  const cols = Math.max(1, Math.floor(grid.cols))
  const codes = generateCodes({
    prefix: grid.prefix,
    start: grid.start,
    count: rows * cols,
    rules: grid.skipRules,
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
export function materializeCanvas(grids: GridBlock[], freeUnits: CanvasUnit[] = []): CanvasUnit[] {
  return [...grids.flatMap(materializeGrid), ...freeUnits]
}
