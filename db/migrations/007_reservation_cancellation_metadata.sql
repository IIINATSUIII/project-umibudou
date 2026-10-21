-- Issue #79: keep the cancellation phase and evidence as structured data.
-- Existing cancelled reservations remain NULL because their phase cannot be
-- inferred safely from the current status alone.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancellation_phase text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reservations_cancellation_phase_check'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_cancellation_phase_check
      CHECK (cancellation_phase IS NULL OR cancellation_phase IN ('before', 'after'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reservations_cancellation_phase_idx
  ON reservations (cancellation_phase, cancelled_at);
