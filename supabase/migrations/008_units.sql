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
