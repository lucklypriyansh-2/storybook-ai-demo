-- R.1.2 Catalog data model (admin-curated story templates).
-- All seeded titles/descriptions/covers are PLACEHOLDER sample content, owned
-- and editable by the operator inside this product. No licensed IP is imported.
CREATE TABLE IF NOT EXISTS story_templates (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  cover_key TEXT,
  description TEXT,
  age_band TEXT NOT NULL DEFAULT '3-5',
  tier_default TEXT NOT NULL DEFAULT 'free',
  page_count INTEGER NOT NULL DEFAULT 6,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- `index` is a SQL keyword, so it is always double-quoted.
CREATE TABLE IF NOT EXISTS story_template_shots (
  template_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  caption_prompt TEXT NOT NULL,
  keyframe_prompt TEXT,
  PRIMARY KEY (template_id, "index")
);

CREATE INDEX IF NOT EXISTS idx_story_templates_enabled ON story_templates(enabled);

INSERT OR IGNORE INTO story_templates (id, slug, title, cover_key, description, age_band, tier_default, page_count, enabled, created_at, updated_at) VALUES
  ('tpl_lighthouse_mouse', 'lighthouse-mouse', '{name} and the Lighthouse Mouse', 'local:reel-ocean.jpg', 'PLACEHOLDER sample story. A tiny mouse keeps the lighthouse lamp lit on a foggy night. Admin-editable; no licensed content.', '3-5', 'free', 6, 1, 1762000000000, 1762000000000),
  ('tpl_pebble_pyjamas', 'pebble-pyjamas', '{name}''s Pebble Pyjama Party', 'local:reel-birthday.jpg', 'PLACEHOLDER sample story. Pebble the pebble hosts a very sleepy pyjama party. Admin-editable; no licensed content.', '3-5', 'free', 5, 1, 1762000000000, 1762000000000),
  ('tpl_cloud_whale', 'cloud-whale', '{name} and the Cloud Whale', 'local:spread-02-whale.jpg', 'PLACEHOLDER sample story. A whale made of cloud drifts over the bedtime town. Admin-editable; no licensed content.', '5-7', 'free', 6, 1, 1762000000000, 1762000000000);

INSERT OR IGNORE INTO story_template_shots (template_id, "index", caption_prompt, keyframe_prompt) VALUES
  ('tpl_lighthouse_mouse', 1, '{name} meets a tiny mouse by the harbour wall.', 'storybook illustration, {name} and a tiny grey mouse, harbour at dusk, soft watercolour'),
  ('tpl_lighthouse_mouse', 2, 'The lighthouse lamp flickers and the fog rolls in.', 'storybook illustration, tall lighthouse, thick fog, glowing lamp, muted blues'),
  ('tpl_lighthouse_mouse', 3, 'The mouse climbs the winding stairs with a match.', 'storybook illustration, spiral stone stairs, tiny mouse carrying a match, warm light'),
  ('tpl_lighthouse_mouse', 4, '{name} lifts the mouse up to the great lamp.', 'storybook illustration, {name} gently lifting a mouse, giant brass lamp, golden glow'),
  ('tpl_lighthouse_mouse', 5, 'The lamp blazes and the little boats find their way home.', 'storybook illustration, bright lighthouse beam over calm sea, small boats, night sky'),
  ('tpl_lighthouse_mouse', 6, '{name} and the mouse wave goodnight from the tower.', 'storybook illustration, {name} and mouse waving from lighthouse top, stars, cosy ending'),
  ('tpl_pebble_pyjamas', 1, '{name} finds a smooth pebble that says hello.', 'storybook illustration, {name} holding a smiling pebble, sunny beach'),
  ('tpl_pebble_pyjamas', 2, 'Pebble invites every stone to a pyjama party.', 'storybook illustration, row of pebbles in tiny pyjamas, seaside, playful'),
  ('tpl_pebble_pyjamas', 3, 'They roll down the hill and land in a pillow pile.', 'storybook illustration, pebbles tumbling into pillows, soft pastel colours'),
  ('tpl_pebble_pyjamas', 4, '{name} reads the sleepiest goodnight story.', 'storybook illustration, {name} reading a book to pebbles, lantern light'),
  ('tpl_pebble_pyjamas', 5, 'Everyone snores gently as the moon rises.', 'storybook illustration, sleeping pebbles and moon, calm night, gentle ending'),
  ('tpl_cloud_whale', 1, '{name} spots a whale swimming through the clouds.', 'storybook illustration, {name} looking up at a cloud whale, evening sky'),
  ('tpl_cloud_whale', 2, 'The whale lowers a rope of mist for a ride.', 'storybook illustration, whale made of cloud with a misty rope ladder'),
  ('tpl_cloud_whale', 3, 'They sail over rooftops where the lamps are being lit.', 'storybook illustration, cloud whale over town rooftops, lit windows, dusk'),
  ('tpl_cloud_whale', 4, 'The whale hums a low song only children can hear.', 'storybook illustration, whalesong ripples in the sky, {name} listening'),
  ('tpl_cloud_whale', 5, 'A sleepy star climbs aboard and curls up tight.', 'storybook illustration, small star curling up on a cloud whale, soft glow'),
  ('tpl_cloud_whale', 6, 'The whale sets {name} down, right onto the pillow.', 'storybook illustration, {name} landing softly on a pillow, cosy bedroom');
