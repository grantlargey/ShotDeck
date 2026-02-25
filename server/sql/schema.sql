CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT NOT NULL,
  year INT NOT NULL,
  runtime_minutes INT NOT NULL,
  cover_image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  time_seconds INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_movie_time
ON annotations(movie_id, time_seconds);