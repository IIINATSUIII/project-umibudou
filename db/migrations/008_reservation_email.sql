-- Keep public booking retries and receipt delivery durable across instances.
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS public_request_key text;

CREATE UNIQUE INDEX IF NOT EXISTS reservations_public_request_key_unique
  ON reservations (public_request_key)
  WHERE public_request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS reservation_emails (
  id text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE RESTRICT,
  request_key text NOT NULL,
  recipient_email text NOT NULL,
  guest_name text NOT NULL,
  dive_date text NOT NULL,
  time_slot text NOT NULL,
  course_id text NOT NULL DEFAULT '',
  course_name text NOT NULL,
  guest_count integer NOT NULL CHECK (guest_count > 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  locked_until timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text
);

CREATE INDEX IF NOT EXISTS reservation_emails_due_idx
  ON reservation_emails (available_at, created_at, id)
  WHERE status IN ('pending', 'failed', 'sending');
