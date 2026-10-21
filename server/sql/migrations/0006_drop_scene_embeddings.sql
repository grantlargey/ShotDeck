-- Semantic search uses scene_chunk_embeddings. Retire the previous index
-- without changing captured scenes or their current chunk embeddings.
DROP TABLE scene_embeddings;
