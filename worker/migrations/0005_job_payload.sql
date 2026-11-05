-- Per-job input carried through the queue. motion_i2v reads {shot, keyframe_key}
-- from here; the queue message itself still carries only the job id.
ALTER TABLE jobs ADD COLUMN payload TEXT;
