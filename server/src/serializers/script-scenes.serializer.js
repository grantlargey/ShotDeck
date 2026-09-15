/**
 * Converts the joined script-scene query row into the API shape used by both
 * item-level scene routes and global scene search.
 */
export function mapScriptSceneRow(row) {
    const tags = Array.isArray(row?.tags) ? row.tags : [];
    const anchorGeometry = Array.isArray(row?.anchor_geometry) ? row.anchor_geometry : [];
    const firstImageAnnotation = row?.first_image_annotation_id
        ? {
            id: row.first_image_annotation_id,
            time_seconds: row.first_image_annotation_time_seconds,
            image_key: row.first_image_annotation_image_key,
            thumb_key: row.first_image_annotation_thumb_key ?? null,
            created_at: row.first_image_annotation_created_at,
        }
        : null;

    return {
        id: row.id,
        anchor_id: row.anchor_id,
        movie_id: row.movie_id,
        script_id: row.script_id,
        start_time_seconds: row.start_time_seconds,
        end_time_seconds: row.end_time_seconds,
        tags,
        created_at: row.created_at,
        updated_at: row.updated_at,
        page_start: row.page_start,
        page_end: row.page_end,
        selected_text: row.selected_text,
        raw_selected_text: row.raw_selected_text,
        formatted_selected_text: row.formatted_selected_text,
        context_prefix: row.context_prefix,
        context_suffix: row.context_suffix,
        start_offset: row.start_offset,
        end_offset: row.end_offset,
        anchor_geometry: anchorGeometry,
        first_image_annotation: firstImageAnnotation,
        anchor: {
            id: row.anchor_id,
            page_start: row.page_start,
            page_end: row.page_end,
            selected_text: row.selected_text,
            raw_selected_text: row.raw_selected_text,
            formatted_selected_text: row.formatted_selected_text,
            context_prefix: row.context_prefix,
            context_suffix: row.context_suffix,
            start_offset: row.start_offset,
            end_offset: row.end_offset,
            anchor_geometry: anchorGeometry,
            created_at: row.anchor_created_at,
            updated_at: row.anchor_updated_at,
        },
        ...(row.movie_title ? { movie_title: row.movie_title } : {}),
    };
}
