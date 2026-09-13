// client/src/pages/movie-form/ui/MovieFormPage.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buildMovieSavePayload, createMovieEditForm, MovieDetailsFields } from "@/entities/movie";
import { movieActions } from "@/features/movie-actions";
import { saveScriptPdf } from "@/features/script-actions";
import { uploadMediaFile } from "@/features/upload-media";
import { api } from "@/shared/api";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors";
import { parseTimeInputToMinutes } from "@/shared/lib/time";
import { Button, Callout, Field, FileInput, PageHeader, Panel } from "@/shared/ui";
import styles from "./MovieFormPage.module.css";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = mode === "edit";

  const [form, setForm] = useState({
    title: "",
    director: "",
    writer: "",
    cinematographer: "",
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
        setErr(getErrorMessage(e, "Failed to load project."));
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
        throw new ValidationError("Please choose a PDF file for the script.");
      }

      const runtimeMinutes = parseTimeInputToMinutes(form.runtime_hms, {
        rounding: "nearest",
      });
      if (runtimeMinutes === null || runtimeMinutes < 1) {
        throw new ValidationError("Runtime must use HH:MM:SS and be at least 00:01:00.");
      }

      const basePayload = buildMovieSavePayload(form, runtimeMinutes);

      if (isEdit) {
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
      setErr(getErrorMessage(e2, "Failed to save project."));
    } finally {
      setSaving(false);
    }
  }

  const coverToShow = coverPreviewUrl || existingCoverUrl;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Projects"
        title={isEdit ? "Edit project" : "New project"}
        description={
          isEdit
            ? "Update the film details, cover image, or script."
            : "Add a film, its cover image, and optionally its script."
        }
      />

      {err && (
        <Callout tone="error" className={styles.notice}>
          {err}
        </Callout>
      )}

      <form className={styles.form} onSubmit={onSubmit}>
        <Panel title="Film details">
          <MovieDetailsFields values={form} onChange={updateField} />
        </Panel>

        <Panel title="Files">
          <div className={styles.files}>
            <Field as="div" label="Cover image" hint="JPG or PNG">
              <div className={styles.cover}>
                {coverToShow ? (
                  <img className={styles.coverPreview} src={coverToShow} alt="Cover preview" />
                ) : (
                  <div className={styles.coverPreview} aria-hidden="true" />
                )}
                <FileInput
                  accept="image/png, image/jpeg"
                  file={coverFile}
                  onChange={setCoverFile}
                  label={coverToShow ? "Replace image" : "Choose image"}
                  placeholder={existingCoverUrl ? "Current cover" : "No file chosen"}
                />
              </div>
            </Field>

            <Field as="div" label="Script PDF" hint="Optional. You can also add it later from the project page.">
              <FileInput accept="application/pdf" file={scriptFile} onChange={setScriptFile} label="Choose PDF" />
            </Field>
          </div>
        </Panel>

        <div className={styles.actions}>
          <Button as={Link} to={isEdit ? `/movies/${id}` : "/movies"}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create project"}
          </Button>
        </div>
      </form>
    </div>
  );
}
