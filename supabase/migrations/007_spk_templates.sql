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
