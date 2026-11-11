-- Shared reception queue. Contains references only; QR tokens and health data stay in questionnaires.
CREATE TABLE IF NOT EXISTS checkin_handoffs (
  id uuid PRIMARY KEY,
  questionnaire_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS checkin_handoffs_expiry_idx ON checkin_handoffs(expires_at);
