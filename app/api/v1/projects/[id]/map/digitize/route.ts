import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

// Gemini 2.5 Flash digitization endpoint.
// Stub: returns a realistic demo layout until GOOGLE_GEMINI_API_KEY is configured.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY
  if (!apiKey) {
    // Return stub layout so the canvas works before Gemini is configured
    return ok({
      detected_units: generateStubLayout(),
      overall_confidence: 0,
      stub: true,
    })
  }

  const formData = await request.formData()
  const image = formData.get('image') as File | null
  if (!image) return err('image is required', 400)

  const bytes = await image.arrayBuffer()
  const base64 = Buffer.from(bytes).toString('base64')

  const prompt = `Analyze this site plan or floor plan image. Identify all individual unit blocks (houses, apartments, lots, shophouses) and non-unit areas (roads, common areas, parking).

Return ONLY valid JSON in this exact structure, nothing else:
{
  "detected_units": [
    {
      "temp_id": "u_001",
      "type": "house|apartment|shophouse|commercial|villa|road|common_area|parking|facility|drainage|boundary",
      "label_detected": "text label visible on this unit, or null",
      "suggested_code": "suggested unit code like A-01 or null",
      "coordinates": { "x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0 },
      "confidence": 0.0
    }
  ],
  "overall_confidence": 0.0
}

Coordinates must be normalized 0-1 relative to image dimensions. x,y = top-left corner.
Return only the JSON object, no markdown, no explanation.`

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: image.type, data: base64 } },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    }
  )

  if (!response.ok) return err('Gemini API error', 502)

  const result = await response.json()
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) return err('No response from Gemini', 502)

  try {
    return ok(JSON.parse(text))
  } catch {
    return err('Invalid JSON from Gemini', 502)
  }
}

function generateStubLayout() {
  const units = []
  let n = 1
  // 3 rows × 6 houses
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      units.push({
        temp_id: `u_${String(n).padStart(3, '0')}`,
        type: 'house',
        label_detected: null,
        suggested_code: `A-${String(n).padStart(2, '0')}`,
        coordinates: {
          x: 0.05 + col * 0.155,
          y: 0.08 + row * 0.28,
          width: 0.13,
          height: 0.22,
        },
        confidence: 0,
      })
      n++
    }
  }
  // Road at bottom
  units.push({
    temp_id: 'u_road_1',
    type: 'road',
    label_detected: 'Jalan Utama',
    suggested_code: null,
    coordinates: { x: 0.0, y: 0.92, width: 1.0, height: 0.08 },
    confidence: 0,
  })
  return units
}
