# Pantau — State Transfer (session handoff)

> Front-door for a fresh engineering session. Generated 2026-06-12.
> For depth, this points to the other docs instead of duplicating them:
> product spec `CLAUDE.md` · decisions `DECISIONS.md` · redesign brief
> `docs/REDESIGN.md` · map internals `docs/MAP-STUDIO-HANDOFF.md`.

---

## 1. Snapshot

- **Stack:** Next.js 16.2.7 (App Router, Turbopack), React 19, TypeScript,
  **Tailwind v4 (CSS-first, no `tailwind.config.ts`)**, Supabase (Postgres +
  Auth + RLS + SSR; auth middleware is `proxy.ts`), Cloudflare R2 (images),
  Gemini 2.5 Flash (digitize + copilot), Telegram (notifications).
- **shadcn/ui foundation installed, not yet used:** `components.json`,
  `lib/utils.ts` (`cn()`), deps clsx / tailwind-merge / class-variance-authority
  / tw-animate-css. Theme still the legacy CSS-var system in `app/globals.css`.
- **Git:** branch `feat/map-studio-numbering-engine`, pushed to origin. Tip
  commits `c9326aa` (shadcn foundation) and `ef1f9c8` (team roster / setup).
- **Verify:** `npx tsc --noEmit` · `npx eslint` · `npx vitest run`
  (67 pass / 1 skip) · dev `npm run dev` (:3000).

The 2-level contact model is the spine of recent work: global `contacts`
table (managed at `/projects/directory`) → joined per project via
`project_team_members` (chosen at `/projects/[id]/setup`) → assigned per unit in
`canvas_data.units[].assigned_contact_ids` inside the Map Studio.

## 2. Recent changes (Phases 4 → 5.1)

- Global `contacts` roster + CRUD API + `/projects/directory`; schema expanded
  (email, has_whatsapp/has_telegram, custom_attributes); brand WhatsApp/Telegram
  SVGs replaced Lucide stand-ins.
- `project_team_members` join + `GET/PUT /api/v1/projects/[id]/team`; full-page
  `/projects/[id]/setup` picker (debounced autosave); Map "Kontak" tab →
  "Pengawasan", scoped to the project team.
- Leadership auto-assign: roles matching `isLeadershipRole` render
  checked+disabled per unit, **derived at render time — never mutates
  `canvas_data`** (no loops).
- Onboarding funnel: Proyek Baru → /setup → /map; "Kelola Tim Proyek" on the
  overview.
- AI copilot moved from the stepper to a bottom-left glass FAB (`CopilotFab`);
  stepper is read-only; `ShortcutsHud` removed. `AutosaveIndicator` trust cue
  on Map + Directory.

## 3. Resume point (WIP)

No half-written code. **Current epic: full UI redesign to shadcn/ui + Tailwind
v4 tokens (Rams/Anduril). Process: v0.dev designs → engineer ports
screen-by-screen.** Awaiting the first v0 screen.

On the FIRST port: (1) write the Rams/Anduril tokens into `app/globals.css`
(`:root` + `@theme inline`) and `@import "tw-animate-css";`; (2) rename legacy
`--accent*` → `--brand*` and `--border*` → `--hairline*` (mechanical sweep) so
shadcn owns the standard token names without breaking unmigrated screens.
Suggested first screen: `/login` or `/projects/[id]/setup`. Migration order +
porting protocol are in `docs/REDESIGN.md` §8–9.

## 4. Tech debt & blockers

- **🔴 BLOCKER:** Supabase migrations **016 / 017 / 018 not applied** — directory
  / setup / team data won't persist until they are (UI degrades gracefully).
- UX seam: leadership is auto-locked on the map but freely selectable in
  `/setup` — reconcile (auto-select+lock in setup too).
- Deleting a global contact leaves stale ids in `assigned_contact_ids` (map
  tolerates, never prunes).
- Subcontractors are split-brain: real `subcontractors` table is unused; the
  map's "Subkon" tab is local color tags in `canvas_data.subs`.
- `contacts.custom_attributes` (JSONB) exists but is unused (future Notion grid).
- `AI_HANDOFF_PHASE4.md` (repo root, untracked) is stale — superseded by this
  doc + `docs/REDESIGN.md`.
- **Frozen in the redesign epic:** Map Studio SVG engine (`MapCanvas.tsx`) and
  all backend logic (API routes, RLS, digitize/copilot).

## 5. Init prompt for the next AI builder

> You are the Lead Engineer continuing **Pantau** (Next.js 16 / React 19 / TS /
> Tailwind v4 / Supabase). Read first, in order: `CLAUDE.md`, `DECISIONS.md`
> (2026-06-12 redesign entry), `docs/REDESIGN.md`, `docs/MAP-STUDIO-HANDOFF.md`,
> and this file. Branch `feat/map-studio-numbering-engine` (pushed); work from a
> clean tree.
>
> **Epic:** full UI redesign onto shadcn/ui + standard Tailwind v4 tokens
> ("Dieter Rams / Anduril" dark). **v0.dev designs; you port each screen** —
> typed, data-wired, themed, incrementally. Foundation already installed.
>
> **Resume:** wait for the first v0 screen. On the first port, set up the theme
> tokens in `app/globals.css` and do the legacy `--accent*`→`--brand*` /
> `--border*`→`--hairline*` rename. Suggested first screen: `/login` or
> `/projects/[id]/setup`.
>
> **Strict rules:** UI only — don't touch API routes (`app/api/v1/**`),
> RLS/migrations, Gemini digitize/copilot, or `lib/supabase/**`. Don't restyle
> the Map Studio SVG canvas (`MapCanvas.tsx`) — chrome only. Reuse
> `@/components/ui/AutosaveIndicator`, `@/components/icons/BrandIcons`,
> `@/components/map/contacts` helpers; lucide icons only. Copy stays Bahasa
> Indonesia; keep route/prop contracts and "Lanjut ke Pemetaan" → `/map`.
> Immutable state. A screen is done only with zero legacy `var(--*)` left and
> `tsc`+`eslint`+`vitest` green; delete the legacy token block after the LAST
> screen. Don't commit/push unless asked. Migrations 016/017/018 aren't applied
> (flag, don't work around). End each iteration with a technical-PM-readable
> summary.
>
> First: read the docs above and play back a 5-line summary of the state and the
> next step. Then wait for my first v0 screen.
