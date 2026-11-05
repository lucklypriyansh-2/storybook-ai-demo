-- R2 replacement for the portable (Vercel + libSQL) build. The blobs table
-- stores object bodies inline; the storage/r2-libsql.ts shim speaks the R2
-- surface on top of it so route and job code is unchanged.
CREATE TABLE IF NOT EXISTS blobs (
  key TEXT PRIMARY KEY,
  content BLOB NOT NULL,
  content_type TEXT,
  uploaded_at INTEGER NOT NULL,
  custom_meta TEXT
);

CREATE INDEX IF NOT EXISTS idx_blobs_uploaded_at ON blobs(uploaded_at);
