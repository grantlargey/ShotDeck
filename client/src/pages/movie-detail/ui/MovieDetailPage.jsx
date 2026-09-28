// client/src/pages/movie-detail/ui/MovieDetailPage.jsx
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sortAnnotationsByTime } from "@/entities/annotation/model/annotationTimeline.js";
import { getStillThumbnail } from "@/entities/annotation/model/still.js";
import { createMovieEditForm } from "@/entities/movie/model/movieForms.js";
import { getHandedOverPosterUrl } from "@/entities/movie/model/posterTransition.js";
import { useFilmSave } from "@/entities/movie/model/filmSave.js";
import { MovieDetailsFields } from "@/entities/movie/ui/MovieDetailsFields.jsx";
import { getSceneScriptPath } from "@/entities/script-scene/model/capturedScene.js";
import { useSession } from "@/entities/session/model/useSession.js";
import { listAnnotations } from "@/shared/api/annotations.js";
import { getMovie } from "@/shared/api/movies.js";
import { getMovieScript } from "@/shared/api/scripts.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useSignedMediaUrl } from "@/shared/lib/media/useSignedMediaUrl.js";
import { formatMomentToHms } from "@/shared/lib/time.js";
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
import { AddStillDialog } from "./AddStillDialog.jsx";
import { useStillEdit } from "./useStillEdit.jsx";
import styles from "./MovieDetailPage.module.css";

/**
 * A still in the grid. The callbacks take the still's id, so the page can pass
 * stable setters and hovering one still doesn't re-render the rest.
 */
const StillFrameButton = memo(function StillFrameButton({ annotation, onHover, onOpen }) {
  const thumbnail = getStillThumbnail(annotation);
  const url = useSignedMediaUrl(thumbnail.key, thumbnail.url);
  const time = formatMomentToHms(annotation.time_seconds);

  return (
    <button
      type="button"
      className={styles.frame}
      onClick={() => onOpen(annotation.id)}
      onMouseEnter={() => onHover(annotation.id)}
      onFocus={() => onHover(annotation.id)}
      onBlur={() => onHover(null)}
      aria-label={`Open still at ${time}`}
    >
      {url && <img src={url} alt="" loading="lazy" />}
      <span className={styles.frameTime}>{time}</span>
    </button>
  );
});

/**
 * The grid still under the pointer or keyboard focus, kept outside React
 * state: hovering re-renders only the timeline that marks it, not the page
 * and its hundreds of stills.
 */
function createHoveredStill() {
  let stillId = null;
  const listeners = new Set();
  return {
    get: () => stillId,
    set: (nextId) => {
      if (nextId === stillId) return;
      stillId = nextId;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** The stills timeline, lit around whichever grid still is hovered. */
function HoverLinkedTimeline({ hoveredStill, annotations, ...props }) {
  const hoveredId = useSyncExternalStore(hoveredStill.subscribe, hoveredStill.get);
  return (
    <AnnotationTimeline
      annotations={annotations}
      highlightedIndex={hoveredId ? annotations.findIndex((row) => row.id === hoveredId) : -1}
      {...props}
    />
  );
}

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
  const location = useLocation();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  // Visitors get the same page without any of the editing controls.
  const { isAdmin: canEdit, user } = useSession();
  const filmSave = useFilmSave({ movieId: id, ownerId: user?.id });
  const [movie, setMovie] = useState(null);
  // The project's stills sorted by time; null until they load.
  const [stillRows, setStillRows] = useState(null);
  const [script, setScript] = useState(null);
  const [err, setErr] = useState("");

  // The still the scene viewer opened on; null while it's closed.
  const [viewerStillId, setViewerStillId] = useState(null);
  // The grid still under the pointer or keyboard focus, marked on the timeline.
  const [hoveredStill] = useState(createHoveredStill);
  // Mounting the add dialog opens it on an empty form; unmounting discards it.
  const [addingStill, setAddingStill] = useState(false);

  const [scriptFile, setScriptFile] = useState(null);

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
   * its still was deleted) and closes once no stills remain.
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

  const stillEdit = useStillEdit({ movieId: id, runtimeSeconds, onChange: load });

  function closeViewer() {
    setViewerStillId(null);
    stillEdit.reset();
  }

  async function saveScriptPdf() {
    if (!scriptFile) return;
    // Scene anchors point into the PDF they were captured from, so replacing it
    // deletes the script's captured scenes and the tagging on them.
    if (
      script &&
      !window.confirm(
        "Replace this script? Every scene captured from it, and the tags on those scenes, will be deleted. This can't be undone."
      )
    ) {
      return;
    }
    setErr("");

    try {
      const saved = await filmSave.save({ scriptFile });
      setScriptFile(null);
      setScript(saved.script || await getMovieScript(id));
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save script PDF."));
    }
  }

  async function submitMovieEdits() {
    setErr("");
    try {
      await filmSave.save({ form: editForm });
      await load();
      setEditMode(false);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save project details."));
    }
  }

  function leaveFilmSave() {
    if (!filmSave.recovery) return true;
    if (!window.confirm("Leave this unfinished save? Completed work will stay saved. Unsaved inputs will be discarded.")) return false;
    try {
      filmSave.leave();
      setScriptFile(null);
      load();
      return true;
    } catch (error) {
      setErr(getErrorMessage(error));
      return false;
    }
  }

  function cancelMovieEdits() {
    if (!leaveFilmSave()) return;
    setEditForm(createMovieEditForm(movie));
    setEditMode(false);
  }

  const coverUrl = useSignedMediaUrl(movie?.cover_image_key, movie?.cover_image_url);
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
          <MovieHeaderSkeleton posterUrl={getHandedOverPosterUrl(location.state)} posterKey={location.state?.posterKey} />
        )}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <MovieHeader
        movie={movie}
        coverUrl={coverUrl}
        stills={annotations}
        onOpenStill={setViewerStillId}
        actions={
          <>
            {script && (
              <Button variant="primary" onClick={openScript}>
                Open script
              </Button>
            )}
            {canEdit && (
              <Button disabled={filmSave.saving} onClick={() => (editMode ? cancelMovieEdits() : setEditMode(true))}>
                {editMode ? "Close editor" : "Edit details"}
              </Button>
            )}
          </>
        }
      />

      <div className={styles.content}>
        {err && !viewerStillId && <Callout tone="error">{err}</Callout>}
        {canEdit && filmSave.recovery && !filmSave.saving && (
          <Callout tone="info">
            {filmSave.recovery.message}{" "}
            <Link to={`/movies/${id}/edit`}>Resume film save</Link>
          </Callout>
        )}

        {editMode && canEdit && (
          <section aria-labelledby="project-edit-heading">
            <SectionHeading id="project-edit-heading" title="Edit details" />
            <fieldset disabled={filmSave.saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <MovieDetailsFields
                values={editForm}
                onChange={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
              />

              <div className={styles.panelActions}>
                <Button onClick={cancelMovieEdits}>Cancel</Button>
                <Button variant="primary" onClick={submitMovieEdits}>
                  {filmSave.saving ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </fieldset>
          </section>
        )}

        <MovieScriptPanel
          currentScript={script}
          canEdit={canEdit}
          scriptFile={scriptFile}
          savingScript={filmSave.saving}
          onScriptFileChange={(file) => {
            if (file || leaveFilmSave()) setScriptFile(file);
          }}
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
                <Button size="sm" onClick={() => setAddingStill(true)}>
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
                  <Button size="sm" variant="primary" onClick={() => setAddingStill(true)}>
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
              {/* Pins under the header while the grid scrolls past. */}
              <div className={styles.timelineDock}>
                <HoverLinkedTimeline
                  hoveredStill={hoveredStill}
                  annotations={annotations}
                  onSelect={(index) => setViewerStillId(annotations[index]?.id ?? null)}
                  runtimeSeconds={runtimeSeconds}
                  selectedIndex={annotations.findIndex((row) => row.id === viewerStillId)}
                />
              </div>
              {/* Leaving the grid, not each still, clears the highlight, so it holds across the gaps. */}
              <ul className={styles.stillGrid} onMouseLeave={() => hoveredStill.set(null)}>
                {annotations.map((annotation) => (
                  <li key={annotation.id}>
                    <StillFrameButton annotation={annotation} onHover={hoveredStill.set} onOpen={setViewerStillId} />
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
          initial={{ view: "still", stillId: viewerStillId }}
          source={{ film: { ...movie, scriptId: script?.id ?? null, stills: annotations } }}
          onClose={closeViewer}
          onSelectTag={(tag) => nav(`/script-search?tag=${encodeURIComponent(tag)}`)}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
          renderActions={canEdit ? stillEdit.renderActions : undefined}
          renderStillTools={!canEdit ? undefined : (still) => (
            <>
              {err && <Callout tone="error">{err}</Callout>}
              {stillEdit.renderStillTools(still)}
            </>
          )}
        />
      )}

      {addingStill && (
        <AddStillDialog
          movieId={id}
          runtimeSeconds={runtimeSeconds}
          onAdded={load}
          onClose={() => setAddingStill(false)}
        />
      )}
    </div>
  );
}
