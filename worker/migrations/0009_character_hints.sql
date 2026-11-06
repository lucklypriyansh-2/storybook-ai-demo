-- R.3.2 Avatar editor: the look hints the parent can edit between sheet
-- versions. Stored as a JSON object on the character row so a hint is bound to
-- the exact sheet it describes (an edited look without a regenerate keeps the
-- old drawing and the new hints side by side, which is what M-14 keep/revert
-- needs). Nullable so pre-R.3.2 rows keep working and read back as `hints: null`.
ALTER TABLE characters ADD COLUMN hints TEXT;
