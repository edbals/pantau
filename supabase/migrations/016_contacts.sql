-- Global team roster — a company-wide, org-scoped contact directory.
-- Replaces the per-project `projectContacts` that used to live embedded in
-- projects.canvas_data (duplicated per project, not reusable). Units reference
-- a contact by id via canvas_data.units[].assigned_contact_ids.

CREATE TABLE contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  role         TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'whatsapp' CHECK (platform IN ('whatsapp', 'telegram')),
  country_code TEXT NOT NULL DEFAULT '+62',
  phone        TEXT NOT NULL,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
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
