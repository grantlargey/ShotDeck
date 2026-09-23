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
  -- A shot's moment in the film, to a tenth of a second. Two shots in the same
  -- second are told apart by their tenth rather than by pushing one of them
  -- into the next second, which would move it into the next captured scene.
  time_seconds NUMERIC(7,1) NOT NULL CHECK (time_seconds >= 0),
  image_key TEXT,
  thumb_key TEXT,
  CONSTRAINT annotations_movie_time_unique UNIQUE (movie_id, time_seconds)
);

CREATE TABLE scripts (
  id UUID PRIMARY KEY,
  movie_id UUID NOT NULL UNIQUE REFERENCES movies(id) ON DELETE CASCADE,
  s3_key TEXT NOT NULL,
  page_count INT NOT NULL CHECK (page_count BETWEEN 1 AND 300)
);

CREATE TABLE captured_scenes (
  id UUID PRIMARY KEY,
  script_id UUID NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  start_time_seconds INT NOT NULL CHECK (start_time_seconds >= 0),
  end_time_seconds INT NOT NULL CHECK (end_time_seconds >= start_time_seconds),
  start_page INT NOT NULL CHECK (start_page BETWEEN 1 AND 300),
  start_y NUMERIC(5,1) NOT NULL CHECK (start_y BETWEEN 0 AND 1000),
  end_page INT NOT NULL CHECK (end_page BETWEEN 1 AND 300),
  end_y NUMERIC(5,1) NOT NULL CHECK (end_y BETWEEN 0 AND 1000),
  scene_text TEXT NOT NULL CHECK (scene_text ~ '[^[:space:]]'),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tags) = 'array'),
  CONSTRAINT captured_scenes_anchors_ordered
    CHECK ((start_page, start_y) <= (end_page, end_y)),
  CONSTRAINT captured_scenes_no_film_timing_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      int8range(start_time_seconds, end_time_seconds, '[]') WITH &&
    ),
  CONSTRAINT captured_scenes_no_script_location_overlap
    EXCLUDE USING gist (
      script_id WITH =,
      numrange(start_page::numeric * 1000 + start_y, end_page::numeric * 1000 + end_y, '[]') WITH &&
    )
);

CREATE INDEX captured_scenes_script_location_idx
ON captured_scenes (script_id, start_page, start_y);

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
