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
