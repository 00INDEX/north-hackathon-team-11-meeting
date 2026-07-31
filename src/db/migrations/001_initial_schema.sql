CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  location TEXT NOT NULL,
  equipment_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  open_start TEXT NOT NULL DEFAULT '08:00',
  open_end TEXT NOT NULL DEFAULT '22:00',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_resources (
  room_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, resource_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  room_id TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancelled_reason TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT,
  CHECK (start < end),
  CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_idempotency_key
  ON reservations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS reservation_resources (
  reservation_id TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  room_id TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (reservation_id, resource_id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE RESTRICT,
  CHECK (start < end)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservation_resources_no_overlap
  ON reservation_resources(resource_id, start, end, reservation_id)
  WHERE resource_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS availability_rules (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('room', 'resource')),
  target_id TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK (rule_type IN ('open_hours', 'periodic_block', 'one_time_block')),
  reason TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  recurrence TEXT,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start < end)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  CHECK (idempotency_key IS NULL OR length(idempotency_key) > 0)
);

CREATE INDEX IF NOT EXISTS idx_reservations_room_time
  ON reservations(room_id, start, end);

CREATE INDEX IF NOT EXISTS idx_reservations_status_time
  ON reservations(status, start, end);

CREATE INDEX IF NOT EXISTS idx_rules_target_time
  ON availability_rules(target_type, target_id, start, end);

CREATE INDEX IF NOT EXISTS idx_audit_target
  ON audit_events(target_type, target_id, created_at);
