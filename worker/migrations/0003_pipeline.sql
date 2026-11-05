CREATE TABLE reels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kid_id TEXT NOT NULL,
  status TEXT NOT NULL,
  tier TEXT NOT NULL,
  story TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  reel_id TEXT,
  kid_id TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  photo_id TEXT,
  consent_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_reels_user_id_created_at ON reels(user_id, created_at);
CREATE INDEX idx_jobs_status_type ON jobs(status, type);
CREATE INDEX idx_jobs_reel_id ON jobs(reel_id);
