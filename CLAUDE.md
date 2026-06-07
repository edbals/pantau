# PANTAU — Master Specification for AI Coder
> Read this entire file before writing a single line of code.
> This is the source of truth. If something is not in here, ask before assuming.

---

## 1. What Pantau Is

Pantau is a construction progress tracking platform for residential developers in Southeast Asia, starting in Indonesia. The name means "to monitor / to oversee" in Bahasa Indonesia.

**The core problem:** A developer walks 100 housing units, finds defects and incomplete work across all of them, and currently has to coordinate fixes via WhatsApp groups and spreadsheets. There is no accountability, no photo trail, no progress visibility, and no analytics.

**The core solution:** A visual, map-based progress tracking system where a developer can see every unit on a site plan, color-coded by completion percentage. A three-role workflow — Pengawas (supervisor) submits photo evidence of completed work stages → Koordinator (quality control) approves or denies → Project Manager sees live progress across all units. Denials trigger an instant Telegram group notification. Everything is stamped with who did what and when.

**Target user:** Mid-size Indonesian residential developer doing 50–500 units per project. Completely underserved by enterprise tools (Procore, Autodesk Build) which are too expensive and complex, and currently running on WhatsApp + Excel.

---

## 2. Tech Stack (non-negotiable)

| Layer | Tool | Notes |
|---|---|---|
| Frontend | Next.js (App Router) | Hosted on Vercel, free tier |
| Database + Auth | Supabase | PostgreSQL, RLS, Auth, Edge Functions |
| Image storage | Cloudflare R2 | Zero egress fees. Never use Supabase storage for images. |
| Site plan AI | Gemini 2.5 Flash | Vision API for digitizing uploaded floor plans |
| Notifications | Telegram Bot API | Free. Group notifications on denial |
| Deployment | Vercel (frontend) + Supabase (backend) | |
| Styling | Tailwind CSS | |
| Language | TypeScript throughout | No JavaScript files |

**ECC skills installed at `~/.claude/skills/ecc/`:**
- `frontend-patterns` → use when building React components and Next.js pages
- `postgres-patterns` → use when writing SQL, migrations, or queries
- `backend-patterns` → use when building API routes and services
- `api-design` → use when designing any new endpoint
- `database-migrations` → use when changing schema

**Token efficiency rule:** Load only the relevant ECC skill for the task at hand. Do not load all five simultaneously. Reference the skill file path explicitly when you need it.

---

## 3. User Roles & Permissions

There are exactly four roles. Every database query must be gated by the user's role via Supabase Row Level Security (RLS). Never trust role from the client — always derive from the database.

### Role: `owner`
- The developer / business owner
- Can do everything: create projects, edit maps, view all data, generate reports
- Read-only on individual submissions (cannot submit on behalf of others)

### Role: `project_manager`
- Assigned to one or more projects
- Same as owner within their assigned projects
- Can flag any submission for re-review even after approval
- Cannot create new projects or manage billing

### Role: `koordinator`
- Assigned to one or more projects
- Reviews submission queue: approve or deny with written reason
- Can set/change urgency on any unit
- Cannot edit the map or create submissions

### Role: `pengawas`
- Assigned to specific units within a project
- Can view all units (read-only) but can only submit to assigned units
- Submits stage completions with photo evidence
- Cannot approve, deny, or edit anything else

---

## 4. Database Schema (Canonical — do not deviate)

Use Supabase migrations. Every table must have `created_at TIMESTAMPTZ DEFAULT NOW()` and `updated_at TIMESTAMPTZ DEFAULT NOW()`. Add a trigger for `updated_at` on every table.

### 4.1 organisations
```sql
CREATE TABLE organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.2 users (extends Supabase auth.users)
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID REFERENCES organisations(id),
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'project_manager', 'koordinator', 'pengawas')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.3 projects
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  project_code TEXT NOT NULL,
  name TEXT NOT NULL,
  project_type TEXT NOT NULL CHECK (project_type IN ('residential', 'commercial', 'industrial', 'mixed')),
  status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'on_hold', 'completed', 'archived')),
  site_plan_image_url TEXT,
  canvas_data JSONB,
  go_live_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, project_code)
);
```

### 4.4 project_members (links users to projects)
```sql
CREATE TABLE project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('project_manager', 'koordinator', 'pengawas')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
```

### 4.5 subcontractors
```sql
CREATE TABLE subcontractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  contact_phone TEXT,
  color_hex TEXT DEFAULT '#6B7280',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.6 spk_templates (Work Order templates — 3-level hierarchy)
```sql
CREATE TABLE spk_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('global', 'org', 'project')),
  org_id UUID REFERENCES organisations(id),
  project_id UUID REFERENCES projects(id),
  cloned_from_id UUID REFERENCES spk_templates(id),
  applicable_unit_types TEXT[] NOT NULL,
  stages JSONB NOT NULL,
  -- stages structure:
  -- [{ stage_number, stage_name, stage_code, required_photo_count,
  --    subtasks: [{ subtask_number, description, requires_photo }] }]
  total_stages INTEGER NOT NULL,
  total_subtasks INTEGER NOT NULL,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.7 units
```sql
CREATE TABLE units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  custom_label TEXT,
  unit_type TEXT NOT NULL CHECK (unit_type IN (
    'house', 'apartment', 'shophouse', 'commercial', 'villa',
    'road', 'common_area', 'parking', 'facility', 'drainage', 'boundary'
  )),
  canvas_position JSONB NOT NULL,
  -- { x: float, y: float, width: float, height: float, rotation: float }
  -- ALL VALUES normalized 0-1. Never store pixel values.
  assigned_subcontractor_id UUID REFERENCES subcontractors(id),
  assigned_supervisor_id UUID REFERENCES users(id),
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'high', 'critical')),
  spk_template_id UUID REFERENCES spk_templates(id),
  progress_pct NUMERIC(5,2) DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'pending_review', 'completed'
  )),
  qr_code_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, unit_code)
);
```

### 4.8 submissions
```sql
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL,
  submitted_by UUID NOT NULL REFERENCES users(id),
  subcontractor_id UUID REFERENCES subcontractors(id),
  subtasks_checked INTEGER[] NOT NULL DEFAULT '{}',
  notes TEXT,
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  -- Review fields (populated by koordinator)
  reviewed_by UUID REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IN ('approved', 'denied')),
  review_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  -- PM flag fields
  flagged_by UUID REFERENCES users(id),
  flag_reason TEXT,
  flagged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.9 submission_photos
```sql
CREATE TABLE submission_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  caption TEXT,
  file_size_bytes INTEGER,
  taken_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 4.10 unit_assignments (Pengawas → Units mapping)
```sql
CREATE TABLE unit_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(unit_id, user_id)
);
```

### 4.11 Progress calculation (computed, not stored raw)
`progress_pct` on the `units` table is updated via a database function triggered after every submission review:

```sql
-- Run this after every approved/denied review to recompute progress
CREATE OR REPLACE FUNCTION compute_unit_progress(p_unit_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  total_subtasks INTEGER;
  approved_subtasks INTEGER;
  template_stages JSONB;
BEGIN
  SELECT s.stages INTO template_stages
  FROM units u
  JOIN spk_templates s ON u.spk_template_id = s.id
  WHERE u.id = p_unit_id;

  SELECT total_subtasks INTO total_subtasks
  FROM spk_templates st
  JOIN units u ON u.spk_template_id = st.id
  WHERE u.id = p_unit_id;

  SELECT COALESCE(SUM(array_length(subtasks_checked, 1)), 0) INTO approved_subtasks
  FROM submissions
  WHERE unit_id = p_unit_id AND review_decision = 'approved';

  IF total_subtasks = 0 THEN RETURN 0; END IF;
  RETURN ROUND((approved_subtasks::NUMERIC / total_subtasks) * 100, 2);
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Row Level Security (RLS) — Non-negotiable

Enable RLS on every table. These are the core policies. Add more as needed but never remove these.

```sql
-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_photos ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's role in a project
CREATE OR REPLACE FUNCTION user_project_role(p_project_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM project_members
  WHERE project_id = p_project_id AND user_id = auth.uid()
  UNION
  SELECT 'owner' FROM users u
  JOIN organisations o ON u.org_id = o.id
  JOIN projects p ON p.org_id = o.id
  WHERE u.id = auth.uid() AND p.id = p_project_id AND u.role = 'owner'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

-- Projects: org members can see their org's projects
CREATE POLICY "org members see their projects" ON projects
  FOR SELECT USING (
    org_id = (SELECT org_id FROM users WHERE id = auth.uid())
  );

-- Units: project members can see units in their projects
CREATE POLICY "project members see units" ON units
  FOR SELECT USING (
    user_project_role(project_id) IS NOT NULL
  );

-- Pengawas can only insert submissions for their assigned units
CREATE POLICY "pengawas submit to assigned units" ON submissions
  FOR INSERT WITH CHECK (
    submitted_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM unit_assignments
      WHERE unit_id = submissions.unit_id AND user_id = auth.uid()
    )
  );

-- Koordinator can update review fields only
CREATE POLICY "koordinator review submissions" ON submissions
  FOR UPDATE USING (
    user_project_role(
      (SELECT project_id FROM units WHERE id = submissions.unit_id)
    ) IN ('koordinator', 'project_manager', 'owner')
  );
```

---

## 6. Feature Specifications

### 6.1 Map Studio

**Three entry modes:**
1. Upload a site plan photo → AI digitizes it
2. Build from scratch on a blank canvas
3. Load a starter template

**Site plan upload → AI digitization flow:**
1. User uploads JPG, PNG, or PDF (max 20MB). Accept HEIC too.
2. If PDF: extract first page as image server-side.
3. Send the ORIGINAL image (do not compress) to Gemini 2.5 Flash Vision API.
4. Prompt Gemini to return detected unit blocks as JSON (see below).
5. Store compressed version of the image in R2 for display (40% opacity background).
6. Render AI-detected blocks as SVG overlay on top of the faded image.
7. User reviews, adjusts, confirms.

**Gemini prompt for digitization:**
```
Analyze this site plan or floor plan image. Identify all individual unit blocks (houses, 
apartments, lots, shophouses) and non-unit areas (roads, common areas, parking).

Return ONLY valid JSON in this exact structure, nothing else:
{
  "detected_units": [
    {
      "temp_id": "u_001",
      "type": "house|apartment|shophouse|commercial|villa|road|common_area|parking|facility|drainage|boundary",
      "label_detected": "text label visible on this unit, or null",
      "suggested_code": "suggested unit code like A-01 or null",
      "coordinates": { "x": 0.0-1.0, "y": 0.0-1.0, "width": 0.0-1.0, "height": 0.0-1.0 },
      "confidence": 0.0-1.0
    }
  ],
  "overall_confidence": 0.0-1.0
}

Coordinates must be normalized 0-1 relative to image dimensions. x,y = top-left corner.
If confidence is below 0.4, still include the block but note low confidence.
Return only the JSON object, no markdown, no explanation.
```

**Canvas editor (SVG-based):**
- Render the site plan image as an `<image>` element at 40% opacity
- Render blocks as `<rect>` or `<polygon>` SVG elements on top
- Implement: tap to select, drag to move, corner handles to resize, multi-select
- Store all coordinates in 0-1 normalized space — convert to/from pixel space only for rendering
- Zoom: 50%–400%. Pan: drag canvas. "Fit to screen" button always visible.

**Configuration playground (after map is built):**
Five modes, toggled via a tab bar:
1. **Assign Subcontractor** — select sub from list, tap/drag units to assign. Each sub gets a color.
2. **Assign Supervisor (Pengawas)** — select supervisor, tap units. Shown as dotted border.
3. **Set Area Type** — change the unit type enum for each block.
4. **Set Urgency** — Normal (default) / High (yellow badge) / Critical (red badge).
5. **Assign SPK Template** — assign which work order template applies to this unit.

**Unit type visual treatment:**

| Type | Fill | Border | Icon |
|---|---|---|---|
| house/apartment/villa | transparent | solid blue | 🏠 |
| shophouse/commercial | transparent | solid amber | 🏪 |
| road | gray-200 fill | dashed gray | — |
| common_area | green-100 fill | dashed green | 🌳 |
| parking/facility/etc | gray-100 fill | dashed gray | varies |

### 6.2 SPK Template System

Three levels, applied in priority order: `global` → `org` → `project`.

**Default global templates to seed on first deploy:**
- "Standard 2BR Landed House" (10 stages, 47 subtasks)
- "Standard 3BR Landed House" (12 stages, 55 subtasks)
- "Shophouse Unit" (8 stages, 38 subtasks)
- "Apartment Unit" (9 stages, 42 subtasks)

Stages follow construction order and cannot be skipped. Stage N requires Stage N-1 to be approved before submission.

### 6.3 Pengawas Flow (Mobile PWA — Android first)

**Home screen:** List of assigned projects → tap project → see assigned units on map (all units visible read-only, assigned units are interactive).

**Submit a stage:**
1. Tap assigned unit on map (or scan QR code or search by unit code)
2. See stage list — current active stage is highlighted
3. Tap active stage → see subtask checklist
4. Check off each subtask
5. Camera button appears for each subtask requiring photo
6. **Photo handling:** capture via camera or pick from gallery → compress to ~800KB client-side (use browser Canvas API, JPEG quality 0.75) → upload to R2 via pre-signed URL
7. Add optional text note
8. Tap "Submit for review"
9. Stage status changes to "Pending Review"

**If denied:** receive push notification (or check app) → see denial reason → stage re-opens → fix and resubmit.

**Offline mode:** If no connection, store submission locally (IndexedDB). Show "Syncing..." badge. Auto-sync when reconnected.

### 6.4 Koordinator Flow (Mobile + Web)

**Home screen:** Review queue sorted by: Critical urgency first → High → Normal → then by project.

**Review a submission:**
1. See stage info, subtasks checked, all photos (full-size, swipeable)
2. See who submitted, which subcontractor, timestamp
3. Tap **Approve** → stage % confirmed, stamped with koordinator ID + timestamp
4. Tap **Deny** → required text field for reason → on submit, trigger Telegram notification
5. Denied submissions re-open the stage for the Pengawas

**PM flag:** Koordinator can escalate any submission to the PM with a note.

### 6.5 PM / Owner Dashboard (Web)

**Project overview:**
- All projects as cards with overall % and status
- Click project → site map with color-coded units

**Progress color scale:**
| % | Fill color |
|---|---|
| 0 | No fill (outline only) |
| 1–24 | Light gray |
| 25–49 | Light teal |
| 50–74 | Medium teal |
| 75–99 | Dark teal |
| 100 | Solid green |
| Pending review | Amber pulsing dot (top-right corner) |
| Denied | Red pulsing dot (top-right corner) |

**Map filters:** by subcontractor, supervisor, status, urgency.

**Unit detail panel (tap any unit):**
- Unit code, type, assigned parties, urgency (editable inline)
- Progress bar + stage breakdown
- Full submission history with photos
- "Flag for re-review" button (PM only)

**Stats panel:**
- Overall project % completion
- Per-subcontractor: units assigned, % complete, avg days per stage, denial rate
- Per-supervisor: units covered, submission count, approval rate

### 6.6 QR Code System

- Every unit gets a QR code auto-generated on project go-live
- QR links to: `https://pantau.app/u/[unit_id]`
- On scan, redirect based on role:
  - Pengawas → submission form for that unit
  - Koordinator → that unit's review queue
  - PM/Owner → unit detail panel

**QR PDF export:**
- Download all unit QR codes as a PDF
- Format: 6 per A4 page, each labeled with unit code
- Use a library like `qrcode` + `jspdf` or a Supabase Edge Function

### 6.7 Telegram Notifications

Use the Telegram Bot API. Store the bot token in environment variables.

**Trigger:** Every time a Koordinator denies a submission.

**Message format:**
```
🔴 DENIED — [Project Name]
Unit: [unit_code] ([unit_type])
Stage: [stage_number] — [stage_name]
Denied by: [koordinator_name]
Reason: [review_reason]
Pengawas: [pengawas_name]
Subcontractor: [subcontractor_name]

View unit: https://pantau.app/u/[unit_id]
```

**Setup:** Each project has a configured Telegram group chat ID stored in a `project_notifications` table. The bot must be added to that group. When a denial fires, send to the group associated with that project.

---

## 7. Image Handling Rules

**Progress photos (Pengawas submissions):**
- Compress client-side BEFORE upload: browser Canvas API, JPEG quality 0.75, max 1MB
- Upload directly to R2 via pre-signed URL (never proxy through your server)
- Serve via R2 public URL or signed URL (signed preferred for access control)
- Long-term storage: keep in R2 for project lifetime (5–10 years). Do not auto-delete.

**Site plan images (Map Studio upload):**
- Do NOT compress before sending to Gemini — AI needs full resolution to read labels
- After Gemini processes: store a compressed version (800KB) in R2 for display background
- Keep original too, in a separate R2 key with `/originals/` prefix

**R2 key structure:**
```
submissions/{project_id}/{unit_id}/{submission_id}/{photo_id}.jpg
site-plans/{project_id}/original/{filename}
site-plans/{project_id}/display/{filename}
qr-codes/{project_id}/{unit_id}.png
```

**Never expose R2 credentials to the client.** Use pre-signed URLs generated server-side with a 15-minute expiry for uploads. For viewing, use Cloudflare's public R2 URL or signed read URLs.

---

## 8. Security Requirements

### 8.1 Environment variables (never commit these)
```
# .env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server-side only, never expose to client
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_R2_PUBLIC_URL=
GOOGLE_GEMINI_API_KEY=            # server-side only
TELEGRAM_BOT_TOKEN=               # server-side only
TELEGRAM_WEBHOOK_SECRET=          # for validating Telegram webhook calls
```

### 8.2 API route protection
Every API route must:
1. Call `createServerClient()` from Supabase SSR package
2. Get the session: `const { data: { user } } = await supabase.auth.getUser()`
3. If no user: return 401
4. Query the `users` table for role
5. Gate the action to the required role

Never use `getSession()` server-side — always use `getUser()` which verifies the JWT with Supabase.

### 8.3 File upload validation
Before generating a pre-signed upload URL:
- Check file size: reject > 20MB
- Check MIME type: accept only `image/jpeg`, `image/png`, `image/heic`, `application/pdf`
- Never accept `.exe`, `.js`, `.sh`, or any executable type
- Sanitize filename: strip path traversal chars, replace spaces with `-`

### 8.4 Input sanitization
- Sanitize all text inputs before storing (trim, strip HTML tags)
- Unit codes: allow only alphanumeric + `-` + `_`. Reject all others.
- Stage/subtask content: store as text, never render as HTML (use textContent not innerHTML)

### 8.5 Supabase RLS
- RLS must be ON for every table (see Section 5 for policies)
- Service role key is only used server-side for admin operations (QR generation, stats)
- Never use service role key in client-side code

### 8.6 Telegram webhook security
When Telegram calls your webhook endpoint, validate the `X-Telegram-Bot-Api-Secret-Token` header matches your `TELEGRAM_WEBHOOK_SECRET`. Reject all requests that don't match.

### 8.7 Run ECC security scan after building auth
```bash
# From your project root in Claude Code
/security-scan
# or
npx ecc-agentshield scan
```

---

## 9. API Design Conventions

Follow the `~/.claude/skills/ecc/api-design` skill for all endpoints.

**Base conventions:**
- All routes under `/api/v1/`
- Use HTTP verbs correctly: GET (read), POST (create), PUT (full update), PATCH (partial), DELETE
- Return consistent JSON: `{ data: ..., error: null }` on success, `{ data: null, error: { code, message } }` on failure
- HTTP status codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity, 500 Server Error
- Paginate lists: `?page=1&limit=20`, return `{ data: [], meta: { total, page, limit, hasMore } }`

**Key endpoints:**

```
POST   /api/v1/projects
GET    /api/v1/projects/:id
PATCH  /api/v1/projects/:id

POST   /api/v1/projects/:id/map/digitize     # send image, get back detected blocks
POST   /api/v1/projects/:id/map/save         # save canvas_data JSON

GET    /api/v1/projects/:id/units
POST   /api/v1/projects/:id/units
PATCH  /api/v1/projects/:id/units/:unitId
GET    /api/v1/projects/:id/units/:unitId/qr

POST   /api/v1/units/:unitId/submissions
GET    /api/v1/units/:unitId/submissions

PATCH  /api/v1/submissions/:id/review        # koordinator approve/deny
PATCH  /api/v1/submissions/:id/flag          # PM flag

POST   /api/v1/uploads/presign               # get pre-signed R2 upload URL

GET    /api/v1/projects/:id/stats
GET    /api/v1/projects/:id/qr-pdf           # download all QR codes as PDF
```

---

## 10. Implementation Steps (Do these in order)

### Phase 1: Foundation
1. `npx create-next-app@latest pantau --typescript --tailwind --app` 
2. Install Supabase: `npm install @supabase/supabase-js @supabase/ssr`
3. Create Supabase project, get URL + anon key, set up `.env.local`
4. Set up Cloudflare R2 bucket, generate API keys
5. Run all migrations from Section 4 in Supabase SQL editor (in order: organisations → users → projects → project_members → subcontractors → spk_templates → units → submissions → submission_photos → unit_assignments)
6. Enable RLS and apply all policies from Section 5
7. Seed default SPK templates (4 global templates)

### Phase 2: Auth
8. Build login page (email + password, Supabase Auth)
9. Build middleware (`middleware.ts`) that checks session on every route
10. Create user profile on first login (insert into `users` table)
11. Build role-based layout: different nav/sidebar per role

### Phase 3: Map Studio
12. Build site plan upload UI (drag-and-drop + camera capture)
13. Build the Gemini integration API route (`/api/v1/projects/:id/map/digitize`)
14. Build SVG canvas editor (display image + block overlays)
15. Build block editing interactions (select, drag, resize, add, delete)
16. Build the configuration playground (5-mode tab system)
17. Build canvas save (serialize to `canvas_data` JSON → save to Supabase)
18. Build starter templates (5 presets)

### Phase 4: SPK Templates
19. Build template CRUD UI (list, create, edit, clone)
20. Implement 3-level hierarchy logic (global → org → project)
21. Seed the 4 default global templates

### Phase 5: Pengawas Flow
22. Build Pengawas home (assigned units list + map view)
23. Build stage list view per unit
24. Build subtask checklist + photo capture
25. Build client-side image compression (Canvas API, max 1MB)
26. Build R2 pre-signed upload URL endpoint + client upload flow
27. Build submission creation API route
28. Build offline mode (IndexedDB + sync)

### Phase 6: Koordinator Flow
29. Build review queue (sorted by urgency)
30. Build submission detail view (photos, checklist, metadata)
31. Build approve action (update submission + trigger progress recalculation)
32. Build deny action (update submission + send Telegram message)
33. Build Telegram Bot (set up bot, configure webhook endpoint)

### Phase 7: PM/Owner Dashboard
34. Build project list with progress stats
35. Build interactive site map with color-coded progress fills
36. Build map filters (by sub, supervisor, status, urgency)
37. Build unit detail panel (slide-in from right on tap/click)
38. Build stats panel (per-subcontractor, per-supervisor metrics)
39. Build PM flag action (re-opens submission for re-review)

### Phase 8: QR System
40. Build QR code generation per unit (auto-on go-live)
41. Build `/u/[unit_id]` route that redirects based on role
42. Build QR PDF export (all units for a project, 6 per A4 page)

### Phase 9: Go-live checklist
43. Set `status = 'active'` on project → auto-generate all QR codes
44. Run `npx ecc-agentshield scan` — fix all critical findings
45. Test full workflow end-to-end with real users on a staging project

---

## 11. Out of Scope for V1 (Do not build these)

- S-curve / timeline analytics
- DWG / AutoCAD file import (JPG, PNG, PDF only)
- Real-world scale calculation from site plan
- Multi-floor maps
- Real-time collaborative canvas editing
- Payment / billing integration
- In-app chat
- WhatsApp integration (Telegram only for V1)
- Auto-detection of project phases (Phase 1, Phase 2, etc.)
- Native iOS / Android app (PWA only for V1)

---

## 12. Naming & Language Notes

- The product is called **Pantau** (Indonesian: "to monitor/oversee")
- Primary language of the UI: **Bahasa Indonesia** (with English option)
- Key Indonesian terms used in the codebase:
  - Pengawas = site supervisor (role)
  - Koordinator = quality control reviewer (role)
  - Denah = floor plan / site plan
  - SPK (Surat Perintah Kerja) = Work Order
  - Subkon = subcontractor

---

## 13. ECC Token Efficiency Guide

When asking Claude Code to build a specific area, prepend your prompt with the relevant skill reference to avoid loading unnecessary context:

```
# For database work:
"Using the postgres-patterns skill at ~/.claude/skills/ecc/postgres-patterns, 
write a migration for..."

# For API routes:
"Using the api-design skill at ~/.claude/skills/ecc/api-design,
create the endpoint for..."

# For React components:
"Using the frontend-patterns skill at ~/.claude/skills/ecc/frontend-patterns,
build the component for..."

# For schema changes:
"Using the database-migrations skill at ~/.claude/skills/ecc/database-migrations,
write a migration that..."
```

**Do not ask Claude to load all skills at once.** One skill per task. This keeps the context window efficient and outputs more focused.

**Use `/code-review` after each phase** (not after every file). Phase-level reviews catch architectural issues before they compound.

**Use `/security-scan` after Phase 2 (auth) and before Phase 9 (go-live).** These are the two highest-risk moments.

---

## 14. Questions to Ask Before Starting Any Task

Before coding anything non-trivial, ask:
1. Which user role(s) does this affect?
2. What RLS policy gates this data?
3. Does this involve an image? (if yes: compress for progress photos, do not compress for site plan AI calls)
4. Does this require a Telegram notification?
5. Is this in scope for V1? (check Section 11)
