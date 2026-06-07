# MASTER-SPEC.md — Pantau
> Source of truth for all product decisions. Update this file when a decision changes. Do not let it drift.

---

## 1. Product Overview

**Pantau** (Indonesian: "to monitor") is a construction progress tracking platform for residential property developers in Southeast Asia, starting with Indonesia.

**Core problem:** A developer walks 100 units, finds defects and incomplete stages across all of them, and currently manages everything via WhatsApp groups and Excel. No accountability, no photo trail, no progress visibility, no analytics.

**Core solution:** A visual, map-based progress tracker. The developer sees every unit on a site plan, color-coded by completion percentage. A three-role workflow handles the data lifecycle.

**Target user:** Indonesian residential developer, 50–500 units per project. Underserved by enterprise tools (too expensive, too complex) and currently running on WhatsApp + Excel.

---

## 2. User Roles

| Role | What they do | Primary device |
|---|---|---|
| **Owner / Developer** | Views all projects, top-level dashboard | Web |
| **Project Manager** | Sets up maps, assigns parties, views stats, can flag issues | Web |
| **Koordinator** | Reviews stage submissions, approves or denies with reason | Mobile + Web |
| **Pengawas** | Submits stage completions with photo evidence | Mobile (Android-first) |

Rules:
- A Pengawas can VIEW all units (read-only) but can only SUBMIT to their assigned units
- A Koordinator can update urgency on any unit
- A Project Manager can flag any submission for re-review even after approval
- Role is server-side — never trust role from client

---

## 3. Core Workflow

```
Pengawas checks off subtasks + uploads photos
           ↓
     Submits stage for review
           ↓
  Koordinator review queue
     /          \
Approve        Deny + written reason
   ↓                   ↓
% updates       Telegram group notification
PM sees it      Pengawas resubmits
```

---

## 4. Feature Specifications

### 4.1 Map Studio

**Three entry modes:**
1. Upload a site plan photo → AI digitizes it
2. Build from scratch on blank canvas
3. Load a starter template (Grid cluster, Row housing)

**Upload & Digitize:**
- Accept JPG, PNG, HEIC, PDF (first page). Max 20MB.
- Send ORIGINAL (full resolution) to Gemini 2.5 Flash — do NOT compress before AI processing
- AI returns detected blocks as JSON with normalized 0-1 coordinates
- Show detected blocks as SVG overlay on faded background image
- User reviews, adjusts (select/move/resize/add/delete), confirms

**Canvas editor (SVG-based):**
- All block coordinates stored as normalized 0-1 values (x, y, width, height)
- Never store pixel values in the database
- Interactions: click to select, drag to move, draw tool to add new block, Delete key to remove
- Corner handles for resize (Phase 2)
- Minimum block size to be clickable: 24×24px at default zoom

**Configuration playground (5 modes, tab-switched):**
1. **Assign Subcontractor** — click/paint units. Each sub has a color. Shows color fill on canvas.
2. **Assign Supervisor** — click/paint units. Shows border treatment on canvas.
3. **Set Area Type** — apply type from taxonomy. Shows type color on canvas.
4. **Set Urgency** — Normal / High / Critical. Shows badge on block.
5. **Assign SPK Template** — link work order template to unit.

**Unit type taxonomy (fixed, global — do not add new types without updating backend enum):**
`house`, `apartment`, `shophouse`, `commercial`, `villa`, `road`, `common_area`, `parking`, `facility`, `drainage`, `boundary`

### 4.2 SPK Template System (Work Orders)

Three-level hierarchy, applied in priority order:
```
Global (Pantau default) → Org override → Project override
```

A unit without an SPK template cannot accept submissions.

**Stage order is enforced:** Stage N cannot be submitted until Stage N-1 is approved.

**Default global templates to seed:**
- Standard 2BR Landed House (10 stages, 42 subtasks)
- Standard 3BR Landed House (12 stages, 54 subtasks)
- Shophouse Unit (8 stages, 38 subtasks)
- Infrastructure (5 stages, 20 subtasks)

### 4.3 Pengawas Submission Flow

1. Open app → see assigned project → tap unit (from map or unit list or QR scan)
2. See stage list — only active stage is submittable
3. Check off subtasks
4. Upload required photos (compressed client-side, max 1MB each)
5. Add optional note
6. Submit → status: "Pending Review"
7. If denied: see reason, stage re-opens, resubmit

**Offline mode:** store submissions in IndexedDB, sync when connected.

### 4.4 Koordinator Review Flow

1. Review queue sorted: Critical first → High → Normal
2. See photos, checklist, metadata
3. Approve → stage % confirmed, stamped
4. Deny → required reason → Telegram notification fires

PM can flag any approved submission for re-review.

### 4.5 PM / Owner Dashboard

**Map view:** site plan with progress fills:

| % | Color |
|---|---|
| 0 | No fill (outline only) |
| 1–24 | Light gray |
| 25–49 | Light teal |
| 50–74 | Medium teal |
| 75–99 | Dark teal |
| 100 | Solid green |
| Pending review | Amber pulsing dot |
| Denied | Red pulsing dot |

**Filters:** by subcontractor, supervisor, status, urgency.

**Unit detail panel:** stage list, photos, approval chain, urgency edit.

**Stats:** per-subcontractor %, per-supervisor metrics, overall project %.

### 4.6 QR Code System

- Every unit gets a unique QR code on project go-live
- Links to: `pantau.app/u/[unit_id]`
- On scan, role-based redirect:
  - Pengawas → submission form
  - Koordinator → unit review queue
  - PM/Owner → unit detail
- PDF export: all QR codes, 6 per A4 page

### 4.7 Telegram Notifications

Fires when a Koordinator denies a submission. Message sent to the project's configured Telegram group.

**Message format:**
```
🔴 DENIED — [Project Name]
Unit: [unit_code] | Stage: [n] — [stage_name]
Reason: [reason]
Denied by: [name] | Pengawas: [name]
View: pantau.app/u/[unit_id]
```

---

## 5. Data Model (Canonical)

See `CLAUDE.md` for full SQL schema. Summary of key entities:

| Table | Purpose |
|---|---|
| `organisations` | Multi-tenant root |
| `users` | Extends Supabase auth, holds role |
| `projects` | One per construction project |
| `project_members` | Links users to projects with role |
| `subcontractors` | Contractor entities per org |
| `spk_templates` | Work order templates (3-level) |
| `units` | Individual map blocks |
| `unit_assignments` | Pengawas → unit mapping |
| `submissions` | Stage completion submissions |
| `submission_photos` | Photos linked to submissions |

**Critical invariants:**
- Unit coordinates always in 0-1 normalized space
- `progress_pct` = approved_subtasks / total_subtasks × 100
- Stages must be completed in order
- RLS on every table, always

---

## 6. Image Handling

| Image type | Compress? | Where sent | Storage |
|---|---|---|---|
| Progress photos (Pengawas) | Yes — 800KB max, client-side | Directly to R2 via pre-signed URL | R2, kept 5–10 years |
| Site plan upload | NO — full resolution needed | Server → Gemini API → then compress for display | R2 (original + compressed display copy) |

**Never expose R2 credentials to the client.** Pre-signed URLs only, 15-min expiry.

---

## 7. Acceptance Criteria

- [ ] User can upload a JPG/PNG/HEIC/PDF site plan and receive digitized blocks within 5 seconds
- [ ] User can manually adjust, add, delete, rename any block
- [ ] All 5 configuration modes visually update the canvas in real time
- [ ] Paint mode (click/drag across blocks) assigns configuration in bulk
- [ ] Progress map shows correct color fills per completion %
- [ ] Tapping a unit opens detail panel with stage list
- [ ] QR scan opens correct role-specific view
- [ ] Pengawas can only submit to assigned units (enforced by RLS)
- [ ] Koordinator deny triggers Telegram group message
- [ ] All unit coordinates stored in 0-1 normalized space
- [ ] SPK template 3-level hierarchy respected (global → org → project)

---

## 8. Out of Scope for V1

- S-curve / Kurva S timeline analytics
- DWG / AutoCAD file import
- Real-world scale calculation
- Multi-floor maps
- Real-time collaborative editing
- Payment / billing
- In-app chat
- WhatsApp integration (Telegram only)
- Native iOS / Android app (PWA first)
- Auto-detection of project phases
