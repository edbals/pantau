// Unit-code numbering: generation (with skip-lists for tetraphobia) and
// validation (suffix-aware, skip-aware). Pure + testable.
//
// Indonesian developers often skip "unlucky" numbers (4, 13, 14) and split a
// lot into letter-suffixed sub-lots (3a, 3b, 12a, 12b, 12c). Numbering must
// accommodate both without false "missing code" warnings.

export type ValidationIssue =
  | { type: 'duplicate'; codes: string[] }
  | { type: 'gap'; prefix: string; gaps: string[] }
  | { type: 'missing_suffix'; missing: string }

export interface ParsedCode {
  prefix: string   // e.g. "3J"
  number: number   // e.g. 3
  suffix: string   // e.g. "a" (lowercased), or "" when none
}

const MAX_GAP_ISSUES = 5

// Explicit per-number override applied while generating codes:
// - 'skip':    the numeral is omitted entirely and no cell consumes it; the
//              sequence renumbers past it (e.g. ...3, 5, 6 — classic tetraphobia).
// - 'replace': the cell is KEPT and labelled with the EXACT `value` provided
//              (e.g. "3A", "12B"), prefixed — the engine does not compute the
//              suffix. Lot count is preserved and the user controls the label.
export interface SkipRule {
  target: number
  action: 'skip' | 'replace'
  value?: string
}

// Parses "3J-03a" / "3J-3B" / "A-12" into parts. Returns null if it doesn't
// fit the "<prefix>-<number><optional letter>" shape.
export function parseUnitCode(code: string): ParsedCode | null {
  const match = code.match(/^(.+)-(\d+)([A-Za-z]?)$/)
  if (!match) return null
  return { prefix: match[1], number: parseInt(match[2], 10), suffix: match[3].toLowerCase() }
}

// Deterministic numbering engine: generates exactly `count` codes for `count`
// physical cells, honouring per-number skip/suffix rules. The unit_code array is
// derived purely from these inputs — never from the AI's OCR of suffixes.
// Format: PREFIX-NN (zero-padded to at least 2 digits), with an optional letter.
export function generateCodes(opts: {
  prefix: string
  start: number
  count: number
  rules?: Iterable<SkipRule>
  pad?: number
}): string[] {
  const { prefix, start, count, pad = 2 } = opts
  const ruleByNumber = new Map<number, SkipRule>()
  for (const r of opts.rules ?? []) ruleByNumber.set(r.target, r)

  const codes: string[] = []
  let n = start
  let guard = 0
  const maxGuard = count + ruleByNumber.size + 10000

  while (codes.length < count && guard < maxGuard) {
    guard++
    const rule = ruleByNumber.get(n)
    if (rule?.action === 'skip') { n++; continue }
    if (rule?.action === 'replace') {
      // Use the caller's exact label; fall back to the plain number if absent.
      const label = rule.value ?? String(n).padStart(pad, '0')
      codes.push(`${prefix}-${label}`)
      n++
      continue
    }
    codes.push(`${prefix}-${String(n).padStart(pad, '0')}`)
    n++
  }
  return codes
}

// Back-compat wrapper: a plain skip-list maps to all-'skip' rules.
export function generateGridCodes(opts: {
  prefix: string
  start: number
  count: number
  skip?: Iterable<number>
  pad?: number
}): string[] {
  const rules: SkipRule[] = [...new Set(opts.skip ?? [])].map(target => ({ target, action: 'skip' }))
  return generateCodes({ prefix: opts.prefix, start: opts.start, count: opts.count, rules, pad: opts.pad })
}

// Validates a set of unit codes. `skip` lists numbers intentionally omitted
// (e.g. 4, 13, 14) so they are not reported as gaps.
export function validateUnitCodes(codes: string[], skip: Iterable<number> = []): ValidationIssue[] {
  const present = codes.filter(Boolean)
  const skipSet = new Set(skip)
  const issues: ValidationIssue[] = []

  // 1. Duplicates
  const seen = new Set<string>()
  const dupes: string[] = []
  for (const code of present) {
    if (seen.has(code)) dupes.push(code)
    else seen.add(code)
  }
  if (dupes.length > 0) issues.push({ type: 'duplicate', codes: [...new Set(dupes)] })

  // Parse once.
  const parsed = present.map(parseUnitCode).filter((p): p is ParsedCode => p !== null)

  // 2. Numeric gaps per prefix (a base number counts as present with or without
  //    a suffix; intentional skips are excluded).
  const numbersByPrefix = new Map<string, Set<number>>()
  for (const { prefix, number } of parsed) {
    const set = numbersByPrefix.get(prefix) ?? new Set<number>()
    set.add(number)
    numbersByPrefix.set(prefix, set)
  }
  let gapCount = 0
  for (const [prefix, set] of numbersByPrefix) {
    const nums = [...set].sort((a, b) => a - b)
    if (nums.length < 2) continue
    const gaps: string[] = []
    for (let i = nums[0] + 1; i < nums[nums.length - 1]; i++) {
      if (!set.has(i) && !skipSet.has(i)) {
        gaps.push(`${prefix}-${String(i).padStart(2, '0')}`)
        if (++gapCount >= MAX_GAP_ISSUES) break
      }
    }
    if (gaps.length > 0) issues.push({ type: 'gap', prefix, gaps })
    if (gapCount >= MAX_GAP_ISSUES) break
  }

  // 3. Suffix gaps: within one base (prefix+number) that uses letters, flag a
  //    missing middle letter (e.g. a and c present, b missing).
  const suffixesByBase = new Map<string, Set<string>>()
  for (const { prefix, number, suffix } of parsed) {
    if (!suffix) continue
    const base = `${prefix}-${number}`
    const set = suffixesByBase.get(base) ?? new Set<string>()
    set.add(suffix)
    suffixesByBase.set(base, set)
  }
  for (const [base, set] of suffixesByBase) {
    const letters = [...set].sort()
    const first = letters[0].charCodeAt(0)
    const last = letters[letters.length - 1].charCodeAt(0)
    for (let c = first + 1; c < last; c++) {
      const ch = String.fromCharCode(c)
      if (!set.has(ch)) issues.push({ type: 'missing_suffix', missing: `${base}${ch}` })
    }
  }

  return issues
}

// Parses a "4, 13, 14" style input into a sorted unique number array.
export function parseSkipList(input: string): number[] {
  const nums = input
    .split(/[,\s]+/)
    .map(s => parseInt(s.trim(), 10))
    .filter(n => Number.isFinite(n) && n > 0)
  return [...new Set(nums)].sort((a, b) => a - b)
}
