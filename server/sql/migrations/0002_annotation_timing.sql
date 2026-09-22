-- Existing duplicate timestamps must be resolved before this migration can run.
-- Rebuild the constraint for both existing databases and fresh canonical schemas.
ALTER TABLE annotations
  DROP CONSTRAINT IF EXISTS annotations_movie_time_unique;
ALTER TABLE annotations
  ADD CONSTRAINT annotations_movie_time_unique UNIQUE (movie_id, time_seconds);
DROP INDEX IF EXISTS idx_annotations_movie_time;
ALTER TABLE annotations DROP COLUMN IF EXISTS created_at;
