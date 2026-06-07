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
