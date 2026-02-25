import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { presignUpload, uploadToS3 } from "../api/uploads";

function toSeconds(min, sec) {
  const m = Number(min || 0);
  const s = Number(sec || 0);
  return m * 60 + s;
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function MovieDetailPage() {
  const { id } = useParams();
  const [movie, setMovie] = useState(null);
  const [annotations, setAnnotations] = useState([]);
  const [err, setErr] = useState("");

  const [form, setForm] = useState({ min: "", sec: "", title: "", body: "" });
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // NEW: optional annotation image upload
  const [annotationFile, setAnnotationFile] = useState(null);

  async function load() {
    setErr("");
    try {
      const m = await api.getMovie(id);
      const a = await api.listAnnotations(id);
      a.sort((x, y) => x.time_seconds - y.time_seconds);
      setMovie(m);
      setAnnotations(a);
      setSelectedIndex(a.length ? a.length - 1 : -1);
    } catch (e) {
      setErr(e.message);
    }
  }

  useEffect(() => {
    load();
  }, [id]);

  const runtimeSeconds = useMemo(() => {
    if (!movie?.runtime_minutes) return 0;
    return Number(movie.runtime_minutes) * 60;
  }, [movie]);

  async function addAnnotation(e) {
    e.preventDefault();
    setErr("");

    try {
      const time_seconds = toSeconds(form.min, form.sec);

      let imageKey = null;
      if (annotationFile) {
        const { uploadUrl, key } = await presignUpload({
          movieId: id,
          type: "annotation",
          contentType: annotationFile.type,
        });

        await uploadToS3(uploadUrl, annotationFile);
        imageKey = key;
      }

      const payload = {
        time_seconds,
        title: form.title.trim(),
        body: form.body.trim(),
        image_key: imageKey,
      };

      await api.createAnnotation(id, payload);

      setForm({ min: "", sec: "", title: "", body: "" });
      setAnnotationFile(null);
      await load();
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const selected = selectedIndex >= 0 ? annotations[selectedIndex] : null;

  return (
    <div>
      {err && <p style={{ color: "crimson" }}>{err}</p>}
      {!movie ? (
        <p>Loading...</p>
      ) : (
        <>
          <h3>
            {movie.title} <span style={{ color: "#666" }}>({movie.year})</span>
          </h3>

          <p>
            <b>Director:</b> {movie.director} • <b>Runtime:</b> {movie.runtime_minutes} min •{" "}
            <Link to={`/movies/${movie.id}/edit`}>Edit</Link>
          </p>

          <h4>Timeline</h4>
          <div
            style={{
              position: "relative",
              height: 18,
              background: "#ddd",
              borderRadius: 999,
              marginBottom: 16,
              overflow: "hidden",
            }}
          >
            {annotations.map((a, idx) => {
              const pct =
                runtimeSeconds > 0 ? Math.min(100, (a.time_seconds / runtimeSeconds) * 100) : 0;

              return (
                <button
                  key={a.id}
                  title={`${formatTime(a.time_seconds)} • ${a.title}`}
                  onClick={() => setSelectedIndex(idx)}
                  style={{
                    position: "absolute",
                    left: `${pct}%`,
                    top: 0,
                    transform: "translateX(-50%)",
                    width: 10,
                    height: 18,
                    border: "none",
                    cursor: "pointer",
                    background: idx === selectedIndex ? "#333" : "#555",
                  }}
                />
              );
            })}
          </div>

          <h4>Add Annotation</h4>
          <form onSubmit={addAnnotation} style={{ maxWidth: 560, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="number"
                placeholder="Min"
                min="0"
                value={form.min}
                onChange={(e) => setForm((f) => ({ ...f, min: e.target.value }))}
                required
              />
              <input
                type="number"
                placeholder="Sec"
                min="0"
                max="59"
                value={form.sec}
                onChange={(e) => setForm((f) => ({ ...f, sec: e.target.value }))}
                required
              />
            </div>

            <input
              placeholder="Annotation title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />

            <textarea
              placeholder="Annotation body"
              value={form.body}
              onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
              rows={4}
            />

            <label style={{ display: "grid", gap: 6 }}>
              Screenshot / image (optional)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setAnnotationFile(e.target.files?.[0] ?? null)}
              />
              {annotationFile && (
                <div style={{ fontSize: 12, opacity: 0.8 }}>Selected: {annotationFile.name}</div>
              )}
            </label>

            <button type="submit">Add Annotation</button>
          </form>

          <h4 style={{ marginTop: 24 }}>Annotation Viewer</h4>
          {!selected ? (
            <p>No annotations yet.</p>
          ) : (
            <div style={{ borderTop: "1px solid #ddd", paddingTop: 12 }}>
              <p style={{ margin: 0, color: "#666" }}>{formatTime(selected.time_seconds)}</p>
              <h3 style={{ marginTop: 6 }}>{selected.title}</h3>
              <p>{selected.body}</p>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  disabled={selectedIndex <= 0}
                  onClick={() => setSelectedIndex((i) => Math.max(0, i - 1))}
                >
                  ← Previous
                </button>
                <button
                  disabled={selectedIndex >= annotations.length - 1}
                  onClick={() => setSelectedIndex((i) => Math.min(annotations.length - 1, i + 1))}
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}