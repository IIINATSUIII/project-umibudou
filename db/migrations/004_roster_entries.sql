CREATE TABLE IF NOT EXISTS roster_entries (
  id text PRIMARY KEY,
  dive_date text NOT NULL,
  reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  questionnaire_id text NOT NULL UNIQUE REFERENCES questionnaires(id) ON DELETE RESTRICT,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  name text NOT NULL,
  name_kana text NOT NULL,
  birth_date text NOT NULL,
  age integer NOT NULL CHECK (age >= 0),
  gender text NOT NULL,
  address text NOT NULL,
  phone text NOT NULL,
  emergency_contact text NOT NULL,
  emergency_phone text NOT NULL,
  course text NOT NULL,
  staff_name text NOT NULL DEFAULT '',
  checked_in_at timestamptz NOT NULL,
  check_in_method text NOT NULL CHECK (check_in_method IN ('QR読取', '手動照合'))
);

CREATE INDEX IF NOT EXISTS roster_entries_dive_date_checked_in_idx
  ON roster_entries (dive_date, checked_in_at DESC);
