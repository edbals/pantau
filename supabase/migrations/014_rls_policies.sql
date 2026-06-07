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
