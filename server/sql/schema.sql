CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT NOT NULL,
  year INT NOT NULL CHECK (year >= 1888),
  runtime_minutes INT NOT NULL CHECK (runtime_minutes > 0),
  cover_image_key TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS annotations (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  time_seconds INT NOT NULL CHECK (time_seconds >= 0),
  title TEXT NOT NULL,
  body TEXT,
  image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_movie_time
ON annotations(movie_id, time_seconds);

CREATE TABLE IF NOT EXISTS scripts (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scripts_id_movie
ON scripts(id, movie_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_scripts_movie_id_unique
ON scripts(movie_id);

CREATE TABLE IF NOT EXISTS script_scene_anchors (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  script_id UUID NOT NULL,
  page_start INT CHECK (page_start IS NULL OR page_start > 0),
  page_end INT CHECK (page_end IS NULL OR page_end >= page_start),
  selected_text TEXT NOT NULL,
  raw_selected_text TEXT NOT NULL,
  formatted_selected_text TEXT,
  context_prefix TEXT,
  context_suffix TEXT,
  start_offset INT CHECK (start_offset IS NULL OR start_offset >= 0),
  end_offset INT CHECK (end_offset IS NULL OR end_offset >= start_offset),
  anchor_geometry JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_script_scene_anchors_script_movie
    FOREIGN KEY (script_id, movie_id)
    REFERENCES scripts (id, movie_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_script_scene_anchors_script_page
ON script_scene_anchors(script_id, page_start, page_end);

CREATE TABLE IF NOT EXISTS script_scene_annotations (
  id UUID PRIMARY KEY,
  anchor_id UUID NOT NULL UNIQUE REFERENCES script_scene_anchors(id) ON DELETE CASCADE,
  legacy_annotation_id UUID UNIQUE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  script_id UUID NOT NULL,
  start_time_seconds INT NOT NULL CHECK (start_time_seconds >= 0),
  end_time_seconds INT NOT NULL CHECK (end_time_seconds >= start_time_seconds),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_script_scene_annotations_script_movie
    FOREIGN KEY (script_id, movie_id)
    REFERENCES scripts (id, movie_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_script_scene_annotations_movie_script_time
ON script_scene_annotations(movie_id, script_id, start_time_seconds);

CREATE INDEX IF NOT EXISTS idx_script_scene_annotations_script_time
ON script_scene_annotations(script_id, start_time_seconds);

CREATE INDEX IF NOT EXISTS idx_script_scene_annotations_tags_gin
ON script_scene_annotations USING GIN (tags);

CREATE TABLE IF NOT EXISTS script_annotations (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  script_id UUID NOT NULL,
  start_time_seconds INT NOT NULL CHECK (start_time_seconds >= 0),
  end_time_seconds INT NOT NULL CHECK (end_time_seconds >= start_time_seconds),
  selected_text TEXT NOT NULL,
  raw_selected_text TEXT NOT NULL,
  formatted_selected_text TEXT,
  page_start INT CHECK (page_start IS NULL OR page_start > 0),
  page_end INT CHECK (page_end IS NULL OR page_end >= page_start),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_script_annotations_script_movie
    FOREIGN KEY (script_id, movie_id)
    REFERENCES scripts (id, movie_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scripts_movie_created
ON scripts(movie_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_script_annotations_movie_script_time
ON script_annotations(movie_id, script_id, start_time_seconds);

CREATE INDEX IF NOT EXISTS idx_script_annotations_script_time
ON script_annotations(script_id, start_time_seconds);

CREATE INDEX IF NOT EXISTS idx_script_annotations_tags_gin
ON script_annotations USING GIN (tags);
