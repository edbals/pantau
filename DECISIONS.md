# DECISIONS.md — Pantau
Architecture decisions and the reasoning behind them.
Update this file whenever a non-obvious decision is made.

---

## 2026-06-07 — Stage system is user-defined, never hardcoded

**Decision:** Stages and sub-tasks are always defined by the user — either typed manually in the SPK builder or extracted by Gemini from an uploaded SPK document. No stages are hardcoded in the codebase.

**Why:** Every developer runs different construction specs. A 2BR house in Cikarang has different stages than a shophouse in Surabaya. Hardcoding stages was an early mistake in the demo (index.html) that was explicitly corrected before Phase 1.

**Where:** `spk_templates` table, `app/spk/`, `app/api/v1/spk/`

---

## 2026-06-07 — Cloudflare R2 for all images, never Supabase Storage

**Decision:** All images (progress photos, site plans, QR codes) are stored in Cloudflare R2. Supabase Storage is not used for any images.

**Why:** R2 has zero egress fees. Indonesian developers view submitted photos constantly throughout the day — Supabase Storage would generate significant egress costs at scale. R2 public URLs are also faster in the SEA region.

**Where:** `CLOUDFLARE_R2_*` env vars, `app/api/v1/uploads/presign/`

**Rule:** Never use Supabase Storage for images, even for convenience. This is non-negotiable.

---

## 2026-06-07 — Supabase RLS is the real security layer, middleware is second

**Decision:** Row Level Security (RLS) on every table is the primary access control mechanism. `proxy.ts` (middleware) is a secondary UX layer that redirects unauthenticated users — it is NOT the security boundary.

**Why:** Middleware runs at the edge and cannot be fully trusted. If middleware is bypassed (direct API calls, bugs), RLS on the database still protects data. Defense in depth.

**Critical rule:** `getUser()` is always used server-side, never `getSession()`. `getUser()` re-validates the JWT with Supabase. `getSession()` trusts the cookie blindly.

**Where:** `proxy.ts`, `lib/supabase/server.ts`, `supabase/migrations/014_rls_policies.sql`

---

## 2026-06-07 — RLS WITH CHECK on sensitive UPDATE policies

**Decision:** The `users` UPDATE policy and the `submissions` UPDATE policy both have explicit `WITH CHECK` clauses using SECURITY DEFINER helper functions.

**Why:** Security review (Phase 1) found two HIGH vulnerabilities:
1. Users could self-escalate to `owner` role by updating their own row without restriction
2. Koordinators could overwrite immutable submission fields (submitted_by, unit_id, subtasks_checked)

Both were fixed with `WITH CHECK` clauses that use `current_user_role()`, `current_user_org_id_snapshot()`, and `submission_core_unchanged()` — all SECURITY DEFINER functions that read pre-update values.

**Where:** `supabase/migrations/013_progress_function.sql` (helper functions), `014_rls_policies.sql`

---

## 2026-06-07 — SVG canvas, not HTML Canvas element

**Decision:** The map editor uses SVG (`<svg>`) not the HTML `<canvas>` element.

**Why:** SVG gives us individual DOM elements per unit — each unit is a `<g><rect>` group. This means:
- Click/hover/select work via normal DOM events
- Units are accessible and inspectable
- No manual hit-testing math
- Easier to add labels, dots, and overlays per unit

Trade-off: SVG performance degrades above ~2000 elements. For 500-unit sites this is fine. If we ever hit 2000+ units, consider switching the progress view to canvas while keeping the editor on SVG.

**Where:** `components/map/MapCanvas.tsx`

---

## 2026-06-07 — All canvas coordinates are normalized 0-1

**Decision:** Every coordinate stored in the database (`canvas_position`, `canvas_data`) uses values between 0.0 and 1.0 relative to canvas dimensions. Pixel values are never stored.

**Why:** The canvas renders at different sizes on different screens (laptop vs iPad vs large monitor). Storing normalized coordinates means the map looks correct at any resolution. Pixel values would break on any screen other than the one it was drawn on.

**Rule:** Convert to/from pixels only at render time. Never save pixels to the database.

**Where:** `components/map/MapCanvas.tsx`, `supabase/migrations/008_units.sql`

---

## 2026-06-07 — Window-level mouse events for canvas drawing

**Decision:** `mousemove` and `mouseup` events for canvas drawing and dragging are attached to `window`, not to the SVG element.

**Why:** If the user moves the mouse outside the SVG canvas boundary while drawing a rectangle or dragging a unit, the draw/drag operation should not be cancelled. Attaching to the SVG means the operation breaks the moment the cursor leaves the SVG bounds. Window-level listeners keep the interaction smooth.

**Trade-off:** Slightly more care needed on cleanup (must remove listeners on unmount).

**Where:** `components/map/MapCanvas.tsx`

---

## 2026-06-07 — Background image uses pointerEvents:none

**Decision:** The `<image>` element (site plan background) in the SVG canvas has `pointerEvents: 'none'`.

**Why:** Without this, the background image absorbs all mouse clicks and drawing becomes impossible. SVG `<image>` elements respond to pointer events by default.

**Where:** `components/map/MapCanvas.tsx`

---

## 2026-06-07 — Gemini model fallback chain

**Decision:** The digitize endpoint tries models in order: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`. It moves to the next model only on 503 (overloaded), not on other errors.

**Why:** Gemini 2.5 Flash gets 503 errors under high load on the free tier. Billing has since been enabled which reduces this, but the fallback chain is kept as resilience. A 503 on the primary model should never result in a user-facing failure.

**Where:** `app/api/v1/projects/[id]/map/digitize/route.ts`

---

## 2026-06-07 — project_notifications table added to canonical schema

**Decision:** A `project_notifications` table was added beyond the 10 tables in CLAUDE.md Section 4. It stores `telegram_chat_id` per project.

**Why:** CLAUDE.md Section 6.7 specifies that each project has a Telegram group chat ID. This needs a home in the database. The table was added as migration 012 and is included in combined_migration.sql.

**Where:** `supabase/migrations/012_project_notifications.sql`

---

## 2026-06-07 — proxy.ts instead of middleware.ts (Next.js 16)

**Decision:** The authentication/session middleware is in `proxy.ts` with an exported function named `proxy`, not the traditional `middleware.ts`/`middleware` pattern.

**Why:** Next.js 16.2 deprecated the `middleware` file convention and requires `proxy` as the file name and export name. Using the old convention generates warnings and will eventually break.

**Where:** `proxy.ts`

---

## 2026-06-07 — Indonesian UI for all field-facing screens

**Decision:** All screens used by Pengawas and Koordinator are in Bahasa Indonesia. PM/Owner dashboard is in Indonesian with English option planned for later.

**Why:** Field workers (Pengawas) on construction sites in Indonesia speak Indonesian. English-only UI creates a real usability barrier for the actual end users. This is non-negotiable per BUILD-INSTRUCTIONS.md.

**Rule:** Any screen reachable via `/lapangan` or `/review` must be in Indonesian. Error messages on these screens must also be in Indonesian.

**Where:** `app/lapangan/`, `app/review/`

---

## 2026-06-07 — Service role key is server-only, never client-exposed

**Decision:** `SUPABASE_SERVICE_ROLE_KEY` is used only in `lib/supabase/admin.ts` and never in any file that runs client-side. It has no `NEXT_PUBLIC_` prefix, ensuring Next.js never bundles it into the browser.

**Why:** The service role key bypasses all RLS. If it leaked to the client, any user could read or write any row in the database.

**Where:** `lib/supabase/admin.ts`, `.env.local`

---

## 2026-06-07 — Auth callback uses NEXT_PUBLIC_SITE_URL, not request origin

**Decision:** The `/auth/callback` route redirects to `process.env.NEXT_PUBLIC_SITE_URL`, not to the `origin` derived from `request.url`.

**Why:** Security review found that using `origin` from the request URL creates an open redirect vulnerability — an attacker controlling the `Host` header could redirect auth callbacks to a malicious domain and capture session tokens.

**Where:** `app/auth/callback/route.ts`
