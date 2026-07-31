CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_force_adjust_idempotency
  ON audit_events(event_type, target_type, target_id, idempotency_key)
  WHERE event_type = 'reservation.force_adjusted'
    AND idempotency_key IS NOT NULL;
