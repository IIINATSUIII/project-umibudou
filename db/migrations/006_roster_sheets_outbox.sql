ALTER TABLE sheets_outbox
  DROP CONSTRAINT IF EXISTS sheets_outbox_entity_type_check;

ALTER TABLE sheets_outbox
  ADD CONSTRAINT sheets_outbox_entity_type_check
  CHECK (entity_type IN ('customer', 'reservation', 'questionnaire', 'roster'));
