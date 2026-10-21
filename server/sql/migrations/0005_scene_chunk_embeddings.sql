-- Semantic search's vectors, one per chunk of a scene's text. A scene that fits
-- in one embedding has one chunk; a longer scene is split into overlapping
-- chunks and scores as its closest one. A scene's rows are replaced together
-- whenever its text, tags or model change, and each row carries the hash of the
-- scene's whole embedding input.
--
-- This replaces scene_embeddings (0003), which stays until the release before
-- this one is retired, because that release still reads and writes it.
CREATE TABLE scene_chunk_embeddings (
  scene_id UUID NOT NULL REFERENCES captured_scenes(id) ON DELETE CASCADE,
  chunk INT NOT NULL CHECK (chunk >= 0),
  model TEXT NOT NULL CHECK (model <> ''),
  source_hash TEXT NOT NULL CHECK (source_hash <> ''),
  embedding REAL[] NOT NULL CHECK (cardinality(embedding) > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scene_id, chunk)
);

CREATE INDEX scene_chunk_embeddings_model_idx ON scene_chunk_embeddings (model);
