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
