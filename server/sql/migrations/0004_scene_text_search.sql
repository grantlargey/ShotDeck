-- Word search over captured scenes, which semantic search uses to find
-- candidates by the description's words. An expression index rather than a
-- stored tsvector column, like the script-location exclusion constraint: the
-- row keeps only what the PDF can't give back (ADR 0002), and queries match by
-- repeating the same expression.
CREATE INDEX captured_scenes_text_search_idx
ON captured_scenes USING GIN (to_tsvector('english', scene_text));
