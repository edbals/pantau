import { describe, test, expect } from 'vitest'
import { layoutSolver, type SolverBlock } from './layout-solver'
import type { BoundingBox } from './grid-parser'

function overlapArea(a: BoundingBox, b: BoundingBox): number {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return ox > 0 && oy > 0 ? ox * oy : 0
}

function block(id: string, x: number, y: number, rows: number, cols: number, extra?: Partial<SolverBlock>): SolverBlock {
  return { id, centroid: { x, y }, lots: { rows, cols }, idealAspect: 1, ...extra }
}

const EPS = 1e-6

describe('layoutSolver', () => {
  test('returns an empty map for no blocks', () => {
    expect(layoutSolver([]).size).toBe(0)
  })

  test('keeps every block inside the target safe zone', () => {
    const boxes = layoutSolver([
      block('a', 0.2, 0.2, 1, 10),
      block('b', 0.25, 0.22, 1, 10),
      block('c', 0.8, 0.8, 2, 5),
    ])
    for (const box of boxes.values()) {
      expect(box.x).toBeGreaterThanOrEqual(0.02 - EPS)
      expect(box.y).toBeGreaterThanOrEqual(0.02 - EPS)
      expect(box.x + box.width).toBeLessThanOrEqual(0.98 + EPS)
      expect(box.y + box.height).toBeLessThanOrEqual(0.98 + EPS)
    }
  })

  test('resolves overlap between two near-coincident blocks', () => {
    const boxes = layoutSolver([
      block('a', 0.4, 0.5, 1, 10),
      block('b', 0.42, 0.5, 1, 10),
    ])
    expect(overlapArea(boxes.get('a')!, boxes.get('b')!)).toBeLessThan(EPS)
  })

  test('separates blocks with identical centroids (road-split case)', () => {
    const boxes = layoutSolver([
      block('left', 0.5, 0.5, 1, 20),
      block('right', 0.5, 0.5, 1, 20),
    ])
    expect(overlapArea(boxes.get('left')!, boxes.get('right')!)).toBeLessThan(EPS)
  })

  test('leaves no pairwise overlap for a dense multi-block layout', () => {
    const blocks = Array.from({ length: 12 }, (_, i) =>
      block(`g${i}`, 0.3 + (i % 4) * 0.02, 0.3 + Math.floor(i / 4) * 0.02, 1, 8)
    )
    const boxes = [...layoutSolver(blocks).values()]
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        expect(overlapArea(boxes[i], boxes[j])).toBeLessThan(EPS)
      }
    }
  })

  test('corrects lot aspect for a non-square render frame', () => {
    // idealAspect 1 on a 2:1 image => normalised box aspect 0.5, which renders
    // square once stretched by the frame.
    const boxes = layoutSolver([block('a', 0.5, 0.5, 1, 1, { idealAspect: 1 })], { imageAspect: 2 })
    const box = boxes.get('a')!
    const screenAspect = (box.width / box.height) * 2
    expect(screenAspect).toBeCloseTo(1, 3)
  })

  test('caps scale so a single small block does not fill the canvas', () => {
    const boxes = layoutSolver([block('a', 0.5, 0.5, 1, 1)], { maxScale: 2, baseUnitScale: 0.01 })
    const box = boxes.get('a')!
    expect(box.width).toBeLessThanOrEqual(0.01 * 2 + EPS)
  })

  test('is deterministic', () => {
    const make = () => layoutSolver([block('a', 0.3, 0.3, 1, 6), block('b', 0.32, 0.31, 1, 6)])
    expect([...make().entries()]).toEqual([...make().entries()])
  })

  test('does not crash with a pinned anchor present', () => {
    const boxes = layoutSolver([
      block('anchor', 0.5, 0.5, 1, 10, { pinned: true }),
      block('free', 0.52, 0.5, 1, 10),
    ])
    expect(overlapArea(boxes.get('anchor')!, boxes.get('free')!)).toBeLessThan(EPS)
  })
})
