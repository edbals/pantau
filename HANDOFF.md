# HANDOFF.md — Pantau
> Update this file at the end of every session. Read this first at the start of the next one.

---

## Session: Gemini Site Plan Digitize Hardening
**Date:** June 2026
**Status:** Complete — digitize endpoint compiles and production build passes

### What changed
- Reworked `app/api/v1/projects/[id]/map/digitize/route.ts` for more reliable Gemini sitemap/site-plan extraction.
- Added explicit Node runtime because the route uses `sharp`.
- Normalizes uploaded images to JPEG before sending to Gemini, including HEIC/WebP/PNG inputs.
- Creates real overlapping left/right crop passes for large plans and remaps crop-relative coordinates back to full-canvas normalized coordinates.
- Uses stable Gemini model fallbacks: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, `gemini-2.0-flash-lite`.
- Adds Gemini structured JSON schema, high media resolution for images, request timeout handling, and better API error propagation.
- Replaced old center-distance dedupe that could merge adjacent dense lots with overlap/label-aware dedupe.
- Relaxed ghost filtering so small valid lots are not thrown away.
- Returns diagnostics per pass in the API response for debugging.
- Follow-up after real screenshot test: Gemini was detecting FASOS/common-area boxes instead of lots.
  - Tightened prompt/schema so digitize returns only `house` parcel units.
  - Added overlapping 3x2/2x3 local OCR tile passes for dense plans.
  - Added lot-code extraction/filtering so only labels like `F1`, `G25`, `H23a` survive.
  - Blocks `BLOK`, `JALAN`, `FASOS`, `FASUM`, `TAMAN`, dimensions, compass, legend, and title text from becoming fake units.
  - Batched Gemini calls with concurrency 2 to reduce rate-limit failures.
- Follow-up for tilted/angled plans:
  - Added `rotation?: number` to `CanvasUnit`.
  - `MapCanvas` now renders rotated unit rectangles around their centers.
  - `MapCanvas` now maps unit coordinates to the actual displayed image frame, not the full SVG, so `preserveAspectRatio="meet"` letterboxing does not offset Gemini coordinates.
  - Map Studio has a manual `Kemiringan` angle control and `Analisis ulang` action. It rotates the uploaded image in-browser before sending it to Gemini and displays the same rotated image as the background.
  - Selected units have manual rotation controls (`-1°`, `+1°`, reset, numeric input).
  - Gemini schema/prompt now includes `rotation_degrees` for detected parcels.
  - Cleaned the React Compiler lint error in `app/projects/[id]/page.tsx` by avoiding sync state clearing inside an effect.
- `sharp` is now listed in `package.json` and `package-lock.json`.

### Verification
- `npx tsc --noEmit` ✅
- `npx eslint 'app/api/v1/projects/[id]/map/digitize/route.ts'` ✅
- `npx eslint 'app/api/v1/projects/[id]/map/digitize/route.ts' 'app/projects/[id]/map/page.tsx' components/map/MapCanvas.tsx` ✅
- `npm run lint` ✅ exits 0 with 3 existing warnings.
- `npm run build` ✅ earlier after allowing network access for Google Fonts.
- Latest build re-run after tilted-plan changes was not completed because the environment rejected the required network escalation; rerun `npm run build` when allowed.
- Remaining lint warnings are pre-existing unused variables in `app/api/v1/projects/[id]/route.ts`, `app/api/v1/submissions/[id]/review/route.ts`, and `app/spk/new/page.tsx`.

### Notes
- A Next dev server was already running for this repo on `http://localhost:3000` when this session ended.
- The Gemini key variable exists in `.env.local`; do not print or commit it.

## Session: Phase 2–6 — Map Studio, SPK, Field Flow, Review, PM Dashboard
**Date:** June 2026
**Status:** ✅ Complete — ready for Go Live + Phase 7 hardening

### What was built

**Phase 2 — Map Studio**
- `app/projects/new/page.tsx` — create project form
- `app/projects/[id]/map/page.tsx` — full Map Studio (draw, configure, save, AI digitize)
- `components/map/MapCanvas.tsx` — SVG canvas with draw/select/drag/delete tools
- `app/api/v1/projects/route.ts` — project CRUD
- `app/api/v1/projects/[id]/map/save/route.ts` — save canvas_data to Supabase
- `app/api/v1/projects/[id]/map/digitize/route.ts` — Gemini 2.5 Flash digitization with fallback chain
- Dashboard updated with real project list + create button

**Phase 3 — SPK Template Builder**
- `app/spk/page.tsx` — template list
- `app/spk/new/page.tsx` — builder: stages, subtasks, photo-required toggle, AI synthesis stub
- `app/api/v1/spk/route.ts` — template CRUD

**Phase 4 — Pengawas Mobile Flow**
- `app/lapangan/page.tsx` — assigned units list (Indonesian)
- `app/lapangan/unit/[unit_id]/page.tsx` — stage checklist, photo capture, submit
- `app/api/v1/lapangan/units/route.ts` — assigned units for current user
- `app/api/v1/lapangan/units/[unit_id]/route.ts` — unit detail with SPK stages
- `app/api/v1/units/[unit_id]/submissions/route.ts` — submission POST

**Phase 5 — Koordinator Review Queue**
- `app/review/page.tsx` — split-panel queue sorted by urgency, approve/deny with reason
- `app/api/v1/review/queue/route.ts` — pending submissions sorted by urgency
- `app/api/v1/submissions/[id]/review/route.ts` — approve/deny + Telegram stub

**Phase 6 — PM Progress Map**
- `app/projects/[id]/page.tsx` — live progress map, KPI strip, filters, unit detail panel
- `app/api/v1/units/[unit_id]/route.ts` — unit detail with submission history

**Infrastructure**
- `lib/api/auth.ts` — `requireAuth()` + `requireRole()` helpers used by all API routes
- `lib/api/response.ts` — `ok()`, `created()`, `err()` response helpers
- `proxy.ts` — renamed from middleware.ts (Next.js 16 requirement)
- `DECISIONS.md` — architecture decision log (14 entries)
- `app/globals.css` — `.card-hover` CSS class added

### What is stubbed / not yet real

| Feature | Status |
|---|---|
| Go Live | Button exists but does NOT populate `units` table from canvas — **build this next** |
| R2 photo uploads | Presign endpoint not built — UI captures photos but doesn't upload |
| Telegram notifications | Stub only — fires `console.log`, needs bot token + `project_notifications` row |
| QR code per unit | Not built |
| Offline mode (IndexedDB) | Not built |
| PWA manifest | Not built |
| Role-based navigation | All roles see same layout — role-aware nav not built |
| User onboarding | No sign-up flow — users created via Supabase dashboard + SQL |

### Credentials (all in .env.local — gitignored)
- Supabase: `oofxnbpsncixbepvjimg`
- Cloudflare R2: `pantau` bucket, Account ID `94e419b0c3bf8c318fdd1fce03a42d7a`
- Gemini API key: set, billing enabled
- Test user: `admin@ptmitraadi.com` / `Pantau#2024!`, org: PT Mitra Adi Properti, role: owner

### Next priority: Go Live
When PM clicks "Go Live" on a project, it must:
1. Set `projects.status = 'active'` and `go_live_at = now()`
2. Read `canvas_data.units` from the project
3. INSERT each unit into the `units` table with normalized coordinates
4. Return the created unit IDs so QR codes can be generated later
Without this, Pengawas have nothing to submit against — the whole field workflow is blocked.

---

## Session: Phase 1 — Supabase Foundation + Auth + Security Review
**Date:** June 2026
**Status:** ✅ Complete — ready for Phase 2

### Supabase project
- **Project ID:** `oofxnbpsncixbepvjimg`
- **URL:** `https://oofxnbpsncixbepvjimg.supabase.co`
- **Credentials:** stored in `.env.local` (gitignored)

### What was built

**Database (supabase/migrations/ — NOT YET RUN)**
All 15 migration files created in canonical order. Run `supabase/combined_migration.sql` in the Supabase SQL editor to apply everything at once.
- `001` — `update_updated_at_column()` trigger function
- `002–011` — All 10 canonical tables (organisations → unit_assignments)
- `012` — `project_notifications` table (Telegram group IDs per project)
- `013` — Progress functions + security helper functions (`current_user_role`, `current_user_org_id_snapshot`, `submission_core_unchanged`)
- `014` — RLS policies with security fixes (see below)
- `015` — Indexes on all FK columns

**Application code**
- `lib/supabase/client.ts` — browser Supabase client
- `lib/supabase/server.ts` — server Supabase client (SSR cookie handling)
- `lib/supabase/admin.ts` — service-role admin client (server-only)
- `lib/types/database.ts` — full TypeScript types for all tables
- `middleware.ts` — session refresh + redirect unauthenticated users to /login
- `app/login/page.tsx` — login page in Indonesian (dark design system)
- `app/auth/callback/route.ts` — auth code exchange handler
- `app/page.tsx` — root redirect (→ dashboard if authed, → login if not)
- `app/dashboard/page.tsx` — placeholder dashboard (Phase 2 will replace)
- `app/globals.css` — full dark design system CSS vars matching index.html
- `app/layout.tsx` — Inter font, lang="id", dark theme

**Security review: 4 vulnerabilities found and fixed**
1. **CRITICAL fixed** — `users` UPDATE self allowed role/org escalation. Added `WITH CHECK` using `current_user_role()` + `current_user_org_id_snapshot()` SECURITY DEFINER functions.
2. **HIGH fixed** — `submissions` UPDATE had no `WITH CHECK`. Added `submission_core_unchanged()` SECURITY DEFINER function to prevent koordinators from overwriting immutable fields.
3. **HIGH fixed** — `auth/callback/route.ts` used unvalidated `origin` for redirect. Now uses `NEXT_PUBLIC_SITE_URL` env var.
4. **MEDIUM fixed** — `spk_templates FOR ALL` missing `WITH CHECK`. Added explicit `WITH CHECK` mirroring the `USING` clause.

### NOT YET DONE — do this before testing

**Step 1: Run the migration in Supabase**
1. Go to supabase.com → your project → SQL Editor
2. Open `supabase/combined_migration.sql`
3. Copy all 543 lines → paste → Run

**Step 2: Enable Email Auth in Supabase**
1. Supabase dashboard → Authentication → Providers
2. Enable Email provider
3. Disable "Confirm email" for development (re-enable for production)

**Step 3: Create your first user**
1. Supabase dashboard → Authentication → Users → Add User
2. Then in SQL Editor run:
```sql
INSERT INTO organisations (name, slug) VALUES ('PT. Nama Perusahaan', 'pt-nama-perusahaan');
INSERT INTO users (id, org_id, full_name, role)
VALUES (
  '<paste-user-uuid-from-auth>',
  (SELECT id FROM organisations WHERE slug = 'pt-nama-perusahaan'),
  'Nama Anda',
  'owner'
);
```

**Step 4: Set NEXT_PUBLIC_SITE_URL for production**
- In `.env.local` (local): `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- In Vercel env vars (production): `NEXT_PUBLIC_SITE_URL=https://your-domain.com`

### What is mocked / not yet real
- Dashboard is a placeholder — no project list, no map
- No role-based layout (all roles see the same empty dashboard)
- No user onboarding flow (users must be created via Supabase dashboard or SQL)

### Next: Phase 2 — Map Studio
Build the SVG canvas, site plan upload, Gemini digitization, and canvas save.

---

## Session: Phase 0 v2 — Dark Premium UI + Field View Rebuild
**Date:** June 2026
**Status:** ✅ Complete

---

## What was built

### `index.html` — Full rebuilt static demo

**Two distinct views, toggled from the navbar:**

**Manajer / PM View (dark premium dashboard):**
- Dark design system (CSS custom properties: `--bg-base`, `--bg-1`, `--bg-2`, `--bg-3`, `--accent` purple)
- Left navigation rail (Dashboard | Peta | Review)
- Dashboard: 4 KPI cards + project cards with real progress stats
- Map Studio: SVG canvas (dark type-color system), 5-tab configure panel, draw/select/delete tools
- Progress View: color-coded dark map, unit detail with stage accordion, approve/deny buttons
- Review Queue: pending stages listed with subtask preview and photo thumbnails
- Stage accordion: expand any stage → see all sub-tasks + photo evidence

**Tampilan Lapangan / Field View (mobile phone frame, Indonesian):**
- Realistic phone frame (375px, dark, with status bar chrome)
- Three screens: Home → Unit Detail → Submit Form
- **Home:** greeting, project label, QR scan button, assigned unit list in Indonesian
- **Unit Detail:** all stages listed, click to expand → see sub-task checklist + photo upload per sub-task
- **Submit Form:** full checklist with photo upload, catatan (notes), kirim ke review button
- Indonesian throughout: "Disetujui", "Menunggu review", "Belum mulai", "Kirim ke Review", etc.
- Photo upload works via FileReader (camera capture on mobile)

**Real Indonesian construction stages (TAHAP_RUMAH_2BR):**
10 stages with genuine industry sub-tasks:
1. Pekerjaan Persiapan (3 sub-tasks)
2. Pekerjaan Pondasi — galian, urugan pasir, lantai kerja, pondasi batu kali, sloof (5)
3. Pekerjaan Struktur — kolom, ring balok, curing (4)
4. Pekerjaan Dinding — bata, plesteran, acian (3)
5. Pekerjaan Atap — kuda-kuda, reng, genteng, listplank (4)
6. Pekerjaan Kusen & Pintu (3)
7. Pekerjaan Lantai — waterproofing, keramik (3)
8. Instalasi Listrik — conduit, kabel, saklar, panel, pengujian (5)
9. Instalasi Sanitasi (3)
10. Pekerjaan Finishing — cat, plafon, pembersihan (4)

**Photo evidence workflow:**
- Manager can see photos in stage accordion (submitted by Pengawas)
- Field worker uploads photos per sub-task in unit detail and submit form
- Photos persist in `S.fPhotos` state during session

**Approve/Deny from manager:**
- Approve → stage status changes to 'approved', progress % recalculates
- Deny → prompts for reason, fires mock Telegram notification, logs to console

---

## What is mocked / faked

| Feature | What actually happens |
|---|---|
| AI digitization | 2.8s delay + pre-built 23-block layout |
| Project save | localStorage |
| Auth | No auth — anyone can see/do everything |
| Telegram | console.log + toast |
| QR scan | toast "Fitur hadir berikutnya" |
| Real photos | FileReader data URL (stored in `S.fPhotos` and stage objects) |
| Photo persistence | Lost on page refresh (data URLs not in localStorage) |
| Koordinator view | Not a separate role view — manager does approve/deny |
| Stage order enforcement | Not enforced in demo — all stages accessible |
| Push notifications | Not implemented |
| Offline mode | Not implemented |

---

## Known limitations

1. **Phone frame is decorative** — the field view is a CSS-framed simulation. On a real phone it adapts but the frame itself only shows on desktop.
2. **Photo URL persistence** — data URLs are too large for localStorage; photos reset on page refresh. In production this is R2 URLs which persist.
3. **Stage order not enforced** — field worker can click any stage, not just the next one.
4. **No separate Koordinator login** — approve/deny is accessible from the manager view directly.
5. **No role gating** — demo allows all actions from any view.
6. **`S.fPhotos` is session-only** — photos uploaded in field view don't survive page refresh.

---

## Files in this directory

| File | Purpose |
|---|---|
| `index.html` | The rebuilt demo — dark premium + field view |
| `MASTER-SPEC.md` | Product spec source of truth |
| `BUILD-INSTRUCTIONS.md` | Rules for AI coding sessions |
| `WORKFLOW.md` | Phase breakdown |
| `MOCK-DATA-SPEC.md` | Mock entities and data structure |
| `API-PLAN.md` | Future API + Cloudflare architecture |
| `HANDOFF.md` | This file |

---

## What to do next (Phase 1)

Priority items from this session's feedback:
1. Add a proper **Koordinator view** (separate from manager) — pending review queue, approve/deny, deny reasons
2. Enforce **stage order** (cannot submit stage N until N-1 is approved)
3. Add **AI stage generation** from uploaded rancangan bangunan (architectural drawing) — Gemini reads drawing and auto-generates appropriate stages + sub-tasks
4. **Progress View** should be accessible from both manager and field views
5. Proper role-based navigation (different screens for owner vs koordinator vs pengawas)

**Phase 1 session start prompt:**
> "We are building Pantau, an Indonesian construction progress tracker. Read HANDOFF.md, BUILD-INSTRUCTIONS.md, MASTER-SPEC.md. We are in Phase 1 — setting up Next.js + Supabase. The working dark-theme demo is index.html. The field view uses Indonesian. There are 10 real construction stages (TAHAP_RUMAH_2BR in the demo). Next priority: Koordinator view and stage order enforcement."
