ALTER TABLE availability_rules ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0;

UPDATE availability_rules
SET is_system = 1
WHERE id IN ('rule-activity-lunch-weekday', 'rule-502-tuesday-all-day');

CREATE INDEX IF NOT EXISTS idx_rules_target_time_enabled
  ON availability_rules(enabled, target_type, target_id, start, end);
