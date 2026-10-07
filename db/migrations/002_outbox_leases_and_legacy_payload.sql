-- Preserve unprojected source fields during one-off imports and fence outbox leases.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS raw_legacy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS raw_legacy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE questionnaires
  ADD COLUMN IF NOT EXISTS raw_legacy jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sheets_outbox
  ADD COLUMN IF NOT EXISTS lease_token uuid;

ALTER TABLE sheets_outbox
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
