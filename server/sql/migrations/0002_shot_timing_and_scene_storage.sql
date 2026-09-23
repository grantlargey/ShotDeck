-- A shot's moment is now held to a tenth of a second, and no two shots of one
-- film may share a moment. Shots that shared a second are separated by a tenth
-- in the order they were added, which leaves each of them inside the captured
-- scene it belongs to; adding a whole second to one would carry it into the
-- next scene. Ten shots fit in a second, so a fuller one stops the migration
-- here, where the reason can be stated, rather than on the constraint below.
DO $$
DECLARE crowded INT;
BEGIN
  SELECT count(*) INTO crowded FROM (
    SELECT 1 FROM annotations GROUP BY movie_id, time_seconds HAVING count(*) > 10
  ) AS crowded_seconds;
  IF crowded > 0 THEN
    RAISE EXCEPTION 'A tenth of a second cannot separate more than ten shots, and % second(s) hold more', crowded;
  END IF;
END $$;

ALTER TABLE annotations
  DROP CONSTRAINT IF EXISTS annotations_movie_time_unique;
DROP INDEX IF EXISTS idx_annotations_movie_time;
ALTER TABLE annotations
  ALTER COLUMN time_seconds TYPE NUMERIC(7,1) USING time_seconds::numeric(7,1);

-- Only a database that still records when a shot was added has shots sharing a
-- second to separate, and their upload order is the only record of which came
-- first. A fresh canonical schema has neither, and needs neither.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'annotations' AND column_name = 'created_at'
  ) THEN
    EXECUTE $sql$
      UPDATE annotations a
      SET time_seconds = a.time_seconds + (ordered.seq - 1) * 0.1
      FROM (
        SELECT id,
               row_number() OVER (PARTITION BY movie_id, time_seconds ORDER BY created_at, id) AS seq
        FROM annotations
      ) AS ordered
      WHERE ordered.id = a.id AND ordered.seq > 1
    $sql$;
  END IF;
END $$;

ALTER TABLE annotations DROP COLUMN IF EXISTS created_at;
ALTER TABLE annotations
  ADD CONSTRAINT annotations_movie_time_unique UNIQUE (movie_id, time_seconds);

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

-- A scene anchor is now a page and one y: the baseline of a text line, in PDF
-- points. Line boxes overlap their neighbours by design (ascent plus descent
-- exceeds the leading), so a stored top and bottom made ordering and adjacency
-- ambiguous; baselines do not overlap, so one value per anchor is exact and the
-- line number, the second y and the anchor snippets are all redundant.
-- Existing anchors carry their baseline inside the box they stored:
-- baseline = top + ascent/(ascent + descent) * (bottom - top).
ALTER TABLE captured_scenes
  DROP CONSTRAINT IF EXISTS captured_scenes_no_script_location_overlap;
ALTER TABLE captured_scenes
  DROP CONSTRAINT IF EXISTS captured_scenes_no_film_timing_overlap;
ALTER TABLE captured_scenes DROP CONSTRAINT IF EXISTS captured_scenes_anchors_ordered;
DROP INDEX IF EXISTS captured_scenes_script_location_idx;

ALTER TABLE captured_scenes
  ADD COLUMN IF NOT EXISTS start_y NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS end_y NUMERIC(5,1);

-- Only a database that still has the old anchor columns has anything to carry
-- over; a fresh canonical schema already stores baselines.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'captured_scenes' AND column_name = 'start_top'
  ) THEN
    EXECUTE $sql$
      UPDATE captured_scenes
      SET start_y = LEAST(1000, GREATEST(0, round((start_top + (start_bottom - start_top) * 0.82 / 1.06)::numeric, 1))),
          end_y = LEAST(1000, GREATEST(0, round((end_top + (end_bottom - end_top) * 0.82 / 1.06)::numeric, 1)))
      WHERE start_y IS NULL OR end_y IS NULL
    $sql$;
  END IF;
END $$;

ALTER TABLE captured_scenes
  ALTER COLUMN start_y SET NOT NULL,
  ALTER COLUMN end_y SET NOT NULL;

-- The line number, the second y of each anchor and the anchor snippets are all
-- derivable from the PDF, and the document position they fed is computed in the
-- overlap constraint's index instead of being stored. Raw text is the capture
-- the client recomputes from the PDF on every open, and nothing reads the
-- stored copy. Scene timestamps are no longer kept: script search orders by
-- film title and time.
ALTER TABLE captured_scenes
  DROP COLUMN IF EXISTS location_start_key,
  DROP COLUMN IF EXISTS location_end_key,
  DROP COLUMN IF EXISTS start_line,
  DROP COLUMN IF EXISTS start_top,
  DROP COLUMN IF EXISTS start_bottom,
  DROP COLUMN IF EXISTS start_text,
  DROP COLUMN IF EXISTS end_line,
  DROP COLUMN IF EXISTS end_top,
  DROP COLUMN IF EXISTS end_bottom,
  DROP COLUMN IF EXISTS end_text,
  DROP COLUMN IF EXISTS raw_text,
  DROP COLUMN IF EXISTS created_at,
  DROP COLUMN IF EXISTS updated_at;

ALTER TABLE captured_scenes DROP CONSTRAINT IF EXISTS captured_scenes_start_y_check;
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_start_y_check CHECK (start_y BETWEEN 0 AND 1000);
ALTER TABLE captured_scenes DROP CONSTRAINT IF EXISTS captured_scenes_end_y_check;
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_end_y_check CHECK (end_y BETWEEN 0 AND 1000);
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_anchors_ordered
    CHECK ((start_page, start_y) <= (end_page, end_y));

-- Scenes of one script may no longer share a second of film timing. Stored
-- scenes that touch must be separated before this migration can run: a still on
-- the shared second would otherwise belong to both of them.
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_no_film_timing_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      int8range(start_time_seconds, end_time_seconds, '[]') WITH &&
    );
ALTER TABLE captured_scenes
  ADD CONSTRAINT captured_scenes_no_script_location_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      numrange(start_page::numeric * 1000 + start_y, end_page::numeric * 1000 + end_y, '[]') WITH &&
    );

CREATE INDEX captured_scenes_script_location_idx
ON captured_scenes (script_id, start_page, start_y);
