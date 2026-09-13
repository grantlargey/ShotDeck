// client/src/pages/movie-detail/ui/MovieDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { sortAnnotationsByTime } from "@/entities/annotation";
import { buildMovieSavePayload, createMovieEditForm, getMovieCoverUrl } from "@/entities/movie";
import { getCurrentScript } from "@/entities/script";
import { getSceneScriptPath } from "@/entities/script-scene";
import {
  createImageAnnotation,
  deleteImageAnnotation,
  updateImageAnnotation,
} from "@/features/annotation-actions";
import { movieActions } from "@/features/movie-actions";
import { saveScriptPdf as saveScriptPdfAction } from "@/features/script-actions";
import { api } from "@/shared/api";
import { useDocumentTitle } from "@/shared/lib/document-title";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors";
import { useFilePreviewUrl, useSignedMediaUrl } from "@/shared/lib/media";
import {
  formatSecondsToHms,
  parseTimeInputToMinutes,
  parseTimeInputToSeconds,
} from "@/shared/lib/time";
import {
  Button,
  Callout,
  Dialog,
  EmptyState,
  Field,
  FileDropzone,
  FileInput,
  Input,
  PlusIcon,
  SectionHeading,
} from "@/shared/ui";
import { SceneModalButton, SceneViewerModal } from "@/widgets/scene-detail-modal";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import { MovieEditPanel } from "./MovieEditPanel.jsx";
import { MovieHeader, MovieHeaderSkeleton } from "./MovieHeader.jsx";
import { MovieScriptPanel } from "./MovieScriptPanel.jsx";
import styles from "./MovieDetailPage.module.css";

/** Reformats typed time as HH:MM:SS, leaving input it can't parse untouched. */
function normalizeHms(value) {
  const parsed = parseTimeInputToSeconds(value);
  return parsed === null ? value : formatSecondsToHms(parsed, { fallback: "00:00:00" });
}

/** Parses a still's timestamp, rejecting bad input and times past the film's runtime. */
function parseStillTime(text, runtimeSeconds) {
  const seconds = parseTimeInputToSeconds(text);
  if (seconds === null || seconds < 0) {
    throw new ValidationError("Use HH:MM:SS (or MM:SS) for the timestamp.");
  }
  if (runtimeSeconds > 0 && seconds > runtimeSeconds) {
    throw new ValidationError(
      `The timestamp can't be later than the film's runtime (${formatSecondsToHms(runtimeSeconds)}).`
    );
  }
  return seconds;
}

function StillFrameButton({ annotation, onOpen }) {
  const url = useSignedMediaUrl(annotation.image_key || null, annotation.image_url || null);
  const time = formatSecondsToHms(annotation.time_seconds);

  return (
    <button type="button" className={styles.frame} onClick={onOpen} aria-label={`Open still at ${time}`}>
      {url && <img src={url} alt="" loading="lazy" />}
      <span className={styles.frameTime}>{time}</span>
    </button>
  );
}

export default function MovieDetailPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [movie, setMovie] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [err, setErr] = useState("");

  // The still the scene viewer opened on; null while it's closed.
  const [viewerStillId, setViewerStillId] = useState(null);

  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState({ time_hms: "" });
  const [addFile, setAddFile] = useState(null);
  const [addError, setAddError] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addPreviewUrl = useFilePreviewUrl(addFile);

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

  // Inline still edit inside the scene viewer, tied to the still it edits so
  // stepping to another still never applies it to the wrong one.
  const [stillEdit, setStillEdit] = useState(null);
  const lastDeepLinkedAnnotationRef = useRef("");
  const annotationIdFromQuery = searchParams.get("annotationId") || "";

  useDocumentTitle(movie?.title || "Project");

  /**
   * Reloads the project. The scene viewer stays open across reloads (moving to
   * the nearest still if its still was deleted) and closes once no stills remain.
   */
  async function load() {
    setErr("");
    try {
      const [m, annotationRows, scriptRows] = await Promise.all([
        api.getMovie(id),
        api.listAnnotations(id),
        api.listScripts(id),
      ]);
      const a = sortAnnotationsByTime(annotationRows);

      setMovie(m);
      setAnnotations(a);
      setScripts(Array.isArray(scriptRows) ? scriptRows : []);
      if (a.length === 0) setViewerStillId(null);

      // Keep edit form in sync with loaded movie
      setEditForm(createMovieEditForm(m));
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to load project."));
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

  const backdropUrl = useSignedMediaUrl(annotations[0]?.image_key || null, annotations[0]?.image_url || null);

  function openAddDialog() {
    setAddForm({ time_hms: "" });
    setAddFile(null);
    setAddError("");
    setAdding(true);
  }

  async function addAnnotation(e) {
    e.preventDefault();
    setAddError("");

    try {
      const timeSeconds = parseStillTime(addForm.time_hms, runtimeSeconds);
      if (!addFile) {
        throw new ValidationError("Choose a still image to add.");
      }

      setAddBusy(true);
      await createImageAnnotation({ movieId: id, timeSeconds, file: addFile });
      setAdding(false);
      await load();
    } catch (e2) {
      setAddError(getErrorMessage(e2, "Failed to add the still."));
    } finally {
      setAddBusy(false);
    }
  }

  function startStillEdit(still) {
    setStillEdit({
      stillId: still.id,
      time_hms: formatSecondsToHms(still.time_seconds, { fallback: "00:00:00" }),
      file: null,
    });
  }

  async function saveStillEdit(still) {
    if (stillEdit?.stillId !== still.id) return;
    setErr("");

    try {
      const timeSeconds = parseStillTime(stillEdit.time_hms, runtimeSeconds);
      if (!still.image_key && !stillEdit.file) {
        throw new ValidationError("Choose an image for this still.");
      }

      await updateImageAnnotation({
        movieId: id,
        annotationId: still.id,
        timeSeconds,
        imageKey: still.image_key ?? null,
        file: stillEdit.file,
      });

      await load();
      setStillEdit(null);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save the still."));
    }
  }

  async function deleteStill(still) {
    if (!window.confirm("Delete this still?")) return;
    try {
      await deleteImageAnnotation(id, still.id);
      setStillEdit(null);
      await load();
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to delete the still."));
    }
  }

  function closeViewer() {
    setViewerStillId(null);
    setStillEdit(null);
  }

  async function saveScriptPdf() {
    if (!scriptFile) return;
    setErr("");
    setSavingScript(true);

    try {
      const script = await saveScriptPdfAction({ movieId: id, file: scriptFile });
      setScriptFile(null);
      setScripts((prev) => {
        if (!script?.id) return prev;
        const rest = prev.filter((row) => row.id !== script.id);
        return [script, ...rest];
      });
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save script PDF."));
    } finally {
      setSavingScript(false);
    }
  }

  async function saveMovieEdits() {
    setErr("");
    try {
      const runtimeMinutes = parseTimeInputToMinutes(editForm.runtime_hms, {
        rounding: "nearest",
      });
      if (runtimeMinutes === null || runtimeMinutes < 1) {
        throw new ValidationError("Runtime must use HH:MM:SS and be at least 00:01:00.");
      }

      await movieActions.update(id, buildMovieSavePayload(editForm, runtimeMinutes));
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

  const coverUrl = movie ? getMovieCoverUrl(movie) || null : null;
  const currentScript = getCurrentScript(scripts);

  function openScript() {
    if (currentScript) nav(`/movies/${id}/scripts/${currentScript.id}`);
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
            {currentScript && (
              <Button variant="primary" onClick={openScript}>
                Open script
              </Button>
            )}
            <Button onClick={() => (editMode ? cancelMovieEdits() : setEditMode(true))}>
              {editMode ? "Close editor" : "Edit details"}
            </Button>
          </>
        }
      />

      <div className={styles.content}>
        {err && !viewerStillId && <Callout tone="error">{err}</Callout>}

        {editMode && (
          <MovieEditPanel
            editForm={editForm}
            setEditForm={setEditForm}
            onCancel={cancelMovieEdits}
            onSave={saveMovieEdits}
          />
        )}

        <MovieScriptPanel
          currentScript={currentScript}
          scriptFile={scriptFile}
          savingScript={savingScript}
          onScriptFileChange={setScriptFile}
          onSaveScript={saveScriptPdf}
        />

        <section aria-labelledby="project-stills-heading">
          <SectionHeading
            id="project-stills-heading"
            title="Film stills"
            count={annotations.length}
            actions={
              annotations.length > 0 && (
                <Button size="sm" onClick={openAddDialog}>
                  <PlusIcon size={14} />
                  Add still
                </Button>
              )
            }
          />

          {annotations.length === 0 ? (
            <EmptyState
              className={styles.stillsEmpty}
              title="No stills yet"
              action={
                <Button size="sm" variant="primary" onClick={openAddDialog}>
                  <PlusIcon size={14} />
                  Add the first still
                </Button>
              }
            >
              Add frames from the film at their timestamps. A still inside a captured scene appears on that scene.
            </EmptyState>
          ) : (
            <>
              <AnnotationTimeline
                annotations={annotations}
                onSelect={(index) => setViewerStillId(annotations[index]?.id ?? null)}
                runtimeSeconds={runtimeSeconds}
                selectedIndex={annotations.findIndex((row) => row.id === viewerStillId)}
              />
              <ul className={styles.stillGrid}>
                {annotations.map((annotation) => (
                  <li key={annotation.id}>
                    <StillFrameButton annotation={annotation} onOpen={() => setViewerStillId(annotation.id)} />
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
          scriptId={currentScript?.id ?? null}
          stills={annotations}
          onClose={closeViewer}
          onSelectTag={(tag) => nav(`/script-search?tag=${encodeURIComponent(tag)}`)}
          onOpenScene={(scene) => nav(getSceneScriptPath(scene))}
          renderActions={({ view, still }) =>
            view === "still" &&
            still && (
              <>
                <SceneModalButton variant="danger" onClick={() => deleteStill(still)}>
                  Delete
                </SceneModalButton>
                <SceneModalButton
                  onClick={() => (stillEdit?.stillId === still.id ? setStillEdit(null) : startStillEdit(still))}
                >
                  {stillEdit?.stillId === still.id ? "Cancel edit" : "Edit"}
                </SceneModalButton>
              </>
            )
          }
          renderStillTools={(still) => (
            <>
              {err && <Callout tone="error">{err}</Callout>}
              {stillEdit?.stillId === still.id && (
                <div className={styles.editRow}>
                  <Field label="Timestamp" required className={styles.timeField}>
                    <Input
                      placeholder="HH:MM:SS"
                      value={stillEdit.time_hms}
                      onChange={(e) => {
                        const value = e.target.value;
                        setStillEdit((edit) => ({ ...edit, time_hms: value }));
                      }}
                      onBlur={(e) => {
                        const value = normalizeHms(e.target.value);
                        setStillEdit((edit) => ({ ...edit, time_hms: value }));
                      }}
                    />
                  </Field>
                  <Field as="div" label="Replace image" className={styles.imageField}>
                    <FileInput
                      accept="image/*"
                      file={stillEdit.file}
                      onChange={(file) => setStillEdit((edit) => ({ ...edit, file }))}
                      label="Choose image"
                      placeholder="Keeps the current image"
                    />
                  </Field>
                  <div className={styles.editActions}>
                    <Button variant="primary" onClick={() => saveStillEdit(still)}>
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        />
      )}

      {adding && (
        <Dialog
          title="Add a film still"
          onClose={() => setAdding(false)}
          footer={
            <>
              <Button onClick={() => setAdding(false)}>Cancel</Button>
              <Button type="submit" form="add-still-form" variant="primary" disabled={addBusy}>
                {addBusy ? "Adding…" : "Add still"}
              </Button>
            </>
          }
        >
          <form id="add-still-form" className={styles.addForm} onSubmit={addAnnotation}>
            <FileDropzone
              className={styles.addDrop}
              accept="image/*"
              file={addFile}
              onChange={(file) => {
                setAddFile(file);
                setAddError("");
              }}
              onReject={() => setAddError("That file isn't an image. Choose a JPG or PNG.")}
              title={addFile ? "Replace image" : "Drop a still here or click to choose"}
              hint="JPG or PNG"
              preview={addPreviewUrl ? <img src={addPreviewUrl} alt="" /> : null}
            />
            <Field
              label="Timestamp"
              required
              hint={runtimeSeconds ? `Between 00:00:00 and ${formatSecondsToHms(runtimeSeconds)}` : "HH:MM:SS"}
            >
              <Input
                placeholder="HH:MM:SS"
                value={addForm.time_hms}
                onChange={(e) => setAddForm({ time_hms: e.target.value })}
                onBlur={(e) => setAddForm({ time_hms: normalizeHms(e.target.value) })}
                required
              />
            </Field>
            {addError && (
              <p className={styles.formError} role="alert">
                {addError}
              </p>
            )}
          </form>
        </Dialog>
      )}
    </div>
  );
}
