// client/src/pages/movie-form/ui/MovieFormPage.jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { buildMovieSavePayload, createMovieEditForm } from "@/entities/movie";
import { movieActions } from "@/features/movie-actions";
import { saveScriptPdf } from "@/features/script-actions";
import { uploadMediaFile } from "@/features/upload-media";
import { api } from "@/shared/api";
import {
  formatSecondsToHms,
  parseTimeInputToMinutes,
  parseTimeInputToSeconds,
} from "@/shared/lib/time";
import styles from "./MovieFormPage.module.css";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();

  const [form, setForm] = useState({
    title: "",
    director: "",
    year: "",
    runtime_hms: "",
  });

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const [coverFile, setCoverFile] = useState(null);
  const [scriptFile, setScriptFile] = useState(null);
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

        setForm(createMovieEditForm(m));

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
      if (scriptFile && scriptFile.type !== "application/pdf") {
        throw new Error("Please choose a PDF file for the script.");
      }

      const runtimeMinutes = parseTimeInputToMinutes(form.runtime_hms, {
        rounding: "nearest",
      });
      if (runtimeMinutes === null || runtimeMinutes < 1) {
        throw new Error("Runtime must use HH:MM:SS and be at least 00:01:00.");
      }

      const basePayload = buildMovieSavePayload(form, runtimeMinutes);

      if (mode === "edit") {
        await movieActions.update(id, basePayload);

        if (coverFile) {
          const key = await uploadMediaFile({
            movieId: id,
            type: "cover",
            file: coverFile,
          });

          await movieActions.update(id, { ...basePayload, cover_image_key: key });
        }

        if (scriptFile) {
          await saveScriptPdf({ movieId: id, file: scriptFile });
        }

        nav(`/movies/${id}`);
        return;
      }

      const created = await movieActions.create(basePayload);

      if (coverFile) {
        const key = await uploadMediaFile({
          movieId: created.id,
          type: "cover",
          file: coverFile,
        });

        await movieActions.update(created.id, { ...basePayload, cover_image_key: key });
      }

      if (scriptFile) {
        await saveScriptPdf({ movieId: created.id, file: scriptFile });
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
          Runtime (HH:MM:SS):
        </label>
        <input
          id="runtime"
          type="text"
          className={styles.input}
          value={form.runtime_hms}
          onChange={(e) => updateField("runtime_hms", e.target.value)}
          onBlur={(e) => {
            const parsed = parseTimeInputToSeconds(e.target.value);
            if (parsed !== null) {
              updateField("runtime_hms", formatSecondsToHms(parsed, { fallback: "00:00:00" }));
            }
          }}
          placeholder="00:00:00"
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

        <label className={styles.label} htmlFor="scriptPdf">
          Upload Script PDF (.pdf, optional):
        </label>
        <input
          id="scriptPdf"
          type="file"
          accept="application/pdf"
          onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
        />
        {scriptFile && <p className={styles.helperText}>Selected PDF: {scriptFile.name}</p>}

        <button className={styles.button} disabled={saving} type="submit">
          {saving ? "Saving..." : "Save Entry"}
        </button>
      </form>
    </div>
  );
}
