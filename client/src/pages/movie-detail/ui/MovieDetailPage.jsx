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
import { FeedbackMessage, LoadingState } from "@/shared/ui";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import { MovieEditPanel } from "./MovieEditPanel.jsx";
import { MovieReadOnlyDetails } from "./MovieReadOnlyDetails.jsx";
import { MovieScriptPanel } from "./MovieScriptPanel.jsx";
import { MovieTitleBlock } from "./MovieTitleBlock.jsx";

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

  const btnPrimary = {
    background: "#333",
    color: "white",
    padding: "0.6rem 0.9rem",
    border: "none",
    cursor: "pointer",
    borderRadius: 6,
  };

  const btnSecondary = {
    background: "#eee",
    color: "#111",
    padding: "0.6rem 0.9rem",
    border: "1px solid #ccc",
    cursor: "pointer",
    borderRadius: 6,
  };

  const btnRow = {
    display: "flex",
    gap: 8,
    marginTop: 12,
    flexWrap: "wrap",
  };

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

  return (
    <div style={{ padding: "2rem", background: "#fdfdfd" }}>
      <FeedbackMessage tone="error">{err}</FeedbackMessage>

      {!movie ? (
        <LoadingState />
      ) : (
        <>
          <MovieTitleBlock coverUrl={coverUrl} movie={movie} />

          {!editMode && (
            <>
              <MovieReadOnlyDetails movie={movie} />
              <MovieScriptPanel
                btnPrimary={btnPrimary}
                btnSecondary={btnSecondary}
                currentScript={currentScript}
                onChoosePdf={() => document.getElementById("scriptPdfInput")?.click()}
                onSaveScript={saveScriptPdf}
                onScriptFileChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
                onViewPdf={() =>
                  currentScript && nav(`/movies/${id}/scripts/${currentScript.id}`)
                }
                savingScript={savingScript}
                scriptFile={scriptFile}
              />
            </>
          )}

          {editMode && (
            <MovieEditPanel
              btnPrimary={btnPrimary}
              btnSecondary={btnSecondary}
              editForm={editForm}
              onCancel={cancelMovieEdits}
              onSave={saveMovieEdits}
              setEditForm={setEditForm}
            />
          )}

          {/* Toggle button (label change): "Toggle edit mode" -> "Edit" */}
          <button
            type="button"
            onClick={() => setEditMode((v) => !v)}
            style={{
              ...btnPrimary,
              marginTop: 4,
              marginBottom: 18,
            }}
          >
            {editMode ? "Exit Edit Mode" : "Edit"}
          </button>

          <h2 style={{ marginTop: 0 }}>Annotations Timeline</h2>
          <AnnotationTimeline
            annotations={annotations}
            onSelect={setSelectedIndex}
            runtimeSeconds={runtimeSeconds}
            selectedIndex={selectedIndex}
          />

          {/* Add annotation */}
          <form onSubmit={addAnnotation} style={{ maxWidth: 900 }}>
            <input
              type="text"
              placeholder="Time (HH:MM:SS)"
              value={form.time_hms}
              onChange={(e) => setForm((f) => ({ ...f, time_hms: e.target.value }))}
              onBlur={(e) => {
                const parsed = parseTimeInputToSeconds(e.target.value);
                if (parsed !== null) {
                  setForm((f) => ({
                    ...f,
                    time_hms: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                  }));
                }
              }}
              required
              style={{ width: "100%", padding: 8, marginBottom: 10 }}
            />

            <div style={{ marginBottom: 10 }}>
              <button
                type="button"
                onClick={() =>
                  document.getElementById("annotationImageInput")?.click()
                }
                style={{ ...btnPrimary, marginRight: 8 }}
              >
                Add Image
              </button>

              <button type="submit" style={btnPrimary}>
                Add Annotation
              </button>

              <input
                id="annotationImageInput"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) =>
                  setAnnotationFile(e.target.files?.[0] ?? null)
                }
              />
            </div>

            {annotationFile && (
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
                Selected: {annotationFile.name}
              </div>
            )}
          </form>

          {/* Divider: thicker / more visible */}
          <hr
            style={{
              border: 0,
              borderTop: "3px solid #2f2f2f",
              margin: "1.25rem 0 1.25rem",
              opacity: 1,
            }}
          />

          {/* Annotation viewer */}
          {!selected ? (
            <p>No annotations yet.</p>
          ) : (
            <div style={{ maxWidth: 900 }}>
              {/* Annotation image first (as in your screenshot) */}
              {selectedImageUrl && (
                <img
                  src={selectedImageUrl}
                  alt="Annotation"
                  style={{
                    maxWidth: "100%",
                    display: "block",
                    marginBottom: 14,
                  }}
                />
              )}

              {/* Inline annotation edit form */}
              {annotationEditMode ? (
                <>
                  <input
                    value={annotationEditForm.time_hms}
                    onChange={(e) =>
                      setAnnotationEditForm((f) => ({
                        ...f,
                        time_hms: e.target.value,
                      }))
                    }
                    onBlur={(e) => {
                      const parsed = parseTimeInputToSeconds(e.target.value);
                      if (parsed !== null) {
                        setAnnotationEditForm((f) => ({
                          ...f,
                          time_hms: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                        }));
                      }
                    }}
                    style={{
                      width: "100%",
                      padding: 12,
                      marginBottom: 12,
                      border: "2px solid #777",
                      borderRadius: 4,
                      fontSize: 20,
                    }}
                    placeholder="Time (HH:MM:SS)"
                  />

                  <div style={{ marginBottom: 12 }}>
                    <input
                      id="annotationEditImageInput"
                      type="file"
                      accept="image/*"
                      onChange={(e) =>
                        setAnnotationEditFile(e.target.files?.[0] ?? null)
                      }
                    />
                    {annotationEditFile && (
                      <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                        New image: {annotationEditFile.name}
                      </div>
                    )}
                  </div>

                  <div style={btnRow}>
                    <button type="button" style={btnPrimary} onClick={saveEditedAnnotation}>
                      Save
                    </button>
                    <button
                      type="button"
                      style={btnSecondary}
                      onClick={() => {
                        setAnnotationEditMode(false);
                        setAnnotationEditForm({ time_hms: "" });
                        setAnnotationEditFile(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ marginTop: 0, marginBottom: 8, color: "#555" }}>
                    <strong>Time:</strong> {formatSecondsToHms(selected.time_seconds)}
                  </p>
                </>
              )}

              {/* Navigation buttons under the image, matching page styles */}
              <div style={btnRow}>
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                  style={{
                    ...btnPrimary,
                    opacity: selectedIndex <= 0 ? 0.45 : 1,
                    cursor: selectedIndex <= 0 ? "not-allowed" : "pointer",
                  }}
                >
                  ← Previous
                </button>

                <button
                  type="button"
                  disabled={selectedIndex >= annotations.length - 1}
                  onClick={() =>
                    setSelectedIndex((i) =>
                      Math.min(annotations.length - 1, i + 1)
                    )
                  }
                  style={{
                    ...btnPrimary,
                    opacity: selectedIndex >= annotations.length - 1 ? 0.45 : 1,
                    cursor:
                      selectedIndex >= annotations.length - 1
                        ? "not-allowed"
                        : "pointer",
                  }}
                >
                  Next →
                </button>

                {/* Scene navigation + edit/delete controls */}
                <button
                  type="button"
                  disabled={!canOpenSceneInScript}
                  onClick={() => {
                    if (!sceneLookupResult?.scene_id || !sceneLookupResult?.script_id) return;
                    const params = new URLSearchParams();
                    params.set("sceneId", sceneLookupResult.scene_id);
                    const page = Number(
                      sceneLookupResult.page_start || sceneLookupResult.page_end || 1
                    );
                    params.set("page", String(Number.isInteger(page) && page > 0 ? page : 1));
                    nav(
                      `/movies/${id}/scripts/${sceneLookupResult.script_id}?${params.toString()}`
                    );
                  }}
                  title={
                    !canOpenSceneInScript
                      ? sceneLookupStatus === "loading"
                        ? "Finding scene annotation for this timestamp..."
                        : sceneLookupMessage || "No scene annotation for this timestamp."
                      : "Open matching scene annotation in script"
                  }
                  style={{
                    ...btnPrimary,
                    opacity: canOpenSceneInScript ? 1 : 0.5,
                    cursor: canOpenSceneInScript ? "pointer" : "not-allowed",
                  }}
                >
                  {sceneLookupStatus === "loading" ? "Finding Scene..." : "Open Scene In Script"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAnnotationEditForm({
                      time_hms: formatSecondsToHms(selected.time_seconds, { fallback: "00:00:00" }),
                    });
                    setAnnotationEditFile(null);
                    setAnnotationEditMode(true);
                  }}
                  style={btnPrimary}
                >
                  Edit
                </button>

                <button
                  type="button"
                  onClick={async () => {
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
                  }}
                  style={btnPrimary}
                >
                  Delete
                </button>
              </div>

              {sceneLookupStatus === "no_script" && (
                <p style={{ margin: "10px 0 0", color: "#666" }}>No script available.</p>
              )}
              {sceneLookupStatus === "no_scene" && (
                <p style={{ margin: "10px 0 0", color: "#666" }}>
                  No scene annotation for this timestamp.
                </p>
              )}
              {sceneLookupStatus === "error" && sceneLookupMessage && (
                <p style={{ margin: "10px 0 0", color: "crimson" }}>{sceneLookupMessage}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
