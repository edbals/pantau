# Pantau — UI Redesign Brief & Handoff

> **Audience:** the technical PM and the UI/UX designer (human or v0.dev).
> **Status (2026-06-12):** Decision locked. Foundation installed. Migrating screen-by-screen.
> **Process:** **v0.dev drives the visual art direction → Claude ports each screen into the repo** (typed, data-wired, themed). The app stays demoable throughout — not a big-bang.
> This file is self-contained; you can attach it without opening the codebase.

---

## 1. What we're doing & why

Migrating the **whole UI** from a bespoke CSS-variable + inline-style system to **shadcn/ui components + standard Tailwind v4 design tokens**, under a **Dieter Rams / Anduril** dark aesthetic: true-neutral greys, high contrast, one restrained accent, high information density.

It's a **data tool**, not a marketing site. Optimize for density and clarity (50–500 records per screen), not hero imagery.

**Already in place (engineering foundation):** `components.json` (shadcn, Tailwind-v4 mode, `baseColor: neutral`, lucide), `lib/utils.ts` (`cn()`), deps `clsx` / `tailwind-merge` / `class-variance-authority` / `tw-animate-css`. This repo is **Tailwind v4 (CSS-first — there is NO `tailwind.config.ts`)**; the theme lives in `app/globals.css` via `@theme`.

---

## 2. Design system reference

### 2.1 Current palette (the look to evolve, not the target)
Today every screen styles via inline `style={{ background: 'var(--bg-1)' }}`. Exact tokens (`app/globals.css`):

| Token | Hex / value | Role |
|---|---|---|
| `--bg-base` | `#080A10` | Page background (outermost) |
| `--bg-1` | `#0F1117` | Cards, nav bars, side panels |
| `--bg-2` | `#161925` | Inputs, secondary surfaces |
| `--bg-3` | `#1E2233` | Chips, tertiary buttons |
| `--bg-hover` | `#242740` | Hover surface |
| `--border` / `--border-md` / `--border-lg` | `rgba(255,255,255,.06/.10/.16)` | Hairline borders |
| `--accent` / `--accent-2` | `#7C3AED` / `#9F67FF` | **Current brand purple** / lighter accent |
| `--accent-sub` / `--accent-glow` | `rgba(124,58,237,.12)` / `(.25)` | Selected bg / CTA glow |
| `--t1` / `--t2` / `--t3` | `#F0F4FF` / `#8892B0` / `#4A5270` | Text primary / secondary / muted |
| `--green` / `--amber` / `--red` / `--blue` | `#10B981` / `#F59E0B` / `#EF4444` / `#3B82F6` | Status |
| `--r` / `--r-sm` | `10px` / `6px` | Radius |

**Map Canvas is a separate surface:** background `#0A1628` (blueprint) + dot-grid overlay; unit strokes blueprint cyan `#5FD0F0` / amber `#F2C572`. Don't reuse the blueprint look elsewhere — the setup/dashboard screens use the standard layout palette above.

### 2.2 Target direction (Rams / Anduril) — designer decides the exact values
- **True-neutral greys** (no blue tint), near-black background, off-white text, generous contrast.
- **The one big fork to decide:** keep a **refined purple** brand, or go **monochrome** (white-on-black primary, Linear-style). This sets shadcn's `--primary`.
- Map to the **standard shadcn token names**: `--background, --foreground, --card, --popover, --primary, --secondary, --muted, --muted-foreground, --accent, --border, --input, --ring, --destructive, --radius`.

### 2.3 Progress color scale (keep — it's product-meaningful)
0% = outline only · 1–24% light grey · 25–49% light teal · 50–74% medium teal · 75–99% dark teal · 100% solid green · pending = amber pulsing dot · denied = red pulsing dot.

---

## 3. Data interfaces (build components against these)

```ts
// The roster contact — the core entity in directory/setup screens
interface Contact {
  id: string
  org_id: string
  name: string
  role: string                  // free text; preset OR custom ("Lainnya")
  email: string | null
  has_whatsapp: boolean
  has_telegram: boolean
  country_code: string          // "+62"
  phone: string                 // digits only, no country code
  custom_attributes: Record<string, unknown>   // open bag (future Notion cols) — unused in UI today
  created_by: string | null
  created_at: string
  updated_at: string
}

interface ProjectTeamMember {     // backend join only (project ↔ contact)
  id: string; project_id: string; contact_id: string; added_by: string | null; created_at: string
}

type UserRole = 'owner' | 'project_manager' | 'koordinator' | 'pengawas'
type Urgency  = 'normal' | 'high' | 'critical'
type UnitStatus = 'not_started' | 'in_progress' | 'pending_review' | 'completed'
```
Roles are free text; leadership is matched by substring (`CEO`, `Project Manager`, `Direktur`, `Pemilik`, `Pimpinan`, … — excludes "Field Manager"). Preset roles: `Subkontraktor`, `Pengawas`, `Field Manager`.

---

## 4. Code constraints (so generated UI drops in)

- **No shadcn in the existing screens yet** — they're hand-rolled (`<button>`/`<input>`/`<select>` styled inline). The shadcn foundation is installed; primitives get added per screen as we port.
- **Must reuse these primitives:**
  - `import AutosaveIndicator, { type AutosaveStatus } from '@/components/ui/AutosaveIndicator'` — status `'idle' | 'saving' | 'saved'`.
  - `import { WhatsAppIcon, TelegramIcon } from '@/components/icons/BrandIcons'` — props `{ size?, color?, className?, title? }`.
  - `import { whatsappUrlFor, telegramUrlFor, isLeadershipRole, CONTACT_ROLES } from '@/components/map/contacts'`.
- **Icons:** `lucide-react` only.
- **Copy:** **Bahasa Indonesia** (UI is Indonesian; `/lapangan` + `/review` must be).
- **Dark mode only** for now.

---

## 5. Screen inventory (archetypes, not 13 one-offs)

| Archetype | Routes |
|---|---|
| Auth / form | `/login`, `/projects/new` |
| App shell + card grid | `/dashboard` |
| List / roster | `/projects/directory`, `/projects/[id]/setup` |
| Data dashboard (KPI + filters + slide-in panel) | `/projects/[id]` |
| Queue / tables | `/review`, `/spk`, `/spk/new` |
| Mobile-first PWA (field) | `/lapangan`, `/lapangan/unit/[unit_id]` |
| Specialized SVG editor | `/projects/[id]/map` — **chrome only; do not redesign the canvas engine** |

**Onboarding funnel (already wired):** `Proyek Baru` → `/projects/[id]/setup` (pick team, autosaves) → **"Lanjut ke Pemetaan"** → `/projects/[id]/map`. Existing projects reach setup via the overview's "Kelola Tim Proyek" button.

---

## 6. The active target: `/projects/[id]/setup` (UX critique)

Current: flat checkbox list (search + autosave + Continue at top, "Pimpinan" badge on leaders). ~6/10. To reach 10/10:

- **Fix first — a real inconsistency:** leadership is auto-checked + locked on the **map**, but a normal selectable row in **setup**. Reconcile (auto-select + lock leadership in setup too, with a tooltip).
- **Group by role** (Pimpinan → Pengawas → Subkontraktor → Lainnya) with section headers + per-group "select all".
- **Sticky header** (search + selection summary) and **sticky footer CTA** ("Lanjut ke Pemetaan" always reachable).
- **Richer summary:** `12 dipilih · 2 Pimpinan · 6 Pengawas`.
- **Per-row polish:** real hover state, color-hashed initials avatars, WA/TG/email channel chips, 44px tap targets.
- **Search + sort:** search name/role/phone/email; sort by name/role/recent.
- **Empty roster = dead end today** → make it a CTA deep-linking to `/projects/directory`.
- **Keep** the top-left `AutosaveIndicator` ("Tersimpan otomatis") — it's a deliberate trust cue.
- **Primary action — exact wording: `Lanjut ke Pemetaan`** → routes to `/projects/[id]/map` (must flush the debounced `PUT /api/v1/projects/[id]/team` first).

---

## 7. For the UI/UX designer

- Honor §2 (Rams/Anduril, token names) and §4 (reuse our primitives, lucide, Indonesian copy).
- Design the **archetypes in §5**, not 13 bespoke screens — we apply each pattern across its siblings.
- **Density first** — compact rows/tables, 32–36px controls; this is an operations tool.
- Cover **empty / loading / error / saving** states explicitly (we surface autosave + denial states).
- **Mobile PWA** matters for `/lapangan` (field supervisors, thumb targets, offline "Syncing…").
- **Don't** redesign the Map Studio SVG canvas geometry — only its panels/toolbar/HUDs.
- Deliver in **idiomatic shadcn + Tailwind tokens** (v0's default output is perfect); we map the tokens to the final palette on our side.

## 8. For the technical PM

- **Scope = migration epic:** ~13 routes + ~11 components, multi-session. Run **incrementally** so the app stays demoable.
- **"Done" per screen:** new shadcn/token markup, real data wired, **zero legacy `var(--*)` left on that screen**, `tsc` + `eslint` + `vitest` green. Delete the legacy token block only after the last screen.
- **Migration order (traffic-first):** login → dashboard → directory → setup → project overview → review/spk → lapangan → Map Studio chrome.
- **Frozen in this epic:** Map Studio canvas engine (`MapCanvas.tsx`), the copilot/digitize backend.
- **One-time risk:** legacy `--accent`/`--border` collide with shadcn token names — handled on the first port by renaming legacy `--accent*`→`--brand*`, `--border*`→`--hairline*`. After that, ports are paste-and-wire.
- **Separate blocker (not redesign):** Supabase migrations **016 / 017 / 018** are not yet applied — directory/setup/team data won't persist until they are. Assign an owner.

---

## 9. Porting protocol (how to hand a v0 screen to engineering)

For each screen, provide: **(1)** the v0 code or share link, **(2)** the route it replaces, **(3)** any non-obvious data note. Engineering then: adds the shadcn primitives it uses, swaps mock data for real Supabase fetches + types, rewires actions (autosave/API/nav), maps icons to our primitives, keeps Indonesian copy, and verifies `tsc`/`eslint`/`vitest` before merge. **Recommended first screen:** `/login` or `/projects/[id]/setup` (locks the theme on something low-risk).
