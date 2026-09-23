-- Existing duplicate timestamps must be resolved before this migration can run.
-- Rebuild the constraint for both existing databases and fresh canonical schemas.
ALTER TABLE annotations
  DROP CONSTRAINT IF EXISTS annotations_movie_time_unique;
ALTER TABLE annotations
  ADD CONSTRAINT annotations_movie_time_unique UNIQUE (movie_id, time_seconds);
DROP INDEX IF EXISTS idx_annotations_movie_time;
ALTER TABLE annotations DROP COLUMN IF EXISTS created_at;

-- A script's page count now travels with its row, so the film's pages can state
-- the screenplay's length without downloading the PDF. Nothing recorded when
-- scripts predating this column were attached, and SQL cannot read a PDF, so
-- they are backfilled with 1 and carry that until the script is saved again.
ALTER TABLE scripts DROP COLUMN IF EXISTS created_at;
ALTER TABLE scripts
  ADD COLUMN IF NOT EXISTS page_count INT NOT NULL DEFAULT 1;
ALTER TABLE scripts ALTER COLUMN page_count DROP DEFAULT;

-- Page counts and scene anchors are both held to the length of a screenplay
-- rather than an arbitrary ceiling. Rebuild the checks by name so existing
-- databases are tightened and fresh canonical schemas stay unchanged.
ALTER TABLE scripts DROP CONSTRAINT IF EXISTS scripts_page_count_check;
ALTER TABLE scripts
  ADD CONSTRAINT scripts_page_count_check CHECK (page_count BETWEEN 1 AND 300);
ALTER TABLE captured_scenes DROP CONSTRAINT IF EXISTS captured_scenes_start_page_check;
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_start_page_check CHECK (start_page BETWEEN 1 AND 300);
ALTER TABLE captured_scenes DROP CONSTRAINT IF EXISTS captured_scenes_end_page_check;
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_end_page_check CHECK (end_page BETWEEN 1 AND 300);

-- One script per film, expressed as a constraint on the column rather than a
-- bare index, so it appears with the table's other rules.
ALTER TABLE scripts DROP CONSTRAINT IF EXISTS scripts_movie_id_key;
DROP INDEX IF EXISTS idx_scripts_movie_id_unique;
ALTER TABLE scripts ADD CONSTRAINT scripts_movie_id_key UNIQUE (movie_id);
