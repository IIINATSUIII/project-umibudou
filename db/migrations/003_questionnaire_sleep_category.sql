ALTER TABLE questionnaires
  ADD COLUMN IF NOT EXISTS sleep_category text NOT NULL DEFAULT '';

ALTER TABLE questionnaires
  ALTER COLUMN sleep_hours DROP NOT NULL;

UPDATE questionnaires
SET sleep_category = CASE
  WHEN sleep_hours >= 6 THEN '6時間以上'
  WHEN sleep_hours >= 4 THEN '4時間以上6時間未満'
  WHEN sleep_hours > 0 THEN '4時間未満'
  ELSE ''
END
WHERE sleep_category = '';
