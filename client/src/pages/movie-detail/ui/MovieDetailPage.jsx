// client/src/pages/movie-detail/ui/MovieDetailPage.jsx
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sortAnnotationsByTime } from "@/entities/annotation/model/annotationTimeline.js";
import { getStillThumbnail } from "@/entities/annotation/model/still.js";
import { createMovieEditForm, saveMovieEdits } from "@/entities/movie/model/movieForms.js";
import { MovieDetailsFields } from "@/entities/movie/ui/MovieDetailsFields.jsx";
import { getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { useSession } from "@/entities/session/model/useSession.js";
import { listAnnotations } from "@/shared/api/annotations.js";
import { getMovie } from "@/shared/api/movies.js";
import { getMovieScript, saveScript } from "@/shared/api/scripts.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatSecondsToHms } from "@/shared/lib/time.js";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { EmptyState } from "@/shared/ui/EmptyState.jsx";
import { PlusIcon } from "@/shared/ui/icons.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import { Skeleton } from "@/shared/ui/Skeleton.jsx";
import { SceneViewerModal } from "@/widgets/scene-detail-modal/ui/SceneViewerModal.jsx";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import { MovieHeader, MovieHeaderSkeleton } from "./MovieHeader.jsx";
import { MovieScriptPanel } from "./MovieScriptPanel.jsx";
import { useStillEditor } from "./useStillEditor.jsx";
import styles from "./MovieDetailPage.module.css";

/**
 * A still in the grid. The callbacks take the still's id, so the page can pass
 * stable setters and hovering one still doesn't re-render the rest.
 */
const StillFrameButton = memo(function StillFrameButton({ annotation, onHover, onOpen }) {
  const thumbnail = getStillThumbnail(annotation);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);
  const time = formatSecondsToHms(annotation.time_seconds);

  return (
    <button
      type="button"
      className={styles.frame}
      onClick={() => onOpen(annotation.id)}
      onMouseEnter={() => onHover(annotation.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(annotation.id)}
      onBlur={() => onHover(null)}
      aria-label={`Open still at ${time}`}
    >
      {url && <img src={url} alt="" loading="lazy" />}
      <span className={styles.frameTime}>{time}</span>
    </button>
  );
});

const NO_STILLS = [];
const SKELETON_FRAME_COUNT = 8;

/** Placeholder timeline and grid, shown while the stills list loads. */
function StillsSkeleton() {
  return (
    <div aria-hidden="true">
      <Skeleton className={styles.skeletonTimeline} />
      <ul className={styles.stillGrid}>
        {Array.from({ length: SKELETON_FRAME_COUNT }, (_, i) => (
          <li key={i}>
            <Skeleton className={styles.skeletonFrame} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MovieDetailPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  // Visitors get the same page without any of the editing controls.
  const { isAdmin: canEdit } = useSession();
  const [movie, setMovie] = useState(null);
  // The project's stills sorted by time; null until they load.
  const [stillRows, setStillRows] = useState(null);
  const [script, setScript] = useState(null);
  const [err, setErr] = useState("");

  // The still the scene viewer opened on; null while it's closed.
  const [viewerStillId, setViewerStillId] = useState(null);
  // The grid still under the pointer or keyboard focus, marked on the timeline.
  const [hoveredStillId, setHoveredStillId] = useState(null);

  // A random still backs the hero, picked when the page loads.
  const [backdropStillId, setBackdropStillId] = useState(null);

  const [scriptFile, setScriptFile] = useState(null);
  const [savingScript, setSavingScript] = useState(false);

  // Inline edit mode (MOVIE)
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    director: "",
    writer: "",
    cinematographer: "",
    year: "",
    runtime_hms: "",
  });

  const lastDeepLinkedAnnotationRef = useRef("");
  const loadIdRef = useRef(0);
  const annotationIdFromQuery = searchParams.get("annotationId") || "";

  const annotations = stillRows ?? NO_STILLS;
  const stillsLoading = stillRows === null;

  useDocumentTitle(movie?.title || "Project");

  /**
   * Reloads the project. The details and the stills list are applied as each
   * arrives, so the header and script panel don't wait for the slower stills.
   * Only the latest load's responses apply.
   * The scene viewer stays open across reloads (moving to the nearest still if
   * its still was deleted) and closes once no stills remain. The hero keeps its
   * random still across reloads unless that still was deleted.
   */
  async function load() {
    const loadId = ++loadIdRef.current;
    const isLatest = () => loadIdRef.current === loadId;
    setErr("");

    const details = Promise.all([getMovie(id), getMovieScript(id)]).then(([m, loadedScript]) => {
      if (!isLatest()) return;
      setMovie(m);
      setScript(loadedScript);
      // Keep edit form in sync with loaded movie
      setEditForm(createMovieEditForm(m));
    });

    const stills = listAnnotations(id).then((annotationRows) => {
      if (!isLatest()) return;
      const a = sortAnnotationsByTime(annotationRows);
      setStillRows(a);
      if (a.length === 0) closeViewer();
      setBackdropStillId((prev) =>
        a.some((row) => row.id === prev) ? prev : (a[Math.floor(Math.random() * a.length)]?.id ?? null)
      );
    });

    try {
      await Promise.all([details, stills]);
    } catch (e) {
      if (isLatest()) setErr(getErrorMessage(e, "Failed to load project."));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ?annotationId=… (from a scene's "Open first still") opens that still.
  useEffect(() => {
    if (!annotationIdFromQuery) {
      lastDeepLinkedAnnotationRef.current = "";
      return;
    }
    if (lastDeepLinkedAnnotationRef.current === annotationIdFromQuery) return;
    if (!annotations.some((row) => row.id === annotationIdFromQuery)) return;

    lastDeepLinkedAnnotationRef.current = annotationIdFromQuery;
    setViewerStillId(annotationIdFromQuery);
  }, [annotationIdFromQuery, annotations]);

  const runtimeSeconds = useMemo(() => {
    if (!movie?.runtime_minutes) return 0;
    return Number(movie.runtime_minutes) * 60;
  }, [movie]);

  const stillEditor = useStillEditor({ movieId: id, runtimeSeconds, onChange: load });

  const backdropStill = annotations.find((row) => row.id === backdropStillId);
  const backdropUrl = useSignedMediaUrl(backdropStill?.image_key || null, backdropStill?.image_url || null);

  function closeViewer() {
    setViewerStillId(null);
    stillEditor.reset();
  }

  async function saveScriptPdf() {
    if (!scriptFile) return;
    setErr("");
    setSavingScript(true);

    try {
      const savedScript = await saveScript({ movieId: id, file: scriptFile });
      setScriptFile(null);
      setScript(savedScript);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save script PDF."));
    } finally {
      setSavingScript(false);
    }
  }

  async function submitMovieEdits() {
    setErr("");
    try {
      await saveMovieEdits({ movieId: id, form: editForm });
      await load();
      setEditMode(false);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save project details."));
    }
  }

  function cancelMovieEdits() {
    setEditForm(createMovieEditForm(movie));
    setEditMode(false);
  }

  const coverUrl = movie?.cover_image_url || null;
  function openScript() {
    if (script) nav(`/movies/${id}/scripts/${script.id}`);
  }

  if (!movie) {
    return (
      <div className={styles.page}>
        {err ? (
          <div className={styles.content}>
            <Callout tone="error">{err}</Callout>
          </div>
        ) : (
          <MovieHeaderSkeleton />
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <MovieHeader
        movie={movie}
        coverUrl={coverUrl}
        backdropUrl={backdropUrl}
        actions={
          <>
            {script && (
              <Button variant="primary" onClick={openScript}>
                Open script
              </Button>
            )}
            {canEdit && (
              <Button onClick={() => (editMode ? cancelMovieEdits() : setEditMode(true))}>
                {editMode ? "Close editor" : "Edit details"}
              </Button>
            )}
          </>
        }
      />

      <div className={styles.content}>
        {err && !viewerStillId && <Callout tone="error">{err}</Callout>}

        {editMode && canEdit && (
          <section aria-labelledby="project-edit-heading">
            <SectionHeading id="project-edit-heading" title="Edit details" />
            <MovieDetailsFields
              values={editForm}
              onChange={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
            />

            <div className={styles.panelActions}>
              <Button onClick={cancelMovieEdits}>Cancel</Button>
              <Button variant="primary" onClick={submitMovieEdits}>
                Save changes
              </Button>
            </div>
          </section>
        )}

        <MovieScriptPanel
          currentScript={script}
          canEdit={canEdit}
          scriptFile={scriptFile}
          savingScript={savingScript}
          onScriptFileChange={setScriptFile}
          onSaveScript={saveScriptPdf}
        />

        <section aria-labelledby="project-stills-heading" aria-busy={stillsLoading}>
          <SectionHeading
            id="project-stills-heading"
            title="Film stills"
            count={stillsLoading ? undefined : annotations.length}
            actions={
              canEdit &&
              annotations.length > 0 && (
                <Button size="sm" onClick={stillEditor.openAddDialog}>
                  <PlusIcon size={14} />
                  Add still
                </Button>
              )
            }
          />

          {stillsLoading ? (
            !err && <StillsSkeleton />
          ) : annotations.length === 0 ? (
            <EmptyState
              className={styles.stillsEmpty}
              title="No stills yet"
              action={
                canEdit && (
                  <Button size="sm" variant="primary" onClick={stillEditor.openAddDialog}>
                    <PlusIcon size={14} />
                    Add the first still
                  </Button>
                )
              }
            >
              {canEdit
                ? "Add frames from the film at their timestamps. A still inside a captured scene appears on that scene."
                : "No film stills have been added to this project yet."}
            </EmptyState>
          ) : (
            <>
              <AnnotationTimeline
                annotations={annotations}
                highlightedIndex={annotations.findIndex((row) => row.id === hoveredStillId)}
                onSelect={(index) => setViewerStillId(annotations[index]?.id ?? null)}
                runtimeSeconds={runtimeSeconds}
                selectedIndex={annotations.findIndex((row) => row.id === viewerStillId)}
              />
              <ul className={styles.stillGrid}>
                {annotations.map((annotation) => (
                  <li key={annotation.id}>
                    <StillFrameButton annotation={annotation} onHover={setHoveredStillId} onOpen={setViewerStillId} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {viewerStillId && (
        <SceneViewerModal
          key={viewerStillId}
          initialView="still"
          initialStillId={viewerStillId}
          movie={movie}
          scriptId={script?.id ?? null}
          stills={annotations}
          onClose={closeViewer}
          onSelectTag={(tag) => nav(`/script-search?tag=${encodeURIComponent(tag)}`)}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
          renderActions={canEdit ? stillEditor.renderActions : undefined}
          renderStillTools={!canEdit ? undefined : (still) => (
            <>
              {err && <Callout tone="error">{err}</Callout>}
              {stillEditor.renderStillTools(still)}
            </>
          )}
        />
      )}

      {stillEditor.addDialog}
    </div>
  );
}
