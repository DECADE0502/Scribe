-- 本书基础信息
CREATE TABLE book_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 通用骨架:角色卡
CREATE TABLE characters (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT,
  base_data     JSON,
  current_state JSON,
  appearances   JSON,
  updated_at    INTEGER
);

-- 通用骨架:大纲(可嵌套树)
CREATE TABLE outline_nodes (
  id          TEXT PRIMARY KEY,
  parent_id   TEXT,
  level       TEXT,
  title       TEXT,
  summary     TEXT,
  status      TEXT,
  sort_order  INTEGER,
  metadata    JSON
);
CREATE INDEX idx_outline_parent ON outline_nodes(parent_id);

-- 通用骨架:伏笔
CREATE TABLE foreshadowing (
  id                 TEXT PRIMARY KEY,
  label              TEXT NOT NULL,
  description        TEXT,
  planted_chapter    INTEGER,
  paid_chapter       INTEGER,
  status             TEXT,
  related_characters JSON
);
CREATE INDEX idx_foreshadowing_status ON foreshadowing(status);

-- 通用骨架:时间线
CREATE TABLE timeline_events (
  id           TEXT PRIMARY KEY,
  chapter_no   INTEGER,
  story_time   TEXT,
  event        TEXT,
  participants JSON
);

-- 题材专属板块
CREATE TABLE genre_sections (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  schema     JSON,
  created_by TEXT,
  created_at INTEGER
);

CREATE TABLE genre_section_items (
  id         TEXT PRIMARY KEY,
  section_id TEXT NOT NULL,
  data       JSON NOT NULL,
  updated_at INTEGER,
  FOREIGN KEY (section_id) REFERENCES genre_sections(id)
);
CREATE INDEX idx_genre_section_items_section ON genre_section_items(section_id);

-- 章节摘要(三层)
CREATE TABLE chapter_summaries (
  chapter_no        INTEGER PRIMARY KEY,
  one_liner         TEXT,
  paragraph         TEXT,
  key_events        JSON,
  generated_at      INTEGER,
  reasoning_content TEXT
);

-- 章节版本(撤销/历史)
CREATE TABLE chapter_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_no INTEGER NOT NULL,
  version_no INTEGER NOT NULL,
  source     TEXT,
  content_md TEXT,
  created_at INTEGER
);
CREATE INDEX idx_chapter_versions_no ON chapter_versions(chapter_no, version_no DESC);

-- 章节审查报告
CREATE TABLE chapter_audits (
  chapter_no  INTEGER PRIMARY KEY,
  verdict     TEXT,
  issues      JSON,
  audit_model TEXT,
  audited_at  INTEGER
);

-- 对话流
CREATE TABLE conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT,
  content    TEXT,
  metadata   JSON,
  created_at INTEGER
);
CREATE INDEX idx_conversations_created ON conversations(created_at);

-- Token 用量
CREATE TABLE token_usage (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_type         TEXT,
  model             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cached_tokens     INTEGER,
  reasoning_tokens  INTEGER,
  cost_usd          REAL,
  chapter_no        INTEGER,
  created_at        INTEGER
);
CREATE INDEX idx_token_usage_chapter ON token_usage(chapter_no);
