// client/src/pages/MovieFormPage.jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { presignUpload, uploadToS3 } from "../api/uploads";
import styles from "./MovieFormPage.module.css";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();

  const [form, setForm] = useState({
    title: "",
    director: "",
    year: "",
    runtime_minutes: "",
    links: "", // keep UI; don't send until backend supports it
  });

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [coverFile, setCoverFile] = useState(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState("");
  const [existingCoverUrl, setExistingCoverUrl] = useState("");

  // local preview like old base64 preview
  useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(coverFile);
    setCoverPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [coverFile]);

  useEffect(() => {
    if (mode !== "edit") return;

    (async () => {
      try {
        const m = await api.getMovie(id);

        setForm({
          title: m.title || "",
          director: m.director || "",
          year: String(m.year ?? ""),
          runtime_minutes: String(m.runtime_minutes ?? ""),
          links: Array.isArray(m.links) ? m.links.join("\n") : "",
        });

        // Prefer cover_url / cover_image_url if backend provides it
        setExistingCoverUrl(m.cover_url || m.cover_image_url || "");
      } catch (e) {
        setErr(e.message || "Failed to load movie");
      }
    })();
  }, [mode, id]);

  function updateField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr("");

    try {
      const basePayload = {
        title: form.title.trim(),
        director: form.director.trim(),
        year: Number(form.year),
        runtime_minutes: Number(form.runtime_minutes),

        // Enable ONLY when backend supports it:
        // links: form.links.split("\n").map(s => s.trim()).filter(Boolean),
      };

      if (mode === "edit") {
        // 1) update metadata (no cover change yet)
        await api.updateMovie(id, basePayload);

        // 2) if a new cover file is selected, upload + patch cover_image_key
        if (coverFile) {
          const { uploadUrl, key } = await presignUpload({
            movieId: id,
            type: "cover",
            contentType: coverFile.type,
          });

          await uploadToS3(uploadUrl, coverFile);

          await api.updateMovie(id, { ...basePayload, cover_image_key: key });
        }

        nav(`/movies/${id}`);
        return;
      }

      const created = await api.createMovie(basePayload);

      if (coverFile) {
        const { uploadUrl, key } = await presignUpload({
          movieId: created.id,
          type: "cover",
          contentType: coverFile.type,
        });

        await uploadToS3(uploadUrl, coverFile);

        await api.updateMovie(created.id, { ...basePayload, cover_image_key: key });
      }

      nav(`/movies`);
    } catch (e2) {
      setErr(e2.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  const coverToShow = coverPreviewUrl || existingCoverUrl;

  return (
    <div>
      <h1 className={styles.title}>Create or Edit Movie Entry</h1>
      {err && <div className={styles.error}>{err}</div>}

      <form onSubmit={onSubmit}>
        <label className={styles.label} htmlFor="title">
          Movie Title:
        </label>
        <input
          id="title"
          className={styles.input}
          value={form.title}
          onChange={(e) => updateField("title", e.target.value)}
          required
        />

        <label className={styles.label} htmlFor="director">
          Director:
        </label>
        <input
          id="director"
          className={styles.input}
          value={form.director}
          onChange={(e) => updateField("director", e.target.value)}
          required
        />

        <label className={styles.label} htmlFor="year">
          Release Year:
        </label>
        <input
          id="year"
          type="number"
          min="1888"
          max="2100"
          className={styles.input}
          value={form.year}
          onChange={(e) => updateField("year", e.target.value)}
          required
        />

        <label className={styles.label} htmlFor="runtime">
          Runtime (minutes):
        </label>
        <input
          id="runtime"
          type="number"
          min="1"
          className={styles.input}
          value={form.runtime_minutes}
          onChange={(e) => updateField("runtime_minutes", e.target.value)}
          required
        />

        <label className={styles.label} htmlFor="cover">
          Upload Cover Image (.jpg, .png):
        </label>
        <input
          id="cover"
          type="file"
          accept="image/png, image/jpeg"
          onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
        />

        {coverToShow && (
          <img className={styles.previewImg} src={coverToShow} alt="Cover Preview" />
        )}

        <label className={styles.label} htmlFor="links">
          Links to scripts/articles (optional):
        </label>
        <textarea
          id="links"
          className={styles.textarea}
          placeholder="Paste URLs here, one per line..."
          value={form.links}
          onChange={(e) => updateField("links", e.target.value)}
        />

        <button className={styles.button} disabled={saving} type="submit">
          {saving ? "Saving..." : "Save Entry"}
        </button>
      </form>
    </div>
  );
}