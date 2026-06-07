-- ── SECURITY HELPER FUNCTIONS ──────────────────────────────────────────────
-- These use SECURITY DEFINER to bypass RLS when needed inside other RLS
-- policies, preventing recursive evaluation and read-your-own-writes issues.

-- Returns the current user's role from the users table (pre-update snapshot).
-- Used in the users UPDATE WITH CHECK to prevent self-role escalation.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE id = (SELECT auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Returns the current user's org_id (pre-update snapshot).
-- Used in the users UPDATE WITH CHECK to prevent org hijacking.
CREATE OR REPLACE FUNCTION current_user_org_id_snapshot()
RETURNS UUID AS $$
  SELECT org_id FROM users WHERE id = (SELECT auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Verifies that the immutable core fields of a submission have not been
-- changed by a koordinator/PM UPDATE (only review fields should change).
CREATE OR REPLACE FUNCTION submission_core_unchanged(
  p_id              UUID,
  p_unit_id         UUID,
  p_submitted_by    UUID,
  p_stage_number    INTEGER,
  p_subtasks_checked INTEGER[]
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM submissions
    WHERE id              = p_id
      AND unit_id         = p_unit_id
      AND submitted_by    = p_submitted_by
      AND stage_number    = p_stage_number
      AND subtasks_checked = p_subtasks_checked
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ── PROGRESS FUNCTIONS ─────────────────────────────────────────────────────

-- Recomputes progress_pct for a unit based on approved subtask counts
CREATE OR REPLACE FUNCTION compute_unit_progress(p_unit_id UUID)
RETURNS NUMERIC AS $$
DECLARE
  v_total_subtasks  INTEGER;
  v_approved        INTEGER;
BEGIN
  SELECT st.total_subtasks INTO v_total_subtasks
  FROM units u
  JOIN spk_templates st ON u.spk_template_id = st.id
  WHERE u.id = p_unit_id;

  SELECT COALESCE(SUM(array_length(subtasks_checked, 1)), 0) INTO v_approved
  FROM submissions
  WHERE unit_id = p_unit_id AND review_decision = 'approved';

  IF v_total_subtasks IS NULL OR v_total_subtasks = 0 THEN
    RETURN 0;
  END IF;

  RETURN ROUND((v_approved::NUMERIC / v_total_subtasks) * 100, 2);
END;
$$ LANGUAGE plpgsql;

-- Fires after koordinator sets review_decision — updates progress and status
CREATE OR REPLACE FUNCTION trigger_update_unit_progress()
RETURNS TRIGGER AS $$
DECLARE
  v_progress NUMERIC;
BEGIN
  v_progress := compute_unit_progress(NEW.unit_id);

  UPDATE units
  SET
    progress_pct = v_progress,
    status = CASE
      WHEN v_progress >= 100 THEN 'completed'
      WHEN NEW.review_decision IS NULL THEN 'pending_review'
      ELSE 'in_progress'
    END
  WHERE id = NEW.unit_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER submissions_progress_update
  AFTER UPDATE OF review_decision ON submissions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_update_unit_progress();
