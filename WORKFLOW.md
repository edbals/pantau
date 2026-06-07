# WORKFLOW.md — Pantau
> How to build this. Start from Phase 1 — the demo phase is complete.

---

## The golden rule

Read HANDOFF.md first. Read BUILD-INSTRUCTIONS.md second. Then build.

---

## Where we are

Phase 0 (demo) is done. `index.html` proves the product decisions and UI. It is a reference, not a codebase to extend.

**Start Phase 1 now.**

---

## Phase 1 — Foundation (1 session)

Set up the real application. By the end of this phase you have a working app with auth and roles.

```bash
npx create-next-app@latest pantau --typescript --tailwind --app
cd pantau
npm install @supabase/supabase-js @supabase/ssr
```

**Tasks:**
1. Create Supabase project → get URL + anon key + service role key
2. Run all migrations from `CLAUDE.md` Section 4 in Supabase SQL editor (in order)
3. Enable RLS on all tables, apply policies from `CLAUDE.md` Section 5
4. Set up `.env.local` with all keys
5. Supabase Auth — email/password login
6. `middleware.ts` — protect all routes, redirect unauthenticated users to `/login`
7. `users` table insert on first login (set role)
8. Role-based layout: different sidebar/nav per role
9. Seed 4 default SPK templates as empty scaffolds (NOT pre-filled stages — users fill them)

**Session start prompt:**
> "We are building Pantau, a production construction progress tracking platform. Read HANDOFF.md and BUILD-INSTRUCTIONS.md before touching any code. We are in Phase 1: Next.js + Supabase foundation. The demo is index.html — use it as a UI reference only. Build with TypeScript, Tailwind, and Supabase from the start."

---

## Phase 2 — Map Studio (1–2 sessions)

The core product feature. Canvas, digitization, configuration.

**Tasks:**
1. Port SVG canvas from demo to a React component (`<MapCanvas />`)
   - Coordinates still 0-1 normalized (non-negotiable)
   - Drag, select, add, delete, configure modes
   - Dark design system matching VISUAL-SPEC.md
2. Site plan image upload → Cloudflare R2 (pre-signed URL)
3. `/api/v1/map/digitize` — server calls Gemini 2.5 Flash Vision, returns block JSON
4. Canvas save → `projects.canvas_data` JSONB in Supabase
5. All 5 configuration tabs (assign sub, supervisor, type, urgency, SPK) → saves to `units` table
6. "Go Live" → sets `project.status = 'active'`, populates `units` table from canvas_data

**Session start prompt:**
> "We are in Phase 2 of Pantau. Read HANDOFF.md and BUILD-INSTRUCTIONS.md. Task: build the Map Studio feature — SVG canvas component, Gemini digitization API route, and Cloudflare R2 site plan upload."

---

## Phase 3 — SPK Template Builder (1 session)

The stage system. User-defined, never hardcoded.

**Tasks:**
1. SPK template builder UI — add stages, add sub-tasks, drag to reorder, toggle photo-required
2. `/api/v1/spk/synthesize` — user uploads SPK document photo/PDF → Gemini reads it → returns stage JSON → user reviews and confirms
3. 3-level template hierarchy: global → org → project (see MASTER-SPEC.md)
4. Assign template to unit (in Map Studio configure mode)
5. Seed 3 blank global scaffold templates that managers can clone and fill

**The AI synthesis endpoint:**
```typescript
// POST /api/v1/spk/synthesize
// body: FormData { document: File }
// Returns: { stages: [...] }
// Uses Gemini 2.5 Flash with the prompt in BUILD-INSTRUCTIONS.md
```

**Session start prompt:**
> "We are in Phase 3 of Pantau. Read HANDOFF.md and BUILD-INSTRUCTIONS.md. Task: build the SPK template builder. Stages are NEVER hardcoded — users define them manually or upload an SPK document for AI synthesis. The Gemini prompt for synthesis is in BUILD-INSTRUCTIONS.md."

---

## Phase 4 — Pengawas Flow (1–2 sessions)

The mobile submission experience. Indonesian throughout.

**Tasks:**
1. PWA manifest + service worker
2. Pengawas home: assigned units list + map view
3. Unit detail: stages list, only next stage is submittable
4. Stage form: sub-task checklist + photo upload per sub-task
5. Client-side photo compression: Canvas API, JPEG 0.75, max 800KB
6. Photo upload: pre-signed R2 URL, upload directly from browser
7. Submission POST to Supabase (`submissions` + `submission_photos` tables)
8. Offline queue: store pending submission in IndexedDB, sync on reconnect
9. QR code routing: `/u/[unit_id]` → redirects based on role
10. All UI text in Bahasa Indonesia

**Session start prompt:**
> "We are in Phase 4 of Pantau. Read HANDOFF.md and BUILD-INSTRUCTIONS.md. Task: Pengawas mobile submission flow. Indonesian UI. Photo compression client-side. Upload to Cloudflare R2 via pre-signed URLs. Offline queue via IndexedDB."

---

## Phase 5 — Koordinator + Telegram (1 session)

The review loop.

**Tasks:**
1. Koordinator review queue: sorted by urgency (critical first)
2. Submission detail: photos, sub-task completion, metadata
3. Approve → recalculate `units.progress_pct`, stamp with koordinator ID
4. Deny → require reason text → trigger Telegram notification
5. Telegram Bot: set up via BotFather, configure webhook endpoint
6. `project_notifications` table: store group chat ID per project
7. PM flag: re-opens an approved stage for re-review

**Session start prompt:**
> "We are in Phase 5 of Pantau. Read HANDOFF.md and BUILD-INSTRUCTIONS.md. Task: Koordinator review flow and Telegram Bot integration. Denial triggers a real Telegram message to the project's group chat."

---

## Phase 6 — PM Dashboard + Analytics (1 session)

**Tasks:**
1. Full progress map with color fills (dark design, matches VISUAL-SPEC.md)
2. Map filters: by sub, supervisor, status, urgency
3. Unit detail panel: stage accordion with photos (manager view)
4. Per-subcontractor stats
5. Per-supervisor stats
6. QR PDF export: all unit QR codes, 6 per A4 page

---

## Phase 7 — Production Hardening (before any real company uses it)

**Tasks:**
1. Run `npx ecc-agentshield scan` — fix all critical findings
2. Rate limiting on all API routes
3. File upload validation: type, size, no executables
4. Signed R2 URLs for image serving (not public bucket)
5. End-to-end test on a real project with real users
6. Vercel production deploy
7. Custom domain (pantau.app or similar)
8. Error monitoring (Sentry or similar)
9. Basic uptime monitoring

---

## Rules for all sessions

- Always read HANDOFF.md first
- Always update HANDOFF.md at the end
- Never hardcode stages, subcontractors, or any business data
- Never bypass PantauAPI for data operations
- Never store images as base64 in the database
- RLS before data — add policies before inserting any rows
- Indonesian for all field-facing UI (Pengawas, Koordinator screens)

---

## How to hand off between sessions

Before ending:
1. Update HANDOFF.md: what was built, what is mocked, what is broken
2. Commit: `git commit -m "Phase N: [what was done]"`

On next session start: read HANDOFF.md, read BUILD-INSTRUCTIONS.md, continue.
