-- Core PostgreSQL schema. Existing Sheets/JSON data is intentionally not changed
-- by this migration; import is a separate, explicit operation.

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  last_name text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name_kana text NOT NULL DEFAULT '',
  first_name_kana text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  last_visit text NOT NULL DEFAULT '',
  visit_count integer NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  has_c_card boolean NOT NULL DEFAULT false,
  c_card_type text NOT NULL DEFAULT '',
  total_dives integer NOT NULL DEFAULT 0 CHECK (total_dives >= 0),
  health_notes text NOT NULL DEFAULT '',
  guide_notes text NOT NULL DEFAULT '',
  registered_at timestamptz,
  updated_at timestamptz,
  birth_date text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT 'undisclosed',
  postal_code text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  emergency_name text NOT NULL DEFAULT '',
  emergency_relation text NOT NULL DEFAULT '',
  emergency_phone text NOT NULL DEFAULT '',
  c_card_org text NOT NULL DEFAULT '',
  last_dive_date text NOT NULL DEFAULT '',
  last_dive_period text NOT NULL DEFAULT '',
  dm_consent text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  created_at timestamptz,
  updated_at timestamptz,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  guest_name text NOT NULL DEFAULT '',
  guest_phone text NOT NULL DEFAULT '',
  guest_email text,
  dive_date text NOT NULL,
  time text NOT NULL DEFAULT '',
  time_slot text NOT NULL DEFAULT 'unspecified',
  course_id text,
  course_name text NOT NULL DEFAULT '',
  guest_count integer NOT NULL DEFAULT 1 CHECK (guest_count >= 0),
  channel text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'STS-01',
  staff_id text,
  staff_name text,
  questionnaire_id text,
  questionnaire_ids text NOT NULL DEFAULT '',
  questionnaire_token text UNIQUE,
  questionnaire_token_expires_at timestamptz,
  questionnaire_completed boolean NOT NULL DEFAULT false,
  dive_point text,
  staff_note text
);

CREATE TABLE IF NOT EXISTS questionnaires (
  id text PRIMARY KEY,
  reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  submission_id text UNIQUE,
  submitted_at timestamptz NOT NULL,
  last_name text NOT NULL DEFAULT '',
  first_name text NOT NULL DEFAULT '',
  last_name_kana text NOT NULL DEFAULT '',
  first_name_kana text NOT NULL DEFAULT '',
  birth_date text NOT NULL DEFAULT '',
  gender text NOT NULL DEFAULT '',
  postal_code text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  emergency_name text NOT NULL DEFAULT '',
  emergency_relation text NOT NULL DEFAULT '',
  emergency_phone text NOT NULL DEFAULT '',
  heart_disease boolean NOT NULL DEFAULT false,
  high_blood_pressure boolean NOT NULL DEFAULT false,
  respiratory_disease boolean NOT NULL DEFAULT false,
  ear_disease boolean NOT NULL DEFAULT false,
  epilepsy boolean NOT NULL DEFAULT false,
  diabetes boolean NOT NULL DEFAULT false,
  pregnant boolean NOT NULL DEFAULT false,
  panic_disorder boolean NOT NULL DEFAULT false,
  medication boolean NOT NULL DEFAULT false,
  medication_name text NOT NULL DEFAULT '',
  latex_allergy boolean NOT NULL DEFAULT false,
  sleep_hours numeric NOT NULL DEFAULT 0,
  alcohol_last_night boolean NOT NULL DEFAULT false,
  alcohol_today boolean NOT NULL DEFAULT false,
  condition text NOT NULL DEFAULT '',
  condition_details text NOT NULL DEFAULT '',
  flight_within_48h boolean NOT NULL DEFAULT false,
  has_c_card boolean NOT NULL DEFAULT false,
  c_card_type text NOT NULL DEFAULT '',
  c_card_org text NOT NULL DEFAULT '',
  last_dive_date text NOT NULL DEFAULT '',
  total_dives integer NOT NULL DEFAULT 0 CHECK (total_dives >= 0),
  agree_risk boolean NOT NULL DEFAULT false,
  agree_medical boolean NOT NULL DEFAULT false,
  agree_photo boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  qr_token text UNIQUE,
  qr_expires_at timestamptz,
  qr_used boolean NOT NULL DEFAULT false,
  doctor_diving_permit text NOT NULL DEFAULT '',
  staff_review_status text NOT NULL DEFAULT '',
  staff_review_notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS questionnaires_reservation_submitted_idx
  ON questionnaires (reservation_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS questionnaires_customer_submitted_idx
  ON questionnaires (customer_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS reservations_date_status_idx
  ON reservations (dive_date, status);

-- visit_count is incremented once per customer/reservation pair. This durable
-- marker replaces the comma-delimited in-row marker during the adapter cutover.
CREATE TABLE IF NOT EXISTS customer_reservation_counts (
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  reservation_id text NOT NULL REFERENCES reservations(id) ON DELETE RESTRICT,
  counted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, reservation_id)
);

-- Durable reference-only queue for optional Sheets mirroring. The worker loads
-- the latest projection from the canonical tables when dispatching an event.
CREATE TABLE IF NOT EXISTS sheets_outbox (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'reservation', 'questionnaire')),
  entity_id text NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  locked_until timestamptz,
  delivered_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS sheets_outbox_pending_idx
  ON sheets_outbox (available_at, id)
  WHERE delivered_at IS NULL;
