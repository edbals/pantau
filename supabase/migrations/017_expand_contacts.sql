-- Expand the global team roster (contacts) to back a future Notion-style
-- data-grid. Three changes:
--   1. email            — optional email address.
--   2. has_whatsapp /    — replace the single `platform` choice with two flags
--      has_telegram        so one contact's number can be reachable on BOTH
--                          WhatsApp and Telegram simultaneously.
--   3. custom_attributes — open JSONB bag for arbitrary user-defined columns.

ALTER TABLE contacts ADD COLUMN email             TEXT;
ALTER TABLE contacts ADD COLUMN has_whatsapp      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN has_telegram      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE contacts ADD COLUMN custom_attributes JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- Backfill the new flags from the old single-platform column before dropping it.
UPDATE contacts SET has_whatsapp = TRUE WHERE platform = 'whatsapp';
UPDATE contacts SET has_telegram = TRUE WHERE platform = 'telegram';

ALTER TABLE contacts DROP COLUMN platform;
