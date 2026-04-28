import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";

export function MovieEditPanel({
  btnPrimary,
  btnSecondary,
  editForm,
  onCancel,
  onSave,
  setEditForm,
}) {
  return (
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
        onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
        placeholder="Title"
        style={{ width: "100%", padding: 8, marginBottom: 10 }}
      />

      <input
        value={editForm.director}
        onChange={(e) => setEditForm((f) => ({ ...f, director: e.target.value }))}
        placeholder="Director"
        style={{ width: "100%", padding: 8, marginBottom: 10 }}
      />

      <input
        value={editForm.year}
        onChange={(e) => setEditForm((f) => ({ ...f, year: e.target.value }))}
        placeholder="Year"
        style={{ width: "100%", padding: 8, marginBottom: 10 }}
      />

      <input
        value={editForm.runtime_hms}
        onChange={(e) => setEditForm((f) => ({ ...f, runtime_hms: e.target.value }))}
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
        <button type="button" onClick={onSave} style={btnPrimary}>
          Save
        </button>

        <button type="button" onClick={onCancel} style={btnSecondary}>
          Cancel
        </button>
      </div>
    </div>
  );
}
