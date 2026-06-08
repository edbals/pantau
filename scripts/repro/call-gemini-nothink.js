// Same as call-gemini.js but with thinkingConfig.thinkingBudget = 0 to disable
// the thinking phase that was eating the output token budget + 38s of latency.
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const envText = fs.readFileSync(path.join(__dirname, '../../.env.local'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}
const apiKey = process.env.GOOGLE_GEMINI_API_KEY

const GRID_DETECTION_PROMPT = fs.readFileSync(path.join(__dirname, 'prompt.txt'), 'utf8')

async function prepareImage(buf) {
  const out = await sharp(buf, { limitInputPixels: false })
    .rotate().toColorspace('srgb')
    .resize(3200, 3200, { fit: 'inside', withoutEnlargement: true })
    .sharpen().jpeg({ quality: 92 }).toBuffer()
  return out.toString('base64')
}

async function main() {
  const model = process.argv[2] || 'gemini-2.5-flash'
  const budget = parseInt(process.argv[3] || '0', 10)
  const imgPath = process.argv[4] || path.join(__dirname, 'siteplan.png')
  const base64 = await prepareImage(fs.readFileSync(imgPath))

  const body = {
    contents: [{ role: 'user', parts: [
      { text: GRID_DETECTION_PROMPT },
      { inline_data: { mime_type: 'image/jpeg', data: base64 } },
    ]}],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingBudget: budget },
    },
  }

  console.log(`\n=== ${model}, thinkingBudget=${budget} ===`)
  const t = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body) }
  )
  const json = await res.json()
  console.log(`HTTP ${res.status} in ${Date.now() - t}ms`)
  if (json?.error) { console.log('ERROR:', JSON.stringify(json.error).slice(0, 500)); return }

  const cand = json?.candidates?.[0]
  console.log('finishReason:', cand?.finishReason)
  console.log('usage:', JSON.stringify(json?.usageMetadata))
  const text = cand?.content?.parts?.map(p => p.text || '').join('') || ''
  console.log('raw text length:', text.length)
  console.log('first 120:', JSON.stringify(text.slice(0, 120)))

  let content = text
  if (content.startsWith('"')) {
    try { const d = JSON.parse(content); if (typeof d === 'string') content = d } catch {}
  }
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    console.log('PARSE OK. grids:', parsed.detected_grids?.length, 'areas:', parsed.non_grid_areas?.length)
    const total = (parsed.detected_grids || []).reduce((s, g) => s + (g.rows * g.cols), 0)
    console.log('total units would be:', total)
  } catch (e) {
    console.log('PARSE FAILED:', e.message)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
