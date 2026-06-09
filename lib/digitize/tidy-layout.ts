// "Tidy layout" / schematic mode for Map Studio.
//
// Takes the flat list of canvas units (which has lost its block structure after
// digitization) and re-flows it into a clean schematic: units sharing a code
// prefix are regrouped into a uniform grid, the blocks are separated with the
// collision-free layout solver, and each block's EXISTING units are re-placed
// into the idealised box — preserving every unit's id, code, assignments, and
// left-to-right / top-to-bottom arrangement.
//
// Units that aren't sellable lots (roads, common areas, etc.) or whose code
// can't be parsed are left exactly where they are. Splitting a single prefix
// that a road divides into two sub-blocks (e.g. 1-20 | 21-41) is a follow-up;
// for now a road-split prefix tidies into one continuous strip.

import type { CanvasUnit } from '@/components/map/MapCanvas'
import { parseUnitCode } from './numbering'
import { layoutSolver, type SolverBlock } from './layout-solver'

// Infrastructure isn't a sellable lot and never participates in a block grid.
const INFRASTRUCTURE_TYPES = new Set<CanvasUnit['unit_type']>([
  'road', 'common_area', 'parking', 'facility', 'drainage', 'boundary',
])

// Fraction of each cell left as a gutter so re-placed lots read as separated
// tiles (mirrors the digitize expansion's CELL_GAP_RATIO).
const CELL_GAP_RATIO = 0.08
// Default desired on-screen lot aspect (width / height). 1 = square, which is
// what the user wants instead of thin tall slivers.
const DEFAULT_IDEAL_ASPECT = 1
// A new row starts when a unit's centre sits more than this fraction of the
// median cell height below the current row's anchor.
const ROW_BREAK_RATIO = 0.5

export interface TidyOptions {
  imageAspect?: number // imagePixelWidth / imagePixelHeight of the render frame
  idealAspect?: number // desired on-screen lot aspect; defaults to square
}

interface BlockCell {
  id: string
  row: number
  col: number
}

export interface ReconstructedBlock {
  block: SolverBlock
  rows: number
  cols: number
  cells: BlockCell[]
}

interface Centred {
  unit: CanvasUnit
  cx: number
  cy: number
}

function centre(u: CanvasUnit): Centred {
  return { unit: u, cx: u.x + u.width / 2, cy: u.y + u.height / 2 }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const isSellable = (u: CanvasUnit) => !INFRASTRUCTURE_TYPES.has(u.unit_type)

// Groups sellable, code-parseable units by prefix into a clean rows x cols grid.
export function reconstructBlocks(
  units: CanvasUnit[],
  idealAspect = DEFAULT_IDEAL_ASPECT
): ReconstructedBlock[] {
  const groups = new Map<string, CanvasUnit[]>()
  for (const u of units) {
    if (!isSellable(u)) continue
    const parsed = parseUnitCode(u.unit_code)
    if (!parsed) continue
    const list = groups.get(parsed.prefix) ?? []
    list.push(u)
    groups.set(parsed.prefix, list)
  }

  const blocks: ReconstructedBlock[] = []
  // Sort prefixes so the solver's pairwise order (and thus output) is stable.
  for (const prefix of [...groups.keys()].sort()) {
    const members = groups.get(prefix)!.map(centre)
    const medianHeight = median(members.map(m => m.unit.height))
    const rowTolerance = Math.max(medianHeight * ROW_BREAK_RATIO, 0.005)

    // Cluster into rows by vertical position, then sort each row by x.
    const byY = [...members].sort((a, b) => a.cy - b.cy)
    const rows: Centred[][] = []
    let anchorY = Number.NEGATIVE_INFINITY
    for (const m of byY) {
      if (rows.length === 0 || m.cy - anchorY > rowTolerance) {
        rows.push([m])
        anchorY = m.cy
      } else {
        rows[rows.length - 1].push(m)
      }
    }
    rows.forEach(row => row.sort((a, b) => a.cx - b.cx))

    const rowCount = rows.length
    const colCount = Math.max(...rows.map(r => r.length))
    const cells: BlockCell[] = []
    rows.forEach((row, r) => row.forEach((m, c) => cells.push({ id: m.unit.id, row: r, col: c })))

    const cxs = members.map(m => m.cx)
    const cys = members.map(m => m.cy)
    blocks.push({
      block: {
        id: prefix,
        centroid: {
          x: (Math.min(...cxs) + Math.max(...cxs)) / 2,
          y: (Math.min(...cys) + Math.max(...cys)) / 2,
        },
        lots: { rows: rowCount, cols: colCount },
        idealAspect,
      },
      rows: rowCount,
      cols: colCount,
      cells,
    })
  }

  return blocks
}

/**
 * Returns a tidied copy of `units`. If there are no reconstructable blocks the
 * original array reference is returned unchanged, so callers can treat that as a
 * no-op.
 */
export function tidyLayout(units: CanvasUnit[], options: TidyOptions = {}): CanvasUnit[] {
  const idealAspect = options.idealAspect ?? DEFAULT_IDEAL_ASPECT
  const blocks = reconstructBlocks(units, idealAspect)
  if (blocks.length === 0) return units

  const boxes = layoutSolver(
    blocks.map(b => b.block),
    { imageAspect: options.imageAspect }
  )

  // Build id -> new geometry by re-placing each block's units into its box.
  const placement = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const { block, rows, cols, cells } of blocks) {
    const box = boxes.get(block.id)
    if (!box) continue
    const cellW = box.width / cols
    const cellH = box.height / rows
    const insetX = cellW * CELL_GAP_RATIO
    const insetY = cellH * CELL_GAP_RATIO
    for (const cell of cells) {
      placement.set(cell.id, {
        x: box.x + cell.col * cellW + insetX,
        y: box.y + cell.row * cellH + insetY,
        width: cellW - 2 * insetX,
        height: cellH - 2 * insetY,
      })
    }
  }

  return units.map(u => {
    const next = placement.get(u.id)
    // Schematic lots are axis-aligned; clear any rotation carried from the scan.
    return next ? { ...u, ...next, rotation: 0 } : u
  })
}
