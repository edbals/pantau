import { describe, test, expect } from 'vitest'
import {
  parseUnitCode,
  generateGridCodes,
  validateUnitCodes,
  parseSkipList,
} from './numbering'

describe('parseUnitCode', () => {
  test('parses plain code', () => {
    expect(parseUnitCode('3J-03')).toEqual({ prefix: '3J', number: 3, suffix: '' })
  })
  test('parses lowercase suffix', () => {
    expect(parseUnitCode('3J-03a')).toEqual({ prefix: '3J', number: 3, suffix: 'a' })
  })
  test('parses uppercase suffix (normalised to lowercase)', () => {
    expect(parseUnitCode('3J-3B')).toEqual({ prefix: '3J', number: 3, suffix: 'b' })
  })
  test('rejects non-conforming codes', () => {
    expect(parseUnitCode('garbage')).toBeNull()
  })
})

describe('parseSkipList', () => {
  test('parses comma/space separated numbers, unique + sorted', () => {
    expect(parseSkipList('14, 4 13,13')).toEqual([4, 13, 14])
  })
  test('ignores junk', () => {
    expect(parseSkipList('4, x, -2, 0')).toEqual([4])
  })
  test('empty input', () => {
    expect(parseSkipList('')).toEqual([])
  })
})

describe('generateGridCodes', () => {
  test('sequential, zero-padded', () => {
    expect(generateGridCodes({ prefix: '3J', start: 1, count: 3 })).toEqual(['3J-01', '3J-02', '3J-03'])
  })
  test('skips unlucky numbers (tetraphobia)', () => {
    // 4, 13, 14 skipped → still produces `count` codes
    const codes = generateGridCodes({ prefix: 'F', start: 1, count: 5, skip: [4, 13, 14] })
    expect(codes).toEqual(['F-01', 'F-02', 'F-03', 'F-05', 'F-06'])
  })
  test('honours a non-1 start', () => {
    expect(generateGridCodes({ prefix: 'A', start: 21, count: 2 })).toEqual(['A-21', 'A-22'])
  })
  test('never infinite-loops on a pathological skip set', () => {
    const codes = generateGridCodes({ prefix: 'A', start: 1, count: 2, skip: [1, 2, 3] })
    expect(codes).toEqual(['A-04', 'A-05'])
  })
})

describe('validateUnitCodes', () => {
  test('no issues for a clean sequence', () => {
    expect(validateUnitCodes(['3J-01', '3J-02', '3J-03'])).toEqual([])
  })

  test('does NOT flag a lowercase split-lot as a missing number (the screenshot bug)', () => {
    // 3J-03a present → number 3 is present, so no "hilang 3J-03"
    const issues = validateUnitCodes(['3J-01', '3J-02', '3J-03a', '3J-03b', '3J-05'])
    // Only 3J-04 should be a gap (and only if not in skip list)
    const gaps = issues.filter(i => i.type === 'gap').flatMap(i => i.type === 'gap' ? i.gaps : [])
    expect(gaps).toContain('3J-04')
    expect(gaps).not.toContain('3J-03')
  })

  test('respects the skip list (no gap for intentionally skipped numbers)', () => {
    const issues = validateUnitCodes(['3J-01', '3J-02', '3J-03', '3J-05', '3J-06'], [4])
    expect(issues.filter(i => i.type === 'gap')).toHaveLength(0)
  })

  test('still catches a genuine forgotten lot', () => {
    const issues = validateUnitCodes(['A-01', 'A-02', 'A-04'])
    const gaps = issues.filter(i => i.type === 'gap').flatMap(i => i.type === 'gap' ? i.gaps : [])
    expect(gaps).toEqual(['A-03'])
  })

  test('flags duplicates', () => {
    const issues = validateUnitCodes(['A-01', 'A-01', 'A-02'])
    expect(issues.find(i => i.type === 'duplicate')).toMatchObject({ codes: ['A-01'] })
  })

  test('flags a missing middle suffix (a, c present → b missing)', () => {
    const issues = validateUnitCodes(['A-03a', 'A-03c'])
    expect(issues.find(i => i.type === 'missing_suffix')).toMatchObject({ missing: 'A-3b' })
  })

  test('does not flag contiguous suffixes a, b, c', () => {
    const issues = validateUnitCodes(['A-03a', 'A-03b', 'A-03c'])
    expect(issues.filter(i => i.type === 'missing_suffix')).toHaveLength(0)
  })
})
