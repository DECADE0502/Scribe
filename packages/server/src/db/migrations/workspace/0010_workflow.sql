-- 0010_workflow.sql: AI 工作流暂存
CREATE TABLE workflow_runs (
  id         TEXT PRIMARY KEY,
  book_id    TEXT NOT NULL,
  source     TEXT NOT NULL,
  phase      TEXT NOT NULL DEFAULT 'thinking',
  verdict    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_workflow_runs_book ON workflow_runs(book_id, updated_at DESC);

CREATE TABLE workflow_staged_changes (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSON NOT NULL,
  committed  INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_workflow_staged_run ON workflow_staged_changes(run_id, sort_order ASC);
