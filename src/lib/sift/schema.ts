export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  raw_filename TEXT,
  raw_sha256 TEXT,
  byte_length INTEGER,
  mime TEXT,
  parser TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  raw_retained INTEGER NOT NULL DEFAULT 0,
  raw_backend TEXT,
  conversation_count INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  manifest_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_conversation_id TEXT,
  title TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT,
  imported_at TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  pinned INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'active',
  summary TEXT NOT NULL DEFAULT '',
  content_sha256 TEXT NOT NULL,
  processing_stage TEXT NOT NULL DEFAULT 'imported',
  parser TEXT,
  parser_version TEXT,
  current_source_node_id TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_hash ON conversations(content_sha256);
CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations(state);
CREATE INDEX IF NOT EXISTS idx_conversations_source ON conversations(source_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  source_message_id TEXT,
  parent_source_id TEXT,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT,
  sort_index INTEGER NOT NULL,
  is_on_current_path INTEGER NOT NULL DEFAULT 1,
  content_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, sort_index);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT,
  conversation_id TEXT,
  source_attachment_id TEXT,
  kind TEXT NOT NULL,
  filename TEXT,
  mime TEXT,
  sha256 TEXT,
  url TEXT,
  bytes_len INTEGER,
  availability TEXT NOT NULL DEFAULT 'unavailable',
  local_key TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (message_id) REFERENCES messages(id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  score REAL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rel_from ON relationships(from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relationships(to_id);
CREATE INDEX IF NOT EXISTS idx_rel_kind ON relationships(kind);

CREATE TABLE IF NOT EXISTS knowledge_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  source_type TEXT NOT NULL,
  text TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  valid_from TEXT,
  valid_until TEXT,
  superseded_by TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  owner_kind TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  kind TEXT NOT NULL,
  model_id TEXT,
  prompt_version TEXT,
  analysis_version TEXT,
  content_sha256 TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS processing_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor TEXT,
  total INTEGER,
  done_count INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;
