import { describe, test, expect } from 'vitest'
import { reconstructBlocks, tidyLayout } from './tidy-layout'
import type { CanvasUnit } from '@/components/map/MapCanvas'

function unit(partial: Partial<CanvasUnit> & Pick<CanvasUnit, 'id' | 'unit_code'>): CanvasUnit {
  return {
    unit_type: 'house',
    x: 0, y: 0, width: 0.08, height: 0.2,
    ...partial,
  }
}

// A single row of `count` lots sharing `prefix`, left to right.
function row(prefix: string, count: number, y: number, startX = 0.1): CanvasUnit[] {
  return Array.from({ length: count }, (_, i) =>
    unit({ id: `${prefix}-${i + 1}`, unit_code: `${prefix}-${String(i + 1).padStart(2, '0')}`, x: startX + i * 0.1, y })
  )
}

function overlaps(a: CanvasUnit, b: CanvasUnit): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y)
}

describe('reconstructBlocks', () => {
  test('groups units by code prefix into rows x cols', () => {
    const blocks = reconstructBlocks([...row('3J', 4, 0.1), ...row('F', 2, 0.6)])
    expect(blocks.map(b => b.block.id)).toEqual(['3J', 'F']) // sorted
    expect(blocks[0]).toMatchObject({ rows: 1, cols: 4 })
    expect(blocks[1]).toMatchObject({ rows: 1, cols: 2 })
  })

  test('detects multiple rows from vertical position', () => {
    const [b] = reconstructBlocks([...row('A', 3, 0.1), ...row('A', 3, 0.5)])
    expect(b.rows).toBe(2)
    expect(b.cols).toBe(3)
  })

  test('ignores infrastructure and unparseable codes', () => {
    const blocks = reconstructBlocks([
      unit({ id: 'r1', unit_code: 'jalan', unit_type: 'road' }),
      unit({ id: 'x1', unit_code: 'garbage' }),
    ])
    expect(blocks).toHaveLength(0)
  })
})

describe('tidyLayout', () => {
  test('returns the same reference when there is nothing to tidy', () => {
    const units = [unit({ id: 'r1', unit_code: 'jalan', unit_type: 'road' })]
    expect(tidyLayout(units)).toBe(units)
  })

  test('preserves unit count, ids, codes, and assignments', () => {
    const units = [
      ...row('3J', 4, 0.1).map(u => ({ ...u, subcontractor_color: '#123456', urgency: 'high' as const })),
      unit({ id: 'road1', unit_code: 'jalan', unit_type: 'road', x: 0.5, y: 0.5 }),
    ]
    const tidied = tidyLayout(units, { imageAspect: 1 })
    expect(tidied).toHaveLength(units.length)
    expect(tidied.map(u => u.id).sort()).toEqual(units.map(u => u.id).sort())
    const lot = tidied.find(u => u.id === '3J-1')!
    expect(lot.unit_code).toBe('3J-01')
    expect(lot.subcontractor_color).toBe('#123456')
    expect(lot.urgency).toBe('high')
  })

  test('leaves non-grid units untouched', () => {
    const road = unit({ id: 'road1', unit_code: 'jalan', unit_type: 'road', x: 0.5, y: 0.5 })
    const tidied = tidyLayout([...row('3J', 3, 0.1), road], { imageAspect: 1 })
    const after = tidied.find(u => u.id === 'road1')!
    expect(after.x).toBe(0.5)
    expect(after.y).toBe(0.5)
  })

  test('produces a non-overlapping layout for two blocks', () => {
    const tidied = tidyLayout([...row('3J', 5, 0.1), ...row('F', 5, 0.1, 0.55)], { imageAspect: 1 })
    for (let i = 0; i < tidied.length; i++) {
      for (let j = i + 1; j < tidied.length; j++) {
        expect(overlaps(tidied[i], tidied[j])).toBe(false)
      }
    }
  })

  test('clears rotation carried from the scan', () => {
    const tilted = row('3J', 3, 0.1).map(u => ({ ...u, rotation: 12 }))
    const tidied = tidyLayout(tilted, { imageAspect: 1 })
    expect(tidied.every(u => (u.rotation ?? 0) === 0)).toBe(true)
  })
})
