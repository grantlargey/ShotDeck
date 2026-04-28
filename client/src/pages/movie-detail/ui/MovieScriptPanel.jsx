export function MovieScriptPanel({
  btnPrimary,
  btnSecondary,
  currentScript,
  onChoosePdf,
  onSaveScript,
  onScriptFileChange,
  onViewPdf,
  savingScript,
  scriptFile,
}) {
  return (
    <div
      style={{
        marginTop: 10,
        marginBottom: 16,
        padding: "10px 12px",
        border: "1px solid #ddd",
        borderRadius: 8,
        background: "#fafafa",
        maxWidth: 900,
      }}
    >
      <p style={{ margin: "0 0 8px 0" }}>
        <strong>Script PDF:</strong> {currentScript ? "Available" : "No script uploaded yet"}
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          style={{
            ...btnPrimary,
            opacity: currentScript ? 1 : 0.5,
            cursor: currentScript ? "pointer" : "not-allowed",
          }}
          disabled={!currentScript}
          onClick={onViewPdf}
        >
          View PDF
        </button>

        <button type="button" style={btnSecondary} onClick={onChoosePdf}>
          {currentScript ? "Replace PDF" : "Upload PDF"}
        </button>

        <button
          type="button"
          style={{
            ...btnPrimary,
            opacity: scriptFile ? 1 : 0.6,
            cursor: scriptFile ? "pointer" : "not-allowed",
          }}
          disabled={!scriptFile || savingScript}
          onClick={onSaveScript}
        >
          {savingScript ? "Saving..." : "Save Script"}
        </button>

        <input
          id="scriptPdfInput"
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={onScriptFileChange}
        />
      </div>

      {scriptFile && (
        <p style={{ margin: "8px 0 0", fontSize: 12, color: "#666" }}>
          Selected PDF: {scriptFile.name}
        </p>
      )}
    </div>
  );
}
