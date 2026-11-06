-- R.1.2: catalog-generated reels reference a story template and may opt out of
-- the kid's character sheet. Both nullable/defaulted so pre-catalog rows keep working.
ALTER TABLE reels ADD COLUMN template_id TEXT;
ALTER TABLE reels ADD COLUMN use_sheet INTEGER;

-- R.5.2: per-page text overrides ("Edit this page → Save"). Additive and
-- nullable; the reel's shots.json stays the template source of truth.
CREATE TABLE IF NOT EXISTS reel_page_overrides (
  reel_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  text TEXT,
  keyframe_key TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (reel_id, "index")
);

CREATE INDEX IF NOT EXISTS idx_reel_page_overrides_reel ON reel_page_overrides(reel_id);
