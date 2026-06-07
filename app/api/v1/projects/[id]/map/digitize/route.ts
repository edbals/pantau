import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

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

  const prompt = `You are analyzing an Indonesian residential housing site plan (denah kavling / blok plan).

The image shows individual land lots arranged in labeled blocks. Each lot has an alphanumeric label like F1, G23, J12b, I3a. Blocks are labeled BLOK F, BLOK G, etc. There may also be roads (JALAN), green areas (TAMAN, FASOS, FASUM), and facilities.

TASK: Detect every individual lot/unit visible in the image. Return normalized coordinates (0.0 to 1.0) relative to the full image size.

Return ONLY this JSON structure, no markdown, no explanation:
{
  "detected_units": [
    {
      "temp_id": "u_001",
      "type": "house",
      "label_detected": "F1",
      "suggested_code": "F-01",
      "coordinates": { "x": 0.05, "y": 0.10, "width": 0.03, "height": 0.05 },
      "confidence": 0.9
    }
  ],
  "overall_confidence": 0.85
}

Type values: house (default for lots), road (jalan), common_area (taman/FASOS/FASUM), parking, facility, boundary.
Include ALL lots. Do not skip small or partially visible lots.
Coordinates: x,y = top-left corner of the lot, normalized 0-1 to image width/height.`

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } },
      ],
    }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  }

  // Verified against live API 2026-06-07. Try best model first, fall back on 503/404.
  const MODELS = [
    'gemini-2.5-flash',      // primary — best quality/price for vision
    'gemini-3.5-flash',      // newer general flash
    'gemini-2.0-flash-001',  // stable pinned version
    'gemini-2.0-flash-lite', // lightweight last resort
  ]

  let geminiRes: Response | null = null
  let usedModel = ''

  for (const model of MODELS) {
    console.log(`[Digitize] Trying model: ${model}`)
    const attempt = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody) }
    )
    if (attempt.status !== 503 && attempt.status !== 404) {
      geminiRes = attempt
      usedModel = model
      break
    }
    console.warn(`[Digitize] ${model} returned ${attempt.status}, trying next...`)
  }

  if (!geminiRes) {
    return err('Semua model Gemini sedang sibuk — coba lagi dalam 1-2 menit', 503)
  }

  if (!geminiRes.ok) {
    const errText = await geminiRes.text()
    console.error('[Digitize] Gemini error', geminiRes.status, errText.slice(0, 300))
    return err(`Gemini error ${geminiRes.status}: ${errText.slice(0, 100)}`, 502)
  }

  console.log(`[Digitize] Using model: ${usedModel}`)

  const result = await geminiRes.json()

  // Log full response for debugging
  const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  console.log('[Digitize] Raw Gemini response (first 500 chars):', rawText.slice(0, 500))

  if (!rawText) {
    const finishReason = result.candidates?.[0]?.finishReason
    console.error('[Digitize] No text in response. finishReason:', finishReason, 'Full result:', JSON.stringify(result).slice(0, 400))
    return err(`Gemini returned no content (finishReason: ${finishReason})`, 502)
  }

  // Strip markdown code fences if present
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed: { detected_units?: unknown[]; overall_confidence?: number }
  try {
    parsed = JSON.parse(cleaned)
  } catch (e) {
    console.error('[Digitize] JSON parse failed. Cleaned text:', cleaned.slice(0, 500))
    return err('Gemini returned invalid JSON — try a clearer image', 502)
  }

  const units = Array.isArray(parsed.detected_units) ? parsed.detected_units : []
  console.log(`[Digitize] Detected ${units.length} units, confidence: ${parsed.overall_confidence ?? 'N/A'}`)

  return ok({
    detected_units: units,
    overall_confidence: parsed.overall_confidence ?? 0,
    unit_count: units.length,
  })
}

function generateStubLayout() {
  const units = []
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
