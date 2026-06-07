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
