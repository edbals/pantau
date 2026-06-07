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
