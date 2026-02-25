import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { presignUpload, uploadToS3 } from "../api/uploads";

export default function MovieFormPage({ mode }) {
  const { id } = useParams();
  const nav = useNavigate();

  const [form, setForm] = useState({
    title: "",
    director: "",
    year: "",
    runtime_minutes: "",
  });

  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [coverFile, setCoverFile] = useState(null);

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
        });
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
      const payload = {
        title: form.title.trim(),
        director: form.director.trim(),
        year: Number(form.year),
        runtime_minutes: Number(form.runtime_minutes),
      };

      if (mode === "edit") {
        // Update core fields
        const updated = await api.updateMovie(id, payload);

        // Optional: upload new cover and then update cover_image_key
        if (coverFile) {
          const { uploadUrl, key } = await presignUpload({
            movieId: id,
            type: "cover",
            contentType: coverFile.type,
          });

          await uploadToS3(uploadUrl, coverFile);

          await api.updateMovie(id, {
            ...updated,
            cover_image_key: key,
          });
        }

        nav(`/movies/${id}`);
        return;
      }

      // CREATE mode:
      const created = await api.createMovie(payload);

      if (coverFile) {
        const { uploadUrl, key } = await presignUpload({
          movieId: created.id,
          type: "cover",
          contentType: coverFile.type,
        });

        await uploadToS3(uploadUrl, coverFile);

        await api.updateMovie(created.id, {
          ...created,
          cover_image_key: key,
        });
      }

      nav(`/movies/${created.id}`);
    } catch (e) {
      setErr(e.message || "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h3>{mode === "edit" ? "Edit Movie" : "Create Movie"}</h3>
      {err && <p style={{ color: "crimson" }}>{err}</p>}

      <form
        onSubmit={onSubmit}
        style={{ maxWidth: 480, display: "grid", gap: 12 }}
      >
        <label>
          Title
          <input
            value={form.title}
            onChange={(e) => updateField("title", e.target.value)}
            required
          />
        </label>

        <label>
          Director
          <input
            value={form.director}
            onChange={(e) => updateField("director", e.target.value)}
            required
          />
        </label>

        <label>
          Year
          <input
            type="number"
            value={form.year}
            onChange={(e) => updateField("year", e.target.value)}
            required
          />
        </label>

        <label>
          Runtime (minutes)
          <input
            type="number"
            value={form.runtime_minutes}
            onChange={(e) => updateField("runtime_minutes", e.target.value)}
            required
          />
        </label>

        <label>
          Cover image (optional)
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
          />
          {coverFile && (
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Selected: {coverFile.name}
            </div>
          )}
        </label>

        <button disabled={saving} type="submit">
          {saving ? "Saving..." : "Save"}
        </button>
      </form>
    </div>
  );
}