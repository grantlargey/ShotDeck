CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE movies (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  director TEXT NOT NULL,
  writer TEXT,
  cinematographer TEXT,
  year INT NOT NULL CHECK (year >= 1888),
  runtime_minutes INT NOT NULL CHECK (runtime_minutes > 0),
  cover_image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE annotations (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  time_seconds INT NOT NULL CHECK (time_seconds >= 0),
  image_key TEXT,
  thumb_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_annotations_movie_time ON annotations(movie_id, time_seconds);

CREATE TABLE scripts (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_scripts_movie_id_unique ON scripts(movie_id);

CREATE TABLE captured_scenes (
  id UUID PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  start_time_seconds INT NOT NULL CHECK (start_time_seconds >= 0),
  end_time_seconds INT NOT NULL CHECK (end_time_seconds >= start_time_seconds),
  start_page INT NOT NULL CHECK (start_page BETWEEN 1 AND 100000),
  start_line INT NOT NULL CHECK (start_line BETWEEN 0 AND 100000),
  start_top DOUBLE PRECISION NOT NULL
    CHECK (start_top > '-Infinity'::float8 AND start_top < 'Infinity'::float8),
  start_bottom DOUBLE PRECISION NOT NULL
    CHECK (start_bottom > '-Infinity'::float8 AND start_bottom < 'Infinity'::float8),
  start_text TEXT NOT NULL,
  end_page INT NOT NULL CHECK (end_page BETWEEN 1 AND 100000),
  end_line INT NOT NULL CHECK (end_line BETWEEN 0 AND 100000),
  end_top DOUBLE PRECISION NOT NULL
    CHECK (end_top > '-Infinity'::float8 AND end_top < 'Infinity'::float8),
  end_bottom DOUBLE PRECISION NOT NULL
    CHECK (end_bottom > '-Infinity'::float8 AND end_bottom < 'Infinity'::float8),
  end_text TEXT NOT NULL,
  scene_text TEXT NOT NULL CHECK (scene_text ~ '[^[:space:]]'),
  raw_text TEXT NOT NULL CHECK (raw_text ~ '[^[:space:]]'),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  location_start_key BIGINT
    GENERATED ALWAYS AS (start_page::bigint * 1000000 + start_line) STORED,
  location_end_key BIGINT
    GENERATED ALWAYS AS (end_page::bigint * 1000000 + end_line) STORED,
  CONSTRAINT captured_scenes_anchors_ordered
    CHECK ((start_page, start_line) <= (end_page, end_line)),
  CONSTRAINT captured_scenes_no_film_timing_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      int4range(start_time_seconds, end_time_seconds, '[)') WITH &&
    ) WHERE (start_time_seconds < end_time_seconds),
  CONSTRAINT captured_scenes_no_script_location_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      int8range(location_start_key, location_end_key, '[]') WITH &&
    )
);

CREATE INDEX captured_scenes_script_location_idx
ON captured_scenes (script_id, start_page, start_line);

CREATE INDEX captured_scenes_tags_idx ON captured_scenes USING GIN (tags);

-- Admin accounts. There is no sign-up: the owner is created by the admin CLI
-- and every other account by the owner from the site.
CREATE TABLE admin_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_admin_users_email ON admin_users (LOWER(email));

-- Browser sessions. The cookie holds a random token; only its SHA-256 is stored.
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_admin_sessions_user ON admin_sessions(user_id);
