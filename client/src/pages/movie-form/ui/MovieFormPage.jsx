// client/src/pages/movie-form/ui/MovieFormPage.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buildMovieSavePayload, createMovieEditForm } from "@/entities/movie/model/movieForms.js";
import { MovieDetailsFields } from "@/entities/movie/ui/MovieDetailsFields.jsx";
import { createMovie, getMovie, updateMovie } from "@/shared/api/movies.js";
import { saveScript } from "@/shared/api/scripts.js";
import { uploadMediaFile } from "@/shared/api/uploads.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage, ValidationError } from "@/shared/lib/errors.js";
import { useFilePreviewUrl } from "@/shared/lib/media/useFilePreviewUrl.js";
import { parseTimeInputToMinutes } from "@/shared/lib/time.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { FileDropzone } from "@/shared/ui/FileDropzone.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import styles from "./MovieFormPage.module.css";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();
  const isEdit = mode === "edit";
  useDocumentTitle(isEdit ? "Edit project" : "New project");

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
  const [existingCoverUrl, setExistingCoverUrl] = useState("");
  const coverPreviewUrl = useFilePreviewUrl(coverFile);

  useEffect(() => {
    if (mode !== "edit") return;

    (async () => {
      try {
        const m = await getMovie(id);

        setForm(createMovieEditForm(m));

        setExistingCoverUrl(m.cover_image_url || "");
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

      const runtimeMinutes = parseTimeInputToMinutes(form.runtime_hms);
      if (runtimeMinutes === null || runtimeMinutes < 1) {
        throw new ValidationError("Runtime must use HH:MM:SS and be at least 00:01:00.");
      }

      const basePayload = buildMovieSavePayload(form, runtimeMinutes);

      if (isEdit) {
        await updateMovie(id, basePayload);

        if (coverFile) {
          const key = await uploadMediaFile({
            movieId: id,
            type: "cover",
            file: coverFile,
          });

          await updateMovie(id, { ...basePayload, cover_image_key: key });
        }

        if (scriptFile) {
          await saveScript({ movieId: id, file: scriptFile });
        }

        nav(`/movies/${id}`);
        return;
      }

      const created = await createMovie(basePayload);

      if (coverFile) {
        const key = await uploadMediaFile({
          movieId: created.id,
          type: "cover",
          file: coverFile,
        });

        await updateMovie(created.id, { ...basePayload, cover_image_key: key });
      }

      if (scriptFile) {
        await saveScript({ movieId: created.id, file: scriptFile });
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
        <div className={styles.coverColumn}>
          <FileDropzone
            className={styles.coverDrop}
            accept="image/png, image/jpeg"
            file={coverFile}
            onChange={setCoverFile}
            onReject={() => setErr("The cover image must be a JPG or PNG.")}
            title={coverToShow ? "Replace cover" : "Add a cover image"}
            hint={coverToShow ? "Drop or click to change" : "JPG or PNG · drop or click"}
            preview={coverToShow ? <img src={coverToShow} alt="" /> : null}
          />
        </div>

        <div className={styles.fieldsColumn}>
          <section aria-labelledby="project-form-details">
            <SectionHeading id="project-form-details" title="Film details" />
            <MovieDetailsFields values={form} onChange={updateField} />
          </section>

          <section aria-labelledby="project-form-script">
            <SectionHeading id="project-form-script" title="Script" badge={<Badge>Optional</Badge>} />
            <FileDropzone
              accept="application/pdf"
              file={scriptFile}
              onChange={setScriptFile}
              onReject={() => setErr("The script must be a PDF file.")}
              title={isEdit ? "Upload a new script PDF" : "Add the script PDF"}
              hint="Drop a PDF here or click to choose. You can also add it later from the project page."
            />
          </section>

          <div className={styles.actions}>
            <p className={styles.requiredNote}>
              <span aria-hidden="true">*</span> Required
            </p>
            <Button as={Link} to={isEdit ? `/movies/${id}` : "/movies"}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create project"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
