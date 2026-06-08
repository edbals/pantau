// Pure parsing + expansion logic for the Map Studio AI digitization flow.
// Kept free of Next/sharp/network concerns so it can be unit-tested directly.
//
// Pipeline: Gemini returns grid SECTIONS (prefix + rows/cols + bounding box);
// we expand each section into individual lot units mathematically. The model
// never has to enumerate every cell, which keeps its output small and reliable.

export type UnitType =
  | 'house' | 'apartment' | 'shophouse' | 'commercial' | 'villa'
  | 'road' | 'common_area' | 'parking' | 'facility' | 'drainage' | 'boundary'

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface DetectedUnit {
  temp_id: string
  type: UnitType
  label_detected: string | null
  suggested_code: string | null
  coordinates: BoundingBox
  rotation_degrees?: number
  confidence: number
}

export interface DetectedGrid {
  temp_id: string
  prefix: string
  rows: number
  cols: number
  start_number: number
  bounding_box: BoundingBox
  confidence: number
}

export interface NonGridArea {
  temp_id: string
  area_type: 'road' | 'common_area' | 'parking' | 'facility' | 'drainage' | 'boundary'
  label: string | null
  bounding_box: BoundingBox
}

export interface ParsedGrids {
  grids: DetectedGrid[]
  nonGrid: NonGridArea[]
}

const MAX_ROWS = 50
const MAX_COLS = 150
const MIN_GRID_DIM = 0.01
const MIN_AREA_DIM = 0.005

// ── Top-level: turn a raw Gemini response object into grids + areas ──────────

export function parseGridResponse(result: unknown): ParsedGrids {
  const rawText = extractFirstTextPart(result)
  if (!rawText) return { grids: [], nonGrid: [] }
  return parseGridText(rawText)
}

// Same as parseGridResponse but takes the model's text directly (handy in tests).
export function parseGridText(rawText: string): ParsedGrids {
  const cleaned = normaliseModelText(rawText)

  // Fast path: the whole payload is valid JSON.
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (isRecord(parsed)) return collectGridsAndAreas(parsed)
  } catch {
    // Fall through to tolerant recovery.
  }

  // Defense-in-depth: if the JSON is truncated or malformed, recover every
  // COMPLETE { ... } child by brace-matching — a partial response still yields
  // usable grids instead of a dead "0 detected".
  return recoverObjects(cleaned)
}

// ── Text normalisation ───────────────────────────────────────────────────────

// Strips a possible outer JSON-string wrapper (some model outputs are
// double-encoded) and markdown code fences, returning the inner JSON text.
export function normaliseModelText(rawText: string): string {
  let content = rawText.trim()
  if (content.startsWith('"')) {
    try {
      const decoded = JSON.parse(content)
      if (typeof decoded === 'string') content = decoded
    } catch {
      // Truncated outer string — unescape manually, keep up to the last brace.
      content = content.slice(1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
      const lastBrace = content.lastIndexOf('}')
      if (lastBrace !== -1) content = content.slice(0, lastBrace + 1)
    }
  }
  return content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
}

function collectGridsAndAreas(parsed: Record<string, unknown>): ParsedGrids {
  const rawGrids = Array.isArray(parsed.detected_grids) ? parsed.detected_grids : []
  const grids = rawGrids
    .map((g: unknown, i: number) => normaliseDetectedGrid(g, i))
    .filter((g): g is DetectedGrid => g !== null)

  const rawAreas = Array.isArray(parsed.non_grid_areas) ? parsed.non_grid_areas : []
  const nonGrid = rawAreas
    .map((a: unknown, i: number) => normaliseNonGridArea(a, i))
    .filter((a): a is NonGridArea => a !== null)

  return { grids, nonGrid }
}

// Brace-matches the grid/area objects (which live one level inside the root
// object) from possibly-truncated text and recovers every COMPLETE { ... } child.
export function recoverObjects(text: string): ParsedGrids {
  const objects: Record<string, unknown>[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') {
      // Grid/area objects open at depth 1 (root object is depth 0).
      if (depth === 1) start = i
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 1 && start !== -1) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1))
          if (isRecord(obj)) objects.push(obj)
        } catch {
          // Skip a child we can't parse.
        }
        start = -1
      }
    }
  }

  const grids: DetectedGrid[] = []
  const nonGrid: NonGridArea[] = []
  objects.forEach((obj, i) => {
    if ('prefix' in obj && 'rows' in obj && 'cols' in obj) {
      const g = normaliseDetectedGrid(obj, i)
      if (g) grids.push(g)
    } else if ('area_type' in obj) {
      const a = normaliseNonGridArea(obj, i)
      if (a) nonGrid.push(a)
    }
  })
  return { grids, nonGrid }
}

// ── Per-object normalisation ─────────────────────────────────────────────────

export function normaliseDetectedGrid(raw: unknown, index: number): DetectedGrid | null {
  if (!isRecord(raw) || !isRecord(raw.bounding_box)) return null

  const prefix = typeof raw.prefix === 'string' ? raw.prefix.trim().toUpperCase() : null
  if (!prefix) return null

  const rows = Math.round(Math.abs(toFiniteNumber(raw.rows) ?? 0))
  const cols = Math.round(Math.abs(toFiniteNumber(raw.cols) ?? 0))
  if (rows <= 0 || cols <= 0 || rows > MAX_ROWS || cols > MAX_COLS) return null

  const bounding_box = normaliseBox(raw.bounding_box)
  if (bounding_box.width < MIN_GRID_DIM || bounding_box.height < MIN_GRID_DIM) return null

  return {
    temp_id: typeof raw.temp_id === 'string' ? raw.temp_id : `g_${index}`,
    prefix,
    rows,
    cols,
    start_number: Math.max(1, Math.round(toFiniteNumber(raw.start_number) ?? 1)),
    bounding_box,
    confidence: clamp01(toFiniteNumber(raw.confidence) ?? 0.7),
  }
}

const VALID_AREA_TYPES = new Set<string>(['road', 'common_area', 'parking', 'facility', 'drainage', 'boundary'])

export function normaliseNonGridArea(raw: unknown, index: number): NonGridArea | null {
  if (!isRecord(raw) || !isRecord(raw.bounding_box)) return null

  const areaType = typeof raw.area_type === 'string' && VALID_AREA_TYPES.has(raw.area_type)
    ? raw.area_type as NonGridArea['area_type']
    : 'road'

  const bounding_box = normaliseBox(raw.bounding_box)
  if (bounding_box.width < MIN_AREA_DIM || bounding_box.height < MIN_AREA_DIM) return null

  return {
    temp_id: typeof raw.temp_id === 'string' ? raw.temp_id : `a_${index}`,
    area_type: areaType,
    label: typeof raw.label === 'string' ? raw.label.trim() || null : null,
    bounding_box,
  }
}

function normaliseBox(raw: Record<string, unknown>): BoundingBox {
  return {
    x: clamp01(toFiniteNumber(raw.x) ?? 0),
    y: clamp01(toFiniteNumber(raw.y) ?? 0),
    width: clamp01(toFiniteNumber(raw.width) ?? 0),
    height: clamp01(toFiniteNumber(raw.height) ?? 0),
  }
}

// ── Expansion: grid sections → individual lot units ──────────────────────────

// Fraction of each cell left as a gutter so generated lots read as separated
// tiles instead of a cramped, touching grid. Cells otherwise fill their detected
// bounding box exactly — widening to "square" makes adjacent blocks overlap.
const CELL_GAP_RATIO = 0.08

export function expandGridToUnits(grid: DetectedGrid): DetectedUnit[] {
  const { prefix, rows, cols, start_number, bounding_box, confidence, temp_id } = grid
  const cellH = bounding_box.height / rows
  const cellW = bounding_box.width / cols

  const insetX = cellW * CELL_GAP_RATIO
  const insetY = cellH * CELL_GAP_RATIO
  const units: DetectedUnit[] = []
  let n = start_number

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const code = `${prefix}-${String(n).padStart(2, '0')}`
      units.push({
        temp_id: `${temp_id}_r${r}_c${c}`,
        type: 'house',
        // The generated code IS the unit code; the custom label is left empty
        // for a human-friendly name (e.g. "Rumah Hook"), not a copy of the code.
        label_detected: null,
        suggested_code: code,
        coordinates: {
          x: clamp01(bounding_box.x + c * cellW + insetX),
          y: clamp01(bounding_box.y + r * cellH + insetY),
          width: clamp01(cellW - 2 * insetX),
          height: clamp01(cellH - 2 * insetY),
        },
        rotation_degrees: 0,
        confidence,
      })
      n++
    }
  }
  return units
}

export function convertNonGridArea(area: NonGridArea): DetectedUnit[] {
  const { x, y, width, height } = area.bounding_box
  return [{
    temp_id: area.temp_id,
    type: area.area_type,
    label_detected: area.label,
    suggested_code: null,
    coordinates: { x, y, width, height },
    rotation_degrees: 0,
    confidence: 0.7,
  }]
}

export function sortUnitsSpatially(units: DetectedUnit[]): DetectedUnit[] {
  return [...units].sort((a, b) => {
    const ay = a.coordinates.y + a.coordinates.height / 2
    const by = b.coordinates.y + b.coordinates.height / 2
    if (Math.abs(ay - by) > 0.025) return ay - by
    return a.coordinates.x - b.coordinates.x
  })
}

// Builds the final, spatially-ordered unit list from parsed grids + areas.
export function buildUnits(parsed: ParsedGrids): DetectedUnit[] {
  const houseUnits = parsed.grids.flatMap(expandGridToUnits)
  const areaUnits = parsed.nonGrid.flatMap(convertNonGridArea)
  return sortUnitsSpatially([...houseUnits, ...areaUnits])
    .map((u, i) => ({ ...u, temp_id: `u_${String(i + 1).padStart(3, '0')}` }))
}

// ── Gemini response helpers ──────────────────────────────────────────────────

export function extractFirstTextPart(result: unknown): string | null {
  if (!isRecord(result) || !Array.isArray(result.candidates)) return null
  const [candidate] = result.candidates
  if (!isRecord(candidate) || !isRecord(candidate.content) || !Array.isArray(candidate.content.parts)) return null
  const textParts = candidate.content.parts
    .map(part => isRecord(part) && typeof part.text === 'string' ? part.text : '')
    .filter(Boolean)
  return textParts.join('').trim() || null
}

// ── Small utilities ──────────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
