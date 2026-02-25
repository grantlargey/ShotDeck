// client/src/pages/MovieDetailPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { presignUpload, uploadToS3 } from "../api/uploads";

function toSeconds(min, sec) {
  const m = Number(min || 0);
  const s = Number(sec || 0);
  return m * 60 + s;
}

function linksToText(links) {
  if (!links) return "";
  if (Array.isArray(links)) return links.join("\n");
  if (typeof links === "string") return links;
  return "";
}

function textToLinks(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function MovieDetailPage() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({ min: "", sec: "", title: "", body: "" });
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const [annotationFile, setAnnotationFile] = useState(null);

  // Cache signed view urls (fallback)
  const [viewUrlByKey, setViewUrlByKey] = useState({});

  // Inline edit mode (MOVIE)
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    title: "",
    director: "",
    year: "",
    runtime_minutes: "",
    links: "",
  });

  // Inline edit mode (ANNOTATION)
  const [annotationEditMode, setAnnotationEditMode] = useState(false);
  const [annotationEditForm, setAnnotationEditForm] = useState({
    title: "",
    body: "",
  });
  const [annotationEditFile, setAnnotationEditFile] = useState(null);

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

  async function load() {
    setErr("");
    try {
      const m = await api.getMovie(id);
      const a = await api.listAnnotations(id);
      a.sort((x, y) => x.time_seconds - y.time_seconds);

      setMovie(m);
      setAnnotations(a);
      setSelectedIndex(a.length ? a.length - 1 : -1);

      // Keep edit form in sync with loaded movie
      setEditForm({
        title: m.title ?? "",
        director: m.director ?? "",
        year: m.year ?? "",
        runtime_minutes: m.runtime_minutes ?? "",
        links: linksToText(m.links),
      });
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
    setAnnotationEditForm({ title: "", body: "" });
    setAnnotationEditFile(null);
  }, [selected?.id]);

  async function addAnnotation(e) {
    e.preventDefault();
    setErr("");

    try {
      const time_seconds = toSeconds(form.min, form.sec);

      let image_key = null;
      if (annotationFile) {
        const { uploadUrl, key } = await presignUpload({
          movieId: id,
          type: "annotation",
          contentType: annotationFile.type,
        });

        await uploadToS3(uploadUrl, annotationFile);
        image_key = key;
      }

      await api.createAnnotation(id, {
        time_seconds,
        title: form.title.trim(),
        body: form.body.trim(),
        image_key,
      });

      setForm({ min: "", sec: "", title: "", body: "" });
      setAnnotationFile(null);
      await load();
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
      await api.updateAnnotation(id, selected.id, {
        title: annotationEditForm.title.trim(),
        body: annotationEditForm.body.trim(),
        image_key,
      });

      await load();
      setAnnotationEditMode(false);
      setAnnotationEditFile(null);
    } catch (e) {
      setErr(e.message);
    }
  }

  const coverUrl = movie?.cover_url || movie?.cover_image_url || null;

  // Links can come back as array or string; normalize to array for display
  const links = Array.isArray(movie?.links)
    ? movie.links
    : typeof movie?.links === "string"
      ? textToLinks(movie.links)
      : [];

  const selectedImageUrl =
    selected?.image_url ||
    (selected?.image_key ? viewUrlByKey[selected.image_key] : null);

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
                <strong>Runtime:</strong> {movie.runtime_minutes} minutes
              </p>

              <p style={{ marginBottom: 8 }}>
                <strong>Links:</strong>
              </p>

              {links.length ? (
                <ul style={{ marginTop: 0, marginBottom: 12 }}>
                  {links.map((link) => (
                    <li key={link}>
                      <a href={link} target="_blank" rel="noreferrer">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: "#666", marginTop: 0, marginBottom: 12 }}>
                  No links.
                </p>
              )}
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
                value={editForm.runtime_minutes}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    runtime_minutes: e.target.value,
                  }))
                }
                placeholder="Runtime (minutes)"
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <textarea
                value={editForm.links}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, links: e.target.value }))
                }
                placeholder={"Links (one per line)\nhttps://...\nhttps://..."}
                rows={4}
                style={{ width: "100%", padding: 8, marginBottom: 10 }}
              />

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={async () => {
                    setErr("");
                    try {
                      const payload = {
                        title: editForm.title.trim(),
                        director: editForm.director.trim(),
                        year: Number(editForm.year) || null,
                        runtime_minutes: Number(editForm.runtime_minutes) || null,
                        links: textToLinks(editForm.links),
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
                      runtime_minutes: movie.runtime_minutes ?? "",
                      links: linksToText(movie.links),
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
                  title={a.title}
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
              type="number"
              placeholder="Minutes"
              min="0"
              value={form.min}
              onChange={(e) => setForm((f) => ({ ...f, min: e.target.value }))}
              required
              style={{ width: "100%", padding: 8, marginBottom: 10 }}
            />
            <input
              type="number"
              placeholder="Seconds"
              min="0"
              max="59"
              value={form.sec}
              onChange={(e) => setForm((f) => ({ ...f, sec: e.target.value }))}
              required
              style={{ width: "100%", padding: 8, marginBottom: 10 }}
            />
            <input
              placeholder="Annotation title"
              value={form.title}
              onChange={(e) =>
                setForm((f) => ({ ...f, title: e.target.value }))
              }
              required
              style={{ width: "100%", padding: 8, marginBottom: 10 }}
            />
            <textarea
              placeholder="Annotation text"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={4}
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

          {/* Viewer (changes requested)
              1) Remove header "Annotation Viewer"  ✅ (deleted)
              2) Do not display time              ✅ (deleted)
              3) Buttons match rest of page       ✅ (btnPrimary + layout)
              4) Add Edit button between Next and Delete ✅
          */}
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
                    value={annotationEditForm.title}
                    onChange={(e) =>
                      setAnnotationEditForm((f) => ({
                        ...f,
                        title: e.target.value,
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: 12,
                      marginBottom: 12,
                      border: "2px solid #777",
                      borderRadius: 4,
                      fontSize: 22,
                    }}
                    placeholder="Title"
                  />

                  <textarea
                    value={annotationEditForm.body}
                    onChange={(e) =>
                      setAnnotationEditForm((f) => ({
                        ...f,
                        body: e.target.value,
                      }))
                    }
                    rows={4}
                    style={{
                      width: "100%",
                      padding: 12,
                      marginBottom: 12,
                      border: "2px solid #777",
                      borderRadius: 4,
                      fontSize: 20,
                    }}
                    placeholder="Annotation text"
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
                        setAnnotationEditForm({ title: "", body: "" });
                        setAnnotationEditFile(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3 style={{ margin: "0 0 10px 0" }}>{selected.title}</h3>
                  <p style={{ marginTop: 0 }}>{selected.body}</p>
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

                {/* Edit button between Next and Delete */}
                <button
                  type="button"
                  onClick={() => {
                    setAnnotationEditForm({
                      title: selected.title ?? "",
                      body: selected.body ?? "",
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
                      await api.deleteAnnotation(id, selected.id);
                      await load();
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                  style={btnPrimary}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}