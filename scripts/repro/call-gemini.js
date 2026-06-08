// Calls Gemini with the exact production digitize prompt + config, dumps the
// FULL raw response, finishReason, usage, and whether it parses. Reproduces the
// digitize pipeline offline so we can diagnose without the browser/server.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

// Load env from .env.local
const envText = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const apiKey = process.env.GOOGLE_GEMINI_API_KEY
if (!apiKey) { console.error('No GOOGLE_GEMINI_API_KEY'); process.exit(1) }

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

async function prepareImage(buf) {
  const out = await sharp(buf, { limitInputPixels: false })
    .rotate().toColorspace('srgb')
    .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
    .sharpen().jpeg({ quality: 92 }).toBuffer()
  const meta = await sharp(out).metadata()
  console.log(`Prepared image: ${meta.width}x${meta.height}, ${Math.round(out.length / 1024)}KB`)
  return out.toString('base64')
}

async function main() {
  const model = process.argv[2] || 'gemini-2.5-flash'
  const maxTokens = parseInt(process.argv[3] || '8192', 10)
  const imgPath = process.argv[4] || path.join(__dirname, 'siteplan.png')
  const buf = fs.readFileSync(imgPath)
  const base64 = await prepareImage(buf)

  const body = {
    contents: [{ role: 'user', parts: [
      { text: GRID_DETECTION_PROMPT },
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
    ]}],
    generationConfig: { temperature: 0, maxOutputTokens: maxTokens },
  }

  console.log(`\n=== ${model}, maxOutputTokens=${maxTokens} ===`)
  const t = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }
  )
  const json = await res.json()
  console.log(`HTTP ${res.status} in ${Date.now() - t}ms`)

  const cand = json?.candidates?.[0]
  console.log('finishReason:', cand?.finishReason)
  console.log('usageMetadata:', JSON.stringify(json?.usageMetadata))
  if (json?.error) console.log('ERROR:', JSON.stringify(json.error).slice(0, 400))

  const text = cand?.content?.parts?.map(p => p.text || '').join('') || ''
  console.log('\n--- raw text length:', text.length, '---')
  console.log('first 200:', JSON.stringify(text.slice(0, 200)))
  console.log('last 200:', JSON.stringify(text.slice(-200)))

  // Dump full text for inspection
  const dumpPath = path.join(__dirname, `response-${model}-${maxTokens}.txt`)
  fs.writeFileSync(dumpPath, text)
  console.log('Full text dumped to', dumpPath)

  // Try to parse the way production does
  console.log('\n--- parse attempt ---')
  let content = text
  if (content.startsWith('"')) {
    try { const d = JSON.parse(content); if (typeof d === 'string') content = d; console.log('outer-decode: OK') }
    catch (e) { console.log('outer-decode: FAILED (truncated outer string):', e.message) }
  } else {
    console.log('not double-encoded (no leading quote)')
  }
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    console.log('PARSE OK. grids:', parsed.detected_grids?.length, 'areas:', parsed.non_grid_areas?.length)
  } catch (e) {
    console.log('PARSE FAILED:', e.message)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
