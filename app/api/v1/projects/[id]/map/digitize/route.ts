import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

// Verified models against live API 2026-06-07
const MODELS = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
]

interface DetectedUnit {
  temp_id: string
  type: string
  label_detected: string | null
  suggested_code: string | null
  coordinates: { x: number; y: number; width: number; height: number }
  confidence: number
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY
  if (!apiKey) {
    return ok({ detected_units: generateStubLayout(), overall_confidence: 0, stub: true })
  }

  const formData = await request.formData()
  const image = formData.get('image') as File | null
  if (!image) return err('image is required', 400)

  const bytes = await image.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')
  const mimeType = image.type || 'image/jpeg'

  // Run 3 passes in parallel: full image + left half + right half
  // This triples detection coverage for dense plans like block plans with 200+ lots
  const passes: { focus: 'left' | 'right' | null; desc: string }[] = [
    { focus: null,    desc: 'full image' },
    { focus: 'left',  desc: 'left half (x 0.0–0.55)' },
    { focus: 'right', desc: 'right half (x 0.45–1.0)' },
  ]

  console.log('[Digitize] Starting 3-pass parallel detection...')

  const results = await Promise.all(
    passes.map(p => runDetection(base64, mimeType, apiKey, p.focus, p.desc))
  )

  const allUnits = results.flat()
  console.log(`[Digitize] Raw totals per pass: ${results.map(r => r.length).join(' / ')} → ${allUnits.length} before dedup`)

  const deduped = deduplicateUnits(allUnits)
  console.log(`[Digitize] After deduplication: ${deduped.length} units`)

  const cleaned = removeGhosts(deduped)
  console.log(`[Digitize] After ghost removal: ${cleaned.length} units (removed ${deduped.length - cleaned.length} ghosts)`)

  // Re-index temp_ids so they're unique across all passes
  const finalUnits = cleaned.map((u, i) => ({
    ...u,
    temp_id: `u_${String(i + 1).padStart(3, '0')}`,
  }))

  return ok({
    detected_units: finalUnits,
    overall_confidence: finalUnits.length > 0 ? 0.8 : 0,
    unit_count: finalUnits.length,
    passes: results.map(r => r.length),
  })
}

async function runDetection(
  base64: string,
  mimeType: string,
  apiKey: string,
  focus: 'left' | 'right' | null,
  desc: string
): Promise<DetectedUnit[]> {
  const regionInstruction = focus === 'left'
    ? '\nFOCUS: Detect ONLY units in the LEFT HALF of the image (x coordinates 0.0–0.55). Ignore the right side. Still return coordinates relative to the FULL image.'
    : focus === 'right'
    ? '\nFOCUS: Detect ONLY units in the RIGHT HALF of the image (x coordinates 0.45–1.0). Ignore the left side. Still return coordinates relative to the FULL image.'
    : '\nFOCUS: Scan the entire image. Try to detect every lot, including small and densely packed ones.'

  const prompt = `You are analyzing an Indonesian residential housing site plan (denah kavling / blok plan).

The image shows individual land lots arranged in labeled blocks. Each lot has an alphanumeric label like F1, G23, J12b, I3a. Blocks are labeled BLOK F, BLOK G, etc. There may also be roads (JALAN), green areas (TAMAN, FASOS, FASUM), and facilities.
${regionInstruction}

TASK: Detect every individual lot/unit visible. Return precise normalized coordinates (0.0–1.0) relative to the FULL image dimensions.

Return ONLY this JSON, no markdown:
{
  "detected_units": [
    {
      "temp_id": "u_001",
      "type": "house",
      "label_detected": "F1",
      "suggested_code": "F-01",
      "coordinates": { "x": 0.05, "y": 0.10, "width": 0.025, "height": 0.04 },
      "confidence": 0.9
    }
  ]
}

Rules:
- type: "house" for individual lots, "road" for jalan, "common_area" for taman/FASOS/FASUM
- Include ALL visible lots — do not skip small or densely packed ones
- x,y = top-left corner of the lot, coordinates normalized 0–1 to FULL image
- Lot boxes should be small and tight — do not draw one large box over a whole block`

  const body = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  }

  let response: Response | null = null
  for (const model of MODELS) {
    const attempt = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    if (attempt.status !== 503 && attempt.status !== 404) {
      response = attempt
      console.log(`[Digitize:${desc}] Using model: ${model}`)
      break
    }
    console.warn(`[Digitize:${desc}] ${model} → ${attempt.status}, trying next...`)
  }

  if (!response || !response.ok) {
    console.error(`[Digitize:${desc}] All models failed`)
    return []
  }

  const result = await response.json()
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  if (!rawText) {
    console.warn(`[Digitize:${desc}] Empty response`)
    return []
  }

  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    const units: DetectedUnit[] = Array.isArray(parsed.detected_units) ? parsed.detected_units : []
    console.log(`[Digitize:${desc}] Detected ${units.length} units`)
    return units
  } catch {
    console.error(`[Digitize:${desc}] JSON parse failed:`, cleaned.slice(0, 200))
    return []
  }
}

// Remove duplicate detections where unit centers are within 2% of each other
function deduplicateUnits(units: DetectedUnit[]): DetectedUnit[] {
  const kept: DetectedUnit[] = []
  for (const unit of units) {
    const cx = unit.coordinates.x + unit.coordinates.width / 2
    const cy = unit.coordinates.y + unit.coordinates.height / 2
    const isDuplicate = kept.some(k => {
      const kx = k.coordinates.x + k.coordinates.width / 2
      const ky = k.coordinates.y + k.coordinates.height / 2
      return Math.abs(cx - kx) < 0.025 && Math.abs(cy - ky) < 0.025
    })
    if (!isDuplicate) kept.push(unit)
  }
  return kept
}

// Remove ghost units — dimension annotations, scale bars, compass roses etc.
// that Gemini mistakes for lots. Uses two filters:
// 1. Minimum size: tiny rectangles are almost never real lots
// 2. Spatial outliers: units far from the main cluster are hallucinations
function removeGhosts(units: DetectedUnit[]): DetectedUnit[] {
  if (units.length < 4) return units

  // Filter 1: drop units smaller than 0.05% of image area
  // Real lots on a typical site plan are at least 1–2% wide × 1–2% tall
  const sizeFiltered = units.filter(u =>
    u.coordinates.width * u.coordinates.height >= 0.0005
  )

  if (sizeFiltered.length < 4) return sizeFiltered

  // Filter 2: Median Absolute Deviation — robust against outliers
  // (unlike std deviation, a few ghost points don't skew the result)
  const cx = sizeFiltered.map(u => u.coordinates.x + u.coordinates.width / 2)
  const cy = sizeFiltered.map(u => u.coordinates.y + u.coordinates.height / 2)

  const medX = median(cx)
  const medY = median(cy)
  const madX = median(cx.map(x => Math.abs(x - medX)))
  const madY = median(cy.map(y => Math.abs(y - medY)))

  // Keep units within 3× MAD from median (covers ~99% of a normal cluster)
  // Minimum threshold of 0.15 prevents over-filtering on small plans
  const threshX = Math.max(madX * 3, 0.15)
  const threshY = Math.max(madY * 3, 0.15)

  return sizeFiltered.filter(u => {
    const x = u.coordinates.x + u.coordinates.width / 2
    const y = u.coordinates.y + u.coordinates.height / 2
    return Math.abs(x - medX) <= threshX && Math.abs(y - medY) <= threshY
  })
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
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
