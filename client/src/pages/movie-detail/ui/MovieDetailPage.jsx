// client/src/pages/movie-detail/ui/MovieDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  getAnnotationImageUrl,
  getAnnotationIndexById,
  sortAnnotationsByTime,
} from "@/entities/annotation";
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
import {
  formatSecondsToHms,
  parseTimeInputToMinutes,
  parseTimeInputToSeconds,
} from "@/shared/lib/time";
import {
  Badge,
  Button,
  Callout,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  Field,
  FileInput,
  IconButton,
  Input,
  LoadingState,
  Panel,
} from "@/shared/ui";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import { MovieEditPanel } from "./MovieEditPanel.jsx";
import { MovieHeader } from "./MovieHeader.jsx";
import { MovieScriptPanel } from "./MovieScriptPanel.jsx";
import styles from "./MovieDetailPage.module.css";

/** Reformats typed time as HH:MM:SS, leaving input it can't parse untouched. */
function normalizeHms(value) {
  const parsed = parseTimeInputToSeconds(value);
  return parsed === null ? value : formatSecondsToHms(parsed, { fallback: "00:00:00" });
}

export default function MovieDetailPage() {
  const nav = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [movie, setMovie] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [scripts, setScripts] = useState([]);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({ time_hms: "" });
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const [annotationFile, setAnnotationFile] = useState(null);
  const [scriptFile, setScriptFile] = useState(null);
  const [savingScript, setSavingScript] = useState(false);

  // Cache signed view urls (fallback)
  const [viewUrlByKey, setViewUrlByKey] = useState({});

  // Inline edit mode (MOVIE)
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    director: "",
    year: "",
    runtime_hms: "",
  });

  // Inline edit mode (ANNOTATION)
  const [annotationEditMode, setAnnotationEditMode] = useState(false);
  const [annotationEditForm, setAnnotationEditForm] = useState({
    time_hms: "",
  });
  const [annotationEditFile, setAnnotationEditFile] = useState(null);
  const [sceneLookupStatus, setSceneLookupStatus] = useState("idle");
  const [sceneLookupResult, setSceneLookupResult] = useState(null);
  const [sceneLookupMessage, setSceneLookupMessage] = useState("");
  const lastDeepLinkedAnnotationRef = useRef("");
  const annotationIdFromQuery = searchParams.get("annotationId") || "";

  async function load(options = {}) {
    setErr("");
    try {
      const [m, annotationRows, scriptRows] = await Promise.all([
        api.getMovie(id),
        api.listAnnotations(id),
        api.listScripts(id),
      ]);
      const a = sortAnnotationsByTime(annotationRows);
      const preferredAnnotationId =
        options.annotationId || annotationIdFromQuery || "";
      const targetIndex = getAnnotationIndexById(a, preferredAnnotationId);

      setMovie(m);
      setAnnotations(a);
      setScripts(Array.isArray(scriptRows) ? scriptRows : []);
      setSelectedIndex(targetIndex >= 0 ? targetIndex : a.length ? 0 : -1);

      // Keep edit form in sync with loaded movie
      setEditForm(createMovieEditForm(m));
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!annotationIdFromQuery) {
      lastDeepLinkedAnnotationRef.current = "";
      return;
    }
    if (lastDeepLinkedAnnotationRef.current === annotationIdFromQuery) return;

    const targetIndex = annotations.findIndex((row) => row.id === annotationIdFromQuery);
    if (targetIndex < 0) return;

    lastDeepLinkedAnnotationRef.current = annotationIdFromQuery;
    setSelectedIndex(targetIndex);
  }, [annotationIdFromQuery, annotations]);

  const runtimeSeconds = useMemo(() => {
    if (!movie?.runtime_minutes) return 0;
    return Number(movie.runtime_minutes) * 60;
  }, [movie]);

  const selected = selectedIndex >= 0 ? annotations[selectedIndex] : null;

  // If selected has image_key but no image_url, fetch a view URL once and cache it
  useEffect(() => {
    (async () => {
      if (!selected) return;
      const key = selected.image_key;
      if (!key) return;

      if (selected.image_url) return;
      if (viewUrlByKey[key]) return;

      try {
        const { url } = await api.getViewUrlForKey(key);
        setViewUrlByKey((m) => ({ ...m, [key]: url }));
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  // If selection changes, exit annotation edit mode (avoids editing wrong item)
  useEffect(() => {
    setAnnotationEditMode(false);
    setAnnotationEditForm({ time_hms: "" });
    setAnnotationEditFile(null);
  }, [selected?.id]);

  async function addAnnotation(e) {
    e.preventDefault();
    setErr("");

    try {
      const time_seconds = parseTimeInputToSeconds(form.time_hms);
      if (time_seconds === null || time_seconds < 0) {
        throw new Error("Annotation time must use HH:MM:SS (or MM:SS).");
      }
      if (!annotationFile) {
        throw new Error("Please choose an image for the annotation.");
      }

      const created = await createImageAnnotation({
        movieId: id,
        timeSeconds: time_seconds,
        file: annotationFile,
      });

      setForm({ time_hms: "" });
      setAnnotationFile(null);
      await load({ annotationId: created?.id || "" });
    } catch (e2) {
      setErr(e2.message);
    }
  }

  async function saveEditedAnnotation() {
    if (!selected) return;
    setErr("");

    try {
      const time_seconds = parseTimeInputToSeconds(annotationEditForm.time_hms);
      if (time_seconds === null || time_seconds < 0) {
        throw new Error("Annotation time must use HH:MM:SS (or MM:SS).");
      }
      if (!selected.image_key && !annotationEditFile) {
        throw new Error("Please choose an image for the annotation.");
      }

      await updateImageAnnotation({
        movieId: id,
        annotationId: selected.id,
        timeSeconds: time_seconds,
        imageKey: selected.image_key ?? null,
        file: annotationEditFile,
      });

      await load({ annotationId: selected.id });
      setAnnotationEditMode(false);
      setAnnotationEditFile(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  function startAnnotationEdit() {
    setAnnotationEditForm({
      time_hms: formatSecondsToHms(selected.time_seconds, { fallback: "00:00:00" }),
    });
    setAnnotationEditFile(null);
    setAnnotationEditMode(true);
  }

  function cancelAnnotationEdit() {
    setAnnotationEditMode(false);
    setAnnotationEditForm({ time_hms: "" });
    setAnnotationEditFile(null);
  }

  async function deleteSelectedAnnotation() {
    if (!window.confirm("Delete this annotation?")) return;
    try {
      const nextSelectedId =
        annotations[selectedIndex - 1]?.id ||
        annotations[selectedIndex + 1]?.id ||
        "";
      await deleteImageAnnotation(id, selected.id);
      await load({ annotationId: nextSelectedId });
    } catch (e) {
      setErr(e.message);
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
      setErr(e.message || "Failed to save script PDF");
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
        throw new Error("Runtime must use HH:MM:SS and be at least 00:01:00.");
      }

      await movieActions.update(id, buildMovieSavePayload(editForm, runtimeMinutes));
      await load();
      setEditMode(false);
    } catch (e) {
      setErr(e.message);
    }
  }

  function cancelMovieEdits() {
    setEditForm(createMovieEditForm(movie));
    setEditMode(false);
  }

  const coverUrl = movie ? getMovieCoverUrl(movie) || null : null;

  const selectedImageUrl = getAnnotationImageUrl(selected, viewUrlByKey);
  const currentScript = getCurrentScript(scripts);
  const canOpenSceneInScript = sceneLookupStatus === "found" && Boolean(sceneLookupResult);

  useEffect(() => {
    let cancelled = false;

    async function resolveSceneForSelectedAnnotation() {
      if (!selected?.id) {
        setSceneLookupStatus("idle");
        setSceneLookupResult(null);
        setSceneLookupMessage("");
        return;
      }

      if (!currentScript?.id) {
        setSceneLookupStatus("no_script");
        setSceneLookupResult(null);
        setSceneLookupMessage("No script available.");
        return;
      }

      const annotationTimeSeconds = Number(selected.time_seconds);
      if (!Number.isFinite(annotationTimeSeconds) || annotationTimeSeconds < 0) {
        setSceneLookupStatus("no_scene");
        setSceneLookupResult(null);
        setSceneLookupMessage("No scene annotation for this timestamp.");
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
          setSceneLookupMessage("");
          return;
        }

        if (result?.reason === "NO_SCRIPT") {
          setSceneLookupStatus("no_script");
          setSceneLookupResult(null);
          setSceneLookupMessage("No script available.");
          return;
        }

        setSceneLookupStatus("no_scene");
        setSceneLookupResult(null);
        setSceneLookupMessage("No scene annotation for this timestamp.");
      } catch (e) {
        if (cancelled) return;
        setSceneLookupStatus("error");
        setSceneLookupResult(null);
        setSceneLookupMessage(e.message || "Failed to resolve scene for this timestamp.");
      }
    }

    void resolveSceneForSelectedAnnotation();
    return () => {
      cancelled = true;
    };
  }, [currentScript?.id, id, selected?.id, selected?.time_seconds]);

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

  const sceneButtonTitle = canOpenSceneInScript
    ? "Open matching scene annotation in script"
    : sceneLookupStatus === "loading"
      ? "Finding scene annotation for this timestamp..."
      : sceneLookupMessage || "No scene annotation for this timestamp.";

  return (
    <div className={styles.page}>
      {err && <Callout tone="error">{err}</Callout>}

      {!movie ? (
        !err && <LoadingState>Loading project…</LoadingState>
      ) : (
        <>
          <MovieHeader
            movie={movie}
            coverUrl={coverUrl}
            actions={
              <>
                <Button
                  variant="primary"
                  disabled={!currentScript}
                  title={currentScript ? undefined : "Upload a script PDF first"}
                  onClick={openScript}
                >
                  Open script
                </Button>
                <Button onClick={() => (editMode ? cancelMovieEdits() : setEditMode(true))}>
                  {editMode ? "Close editor" : "Edit details"}
                </Button>
              </>
            }
          />

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

          <Panel
            title={
              <>
                Annotations
                <Badge tone="accent">{annotations.length}</Badge>
              </>
            }
          >
            <AnnotationTimeline
              annotations={annotations}
              onSelect={setSelectedIndex}
              runtimeSeconds={runtimeSeconds}
              selectedIndex={selectedIndex}
            />

            <form className={styles.addForm} onSubmit={addAnnotation}>
              <Field label="Timestamp" className={styles.timeField}>
                <Input
                  placeholder="HH:MM:SS"
                  value={form.time_hms}
                  onChange={(e) => setForm((f) => ({ ...f, time_hms: e.target.value }))}
                  onBlur={(e) => setForm((f) => ({ ...f, time_hms: normalizeHms(e.target.value) }))}
                  required
                />
              </Field>
              <Field as="div" label="Still image" className={styles.imageField}>
                <FileInput accept="image/*" file={annotationFile} onChange={setAnnotationFile} label="Choose image" />
              </Field>
              <Button type="submit" variant="primary">
                Add annotation
              </Button>
            </form>

            {!selected ? (
              <EmptyState compact title="No annotations yet" className={styles.viewerEmpty}>
                Add a timestamp and a still image to start the timeline.
              </EmptyState>
            ) : (
              <div className={styles.viewer}>
                <div className={styles.viewerBar}>
                  <div className={styles.stepper}>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      label="Previous annotation"
                      disabled={selectedIndex <= 0}
                      onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                    >
                      <ChevronLeftIcon />
                    </IconButton>
                    <span className={styles.position}>
                      {selectedIndex + 1} / {annotations.length}
                    </span>
                    <IconButton
                      size="sm"
                      variant="secondary"
                      label="Next annotation"
                      disabled={selectedIndex >= annotations.length - 1}
                      onClick={() => setSelectedIndex((i) => Math.min(annotations.length - 1, i + 1))}
                    >
                      <ChevronRightIcon />
                    </IconButton>
                  </div>

                  <span className={styles.timestamp}>{formatSecondsToHms(selected.time_seconds)}</span>

                  <div className={styles.viewerActions}>
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={!canOpenSceneInScript}
                      title={sceneButtonTitle}
                      onClick={openSceneInScript}
                    >
                      {sceneLookupStatus === "loading" ? "Finding scene…" : "Open scene in script"}
                    </Button>
                    <Button size="sm" disabled={annotationEditMode} onClick={startAnnotationEdit}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger" onClick={deleteSelectedAnnotation}>
                      Delete
                    </Button>
                  </div>
                </div>

                {annotationEditMode && (
                  <div className={styles.editRow}>
                    <Field label="Timestamp" className={styles.timeField}>
                      <Input
                        placeholder="HH:MM:SS"
                        value={annotationEditForm.time_hms}
                        onChange={(e) => setAnnotationEditForm((f) => ({ ...f, time_hms: e.target.value }))}
                        onBlur={(e) =>
                          setAnnotationEditForm((f) => ({ ...f, time_hms: normalizeHms(e.target.value) }))
                        }
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
                      <Button onClick={cancelAnnotationEdit}>Cancel</Button>
                      <Button variant="primary" onClick={saveEditedAnnotation}>
                        Save
                      </Button>
                    </div>
                  </div>
                )}

                {selectedImageUrl && (
                  <img
                    className={styles.still}
                    src={selectedImageUrl}
                    alt={`Annotation at ${formatSecondsToHms(selected.time_seconds)}`}
                  />
                )}

                {(sceneLookupStatus === "no_script" || sceneLookupStatus === "no_scene") && (
                  <p className={styles.lookupNote}>{sceneLookupMessage}</p>
                )}
                {sceneLookupStatus === "error" && sceneLookupMessage && (
                  <Callout tone="error">{sceneLookupMessage}</Callout>
                )}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
