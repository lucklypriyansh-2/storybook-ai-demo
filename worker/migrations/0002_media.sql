CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  kid_id TEXT NOT NULL,
  sheet_r2_key TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE photos_tmp (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE INDEX idx_characters_kid_id ON characters(kid_id);
CREATE INDEX idx_photos_tmp_created_at ON photos_tmp(created_at);
