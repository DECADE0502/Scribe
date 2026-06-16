CREATE TABLE worldbook_entries (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  enabled             INTEGER NOT NULL,
  activation          TEXT NOT NULL,
  keys_json           TEXT NOT NULL,
  secondary_keys_json TEXT NOT NULL,
  constant            INTEGER NOT NULL,
  priority            INTEGER NOT NULL,
  insertion_depth     INTEGER NOT NULL,
  recursive           INTEGER NOT NULL,
  recursion_limit     INTEGER NOT NULL,
  token_budget        INTEGER,
  category            TEXT,
  metadata_json       TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX idx_worldbook_enabled_priority
  ON worldbook_entries(enabled, priority DESC, updated_at DESC);
