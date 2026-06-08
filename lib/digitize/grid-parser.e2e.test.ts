// End-to-end test against the REAL Gemini API using the production parsing path.
// Skipped automatically unless GOOGLE_GEMINI_API_KEY is set, so `npm test`/CI
// stays hermetic. Run explicitly with:
//   GOOGLE_GEMINI_API_KEY=... npx vitest run lib/digitize/grid-parser.e2e.test.ts
import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { parseGridResponse, buildUnits } from './grid-parser'

const apiKey = process.env.GOOGLE_GEMINI_API_KEY
const imagePath = join(process.cwd(), 'scripts/repro/siteplan.png')
const canRun = Boolean(apiKey) && existsSync(imagePath)

const PROMPT = `You are analyzing an Indonesian residential housing site plan (denah kavling / blok plan).
The image contains multiple rectangular grid sections of residential lots sharing a prefix (e.g. 3J1, 3J2...).
Identify each grid section's STRUCTURE: prefix, rows, cols, start_number, and a tight normalized 0-1 bounding box.
Two groups with the same prefix split by a road are TWO entries with different start_number.
Return ONLY this JSON: {"detected_grids":[{"temp_id":"g_01","prefix":"3J","rows":1,"cols":20,"start_number":1,"bounding_box":{"x":0.01,"y":0.03,"width":0.47,"height":0.08},"confidence":0.95}],"non_grid_areas":[{"temp_id":"a_01","area_type":"road","label":"Jalan","bounding_box":{"x":0,"y":0.9,"width":1,"height":0.1}}]}`

describe.skipIf(!canRun)('digitize e2e (real Gemini)', () => {
  test('produces units from a synthetic site plan with thinking disabled', async () => {
    const buf = await sharp(readFileSync(imagePath))
      .rotate().toColorspace('srgb')
      .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
      .sharpen().jpeg({ quality: 92 }).toBuffer()

    const body = {
      contents: [{ role: 'user', parts: [
        { text: PROMPT },
        { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } },
      ]}],
      generationConfig: { temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
    }

    const t = Date.now()
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey! }, body: JSON.stringify(body) }
    )
    const elapsed = Date.now() - t
    expect(res.status).toBe(200)
    // With thinking off the call must be fast (the bug made it ~38s).
    expect(elapsed).toBeLessThan(20_000)

    const json = await res.json()
    expect(json?.candidates?.[0]?.finishReason).toBe('STOP')

    const parsed = parseGridResponse(json)
    expect(parsed.grids.length).toBeGreaterThan(0)

    const units = buildUnits(parsed)
    expect(units.length).toBeGreaterThan(0)
    // Every lot must carry a generated code and stay within the canvas.
    for (const u of units) {
      expect(u.coordinates.x).toBeGreaterThanOrEqual(0)
      expect(u.coordinates.x).toBeLessThanOrEqual(1)
      expect(u.coordinates.y).toBeGreaterThanOrEqual(0)
      expect(u.coordinates.y).toBeLessThanOrEqual(1)
    }
    // eslint-disable-next-line no-console
    console.log(`[e2e] ${elapsed}ms, ${parsed.grids.length} grids → ${units.length} units`)
  }, 30_000)
})
