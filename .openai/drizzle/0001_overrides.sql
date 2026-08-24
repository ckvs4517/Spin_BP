CREATE TABLE IF NOT EXISTS overrides (
  source_id TEXT PRIMARY KEY,
  hidden INTEGER NOT NULL DEFAULT 0,
  custom_name TEXT,
  note TEXT,
  custom_image_key TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_overrides_updated_at
  ON overrides(updated_at DESC);
