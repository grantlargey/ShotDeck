// client/src/pages/movie-detail/ui/MovieDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { getAnnotationIndexById, sortAnnotationsByTime } from "@/entities/annotation";
import { buildMovieSavePayload, createMovieEditForm, getMovieCoverUrl } from "@/entities/movie";
import { getCurrentScript } from "@/entities/script";
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
import { SceneDetailModal, SceneModalActions, SceneModalButton } from "@/widgets/scene-detail-modal";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import { MovieEditPanel } from "./MovieEditPanel.jsx";
import { MovieHeader, MovieHeaderSkeleton } from "./MovieHeader.jsx";
import { MovieScriptPanel } from "./MovieScriptPanel.jsx";
import styles from "./MovieDetailPage.module.css";

const LOOKUP_NOTES = {
  loading: "Finding the captured scene for this timestamp…",
  found: "This still falls inside a captured scene.",
  no_scene: "No captured scene covers this timestamp yet.",
  no_script: "Upload the script to link stills to scenes.",
};

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

function LightboxStill({ annotation }) {
  const url = useSignedMediaUrl(annotation.image_key || null, annotation.image_url || null);
  if (!url) return <div className={styles.lightboxStill} aria-hidden="true" />;
  return (
    <img
      className={styles.lightboxStill}
      src={url}
      alt={`Film still at ${formatSecondsToHms(annotation.time_seconds)}`}
    />
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

  // Index of the still open in the lightbox; -1 when it's closed.
  const [activeIndex, setActiveIndex] = useState(-1);

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

  // Inline edit mode (ANNOTATION), inside the lightbox
  const [annotationEditMode, setAnnotationEditMode] = useState(false);
  const [annotationEditForm, setAnnotationEditForm] = useState({ time_hms: "" });
  const [annotationEditFile, setAnnotationEditFile] = useState(null);
  const [sceneLookupStatus, setSceneLookupStatus] = useState("idle");
  const [sceneLookupResult, setSceneLookupResult] = useState(null);
  const [sceneLookupMessage, setSceneLookupMessage] = useState("");
  const lastDeepLinkedAnnotationRef = useRef("");
  const annotationIdFromQuery = searchParams.get("annotationId") || "";

  useDocumentTitle(movie?.title || "Project");

  /**
   * Reloads the project. Passing `openAnnotationId` opens that still in the
   * lightbox afterwards ("" closes it). Without it the lightbox is left alone,
   * so a repeated load can't close a still opened from a ?annotationId link.
   */
  async function load({ openAnnotationId } = {}) {
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
      if (openAnnotationId !== undefined) setActiveIndex(getAnnotationIndexById(a, openAnnotationId));

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

  // ?annotationId=… (from a scene's "Open in project") opens that still.
  useEffect(() => {
    if (!annotationIdFromQuery) {
      lastDeepLinkedAnnotationRef.current = "";
      return;
    }
    if (lastDeepLinkedAnnotationRef.current === annotationIdFromQuery) return;

    const targetIndex = annotations.findIndex((row) => row.id === annotationIdFromQuery);
    if (targetIndex < 0) return;

    lastDeepLinkedAnnotationRef.current = annotationIdFromQuery;
    setActiveIndex(targetIndex);
  }, [annotationIdFromQuery, annotations]);

  const runtimeSeconds = useMemo(() => {
    if (!movie?.runtime_minutes) return 0;
    return Number(movie.runtime_minutes) * 60;
  }, [movie]);

  const active = activeIndex >= 0 ? annotations[activeIndex] : null;
  const backdropUrl = useSignedMediaUrl(annotations[0]?.image_key || null, annotations[0]?.image_url || null);

  // Leaving a still exits its edit mode, so edits never apply to the wrong one.
  useEffect(() => {
    setAnnotationEditMode(false);
    setAnnotationEditForm({ time_hms: "" });
    setAnnotationEditFile(null);
  }, [active?.id]);

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

  async function saveEditedAnnotation() {
    if (!active) return;
    setErr("");

    try {
      const timeSeconds = parseStillTime(annotationEditForm.time_hms, runtimeSeconds);
      if (!active.image_key && !annotationEditFile) {
        throw new ValidationError("Choose an image for this still.");
      }

      await updateImageAnnotation({
        movieId: id,
        annotationId: active.id,
        timeSeconds,
        imageKey: active.image_key ?? null,
        file: annotationEditFile,
      });

      await load({ openAnnotationId: active.id });
      setAnnotationEditMode(false);
      setAnnotationEditFile(null);
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to save the still."));
    }
  }

  function startAnnotationEdit() {
    setAnnotationEditForm({
      time_hms: formatSecondsToHms(active.time_seconds, { fallback: "00:00:00" }),
    });
    setAnnotationEditFile(null);
    setAnnotationEditMode(true);
  }

  function cancelAnnotationEdit() {
    setAnnotationEditMode(false);
    setAnnotationEditForm({ time_hms: "" });
    setAnnotationEditFile(null);
  }

  async function deleteActiveAnnotation() {
    if (!active || !window.confirm("Delete this still?")) return;
    try {
      const neighborId = annotations[activeIndex + 1]?.id || annotations[activeIndex - 1]?.id || "";
      await deleteImageAnnotation(id, active.id);
      await load({ openAnnotationId: neighborId });
    } catch (e) {
      setErr(getErrorMessage(e, "Failed to delete the still."));
    }
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
  const canOpenSceneInScript = sceneLookupStatus === "found" && Boolean(sceneLookupResult);

  useEffect(() => {
    let cancelled = false;

    async function resolveSceneForActiveAnnotation() {
      if (!active?.id) {
        setSceneLookupStatus("idle");
        setSceneLookupResult(null);
        setSceneLookupMessage("");
        return;
      }

      if (!currentScript?.id) {
        setSceneLookupStatus("no_script");
        setSceneLookupResult(null);
        setSceneLookupMessage("");
        return;
      }

      const annotationTimeSeconds = Number(active.time_seconds);
      if (!Number.isFinite(annotationTimeSeconds) || annotationTimeSeconds < 0) {
        setSceneLookupStatus("no_scene");
        setSceneLookupResult(null);
        setSceneLookupMessage("");
        return;
      }

      setSceneLookupStatus("loading");
      setSceneLookupResult(null);
      setSceneLookupMessage("");

      try {
        const result = await api.findSceneByTime(id, annotationTimeSeconds, {
          scriptId: currentScript.id,
        });

        if (cancelled) return;

        if (result?.found && result.scene_id && result.script_id) {
          setSceneLookupStatus("found");
          setSceneLookupResult(result);
          return;
        }

        setSceneLookupStatus(result?.reason === "NO_SCRIPT" ? "no_script" : "no_scene");
        setSceneLookupResult(null);
      } catch (e) {
        if (cancelled) return;
        setSceneLookupStatus("error");
        setSceneLookupResult(null);
        setSceneLookupMessage(getErrorMessage(e, "Failed to look up the scene for this timestamp."));
      }
    }

    void resolveSceneForActiveAnnotation();
    return () => {
      cancelled = true;
    };
  }, [currentScript?.id, id, active?.id, active?.time_seconds]);

  function openScript() {
    if (currentScript) nav(`/movies/${id}/scripts/${currentScript.id}`);
  }

  function openSceneInScript() {
    if (!sceneLookupResult?.scene_id || !sceneLookupResult?.script_id) return;
    const params = new URLSearchParams();
    params.set("sceneId", sceneLookupResult.scene_id);
    const page = Number(sceneLookupResult.page_start || sceneLookupResult.page_end || 1);
    params.set("page", String(Number.isInteger(page) && page > 0 ? page : 1));
    nav(`/movies/${id}/scripts/${sceneLookupResult.script_id}?${params.toString()}`);
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
        {err && !active && <Callout tone="error">{err}</Callout>}

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
                onSelect={setActiveIndex}
                runtimeSeconds={runtimeSeconds}
                selectedIndex={activeIndex}
              />
              <ul className={styles.stillGrid}>
                {annotations.map((annotation, index) => (
                  <li key={annotation.id}>
                    <StillFrameButton annotation={annotation} onOpen={() => setActiveIndex(index)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      {active && (
        <SceneDetailModal
          title={movie.title}
          meta={`Film still · ${formatSecondsToHms(active.time_seconds)}`}
          counter={`${activeIndex + 1} / ${annotations.length}`}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex < annotations.length - 1}
          onStep={(delta) => setActiveIndex((index) => Math.min(annotations.length - 1, Math.max(0, index + delta)))}
          onClose={() => setActiveIndex(-1)}
          stageKey={active.id}
          footer={
            <>
              <p className={styles.lookupNote}>{LOOKUP_NOTES[sceneLookupStatus] || ""}</p>
              <SceneModalActions>
                <SceneModalButton variant="danger" onClick={deleteActiveAnnotation}>
                  Delete
                </SceneModalButton>
                <SceneModalButton onClick={annotationEditMode ? cancelAnnotationEdit : startAnnotationEdit}>
                  {annotationEditMode ? "Cancel edit" : "Edit"}
                </SceneModalButton>
                {canOpenSceneInScript && (
                  <SceneModalButton variant="primary" onClick={openSceneInScript}>
                    Open scene in script
                  </SceneModalButton>
                )}
              </SceneModalActions>
            </>
          }
        >
          <div className={styles.lightboxBody}>
            {err && <Callout tone="error">{err}</Callout>}
            {sceneLookupStatus === "error" && sceneLookupMessage && (
              <Callout tone="error">{sceneLookupMessage}</Callout>
            )}

            {annotationEditMode && (
              <div className={styles.editRow}>
                <Field label="Timestamp" required className={styles.timeField}>
                  <Input
                    placeholder="HH:MM:SS"
                    value={annotationEditForm.time_hms}
                    onChange={(e) => setAnnotationEditForm((f) => ({ ...f, time_hms: e.target.value }))}
                    onBlur={(e) => setAnnotationEditForm((f) => ({ ...f, time_hms: normalizeHms(e.target.value) }))}
                  />
                </Field>
                <Field as="div" label="Replace image" className={styles.imageField}>
                  <FileInput
                    accept="image/*"
                    file={annotationEditFile}
                    onChange={setAnnotationEditFile}
                    label="Choose image"
                    placeholder="Keeps the current image"
                  />
                </Field>
                <div className={styles.editActions}>
                  <Button variant="primary" onClick={saveEditedAnnotation}>
                    Save
                  </Button>
                </div>
              </div>
            )}

            <LightboxStill annotation={active} />
          </div>
        </SceneDetailModal>
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
