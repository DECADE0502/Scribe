CREATE TABLE import_artifacts (
  id                 TEXT PRIMARY KEY,
  book_id            TEXT NOT NULL,
  source_type        TEXT NOT NULL,
  source_name        TEXT NOT NULL,
  source_filename    TEXT NOT NULL,
  raw_json           TEXT NOT NULL,
  raw_hash           TEXT NOT NULL,
  import_report_json TEXT NOT NULL,
  imported_at        INTEGER NOT NULL
);

CREATE INDEX idx_import_artifacts_book
  ON import_artifacts(book_id, imported_at DESC);

CREATE TABLE prompt_presets (
  id                       TEXT PRIMARY KEY,
  book_id                  TEXT NOT NULL,
  name                     TEXT NOT NULL,
  enabled                  INTEGER NOT NULL,
  source_import_id         TEXT,
  generation_settings_json TEXT NOT NULL,
  extensions_json          TEXT NOT NULL,
  regex_scripts_enabled    INTEGER NOT NULL,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);

CREATE INDEX idx_prompt_presets_book_enabled
  ON prompt_presets(book_id, enabled, updated_at DESC);

CREATE TABLE prompt_blocks (
  id                     TEXT PRIMARY KEY,
  preset_id              TEXT NOT NULL,
  source_identifier      TEXT NOT NULL,
  name                   TEXT NOT NULL,
  role                   TEXT NOT NULL,
  content                TEXT NOT NULL,
  enabled                INTEGER NOT NULL,
  stack_index            INTEGER,
  injection_position     INTEGER,
  injection_depth        INTEGER,
  injection_order        INTEGER,
  system_prompt          INTEGER NOT NULL,
  marker                 INTEGER NOT NULL,
  forbid_overrides       INTEGER NOT NULL,
  injection_trigger_json TEXT NOT NULL,
  source_prompt_enabled  INTEGER,
  source_order_enabled   INTEGER,
  metadata_json          TEXT NOT NULL,
  created_at             INTEGER NOT NULL,
  updated_at             INTEGER NOT NULL
);

CREATE INDEX idx_prompt_blocks_preset_stack
  ON prompt_blocks(preset_id, stack_index, source_identifier);

CREATE TABLE reader_issues (
  id               TEXT PRIMARY KEY,
  chapter_no       INTEGER NOT NULL,
  type             TEXT NOT NULL,
  severity         TEXT NOT NULL,
  note             TEXT NOT NULL,
  evidence         TEXT,
  suggested_action TEXT,
  status           TEXT NOT NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE INDEX idx_reader_issues_status_chapter
  ON reader_issues(status, chapter_no);
