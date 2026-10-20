-- Semantic search index for captured scenes. Kept in its own table so a scene's
-- stored shape and its writes never depend on whether an embedding exists.
-- `model` and `source_hash` let indexing re-embed only scenes whose text, tags
-- or embedding model changed. `embedding` is a REAL[] rather than a pgvector
-- column so the index works on the stock postgres image this project runs.
CREATE TABLE scene_embeddings (
  scene_id UUID PRIMARY KEY REFERENCES captured_scenes(id) ON DELETE CASCADE,
  model TEXT NOT NULL CHECK (model <> ''),
  source_hash TEXT NOT NULL CHECK (source_hash <> ''),
  embedding REAL[] NOT NULL CHECK (cardinality(embedding) > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX scene_embeddings_model_idx ON scene_embeddings (model);
