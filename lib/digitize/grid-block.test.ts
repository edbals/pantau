import { describe, test, expect } from 'vitest'
import {
  materializeGrid, materializeCanvas, cellKey,
  parseGridCellId, captureCellOverrides, gridBoundsFromUnits,
  type GridBlock,
} from './grid-block'
import type { CanvasUnit } from '@/components/map/MapCanvas'

function grid(partial: Partial<GridBlock> = {}): GridBlock {
  return {
    id: 'g1',
    prefix: 'A',
    rows: 2,
    cols: 3,
    start: 1,
    bbox: { x: 0.1, y: 0.1, width: 0.6, height: 0.4 },
    ...partial,
  }
}

describe('materializeGrid', () => {
  test('produces rows x cols units with stable ids', () => {
    const units = materializeGrid(grid())
    expect(units).toHaveLength(6)
    expect(units.map(u => u.id)).toEqual([
      'g1__r0c0', 'g1__r0c1', 'g1__r0c2',
      'g1__r1c0', 'g1__r1c1', 'g1__r1c2',
    ])
    expect(new Set(units.map(u => u.id)).size).toBe(6)
  })

  test('numbers cells via the deterministic engine (local replace rules)', () => {
    const units = materializeGrid(grid({
      rows: 1, cols: 6,
      useGlobalRules: false,
      skipRules: [
        { target: 4, action: 'replace', value: '3A' },
        { target: 5, action: 'replace', value: '3B' },
      ],
    }))
    expect(units.map(u => u.unit_code))
      .toEqual(['A-01', 'A-02', 'A-03', 'A-3A', 'A-3B', 'A-06'])
  })

  test('applies GLOBAL rules by default (useGlobalRules undefined)', () => {
    const units = materializeGrid(
      grid({ rows: 1, cols: 4 }),
      [{ target: 2, action: 'skip' }],
    )
    expect(units.map(u => u.unit_code)).toEqual(['A-01', 'A-03', 'A-04', 'A-05'])
  })

  test('ignores global rules and uses local when useGlobalRules is false', () => {
    const units = materializeGrid(
      grid({ rows: 1, cols: 4, useGlobalRules: false, skipRules: [{ target: 3, action: 'skip' }] }),
      [{ target: 2, action: 'skip' }],
    )
    expect(units.map(u => u.unit_code)).toEqual(['A-01', 'A-02', 'A-04', 'A-05'])
  })

  test('a global block ignores its own stale skipRules', () => {
    const units = materializeGrid(
      grid({ rows: 1, cols: 3, useGlobalRules: true, skipRules: [{ target: 2, action: 'skip' }] }),
      [], // no global rules -> plain sequence, local skipRules ignored
    )
    expect(units.map(u => u.unit_code)).toEqual(['A-01', 'A-02', 'A-03'])
  })

  test('cells stay within the bounding box', () => {
    const g = grid()
    const units = materializeGrid(g)
    for (const u of units) {
      expect(u.x).toBeGreaterThanOrEqual(g.bbox.x - 1e-9)
      expect(u.y).toBeGreaterThanOrEqual(g.bbox.y - 1e-9)
      expect(u.x + u.width).toBeLessThanOrEqual(g.bbox.x + g.bbox.width + 1e-9)
      expect(u.y + u.height).toBeLessThanOrEqual(g.bbox.y + g.bbox.height + 1e-9)
    }
  })

  test('applies unitType and preserves soft cell overrides', () => {
    const units = materializeGrid(grid({
      unitType: 'shophouse',
      cellOverrides: { [cellKey(0, 1)]: { subcontractor_color: '#abcdef', urgency: 'high' } },
    }))
    expect(units.every(u => u.unit_type === 'shophouse')).toBe(true)
    const overridden = units.find(u => u.id === 'g1__r0c1')!
    expect(overridden.subcontractor_color).toBe('#abcdef')
    expect(overridden.urgency).toBe('high')
  })

  test('overrides cannot clobber geometry, id, or code', () => {
    const evil: Partial<CanvasUnit> = { x: 0.99, y: 0.99, width: 0.5, id: 'hacked', unit_code: 'Z-99' }
    const [unit] = materializeGrid(grid({
      rows: 1, cols: 1,
      cellOverrides: { [cellKey(0, 0)]: evil },
    }))
    expect(unit.id).toBe('g1__r0c0')
    expect(unit.unit_code).toBe('A-01')
    expect(unit.x).toBeCloseTo(0.1 + 0.6 * 0.08, 6) // bbox.x + gutter, not 0.99
  })
})

describe('parseGridCellId', () => {
  test('round-trips the stable id scheme', () => {
    expect(parseGridCellId('g1__r2c3')).toEqual({ gridId: 'g1', row: 2, col: 3 })
  })
  test('tolerates ids with __ in the grid id', () => {
    expect(parseGridCellId('grid_123__abc__r0c1')).toEqual({ gridId: 'grid_123__abc', row: 0, col: 1 })
  })
  test('returns null for non-grid ids', () => {
    expect(parseGridCellId('road1')).toBeNull()
  })
})

describe('captureCellOverrides', () => {
  test('preserves a cell assignment across a re-materialize (more cols)', () => {
    const g = grid({ rows: 1, cols: 3 })
    const units = materializeGrid(g).map(u =>
      u.id === 'g1__r0c1' ? { ...u, subcontractor_color: '#abcdef', urgency: 'high' as const } : u
    )
    const captured = captureCellOverrides(g, units)
    expect(captured.cellOverrides?.[cellKey(0, 1)]).toEqual({ subcontractor_color: '#abcdef', urgency: 'high' })

    // Growing to 4 cols must keep cell (0,1)'s assignment.
    const grown = materializeGrid({ ...captured, cols: 4 })
    expect(grown.find(u => u.id === 'g1__r0c1')?.subcontractor_color).toBe('#abcdef')
  })

  test('does not capture default/empty values', () => {
    const g = grid({ rows: 1, cols: 2 })
    const captured = captureCellOverrides(g, materializeGrid(g))
    expect(captured.cellOverrides ?? {}).toEqual({})
  })
})

describe('gridBoundsFromUnits', () => {
  test('returns the tight box of a grid’s cells', () => {
    const units = materializeGrid(grid({ rows: 1, cols: 2, bbox: { x: 0.2, y: 0.2, width: 0.4, height: 0.2 } }))
    const box = gridBoundsFromUnits('g1', units)!
    expect(box.x).toBeGreaterThanOrEqual(0.2)
    expect(box.x + box.width).toBeLessThanOrEqual(0.6 + 1e-9)
  })
  test('returns null when the grid has no cells', () => {
    expect(gridBoundsFromUnits('nope', [])).toBeNull()
  })
})

describe('materializeCanvas', () => {
  test('expands grids then appends free units', () => {
    const free: CanvasUnit = {
      id: 'road1', unit_code: 'jalan', unit_type: 'road',
      x: 0.0, y: 0.9, width: 1, height: 0.1,
    }
    const out = materializeCanvas([grid({ rows: 1, cols: 2 })], [free])
    expect(out).toHaveLength(3)
    expect(out[out.length - 1].id).toBe('road1') // free units come last
  })

  test('handles an empty canvas', () => {
    expect(materializeCanvas([], [])).toEqual([])
  })
})
