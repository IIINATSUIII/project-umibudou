ALTER TABLE questionnaires
  ADD COLUMN IF NOT EXISTS last_dive_period text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS medical_certificate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doctor_clearance text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS staff_check_status text NOT NULL DEFAULT '未確認',
  ADD COLUMN IF NOT EXISTS staff_check_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS submission_state text NOT NULL DEFAULT 'pending';

ALTER TABLE questionnaires
  ALTER COLUMN total_dives DROP NOT NULL;

ALTER TABLE customers
  ALTER COLUMN total_dives DROP NOT NULL;

UPDATE questionnaires
SET sleep_category = COALESCE(NULLIF(questionnaires.raw_legacy ->> 'sleepCategory', ''), questionnaires.sleep_category),
    last_dive_period = COALESCE(
      NULLIF(questionnaires.raw_legacy ->> 'lastDivePeriod', ''),
      NULLIF(questionnaires.last_dive_date, ''),
      ''
    ),
    medical_certificate = CASE lower(questionnaires.raw_legacy ->> 'medicalCertificate')
      WHEN 'true' THEN true
      WHEN '1' THEN true
      WHEN 'yes' THEN true
      WHEN 'はい' THEN true
      ELSE false
    END,
    doctor_clearance = COALESCE(
      NULLIF(questionnaires.raw_legacy ->> 'doctorClearance', ''),
      NULLIF(questionnaires.raw_legacy ->> 'doctorDivingPermit', ''),
      questionnaires.doctor_diving_permit
    ),
    staff_check_status = COALESCE(NULLIF(questionnaires.raw_legacy ->> 'staffCheckStatus', ''), '未確認'),
    staff_check_note = COALESCE(questionnaires.raw_legacy ->> 'staffCheckNote', ''),
    submission_state = CASE
      WHEN reservations.questionnaire_completed
        OR reservations.questionnaire_id = questionnaires.id
        OR questionnaires.id = ANY(string_to_array(COALESCE(reservations.questionnaire_ids, ''), '|'))
      THEN 'complete'
      ELSE 'pending'
    END
FROM reservations
WHERE reservations.id = questionnaires.reservation_id;

ALTER TABLE questionnaires
  ALTER COLUMN submission_state SET DEFAULT 'complete';
