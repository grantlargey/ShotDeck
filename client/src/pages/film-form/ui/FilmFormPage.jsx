// client/src/pages/film-form/ui/FilmFormPage.jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createFilmEditForm } from "@/entities/film/model/filmForms.js";
import { useFilmSave } from "@/entities/film/model/filmSave.js";
import { FilmDetailsFields } from "@/entities/film/ui/FilmDetailsFields.jsx";
import { useSession } from "@/entities/session/model/useSession.js";
import { getFilm } from "@/shared/api/films.js";
import { useDocumentTitle } from "@/shared/lib/useDocumentTitle.js";
import { getErrorMessage } from "@/shared/lib/errors.js";
import { useFilePreviewUrl } from "@/shared/lib/media/useFilePreviewUrl.js";
import { Badge } from "@/shared/ui/Badge.jsx";
import { Button } from "@/shared/ui/Button.jsx";
import { Callout } from "@/shared/ui/Callout.jsx";
import { FileDropzone } from "@/shared/ui/FileDropzone.jsx";
import { PageHeader } from "@/shared/ui/PageHeader.jsx";
import { SectionHeading } from "@/shared/ui/SectionHeading.jsx";
import styles from "./FilmFormPage.module.css";

export default function FilmFormPage({ mode }) {
  const { id } = useParams();
  const { user } = useSession();
  return <FilmForm key={`${user?.id}:${mode}:${id}`} mode={mode} id={id} ownerId={user?.id} />;
}

function FilmForm({ mode, id, ownerId }) {
  const nav = useNavigate();
  const isEdit = mode === "edit";
  const filmSave = useFilmSave({ filmId: isEdit ? id : null, ownerId });
  const { saving } = filmSave;
  const [recoveredForm] = useState(filmSave.recovery?.form);
  useDocumentTitle(isEdit ? "Edit film" : "Add a film");

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
        const m = await getFilm(id);
        if (cancelled) return;
        setForm(recoveredForm || createFilmEditForm(m));
        setExistingCoverUrl(m.cover_image_url || "");
      } catch (e) {
        if (!cancelled) setErr(getErrorMessage(e, "Failed to load film."));
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
      nav(isEdit ? `/films/${saved.filmId}` : "/library");
    } catch (e2) {
      setErr(getErrorMessage(e2, "Failed to save film."));
    }
  }

  const coverToShow = coverPreviewUrl || existingCoverUrl;

  function leaveForm() {
    if (filmSave.recovery) {
      if (!window.confirm("Leave this unfinished save? Completed work will stay saved. Unsaved inputs will be discarded.")) return;
      try { filmSave.leave(); }
      catch (error) { setErr(getErrorMessage(error)); return; }
    }
    nav(isEdit ? `/films/${id}` : "/library");
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Library"
        title={isEdit ? "Edit film" : "Add a film"}
        description={
          isEdit
            ? "Update the film details, cover image, or script."
            : "Enter its details, add a cover image, and optionally attach its script."
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
            <section aria-labelledby="film-form-details">
              <SectionHeading id="film-form-details" title="Film details" />
              <FilmDetailsFields values={form} onChange={updateField} />
            </section>

            <section aria-labelledby="film-form-script">
              <SectionHeading id="film-form-script" title="Script" badge={<Badge>Optional</Badge>} />
              <FileDropzone
                accept="application/pdf"
                disabled={saving}
                file={scriptFile}
                onChange={setScriptFile}
                onReject={() => setErr("The script must be a PDF file.")}
                title={isEdit ? "Upload a new script PDF" : "Add the script PDF"}
                hint="Drop a PDF here or click to choose. You can also add it later from the film's page."
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
                {saving ? "Saving…" : filmSave.recovery ? "Retry save" : isEdit ? "Save changes" : "Add film"}
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
