-- Issue #97: a guest's cancellation request is stored separately from the
-- reservation status. Staff approval moves the reservation to cancelled;
-- a pending request alone never changes the status.

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS cancellation_request_status text,
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_request_note text,
  ADD COLUMN IF NOT EXISTS cancellation_request_resolved_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reservations_cancellation_request_status_check'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_cancellation_request_status_check
      CHECK (cancellation_request_status IS NULL OR cancellation_request_status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS reservations_pending_cancellation_request_idx
  ON reservations (cancellation_requested_at)
  WHERE cancellation_request_status = 'pending';
