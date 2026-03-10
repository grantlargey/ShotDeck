// client/src/pages/MovieDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { presignUpload, uploadToS3 } from "../api/uploads";
import {
  formatMinutesToHms,
  formatSecondsToHms,
  parseTimeInputToMinutes,
  parseTimeInputToSeconds,
} from "../utils/time";

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
      const a = Array.isArray(annotationRows) ? annotationRows : [];
      a.sort((x, y) => x.time_seconds - y.time_seconds);
      const preferredAnnotationId =
        options.annotationId || annotationIdFromQuery || "";
      const targetIndex = preferredAnnotationId
        ? a.findIndex((row) => row.id === preferredAnnotationId)
        : -1;

      setMovie(m);
      setAnnotations(a);
      setScripts(Array.isArray(scriptRows) ? scriptRows : []);
      setSelectedIndex(targetIndex >= 0 ? targetIndex : a.length ? 0 : -1);

      // Keep edit form in sync with loaded movie
      setEditForm({
        title: m.title ?? "",
        director: m.director ?? "",
        year: m.year ?? "",
        runtime_hms: formatMinutesToHms(m.runtime_minutes, { fallback: "00:00:00" }),
      });
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

      const { uploadUrl, key } = await presignUpload({
        movieId: id,
        type: "annotation",
        contentType: annotationFile.type,
      });

      await uploadToS3(uploadUrl, annotationFile);

      const created = await api.createAnnotation(id, {
        time_seconds,
        image_key: key,
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
      let image_key = selected.image_key ?? null;

      // If user picked a new image, upload and replace image_key
      if (annotationEditFile) {
        const { uploadUrl, key } = await presignUpload({
          movieId: id,
          type: "annotation",
          contentType: annotationEditFile.type,
        });

        await uploadToS3(uploadUrl, annotationEditFile);
        image_key = key;
      }

      // NOTE: this assumes you have api.updateAnnotation(movieId, annotationId, payload)
      // If your api method name differs, adjust here.
      const time_seconds = parseTimeInputToSeconds(annotationEditForm.time_hms);
      if (time_seconds === null || time_seconds < 0) {
        throw new Error("Annotation time must use HH:MM:SS (or MM:SS).");
      }
      if (!image_key) {
        throw new Error("Please choose an image for the annotation.");
      }

      await api.updateAnnotation(id, selected.id, {
        time_seconds,
        image_key,
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
      if (scriptFile.type !== "application/pdf") {
        throw new Error("Please choose a PDF file.");
      }

      const { uploadUrl, key } = await presignUpload({
        movieId: id,
        type: "script",
        contentType: scriptFile.type,
      });

      await uploadToS3(uploadUrl, scriptFile);
      const script = await api.saveScript(id, { s3_key: key });
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

  const coverUrl = movie?.cover_url || movie?.cover_image_url || null;

  const selectedImageUrl =
    selected?.image_url ||
    (selected?.image_key ? viewUrlByKey[selected.image_key] : null);
  const currentScript = scripts[0] || null;
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
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      {!movie ? (
        <p>Loading...</p>
      ) : (
        <>
          {/* Title block with better spacing before cover */}
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0 }}>
              {movie.title} <span style={{ color: "#666" }}>({movie.year})</span>
            </h2>
          </div>

          {coverUrl && (
            <img
              src={coverUrl}
              alt="Cover"
              style={{
                maxWidth: 260,
                display: "block",
                marginTop: 10,
                marginBottom: "1.25rem",
              }}
            />
          )}

          {/* Details (read-only) */}
          {!editMode && (
            <>
              <p style={{ marginTop: 0 }}>
                <strong>Director:</strong> {movie.director}
              </p>
              <p>
                <strong>Runtime:</strong> {formatMinutesToHms(movie.runtime_minutes)}
              </p>

              <div
                style={{
                  marginTop: 10,
                  marginBottom: 16,
                  padding: "10px 12px",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  background: "#fafafa",
                  maxWidth: 900,
                }}
              >
                <p style={{ margin: "0 0 8px 0" }}>
                  <strong>Script PDF:</strong>{" "}
                  {currentScript ? "Available" : "No script uploaded yet"}
                </p>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    type="button"
                    style={{
                      ...btnPrimary,
                      opacity: currentScript ? 1 : 0.5,
                      cursor: currentScript ? "pointer" : "not-allowed",
                    }}
                    disabled={!currentScript}
                    onClick={() =>
                      currentScript &&
                      nav(`/movies/${id}/scripts/${currentScript.id}`)
                    }
                  >
                    View PDF
                  </button>

                  <button
                    type="button"
                    style={btnSecondary}
                    onClick={() => document.getElementById("scriptPdfInput")?.click()}
                  >
                    {currentScript ? "Replace PDF" : "Upload PDF"}
                  </button>

                  <button
                    type="button"
                    style={{
                      ...btnPrimary,
                      opacity: scriptFile ? 1 : 0.6,
                      cursor: scriptFile ? "pointer" : "not-allowed",
                    }}
                    disabled={!scriptFile || savingScript}
                    onClick={saveScriptPdf}
                  >
                    {savingScript ? "Saving..." : "Save Script"}
                  </button>

                  <input
                    id="scriptPdfInput"
                    type="file"
                    accept="application/pdf"
                    style={{ display: "none" }}
                    onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
                  />
                </div>

                {scriptFile && (
                  <p style={{ margin: "8px 0 0", fontSize: 12, color: "#666" }}>
                    Selected PDF: {scriptFile.name}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Edit panel (MOVIE) */}
          {editMode && (
            <div
              style={{
                marginTop: 12,
                marginBottom: 12,
                padding: 16,
                border: "1px solid #ddd",
                borderRadius: 8,
                maxWidth: 900,
                background: "white",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Edit Movie</h3>

              <input
                value={editForm.title}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder="Title"
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <input
                value={editForm.director}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, director: e.target.value }))
                }
                placeholder="Director"
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <input
                value={editForm.year}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, year: e.target.value }))
                }
                placeholder="Year"
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <input
                value={editForm.runtime_hms}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    runtime_hms: e.target.value,
                  }))
                }
                onBlur={(e) => {
                  const parsed = parseTimeInputToSeconds(e.target.value);
                  if (parsed !== null) {
                    setEditForm((f) => ({
                      ...f,
                      runtime_hms: formatSecondsToHms(parsed, { fallback: "00:00:00" }),
                    }));
                  }
                }}
                placeholder="Runtime (HH:MM:SS)"
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    setErr("");
                    try {
                      const runtimeMinutes = parseTimeInputToMinutes(editForm.runtime_hms, {
                        rounding: "nearest",
                      });
                      if (runtimeMinutes === null || runtimeMinutes < 1) {
                        throw new Error("Runtime must use HH:MM:SS and be at least 00:01:00.");
                      }

                      const payload = {
                        title: editForm.title.trim(),
                        director: editForm.director.trim(),
                        year: Number(editForm.year) || null,
                        runtime_minutes: runtimeMinutes,
                      };

                      await api.updateMovie(id, payload);
                      await load();
                      setEditMode(false);
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                  style={btnPrimary}
                >
                  Save
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditForm({
                      title: movie.title ?? "",
                      director: movie.director ?? "",
                      year: movie.year ?? "",
                      runtime_hms: formatMinutesToHms(movie.runtime_minutes, {
                        fallback: "00:00:00",
                      }),
                    });
                    setEditMode(false);
                  }}
                  style={btnSecondary}
                >
                  Cancel
                </button>
              </div>
            </div>
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

          {/* Timeline */}
          <h2 style={{ marginTop: 0 }}>Annotations Timeline</h2>

          <div
            style={{
              position: "relative",
              height: 20,
              background: "#ccc",
              borderRadius: 10,
              margin: "1rem 0 2rem",
            }}
          >
            {annotations.map((a, idx) => {
              const pct =
                runtimeSeconds > 0
                  ? Math.min(100, (a.time_seconds / runtimeSeconds) * 100)
                  : 0;

              return (
                <div
                  key={a.id}
                  title={formatSecondsToHms(a.time_seconds)}
                  onClick={() => setSelectedIndex(idx)}
                  style={{
                    position: "absolute",
                    left: `${pct}%`,
                    top: -10,
                    transform: "translateX(-50%)",
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 20,
                      background: idx === selectedIndex ? "#111" : "blue",
                      borderRadius: 2,
                    }}
                  />
                </div>
              );
            })}
          </div>

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
                      await api.deleteAnnotation(id, selected.id);
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
