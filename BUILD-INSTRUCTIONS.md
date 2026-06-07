# BUILD-INSTRUCTIONS.md — Pantau
> This is a production application. A real company will use this. Build accordingly.

---

## What you are building

Pantau is a production-grade construction progress tracking SaaS platform. It is not a demo. It is not a prototype. It should be deployable, usable by real field workers on Android phones in Indonesia, and maintainable by a small team.

The reference demo (`index.html`) shows the UI decisions and product logic. Use it as a design reference only. Do not copy its localStorage patterns or hardcoded data into production code.

---

## Non-negotiable production standards

**Every feature you build must:**
- Work with real data from Supabase (no localStorage, no hardcoded arrays)
- Be gated by Supabase Auth + RLS (no feature is accessible without the right role)
- Handle loading, error, and empty states explicitly
- Work on a real Android phone in a browser (mobile-first, touch targets ≥ 44px)
- Be in Bahasa Indonesia for all field-facing text (Pengawas, Koordinator screens)
- Handle offline gracefully (IndexedDB queue for Pengawas submissions)

---

## The stage system — critical design decision

**Stages are NEVER hardcoded.** This is a firm rule.

Every project has different construction requirements. The manager defines their own stages in one of two ways:

**Option A — Manual input:**
Manager types stage names and sub-tasks directly into the SPK builder UI. Drag to reorder. Add/remove sub-tasks. Mark which sub-tasks require a photo.

**Option B — AI synthesis from document:**
Manager uploads a photo or PDF of their existing SPK (Surat Perintah Kerja), rancangan bangunan, or any document that outlines the work. Gemini 2.5 Flash reads the document and returns a structured JSON of stages and sub-tasks. Manager reviews, edits, confirms. This replaces manual input — it doesn't add to it.

**Gemini prompt for SPK synthesis (use this exactly):**
```
You are reading a construction work order (SPK) or building plan document.
Extract all work stages and their sub-tasks from this document.

Return ONLY valid JSON in this structure, nothing else:
{
  "stages": [
    {
      "n": 1,
      "name": "Name of the stage exactly as written",
      "subtasks": [
        { "n": 1, "name": "Sub-task description", "requiresPhoto": true }
      ]
    }
  ],
  "confidence": 0.0-1.0,
  "notes": "any important notes or ambiguities"
}

requiresPhoto should be true for any structural, waterproofing, or inspection work.
If the document is unclear, include what you can find and note the gaps.
Return only the JSON object. No markdown. No explanation.
```

---

## Stack (use exactly this)

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Next.js 14+ (App Router) | Deployed on Vercel |
| Database + Auth | Supabase | PostgreSQL, RLS, Supabase Auth |
| Image storage | Cloudflare R2 | Zero egress. Never Supabase storage for images. |
| AI — map digitization | Gemini 2.5 Flash | Reads site plan photos |
| AI — SPK synthesis | Gemini 2.5 Flash | Reads SPK documents, returns stage JSON |
| Notifications | Telegram Bot API | Group notifications on denial |
| Styling | Tailwind CSS | Dark design system, see VISUAL-SPEC.md |
| Language | TypeScript throughout | No JavaScript files |
| Mobile | PWA (manifest + service worker) | Android-first |

---

## Role system — enforce from day one

| Role | What they see | Primary device |
|---|---|---|
| `owner` | Everything — all projects, all data | Web |
| `project_manager` | Assigned projects — full control within them | Web |
| `koordinator` | Review queue, approve/deny, progress map | Web + Mobile |
| `pengawas` | Assigned units only — submit stages, upload photos | Mobile |

**Rule:** Every page and API route checks the user's role before rendering or returning data. Never skip this. Supabase RLS is the real enforcement — middleware is a second layer.

---

## API layer pattern

All data operations go through `PantauAPI` (same as demo). In production, each method calls a real endpoint. The calling code does not change — only the method bodies.

```typescript
// Production implementation of a demo method
async digitizeImage(imageFile: File): Promise<ApiResponse<Block[]>> {
  const formData = new FormData();
  formData.append('image', imageFile);
  const res = await fetch('/api/v1/map/digitize', {
    method: 'POST',
    body: formData,
    headers: { Authorization: `Bearer ${await getToken()}` }
  });
  return res.json();
}
```

---

## Image handling rules (never break these)

- **Progress photos (Pengawas uploads):** compress to ≤ 800KB client-side (Canvas API, JPEG 0.75) BEFORE upload. Upload directly to R2 via pre-signed URL. Never through the app server.
- **SPK document / site plan upload for AI:** do NOT compress. Send at full resolution. AI needs to read text and fine details.
- **After AI processes site plan:** store a compressed display copy (800KB) in R2. Keep original for audit trail.
- **Never expose R2 credentials to client.** Pre-signed URLs only, 15-minute expiry, generated server-side.

---

## Quality bar

Ask yourself before submitting any feature: would a developer walking 100 units on a hot construction site in Cikarang use this without training? If not, it's not done.

- Loading states must be explicit (skeleton screens or spinners)
- Error messages must be in Indonesian for field-facing screens
- Network failures must be handled gracefully (retry, queue offline)
- Forms must not lose data on failed submission
- The canvas must be usable on a mid-range Android phone

---

## ECC skills reference

| Task | Skill path |
|---|---|
| React / Next.js components | `~/.claude/skills/ecc/frontend-patterns` |
| PostgreSQL + Supabase queries | `~/.claude/skills/ecc/postgres-patterns` |
| API route design | `~/.claude/skills/ecc/api-design` |
| Node.js backend services | `~/.claude/skills/ecc/backend-patterns` |
| Schema migrations | `~/.claude/skills/ecc/database-migrations` |
| AI/Gemini integration | `~/.claude/skills/ecc/agentic-engineering` (if installed) |
| Claude / Gemini API patterns | `~/.claude/skills/ecc/claude-api` (if installed) |

Load one skill per task. State which skill you are using at the start of each task.

---

## Do not build (out of scope, all versions)

- S-curve analytics
- DWG / AutoCAD import
- Real-world scale from site plan
- Multi-floor maps
- Real-time collaborative editing
- Payment / billing
- WhatsApp integration
- Native iOS / Android app
