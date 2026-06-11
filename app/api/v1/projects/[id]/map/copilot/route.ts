import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/api/auth'
import { ok, err } from '@/lib/api/response'

export const runtime = 'nodejs'

// Best-first vision/text models (mirrors the digitize route).
const MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-flash-latest']
const TIMEOUT_MS = 18_000

// UI element ids the copilot may point the user at (must match the editor).
const TARGETS = ['btn-upload-denah', 'tool-grid', 'tab-urgency', 'tab-subcontractor', 'btn-golive'] as const

interface CanvasSnapshot {
  activeStep?: string
  hasDenah?: boolean
  unitCount?: number
  sellableUnits?: number
  assignedUnits?: number
  urgencyUnits?: number
  contactsCount?: number
  gridCount?: number
}

export interface CopilotReply {
  message: string
  action: 'highlight_ui' | 'skip_step' | 'explain'
  targetElement?: string
}

const SYSTEM_PROMPT = `Anda adalah Site Manager ahli di aplikasi Pantau yang membantu pengguna menyusun denah (site plan) proyek perumahan.

Berdasarkan SNAPSHOT keadaan editor saat ini, tentukan SATU tindakan paling berguna berikutnya untuk membimbing pengguna menyelesaikan proyek.

Alur kerja: 1) Denah (unggah/gambar) → 2) Kavling (buat unit) → 3) Urgensi (tandai prioritas) → 4) Tim (tugaskan kontak) → 5) Go Live.

Balas HANYA dengan JSON sesuai skema. Aturan:
- "message": instruksi singkat, ramah, dalam Bahasa Indonesia (maks 1-2 kalimat).
- "action": "highlight_ui" untuk menyorot satu elemen UI, "skip_step" untuk mengarahkan ke langkah berikutnya, atau "explain" untuk penjelasan saja.
- "targetElement": WAJIB untuk highlight_ui/skip_step, salah satu dari: ${TARGETS.join(', ')}. Pilih yang sesuai dengan langkah yang belum selesai. Untuk "explain", kosongkan.

Contoh logika: belum ada denah → btn-upload-denah; ada denah tapi belum ada kavling → tool-grid; ada kavling tapi belum ada urgensi → tab-urgency; kavling belum punya tim → tab-subcontractor; semua siap → btn-golive.`

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    action: { type: 'string', enum: ['highlight_ui', 'skip_step', 'explain'] },
    targetElement: { type: 'string' },
  },
  required: ['message', 'action'],
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params
  const ctx = await requireAuth()
  if ('error' in ctx) return err(ctx.error, ctx.status)

  let snapshot: CanvasSnapshot = {}
  try {
    const body = await request.json()
    if (body && typeof body.snapshot === 'object') snapshot = body.snapshot
  } catch {
    return err('Invalid request body', 400)
  }

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY
  // Graceful deterministic fallback when AI isn't configured — keeps the button useful.
  if (!apiKey) return ok(fallbackReply(snapshot))

  const geminiBody = {
    contents: [{
      role: 'user',
      parts: [{ text: `${SYSTEM_PROMPT}\n\nSNAPSHOT:\n${JSON.stringify(snapshot)}` }],
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      // Thinking models burn the output budget; off = fast, clean JSON.
      thinkingConfig: { thinkingBudget: 0 },
    },
  }

  for (const model of MODELS) {
    const res = await fetchGemini(model, apiKey, geminiBody)
    if (!res.ok) continue
    const reply = parseReply(res.json)
    if (reply) return ok(reply)
  }

  // Every model failed — never leave the user hanging.
  return ok(fallbackReply(snapshot))
}

// Deterministic "next logical step" used when the AI is unavailable.
function fallbackReply(s: CanvasSnapshot): CopilotReply {
  if (!s.hasDenah && !s.unitCount) {
    return { message: 'Mulai dengan mengunggah denah proyek Anda.', action: 'highlight_ui', targetElement: 'btn-upload-denah' }
  }
  if (!s.sellableUnits) {
    return { message: 'Buat blok kavling dengan alat Grid.', action: 'highlight_ui', targetElement: 'tool-grid' }
  }
  if (!s.urgencyUnits) {
    return { message: 'Tandai prioritas unit di tab Urgensi.', action: 'highlight_ui', targetElement: 'tab-urgency' }
  }
  if ((s.assignedUnits ?? 0) < (s.sellableUnits ?? 0)) {
    return { message: 'Tugaskan tim ke unit lewat tab Subkon.', action: 'highlight_ui', targetElement: 'tab-subcontractor' }
  }
  return { message: 'Semua siap — luncurkan proyek Anda.', action: 'highlight_ui', targetElement: 'btn-golive' }
}

function parseReply(json: unknown): CopilotReply | null {
  const text = extractText(json)
  if (!text) return null
  try {
    const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim())
    if (typeof parsed?.message !== 'string') return null
    const action = ['highlight_ui', 'skip_step', 'explain'].includes(parsed.action) ? parsed.action : 'explain'
    const targetElement = typeof parsed.targetElement === 'string' && (TARGETS as readonly string[]).includes(parsed.targetElement)
      ? parsed.targetElement : undefined
    return { message: parsed.message, action, targetElement }
  } catch {
    return null
  }
}

function extractText(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const candidates = (result as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates) || candidates.length === 0) return null
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts
  if (!Array.isArray(parts)) return null
  return parts.map(p => (typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : '')).join('').trim() || null
}

async function fetchGemini(
  model: string, apiKey: string, body: unknown
): Promise<{ ok: true; json: unknown } | { ok: false }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
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
    if (!response.ok) return { ok: false }
    return { ok: true, json: await response.json() }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timeout)
  }
}
