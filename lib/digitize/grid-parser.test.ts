import { describe, test, expect } from 'vitest'
import {
  parseGridText,
  parseGridResponse,
  normaliseModelText,
  normaliseDetectedGrid,
  expandGridToUnits,
  buildUnits,
  recoverObjects,
  type DetectedGrid,
} from './grid-parser'

const VALID_RESPONSE = JSON.stringify({
  detected_grids: [
    {
      temp_id: 'g_01', prefix: '3J', rows: 1, cols: 20, start_number: 1,
      bounding_box: { x: 0.01, y: 0.03, width: 0.45, height: 0.1 }, confidence: 0.95,
    },
    {
      temp_id: 'g_02', prefix: '3J', rows: 1, cols: 21, start_number: 21,
      bounding_box: { x: 0.5, y: 0.03, width: 0.46, height: 0.1 }, confidence: 0.95,
    },
  ],
  non_grid_areas: [
    {
      temp_id: 'a_01', area_type: 'road', label: 'JALAN UTAMA',
      bounding_box: { x: 0.47, y: 0.03, width: 0.03, height: 0.6 },
    },
  ],
})

function geminiResponse(text: string): unknown {
  return { candidates: [{ content: { parts: [{ text }] } }] }
}

describe('normaliseModelText', () => {
  test('passes through plain JSON', () => {
    expect(normaliseModelText('{"a":1}')).toBe('{"a":1}')
  })

  test('strips ```json markdown fences', () => {
    expect(normaliseModelText('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('strips bare ``` fences', () => {
    expect(normaliseModelText('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test('decodes a double-encoded JSON string then strips fences', () => {
    // This is the exact shape that broke production: a JSON-stringified markdown block.
    const doubleEncoded = JSON.stringify('```json\n{"a":1}\n```')
    expect(normaliseModelText(doubleEncoded)).toBe('{"a":1}')
  })
})

describe('parseGridText — happy path', () => {
  test('parses plain JSON response', () => {
    const { grids, nonGrid } = parseGridText(VALID_RESPONSE)
    expect(grids).toHaveLength(2)
    expect(nonGrid).toHaveLength(1)
    expect(grids[0].prefix).toBe('3J')
    expect(grids[1].start_number).toBe(21)
  })

  test('parses markdown-wrapped response (Gemini default)', () => {
    const { grids } = parseGridText('```json\n' + VALID_RESPONSE + '\n```')
    expect(grids).toHaveLength(2)
  })

  test('parses double-encoded markdown response', () => {
    const wrapped = JSON.stringify('```json\n' + VALID_RESPONSE + '\n```')
    const { grids, nonGrid } = parseGridText(wrapped)
    expect(grids).toHaveLength(2)
    expect(nonGrid).toHaveLength(1)
  })
})

describe('parseGridText — truncation recovery', () => {
  test('recovers complete grids from JSON truncated mid-object', () => {
    // Simulate the model getting cut off partway through the 3rd grid.
    const truncated =
      '```json\n{\n "detected_grids": [\n' +
      '{ "temp_id":"g_01","prefix":"3J","rows":1,"cols":20,"start_number":1,"bounding_box":{"x":0.01,"y":0.03,"width":0.45,"height":0.1},"confidence":0.95 },\n' +
      '{ "temp_id":"g_02","prefix":"3H","rows":1,"cols":21,"start_number":21,"bounding_box":{"x":0.5,"y":0.03,"width":0.46,"height":0.1},"confidence":0.95 },\n' +
      '{ "temp_id":"g_03","prefix":"3G","rows":1,"cols":20,"start_number":1,"bounding_box":{"x":0.01,"y":0.2,"width":0.45,"hei'

    const { grids } = parseGridText(truncated)
    // The two complete grids are recovered; the truncated third is dropped.
    expect(grids).toHaveLength(2)
    expect(grids.map(g => g.prefix)).toEqual(['3J', '3H'])
  })

  test('recovers from double-encoded AND truncated response', () => {
    const inner = '```json\n{ "detected_grids": [ { "temp_id":"g_01","prefix":"3J","rows":1,"cols":20,"start_number":1,"bounding_box":{"x":0.01,"y":0.03,"width":0.45,"height":0.1},"confidence":0.95 }, { "temp_id":"g_02'
    // Emulate an unterminated double-encoded string (no closing quote).
    const wrapped = '"' + inner.replace(/"/g, '\\"')
    const { grids } = parseGridText(wrapped)
    expect(grids.length).toBeGreaterThanOrEqual(1)
    expect(grids[0].prefix).toBe('3J')
  })

  test('returns empty for unparseable garbage', () => {
    const { grids, nonGrid } = parseGridText('not json at all, no braces here')
    expect(grids).toHaveLength(0)
    expect(nonGrid).toHaveLength(0)
  })
})

describe('recoverObjects', () => {
  test('classifies grids vs areas by their keys', () => {
    const { grids, nonGrid } = recoverObjects(VALID_RESPONSE)
    expect(grids).toHaveLength(2)
    expect(nonGrid).toHaveLength(1)
  })
})

describe('normaliseDetectedGrid — validation', () => {
  test('rejects a grid with no prefix', () => {
    expect(normaliseDetectedGrid({ rows: 1, cols: 5, bounding_box: { x: 0, y: 0, width: 0.5, height: 0.1 } }, 0)).toBeNull()
  })

  test('rejects zero rows/cols', () => {
    expect(normaliseDetectedGrid({ prefix: 'A', rows: 0, cols: 5, bounding_box: { x: 0, y: 0, width: 0.5, height: 0.1 } }, 0)).toBeNull()
  })

  test('rejects absurd row/col counts (likely hallucination)', () => {
    expect(normaliseDetectedGrid({ prefix: 'A', rows: 999, cols: 5, bounding_box: { x: 0, y: 0, width: 0.5, height: 0.1 } }, 0)).toBeNull()
  })

  test('clamps coordinates to 0-1 and uppercases prefix', () => {
    const g = normaliseDetectedGrid({ prefix: '3j', rows: 1, cols: 2, start_number: 5, bounding_box: { x: -0.2, y: 0.1, width: 2, height: 0.1 }, confidence: 1.4 }, 0)
    expect(g).not.toBeNull()
    expect(g!.prefix).toBe('3J')
    expect(g!.bounding_box.x).toBe(0)
    expect(g!.bounding_box.width).toBe(1)
    expect(g!.start_number).toBe(5)
    expect(g!.confidence).toBe(1)
  })

  test('accepts numeric strings (model sometimes quotes numbers)', () => {
    const g = normaliseDetectedGrid({ prefix: 'A', rows: '2', cols: '3', bounding_box: { x: '0.1', y: '0.1', width: '0.5', height: '0.2' } }, 0)
    expect(g).not.toBeNull()
    expect(g!.rows).toBe(2)
    expect(g!.cols).toBe(3)
  })
})

describe('expandGridToUnits — math', () => {
  const grid: DetectedGrid = {
    temp_id: 'g_01', prefix: '3J', rows: 2, cols: 3, start_number: 1,
    bounding_box: { x: 0, y: 0, width: 0.6, height: 0.4 }, confidence: 0.9,
  }

  test('produces rows × cols units', () => {
    const units = expandGridToUnits(grid)
    expect(units).toHaveLength(6)
  })

  test('numbers lots sequentially from start_number, row-major', () => {
    const units = expandGridToUnits(grid)
    expect(units.map(u => u.suggested_code)).toEqual(['3J-01', '3J-02', '3J-03', '3J-04', '3J-05', '3J-06'])
  })

  test('honours a non-1 start_number', () => {
    const units = expandGridToUnits({ ...grid, start_number: 21, rows: 1, cols: 2 })
    expect(units.map(u => u.suggested_code)).toEqual(['3J-21', '3J-22'])
  })

  test('leaves the custom label empty (code is not copied into label)', () => {
    const units = expandGridToUnits(grid)
    expect(units.every(u => u.label_detected === null)).toBe(true)
  })

  test('lays cells out without overlap, normalized', () => {
    const units = expandGridToUnits(grid)
    // cellW = 0.6/3 = 0.2, cellH = 0.4/2 = 0.2, with an 8% gutter inset each side.
    const inset = 0.2 * 0.08
    expect(units[0].coordinates.x).toBeCloseTo(inset)
    expect(units[0].coordinates.y).toBeCloseTo(inset)
    expect(units[0].coordinates.width).toBeCloseTo(0.2 - 2 * inset)
    expect(units[0].coordinates.height).toBeCloseTo(0.2 - 2 * inset)
    expect(units[1].coordinates.x).toBeCloseTo(0.2 + inset) // second column, gutter-inset
    expect(units[3].coordinates.y).toBeCloseTo(0.2 + inset) // first cell of second row
  })
})

describe('buildUnits — end to end', () => {
  test('expands the canonical 2-group + road response into units', () => {
    const parsed = parseGridText(VALID_RESPONSE)
    const units = buildUnits(parsed)
    // 20 + 21 lots + 1 road = 42
    expect(units).toHaveLength(42)
    expect(units.filter(u => u.type === 'road')).toHaveLength(1)
    expect(units.filter(u => u.type === 'house')).toHaveLength(41)
  })

  test('reassigns sequential temp_ids', () => {
    const units = buildUnits(parseGridText(VALID_RESPONSE))
    expect(units[0].temp_id).toBe('u_001')
    expect(units[units.length - 1].temp_id).toBe('u_042')
  })
})

describe('parseGridResponse — from Gemini envelope', () => {
  test('extracts text from candidates and parses', () => {
    const { grids } = parseGridResponse(geminiResponse('```json\n' + VALID_RESPONSE + '\n```'))
    expect(grids).toHaveLength(2)
  })

  test('handles empty/malformed envelope gracefully', () => {
    expect(parseGridResponse({}).grids).toHaveLength(0)
    expect(parseGridResponse(null).grids).toHaveLength(0)
  })
})
