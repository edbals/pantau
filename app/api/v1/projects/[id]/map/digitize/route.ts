import { NextRequest } from 'next/server'
import sharp from 'sharp'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'
import {
  buildUnits,
  parseGridResponse,
  type DetectedUnit,
  type ParsedGrids,
} from '@/lib/digitize/grid-parser'

export const runtime = 'nodejs'

// Verified-live vision models (2026-06), best-first. gemini-2.5-flash is the
// most consistent; gemini-3.5-flash is capable but intermittently hangs, so it
// sits behind 2.5 as a fallback. gemini-2.0-* are retired (404).
const MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
]

// Successful calls return in ~12s; 22s gives headroom but fails over to the
// next model quickly when one hangs (the old 30s felt like "it's broken").
const GEMINI_TIMEOUT_MS = 22_000
const MAX_OUTPUT_TOKENS = 8192

const GRID_DETECTION_PROMPT = `You are analyzing an Indonesian residential housing site plan (denah kavling / blok plan).

The image contains multiple rectangular sections (blok) of residential parcels. Each section consists of a uniform grid of identically-sized lots arranged in rows and columns. All lots in one section share the same prefix (e.g., all labeled 3J1, 3J2, 3J3... or F1, F2, F3...).

YOUR TASK: Identify each rectangular grid section and return its STRUCTURE — not individual cells.

For EACH grid section:
1. Find the TIGHT bounding box around ALL lots in that section (exclude surrounding roads, labels, whitespace).
2. Count the EXACT number of rows (horizontal layers top-to-bottom) and columns (lots in one horizontal strip left-to-right).
3. Read the prefix:
   - "3J1", "3J2", "3J20" -> prefix "3J"
   - "3H23b", "3H1" -> prefix "3H"
   - "F1", "F25" -> prefix "F"
   - "G23" -> prefix "G"
4. start_number: lowest lot number visible. Usually 1. If a group starts at 21 (1-20 are in a separate group to the left), use 21.

Rules:
- Same prefix separated by a road = TWO separate grid entries with different start_number.
- Count only actual lot cells, NOT road strips or dimension labels.
- Bounding box must be TIGHT around the lots only.
- All coordinates normalized 0-1 relative to full image dimensions. x,y = top-left corner.
- rows and cols must be whole positive integers.

Return a JSON object with this EXACT structure (no markdown, no explanation, just the JSON):
{
  "detected_grids": [
    {
      "temp_id": "g_01",
      "prefix": "3J",
      "rows": 1,
      "cols": 20,
      "start_number": 1,
      "bounding_box": { "x": 0.01, "y": 0.03, "width": 0.47, "height": 0.08 },
      "confidence": 0.95
    }
  ],
  "non_grid_areas": [
    {
      "temp_id": "a_01",
      "area_type": "road",
      "label": "Jalan Utama",
      "bounding_box": { "x": 0.0, "y": 0.9, "width": 1.0, "height": 0.1 }
    }
  ]
}`

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params

  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY
  if (!apiKey) {
    return ok({ detected_units: generateStubLayout(), overall_confidence: 0, stub: true })
  }

  const formData = await request.formData()
  const image = formData.get('image') as File | null
  if (!image) return err('image is required', 400)

  const rawBuffer = Buffer.from(await image.arrayBuffer())
  const mimeType = normaliseMimeType(image.type, image.name)
  if (rawBuffer.length === 0) return err('Uploaded image is empty', 400)

  let imagePass: { base64: string; mimeType: string }
  try {
    imagePass = await prepareImage(rawBuffer, mimeType)
  } catch (e) {
    console.error('[Digitize] Image preparation failed:', e)
    return err('Could not read this image. Try a PNG/JPG export of the site plan.', 400)
  }

  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: GRID_DETECTION_PROMPT },
        { inline_data: { mime_type: imagePass.mimeType, data: imagePass.base64 } },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // CRITICAL: disable the model's "thinking" phase. Left on, it burned
      // ~5500 tokens of the output budget (→ truncated/unparseable JSON) and
      // ~38s of latency (→ timeouts). Off, the same call returns clean JSON in ~6s.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  let parsed: ParsedGrids | null = null
  let usedModel: string | null = null

  for (const model of MODELS) {
    const response = await fetchGemini(model, apiKey, body)
    if (response.ok) {
      parsed = parseGridResponse(response.json)
      usedModel = model
      console.log(`[Digitize] ${model} → ${parsed.grids.length} grid sections, ${parsed.nonGrid.length} non-grid areas`)
      break
    }
    console.warn(`[Digitize] ${model} → ${response.status}: ${response.message}`)
    // Retry on transient/availability errors: timeout (0), overloaded (503),
    // rate-limited (429), not-found (404 = model retired/unavailable).
    const retryable = response.status === 0 || response.status === 503 || response.status === 429 || response.status === 404
    if (!retryable) break
  }

  if (!parsed) return err('All Gemini models failed to respond', 502)

  const allUnits = buildUnits(parsed)
  console.log(`[Digitize] Total units = ${allUnits.length}`)

  return ok({
    detected_units: allUnits,
    overall_confidence: parsed.grids.length > 0 ? 0.85 : 0,
    unit_count: allUnits.length,
    diagnostics: {
      model: usedModel,
      grids_detected: parsed.grids.length,
      non_grid_areas: parsed.nonGrid.length,
      grids: parsed.grids.map(g => ({
        prefix: g.prefix,
        rows: g.rows,
        cols: g.cols,
        start: g.start_number,
        units: g.rows * g.cols,
      })),
    },
  })
}

function normaliseMimeType(type: string, name: string): string {
  if (type) return type
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'image/jpeg'
}

async function prepareImage(rawBuffer: Buffer, mimeType: string): Promise<{ base64: string; mimeType: string }> {
  if (mimeType === 'application/pdf') {
    return { base64: rawBuffer.toString('base64'), mimeType }
  }

  // Convert to JPEG, apply EXIF rotation, upscale-cap to a resolution suitable
  // for reading lot labels. Grid sections are large, so this is plenty.
  const buffer = await sharp(rawBuffer, { limitInputPixels: false })
    .rotate()
    .toColorspace('srgb')
    .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
    .sharpen()
    .jpeg({ quality: 92 })
    .toBuffer()

  const meta = await sharp(buffer).metadata()
  console.log(`[Digitize] Prepared: ${meta.width}×${meta.height}, ${Math.round(buffer.length / 1024)}KB`)
  return { base64: buffer.toString('base64'), mimeType: 'image/jpeg' }
}

async function fetchGemini(
  model: string,
  apiKey: string,
  body: unknown
): Promise<{ ok: true; json: unknown } | { ok: false; status: number; message: string }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      }
    )
    const text = await response.text()
    const json = parseJson(text)
    if (response.ok) return { ok: true, json }
    const message = (extractGeminiError(json) ?? text.slice(0, 300)) || response.statusText
    return { ok: false, status: response.status, message }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'request failed'
    return { ok: false, status: 0, message }
  } finally {
    clearTimeout(timeout)
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function extractGeminiError(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const errorField = (json as Record<string, unknown>).error
  if (typeof errorField !== 'object' || errorField === null) return null
  const message = (errorField as Record<string, unknown>).message
  return typeof message === 'string' ? message : null
}

function generateStubLayout(): DetectedUnit[] {
  const units: DetectedUnit[] = []
  let n = 1
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      units.push({
        temp_id: `u_${String(n).padStart(3, '0')}`, type: 'house',
        label_detected: null, suggested_code: `A-${String(n).padStart(2, '0')}`,
        coordinates: { x: 0.05 + col * 0.155, y: 0.08 + row * 0.28, width: 0.13, height: 0.22 },
        confidence: 0,
      })
      n++
    }
  }
  units.push({
    temp_id: 'u_road_1', type: 'road', label_detected: 'Jalan Utama', suggested_code: null,
    coordinates: { x: 0.0, y: 0.92, width: 1.0, height: 0.08 }, confidence: 0,
  })
  return units
}
