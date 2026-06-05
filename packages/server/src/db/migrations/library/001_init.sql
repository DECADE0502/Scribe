CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  total_cost_usd REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_books_updated ON books(updated_at DESC);
