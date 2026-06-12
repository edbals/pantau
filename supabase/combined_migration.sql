-- Shared trigger function applied to every table with an updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TABLE organisations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER organisations_updated_at
  BEFORE UPDATE ON organisations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE users (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id     UUID REFERENCES organisations(id),
  full_name  TEXT NOT NULL,
  phone      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'project_manager', 'koordinator', 'pengawas')),
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE projects (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID NOT NULL REFERENCES organisations(id),
  project_code        TEXT NOT NULL,
  name                TEXT NOT NULL,
  project_type        TEXT NOT NULL CHECK (project_type IN ('residential', 'commercial', 'industrial', 'mixed')),
  status              TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'on_hold', 'completed', 'archived')),
  site_plan_image_url TEXT,
  canvas_data         JSONB,
  go_live_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, project_code)
);

CREATE TRIGGER projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE project_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('project_manager', 'koordinator', 'pengawas')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);
CREATE TABLE subcontractors (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organisations(id),
  name          TEXT NOT NULL,
  contact_phone TEXT,
  color_hex     TEXT DEFAULT '#6B7280',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER subcontractors_updated_at
  BEFORE UPDATE ON subcontractors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE spk_templates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  level                TEXT NOT NULL CHECK (level IN ('global', 'org', 'project')),
  org_id               UUID REFERENCES organisations(id),
  project_id           UUID REFERENCES projects(id),
  cloned_from_id       UUID REFERENCES spk_templates(id),
  applicable_unit_types TEXT[] NOT NULL,
  -- stages: [{ stage_number, stage_name, stage_code, required_photo_count,
  --   subtasks: [{ subtask_number, description, requires_photo }] }]
  stages               JSONB NOT NULL,
  total_stages         INTEGER NOT NULL,
  total_subtasks       INTEGER NOT NULL,
  is_archived          BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER spk_templates_updated_at
  BEFORE UPDATE ON spk_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE units (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  unit_code                TEXT NOT NULL,
  custom_label             TEXT,
  unit_type                TEXT NOT NULL CHECK (unit_type IN (
    'house', 'apartment', 'shophouse', 'commercial', 'villa',
    'road', 'common_area', 'parking', 'facility', 'drainage', 'boundary'
  )),
  -- canvas_position: { x, y, width, height, rotation } — ALL values normalized 0-1
  canvas_position          JSONB NOT NULL,
  assigned_subcontractor_id UUID REFERENCES subcontractors(id),
  assigned_supervisor_id   UUID REFERENCES users(id),
  urgency                  TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal', 'high', 'critical')),
  spk_template_id          UUID REFERENCES spk_templates(id),
  progress_pct             NUMERIC(5,2) DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  status                   TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'pending_review', 'completed'
  )),
  qr_code_url              TEXT,
  created_at               TIMESTAMPTZ DEFAULT NOW(),
  updated_at               TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, unit_code)
);

CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id         UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  stage_number    INTEGER NOT NULL,
  submitted_by    UUID NOT NULL REFERENCES users(id),
  subcontractor_id UUID REFERENCES subcontractors(id),
  subtasks_checked INTEGER[] NOT NULL DEFAULT '{}',
  notes           TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW(),
  -- Review fields (populated by koordinator)
  reviewed_by     UUID REFERENCES users(id),
  review_decision TEXT CHECK (review_decision IN ('approved', 'denied')),
  review_reason   TEXT,
  reviewed_at     TIMESTAMPTZ,
  -- PM flag fields
  flagged_by      UUID REFERENCES users(id),
  flag_reason     TEXT,
  flagged_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER submissions_updated_at
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TABLE submission_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  r2_key        TEXT NOT NULL,
  public_url    TEXT NOT NULL,
  caption       TEXT,
  file_size_bytes INTEGER,
  taken_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE TABLE unit_assignments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(unit_id, user_id)
);
-- Stores the Telegram group chat ID for each project's denial notifications
CREATE TABLE project_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  telegram_chat_id TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id)
);

CREATE TRIGGER project_notifications_updated_at
  BEFORE UPDATE ON project_notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ── SECURITY HELPER FUNCTIONS ──────────────────────────────────────────────
-- These use SECURITY DEFINER to bypass RLS when needed inside other RLS
-- policies, preventing recursive evaluation and read-your-own-writes issues.

-- Returns the current user's role from the users table (pre-update snapshot).
-- Used in the users UPDATE WITH CHECK to prevent self-role escalation.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = (SELECT auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the current user's org_id (pre-update snapshot).
-- Used in the users UPDATE WITH CHECK to prevent org hijacking.
CREATE OR REPLACE FUNCTION current_user_org_id_snapshot()
RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = (SELECT auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Verifies that the immutable core fields of a submission have not been
-- changed by a koordinator/PM UPDATE (only review fields should change).
CREATE OR REPLACE FUNCTION submission_core_unchanged(
  p_id              UUID,
  p_unit_id         UUID,
  p_submitted_by    UUID,
  p_stage_number    INTEGER,
  p_subtasks_checked INTEGER[]
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM submissions
    WHERE id              = p_id
      AND unit_id         = p_unit_id
      AND submitted_by    = p_submitted_by
      AND stage_number    = p_stage_number
      AND subtasks_checked = p_subtasks_checked
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── PROGRESS FUNCTIONS ─────────────────────────────────────────────────────

-- Recomputes progress_pct for a unit based on approved subtask counts
CREATE OR REPLACE FUNCTION compute_unit_progress(p_unit_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_total_subtasks  INTEGER;
  v_approved        INTEGER;
BEGIN
  SELECT st.total_subtasks INTO v_total_subtasks
  FROM units u
  JOIN spk_templates st ON u.spk_template_id = st.id
  WHERE u.id = p_unit_id;

  SELECT COALESCE(SUM(array_length(subtasks_checked, 1)), 0) INTO v_approved
  FROM submissions
  WHERE unit_id = p_unit_id AND review_decision = 'approved';

  IF v_total_subtasks IS NULL OR v_total_subtasks = 0 THEN
    RETURN 0;
  END IF;

  RETURN ROUND((v_approved::NUMERIC / v_total_subtasks) * 100, 2);
END;
$$ LANGUAGE plpgsql;

-- Fires after koordinator sets review_decision — updates progress and status
CREATE OR REPLACE FUNCTION trigger_update_unit_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_progress NUMERIC;
BEGIN
  v_progress := compute_unit_progress(NEW.unit_id);

  UPDATE units
  SET
    progress_pct = v_progress,
    status = CASE
      WHEN v_progress >= 100 THEN 'completed'
      WHEN NEW.review_decision IS NULL THEN 'pending_review'
      ELSE 'in_progress'
    END
  WHERE id = NEW.unit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_progress_update
  AFTER UPDATE OF review_decision ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_unit_progress();
-- ── ENABLE RLS ON ALL TABLES ───────────────────────────────────────────────

ALTER TABLE organisations         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractors        ENABLE ROW LEVEL SECURITY;
ALTER TABLE spk_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_photos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_notifications ENABLE ROW LEVEL SECURITY;

-- ── HELPER FUNCTIONS ───────────────────────────────────────────────────────

-- Returns the org_id of the currently authenticated user.
CREATE OR REPLACE FUNCTION current_user_org_id()
RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = (SELECT auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the effective role of the current user in a given project.
-- Owners derive their role from org membership, not project_members.
CREATE OR REPLACE FUNCTION user_project_role(p_project_id UUID)
RETURNS TEXT AS $$
  SELECT role FROM project_members
  WHERE project_id = p_project_id AND user_id = (SELECT auth.uid())
  UNION
  SELECT 'owner' FROM users u
  JOIN organisations o ON u.org_id = o.id
  JOIN projects p ON p.org_id = o.id
  WHERE u.id = (SELECT auth.uid())
    AND p.id = p_project_id
    AND u.role = 'owner'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Convenience: true if the current user can administer a project.
CREATE OR REPLACE FUNCTION is_project_admin(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT user_project_role(p_project_id) IN ('owner', 'project_manager');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── ORGANISATIONS ──────────────────────────────────────────────────────────

CREATE POLICY "users see own org" ON organisations
  FOR SELECT USING (id = current_user_org_id());

CREATE POLICY "owners update own org" ON organisations
  FOR UPDATE USING (
    id = current_user_org_id() AND
    EXISTS (SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'owner')
  );

-- ── USERS ──────────────────────────────────────────────────────────────────

-- Allow authenticated user to insert their own profile on first login.
-- org_id and role are set by the server-side onboarding flow, not by the user
-- directly — but since this is Phase 1 (no onboarding API yet), we allow the
-- insert but the WITH CHECK on UPDATE prevents self-escalation afterward.
CREATE POLICY "users insert self" ON users
  FOR INSERT WITH CHECK (id = (SELECT auth.uid()));

-- Users can read their own row and anyone in the same org.
CREATE POLICY "users see self and org" ON users
  FOR SELECT USING (
    id = (SELECT auth.uid()) OR org_id = current_user_org_id()
  );

-- FIX VULN-1: Users may only update profile fields (full_name, phone).
-- WITH CHECK enforces that role and org_id cannot be changed via self-update.
-- current_user_role() and current_user_org_id_snapshot() use SECURITY DEFINER
-- to read pre-update values, preventing self-escalation.
CREATE POLICY "users update self" ON users
  FOR UPDATE
  USING (id = (SELECT auth.uid()))
  WITH CHECK (
    id   = (SELECT auth.uid()) AND
    role = current_user_role() AND
    org_id IS NOT DISTINCT FROM current_user_org_id_snapshot()
  );

-- ── PROJECTS ───────────────────────────────────────────────────────────────

CREATE POLICY "org members see their projects" ON projects
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "owners create projects" ON projects
  FOR INSERT WITH CHECK (
    org_id = current_user_org_id() AND
    EXISTS (SELECT 1 FROM users WHERE id = (SELECT auth.uid()) AND role = 'owner')
  );

CREATE POLICY "admins update projects" ON projects
  FOR UPDATE USING (is_project_admin(id));

-- ── PROJECT MEMBERS ────────────────────────────────────────────────────────

CREATE POLICY "project members see memberships" ON project_members
  FOR SELECT USING (user_project_role(project_id) IS NOT NULL);

CREATE POLICY "admins manage memberships" ON project_members
  FOR ALL USING (is_project_admin(project_id));

-- ── SUBCONTRACTORS ─────────────────────────────────────────────────────────

CREATE POLICY "org members see subcontractors" ON subcontractors
  FOR SELECT USING (org_id = current_user_org_id());

CREATE POLICY "admins manage subcontractors" ON subcontractors
  FOR ALL USING (
    org_id = current_user_org_id() AND
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'project_manager')
    )
  );

-- ── SPK TEMPLATES ──────────────────────────────────────────────────────────

-- Global templates visible to all authenticated users.
-- org/project templates are scoped to their owner.
CREATE POLICY "users see applicable templates" ON spk_templates
  FOR SELECT USING (
    level = 'global' OR
    org_id = current_user_org_id() OR
    user_project_role(project_id) IS NOT NULL
  );

-- FIX VULN-4: Explicit WITH CHECK mirrors the USING clause so INSERT
-- cannot attribute a template to a different org via the FOR ALL policy.
CREATE POLICY "admins manage org templates" ON spk_templates
  FOR ALL
  USING (
    (level = 'org'     AND org_id    = current_user_org_id()) OR
    (level = 'project' AND user_project_role(project_id) IN ('owner', 'project_manager'))
  )
  WITH CHECK (
    (level = 'org'     AND org_id    = current_user_org_id()) OR
    (level = 'project' AND user_project_role(project_id) IN ('owner', 'project_manager'))
  );

-- ── UNITS ──────────────────────────────────────────────────────────────────

CREATE POLICY "project members see units" ON units
  FOR SELECT USING (user_project_role(project_id) IS NOT NULL);

CREATE POLICY "admins manage units" ON units
  FOR ALL USING (is_project_admin(project_id));

-- ── SUBMISSIONS ────────────────────────────────────────────────────────────

CREATE POLICY "project members see submissions" ON submissions
  FOR SELECT USING (
    user_project_role(
      (SELECT project_id FROM units WHERE id = submissions.unit_id)
    ) IS NOT NULL
  );

-- Pengawas can only submit to units they are explicitly assigned to.
CREATE POLICY "pengawas submit to assigned units" ON submissions
  FOR INSERT WITH CHECK (
    submitted_by = (SELECT auth.uid()) AND
    EXISTS (
      SELECT 1 FROM unit_assignments
      WHERE unit_id = submissions.unit_id AND user_id = (SELECT auth.uid())
    )
  );

-- FIX VULN-3: WITH CHECK uses submission_core_unchanged() (SECURITY DEFINER)
-- to compare new field values against pre-update table state, ensuring
-- koordinators can only touch review fields and cannot overwrite the
-- structural submission data (unit_id, submitted_by, stage_number,
-- subtasks_checked) that Pengawas originally committed.
CREATE POLICY "koordinator review submissions" ON submissions
  FOR UPDATE
  USING (
    user_project_role(
      (SELECT project_id FROM units WHERE id = submissions.unit_id)
    ) IN ('koordinator', 'project_manager', 'owner')
  )
  WITH CHECK (
    submission_core_unchanged(id, unit_id, submitted_by, stage_number, subtasks_checked)
  );

-- ── SUBMISSION PHOTOS ──────────────────────────────────────────────────────

CREATE POLICY "project members see photos" ON submission_photos
  FOR SELECT USING (
    user_project_role(
      (SELECT u.project_id FROM units u
       JOIN submissions s ON s.unit_id = u.id
       WHERE s.id = submission_photos.submission_id)
    ) IS NOT NULL
  );

-- Only the user who created the submission may attach photos.
CREATE POLICY "submitters insert photos" ON submission_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM submissions
      WHERE id = submission_photos.submission_id
        AND submitted_by = (SELECT auth.uid())
    )
  );

-- ── UNIT ASSIGNMENTS ───────────────────────────────────────────────────────

CREATE POLICY "project members see assignments" ON unit_assignments
  FOR SELECT USING (
    user_project_role(
      (SELECT project_id FROM units WHERE id = unit_assignments.unit_id)
    ) IS NOT NULL
  );

CREATE POLICY "admins manage assignments" ON unit_assignments
  FOR ALL USING (
    is_project_admin(
      (SELECT project_id FROM units WHERE id = unit_assignments.unit_id)
    )
  );

-- ── PROJECT NOTIFICATIONS ──────────────────────────────────────────────────

CREATE POLICY "project members see notifications" ON project_notifications
  FOR SELECT USING (user_project_role(project_id) IS NOT NULL);

CREATE POLICY "project admins manage notifications" ON project_notifications
  FOR ALL USING (is_project_admin(project_id));
-- ── USERS ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_users_org_id ON users(org_id);
CREATE INDEX idx_users_role   ON users(role);

-- ── PROJECTS ───────────────────────────────────────────────────────────────
CREATE INDEX idx_projects_org_id ON projects(org_id);
CREATE INDEX idx_projects_status ON projects(status);

-- ── PROJECT MEMBERS ────────────────────────────────────────────────────────
-- UNIQUE(project_id, user_id) already creates a composite index.
-- Add a reverse index for lookups by user.
CREATE INDEX idx_project_members_user_id ON project_members(user_id);

-- ── SUBCONTRACTORS ─────────────────────────────────────────────────────────
CREATE INDEX idx_subcontractors_org_id ON subcontractors(org_id);

-- ── SPK TEMPLATES ──────────────────────────────────────────────────────────
CREATE INDEX idx_spk_templates_level      ON spk_templates(level);
CREATE INDEX idx_spk_templates_org_id     ON spk_templates(org_id)     WHERE org_id IS NOT NULL;
CREATE INDEX idx_spk_templates_project_id ON spk_templates(project_id) WHERE project_id IS NOT NULL;

-- ── UNITS ──────────────────────────────────────────────────────────────────
CREATE INDEX idx_units_project_id   ON units(project_id);
CREATE INDEX idx_units_status       ON units(status);
CREATE INDEX idx_units_urgency      ON units(urgency);
-- Partial indexes — only non-null FKs
CREATE INDEX idx_units_subcontractor ON units(assigned_subcontractor_id) WHERE assigned_subcontractor_id IS NOT NULL;
CREATE INDEX idx_units_supervisor    ON units(assigned_supervisor_id)    WHERE assigned_supervisor_id IS NOT NULL;
CREATE INDEX idx_units_spk_template  ON units(spk_template_id)           WHERE spk_template_id IS NOT NULL;

-- ── SUBMISSIONS ────────────────────────────────────────────────────────────
CREATE INDEX idx_submissions_unit_id         ON submissions(unit_id);
CREATE INDEX idx_submissions_submitted_by    ON submissions(submitted_by);
CREATE INDEX idx_submissions_review_decision ON submissions(review_decision);
-- Review queue: only pending submissions (no decision yet)
CREATE INDEX idx_submissions_pending ON submissions(unit_id) WHERE review_decision IS NULL;

-- ── SUBMISSION PHOTOS ──────────────────────────────────────────────────────
CREATE INDEX idx_submission_photos_submission_id ON submission_photos(submission_id);

-- ── UNIT ASSIGNMENTS ───────────────────────────────────────────────────────
-- UNIQUE(unit_id, user_id) already creates a composite index.
CREATE INDEX idx_unit_assignments_user_id ON unit_assignments(user_id);

-- ── PROJECT NOTIFICATIONS ──────────────────────────────────────────────────
CREATE INDEX idx_project_notifications_project_id ON project_notifications(project_id);


-- ── CONTACTS (global team roster) ───────────────────────────────────────────
-- Global team roster — a company-wide, org-scoped contact directory.
-- Replaces the per-project `projectContacts` that used to live embedded in
-- projects.canvas_data (duplicated per project, not reusable). Units reference
-- a contact by id via canvas_data.units[].assigned_contact_ids.

CREATE TABLE contacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL,
  email             TEXT,
  has_whatsapp      BOOLEAN NOT NULL DEFAULT FALSE,
  has_telegram      BOOLEAN NOT NULL DEFAULT FALSE,
  country_code      TEXT NOT NULL DEFAULT '+62',
  phone             TEXT NOT NULL,
  custom_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_contacts_org_id ON contacts(org_id);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Every org member can read the roster — the map editor resolves names/links
-- for the units they can already see.
CREATE POLICY "org members see contacts" ON contacts
  FOR SELECT USING (org_id = current_user_org_id());

-- Only owners / project managers manage the roster. WITH CHECK mirrors USING so
-- a contact can never be written into another org via the FOR ALL policy.
CREATE POLICY "admins manage contacts" ON contacts
  FOR ALL
  USING (
    org_id = current_user_org_id() AND
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'project_manager')
    )
  )
  WITH CHECK (
    org_id = current_user_org_id() AND
    EXISTS (
      SELECT 1 FROM users
      WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'project_manager')
    )
  );


-- ── PROJECT TEAM MEMBERS (project ↔ contact join) ───────────────────────────
-- Project ↔ contact join: which people from the global roster are on a given
-- project. The pre-map setup screen writes this; the Map Studio "Pengawasan"
-- tab reads it (only project members are assignable to units).

CREATE TABLE project_team_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  added_by   UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, contact_id)
);

CREATE INDEX idx_project_team_members_project ON project_team_members(project_id);
CREATE INDEX idx_project_team_members_contact ON project_team_members(contact_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE project_team_members ENABLE ROW LEVEL SECURITY;

-- Any project member can see who is on the project.
CREATE POLICY "project members see team" ON project_team_members
  FOR SELECT USING (user_project_role(project_id) IS NOT NULL);

-- Only owners / project managers manage the project team.
CREATE POLICY "admins manage project team" ON project_team_members
  FOR ALL
  USING (is_project_admin(project_id))
  WITH CHECK (is_project_admin(project_id));
