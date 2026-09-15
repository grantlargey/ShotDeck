/**
 * Shared SELECT fragments for the scene annotation read model.
 *
 * The API returns scene timing, script anchor text, and the first image
 * annotation inside the time range. Keeping the join in one repository file
 * avoids small query drift between list, search, create, and update flows.
 */
export const SCRIPT_SCENE_SELECT_FIELDS_SQL = `
      sc.id,
      sc.anchor_id,
      sc.legacy_annotation_id,
      sc.movie_id,
      sc.script_id,
      sc.start_time_seconds,
      sc.end_time_seconds,
      sc.tags,
      sc.created_at,
      sc.updated_at,
      a.page_start,
      a.page_end,
      a.selected_text,
      a.raw_selected_text,
      a.formatted_selected_text,
      a.context_prefix,
      a.context_suffix,
      a.start_offset,
      a.end_offset,
      a.anchor_geometry,
      first_image_ann.first_image_annotation_id,
      first_image_ann.first_image_annotation_time_seconds,
      first_image_ann.first_image_annotation_image_key,
      first_image_ann.first_image_annotation_thumb_key,
      first_image_ann.first_image_annotation_created_at
`;

export const SCRIPT_SCENE_FROM_SQL = `
    FROM script_scene_annotations sc
    JOIN script_scene_anchors a ON a.id = sc.anchor_id
    LEFT JOIN LATERAL (
      SELECT
        ann.id AS first_image_annotation_id,
        ann.time_seconds AS first_image_annotation_time_seconds,
        ann.image_key AS first_image_annotation_image_key,
        ann.thumb_key AS first_image_annotation_thumb_key,
        ann.created_at AS first_image_annotation_created_at
      FROM annotations ann
      WHERE ann.movie_id = sc.movie_id
        AND COALESCE(ann.image_key, '') <> ''
        AND ann.time_seconds >= sc.start_time_seconds
        AND ann.time_seconds <= sc.end_time_seconds
      ORDER BY ann.time_seconds ASC, ann.created_at ASC, ann.id ASC
      LIMIT 1
    ) first_image_ann ON TRUE
`;

const SCRIPT_SCENE_SELECT_SQL = `
    SELECT
${SCRIPT_SCENE_SELECT_FIELDS_SQL}
    ${SCRIPT_SCENE_FROM_SQL}
`;

export async function fetchScriptSceneRow(db, { sceneId, movieId, scriptId }) {
    const values = [sceneId];
    const where = [`sc.id = $1`];

    if (movieId) {
        values.push(movieId);
        where.push(`sc.movie_id = $${values.length}`);
    }
    if (scriptId) {
        values.push(scriptId);
        where.push(`sc.script_id = $${values.length}`);
    }

    const result = await db.query(
        `${SCRIPT_SCENE_SELECT_SQL} WHERE ${where.join(" AND ")} LIMIT 1`,
        values
    );
    return result.rows[0] || null;
}

export async function findOverlappingScriptScene(
    db,
    { movieId, scriptId, startTimeSeconds, endTimeSeconds, excludeSceneId = "" }
) {
    const values = [movieId, scriptId, startTimeSeconds, endTimeSeconds];
    const where = [
        `sc.movie_id = $1`,
        `sc.script_id = $2`,
        `NOT (sc.end_time_seconds < $3 OR sc.start_time_seconds > $4)`,
    ];

    if (excludeSceneId) {
        values.push(excludeSceneId);
        where.push(`sc.id <> $${values.length}`);
    }

    const result = await db.query(
        `
        ${SCRIPT_SCENE_SELECT_SQL}
        WHERE ${where.join(" AND ")}
        ORDER BY sc.start_time_seconds ASC, sc.end_time_seconds ASC, sc.id ASC
        LIMIT 1
      `,
        values
    );

    return result.rows[0] || null;
}

export async function listScriptSceneRows(db, { movieId, scriptId }) {
    const result = await db.query(
        `
        ${SCRIPT_SCENE_SELECT_SQL}
        WHERE sc.movie_id = $1 AND sc.script_id = $2
        ORDER BY COALESCE(a.page_start, 2147483647) ASC, sc.start_time_seconds ASC, sc.created_at ASC
      `,
        [movieId, scriptId]
    );

    return result.rows;
}

/** Search answers at most this many scenes, the most recently updated. */
const SEARCH_RESULT_LIMIT = 500;

export async function searchScriptSceneRows(db, { tags, match }) {
    const values = [];
    const where = [];

    if (tags && tags.length > 0) {
        if (match === "any") {
            values.push(tags);
            where.push(`sc.tags ?| $${values.length}::text[]`);
        } else {
            values.push(JSON.stringify(tags));
            where.push(`sc.tags @> $${values.length}::jsonb`);
        }
    }

    const result = await db.query(
        `
        SELECT
${SCRIPT_SCENE_SELECT_FIELDS_SQL},
          m.title AS movie_title
        ${SCRIPT_SCENE_FROM_SQL}
        JOIN movies m ON m.id = sc.movie_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY sc.updated_at DESC
        LIMIT ${SEARCH_RESULT_LIMIT}
      `,
        values
    );

    return result.rows;
}

export async function insertScriptSceneAnchor(
    db,
    {
        anchorId,
        movieId,
        scriptId,
        pageStart,
        pageEnd,
        selectedText,
        rawSelectedText,
        formattedSelectedText,
        contextPrefix,
        contextSuffix,
        startOffset,
        endOffset,
        anchorGeometry,
    }
) {
    await db.query(
        `
        INSERT INTO script_scene_anchors (
          id,
          movie_id,
          script_id,
          page_start,
          page_end,
          selected_text,
          raw_selected_text,
          formatted_selected_text,
          context_prefix,
          context_suffix,
          start_offset,
          end_offset,
          anchor_geometry
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13::jsonb
        )
      `,
        [
            anchorId,
            movieId,
            scriptId,
            pageStart,
            pageEnd,
            selectedText,
            rawSelectedText,
            formattedSelectedText,
            contextPrefix,
            contextSuffix,
            startOffset,
            endOffset,
            JSON.stringify(anchorGeometry),
        ]
    );
}

export async function insertScriptSceneAnnotation(
    db,
    { sceneId, anchorId, movieId, scriptId, startTimeSeconds, endTimeSeconds, tags }
) {
    await db.query(
        `
        INSERT INTO script_scene_annotations (
          id,
          anchor_id,
          movie_id,
          script_id,
          start_time_seconds,
          end_time_seconds,
          tags
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      `,
        [
            sceneId,
            anchorId,
            movieId,
            scriptId,
            startTimeSeconds,
            endTimeSeconds,
            JSON.stringify(tags),
        ]
    );
}

export async function updateScriptSceneAnchor(
    db,
    {
        anchorId,
        pageStart,
        pageEnd,
        selectedText,
        rawSelectedText,
        formattedSelectedText,
        contextPrefix,
        contextSuffix,
        startOffset,
        endOffset,
        anchorGeometry,
    }
) {
    await db.query(
        `
        UPDATE script_scene_anchors
        SET
          page_start = $2,
          page_end = $3,
          selected_text = $4,
          raw_selected_text = $5,
          formatted_selected_text = $6,
          context_prefix = $7,
          context_suffix = $8,
          start_offset = $9,
          end_offset = $10,
          anchor_geometry = $11::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
        [
            anchorId,
            pageStart,
            pageEnd,
            selectedText,
            rawSelectedText,
            formattedSelectedText,
            contextPrefix,
            contextSuffix,
            startOffset,
            endOffset,
            JSON.stringify(anchorGeometry),
        ]
    );
}

export async function updateScriptSceneAnnotation(
    db,
    { sceneId, startTimeSeconds, endTimeSeconds, tags }
) {
    await db.query(
        `
        UPDATE script_scene_annotations
        SET
          start_time_seconds = $2,
          end_time_seconds = $3,
          tags = $4::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
        [sceneId, startTimeSeconds, endTimeSeconds, JSON.stringify(tags)]
    );
}

export async function deleteScriptSceneRow(db, { movieId, scriptId, sceneId }) {
    const result = await db.query(
        `
        DELETE FROM script_scene_anchors a
        USING script_scene_annotations sc
        WHERE sc.anchor_id = a.id
          AND sc.id = $1
          AND sc.movie_id = $2
          AND sc.script_id = $3
        RETURNING sc.id
      `,
        [sceneId, movieId, scriptId]
    );

    return result.rows[0] || null;
}
