# API-PLAN.md — Pantau
> Future API architecture. Designed so the demo's mock layer can be swapped for real endpoints without rewriting the app.

---

## Core principle

The demo's `PantauAPI` object is the **contract**. Every method in it corresponds to exactly one real endpoint or service call in production. To go from demo to production, replace method bodies one at a time. The app code does not change.

```javascript
// Demo (current)
async digitizeImage(imageDataUrl) {
  await delay(2500);
  return { data: generateMockDigitizedBlocks() };
}

// Production (swap in place)
async digitizeImage(imageDataUrl) {
  const res = await fetch('/api/v1/map/digitize', {
    method: 'POST',
    body: JSON.stringify({ imageDataUrl }),
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
  });
  return res.json();
}
```

---

## What stays local (browser only)

| Feature | Why it stays local |
|---|---|
| Image compression | Must happen before upload; Canvas API in browser |
| Canvas rendering | SVG DOM manipulation — purely client-side |
| Progress color calculation | Pure function — no server needed |
| Block selection / drag state | Ephemeral UI state |
| Offline submission queue | IndexedDB, browser-side |

---

## What moves to real APIs (production)

### 1. Project CRUD
**Demo:** localStorage  
**Production:** Supabase REST or PostgREST (auto-generated from schema)

```
GET    /api/v1/projects
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id
```

Auth: Supabase JWT in `Authorization` header. RLS handles tenant isolation automatically.

---

### 2. Map Canvas Save / Load
**Demo:** localStorage  
**Production:** Supabase → `projects.canvas_data` (JSONB column)

```
POST   /api/v1/projects/:id/map/save
body:  { canvas_data: { blocks: [...] } }

GET    /api/v1/projects/:id/map
```

The `canvas_data` JSONB blob contains the full block array. No normalization to individual unit rows needed at save time. Units table is populated from this during "Go Live".

---

### 3. AI Digitization (the big one)
**Demo:** setTimeout + mock JSON  
**Production:** Server → Gemini 2.5 Flash Vision API → return JSON

**Why server-side, not browser:**
- Gemini API key must not be exposed to the browser
- Image must be sent at full resolution (no pre-processing)
- Response parsing and validation should happen server-side

**Endpoint:**
```
POST   /api/v1/projects/:id/map/digitize
body:  FormData { image: File }
```

**Server implementation (Next.js API route):**
```javascript
// pages/api/v1/map/digitize.ts (or app/api route)
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY);

export async function POST(req) {
  const formData = await req.formData();
  const imageFile = formData.get('image');
  const base64 = Buffer.from(await imageFile.arrayBuffer()).toString('base64');

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent([DIGITIZE_PROMPT, { inlineData: { data: base64, mimeType: imageFile.type } }]);
  const json = JSON.parse(result.response.text());
  return Response.json({ data: json });
}
```

**Fallback:** if Gemini returns confidence < 0.4, return partial results with a `low_confidence: true` flag. Client shows warning and lets user adjust.

---

### 4. Image Upload (Cloudflare R2)
**Demo:** FileReader data URL in memory  
**Production:** Pre-signed R2 URL pattern

**Flow:**
```
1. Client → POST /api/v1/uploads/presign  { filename, mimeType, projectId }
2. Server validates (type, size, auth) → generates R2 pre-signed PUT URL (15min TTL)
3. Client → PUT to pre-signed URL (directly to Cloudflare, never through Next.js server)
4. Client → PATCH /api/v1/projects/:id  { siteImageUrl: r2PublicUrl }
```

**Why this pattern:**
- Large files never pass through your server (saves bandwidth and compute)
- R2 egress is free (Cloudflare handles CDN delivery)
- Pre-signed URLs expire, preventing unauthorized uploads

**R2 key structure:**
```
site-plans/{project_id}/original/{timestamp}.jpg
site-plans/{project_id}/display/{timestamp}.jpg   ← compressed for background display
submissions/{project_id}/{unit_id}/{submission_id}/{photo_id}.jpg
qr-codes/{project_id}/{unit_id}.png
```

**Cloudflare setup:**
1. Create R2 bucket in Cloudflare dashboard
2. Generate API token with R2 write permissions
3. Add to `.env.local`: `CF_R2_ACCOUNT_ID`, `CF_R2_ACCESS_KEY_ID`, `CF_R2_SECRET_ACCESS_KEY`, `CF_R2_BUCKET`
4. Use `@aws-sdk/client-s3` (S3-compatible) to generate pre-signed URLs

---

### 5. Submissions (Pengawas → Koordinator)
**Demo:** mock stage data, submit button is a stub  
**Production:** Supabase

```
POST   /api/v1/units/:unitId/submissions
body:  { stage_number, subtasks_checked: [1,2,3], photo_r2_keys: [...], notes }

GET    /api/v1/units/:unitId/submissions

PATCH  /api/v1/submissions/:id/review
body:  { decision: 'approved'|'denied', reason?: string }
```

After PATCH with `decision: 'approved'`: server triggers progress recalculation function on the unit.  
After PATCH with `decision: 'denied'`: server calls Telegram notify endpoint.

---

### 6. Telegram Notifications
**Demo:** console.log  
**Production:** Telegram Bot API

**Endpoint (server-side only):**
```
POST   /api/v1/notifications/telegram
body:  { projectId, message }
```

**Server sends:**
```javascript
await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: 'POST',
  body: JSON.stringify({ chat_id: groupChatId, text: message, parse_mode: 'Markdown' }),
});
```

Bot token must never be exposed to client. Validation: check that the requesting user is a Koordinator for the project.

---

### 7. QR Codes
**Demo:** unit code as text placeholder  
**Production:** generate PNG per unit, store in R2, serve via CDN

**PDF generation option (Cloudflare Worker or Next.js API route):**
```
GET    /api/v1/projects/:id/qr-pdf
```
Returns a PDF with all unit QR codes, 6 per A4 page. Use `jspdf` + `qrcode` libraries server-side.

---

## Browser vs Server boundary summary

| Responsibility | Browser | Server |
|---|---|---|
| Image compression (progress photos) | ✅ Canvas API | ✗ |
| Site plan display | ✅ SVG + data URL / R2 URL | ✗ |
| Canvas editing / drag / configure | ✅ SVG DOM | ✗ |
| AI digitization call | ✗ (never expose key) | ✅ Next.js API route |
| R2 pre-signed URL generation | ✗ (never expose R2 key) | ✅ Next.js API route |
| Direct upload to R2 | ✅ Fetch PUT to pre-signed URL | ✗ |
| Auth token management | ✅ Supabase SDK | ✅ Middleware |
| Telegram bot call | ✗ (never expose token) | ✅ Next.js API route |
| Progress % calculation | ✅ Pure function | ✅ Also server trigger |
| RLS enforcement | ✗ (client cannot be trusted) | ✅ Supabase |

---

## Cloudflare services map

| Service | What it does for Pantau |
|---|---|
| **R2** | Store all images (site plans + progress photos). Zero egress fees. |
| **CDN** | Serves R2 images globally via Cloudflare's network. |
| **Workers** (optional, Phase 5+) | Could handle PDF generation, image optimization, or webhook processing at the edge |
| **Pages** (optional) | Alternative to Vercel for frontend hosting |

---

## Moving from mock to production safely

1. **Test each `PantauAPI` method in isolation** — replace one at a time, starting with `saveProject` (least risky)
2. **Add auth last** — get data flowing first, then enforce roles
3. **Seed Supabase with the same mock data** from `MOCK-DATA-SPEC.md` — this lets you validate that real API returns match what the demo expected
4. **Keep the demo working during migration** — `PantauAPI` is the same interface; flip methods to real one by one without breaking the UI
5. **Test Gemini digitization with real site plan photos** — mock blocks are a grid layout; real plans will be irregular. Tune the prompt if needed.
6. **Run `npx ecc-agentshield scan` before any production deploy**
