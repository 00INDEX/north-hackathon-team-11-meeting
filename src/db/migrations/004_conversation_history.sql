CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  request_id TEXT,
  parsed_intent TEXT,
  actions TEXT,
  result TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_order
  ON conversation_messages(conversation_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_messages_request_role
  ON conversation_messages(conversation_id, request_id, role)
  WHERE request_id IS NOT NULL;
