// client/src/pages/movie-form/ui/MovieFormPage.jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createMovieEditForm } from "@/entities/movie/model/movieForms.js";
import { useFilmSave } from "@/entities/movie/model/filmSave.js";
import { MovieDetailsFields } from "@/entities/movie/ui/MovieDetailsFields.jsx";
import { useSession } from "@/entities/session/model/useSession.js";
import { getMovie } from "@/shared/api/movies.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useFilePreviewUrl } from "@/shared/lib/media/useFilePreviewUrl.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { FileDropzone } from "@/shared/ui/FileDropzone.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import styles from "./MovieFormPage.module.css";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const { user } = useSession();
  return <MovieForm key={`${user?.id}:${mode}:${id}`} mode={mode} id={id} ownerId={user?.id} />;
}

function MovieForm({ mode, id, ownerId }) {
  const nav = useNavigate();
  const isEdit = mode === "edit";
  const filmSave = useFilmSave({ movieId: isEdit ? id : null, ownerId });
  const { saving } = filmSave;
  const [recoveredForm] = useState(filmSave.recovery?.form);
  useDocumentTitle(isEdit ? "Edit project" : "New project");

  const [form, setForm] = useState(() => recoveredForm || {
    title: "",
    director: "",
    writer: "",
    cinematographer: "",
    year: "",
    runtime_hms: "",
  });

  const [err, setErr] = useState("");

  const [coverFile, setCoverFile] = useState(null);
  const [scriptFile, setScriptFile] = useState(null);
  const [existingCoverUrl, setExistingCoverUrl] = useState("");
  const coverPreviewUrl = useFilePreviewUrl(coverFile);

  useEffect(() => {
    if (mode !== "edit") return;
    let cancelled = false;
    (async () => {
      try {
        const m = await getMovie(id);
        if (cancelled) return;
        setForm(recoveredForm || createMovieEditForm(m));
        setExistingCoverUrl(m.cover_image_url || "");
      } catch (e) {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load project."));
      }
    })();
    return () => { cancelled = true; };
  }, [mode, id, recoveredForm]);

  function updateField(k, v) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");

    try {
      const saved = await filmSave.save({ form, coverFile, scriptFile });
      nav(isEdit ? `/movies/${saved.movieId}` : "/movies");
    } catch (e2) {
      setErr(getErrorMessage(e2, "Failed to save project."));
    }
  }

  const coverToShow = coverPreviewUrl || existingCoverUrl;

  function leaveForm() {
    if (filmSave.recovery) {
      if (!window.confirm("Leave this unfinished save? Completed work will stay saved. Unsaved inputs will be discarded.")) return;
      try { filmSave.leave(); }
      catch (error) { setErr(getErrorMessage(error)); return; }
    }
    nav(isEdit ? `/movies/${id}` : "/movies");
  }

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

      {filmSave.recovery && !saving && (
        <Callout tone="info" className={styles.notice}>{filmSave.recovery.message}</Callout>
      )}

      <form onSubmit={onSubmit}>
        <fieldset className={styles.form} disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className={styles.coverColumn}>
            <FileDropzone
              className={styles.coverDrop}
              accept="image/png, image/jpeg"
              disabled={saving}
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
                disabled={saving}
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
              <Button onClick={leaveForm} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : filmSave.recovery ? "Retry save" : isEdit ? "Save changes" : "Create project"}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
