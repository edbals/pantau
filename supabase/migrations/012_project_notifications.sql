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
