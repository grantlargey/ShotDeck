import { useRef, useState } from "react";
import { cx } from "@/shared/lib/cx";
import { UploadIcon } from "./icons.jsx";
import styles from "./FileDropzone.module.css";

function matchesAccept(file, accept) {
  if (!accept) return true;
  return accept
    .split(",")
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean)
    .some((type) => {
      if (type.startsWith(".")) return file.name.toLowerCase().endsWith(type);
      if (type.endsWith("/*")) return file.type.startsWith(type.slice(0, -1));
      return file.type === type;
    });
}

/**
 * Click-or-drop file picker. With a `preview` (such as an <img>), the preview
 * fills the zone and the label sits over its bottom edge. A dropped file that
 * doesn't match `accept` goes to `onReject` instead of `onChange`.
 */
export function FileDropzone({
  accept,
  file,
  onChange,
  onReject,
  title,
  hint,
  preview,
  disabled = false,
  className,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function takeFile(files) {
    const next = files?.[0];
    if (!next) return;
    if (matchesAccept(next, accept)) onChange(next);
    else onReject?.(next);
  }

  return (
    <div
      className={cx(
        styles.zone,
        preview && styles.withPreview,
        dragging && styles.dragging,
        disabled && styles.disabled,
        className
      )}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) takeFile(event.dataTransfer.files);
      }}
    >
      <button type="button" className={styles.trigger} disabled={disabled} onClick={() => inputRef.current?.click()}>
        {preview && <span className={styles.preview}>{preview}</span>}
        <span className={styles.body}>
          {!preview && <UploadIcon size={20} className={styles.icon} />}
          <span className={styles.title}>{file ? file.name : title}</span>
          {hint && <span className={styles.hint}>{hint}</span>}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={styles.native}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          takeFile(event.target.files);
          // Clear the native value so picking the same file again still fires.
          event.target.value = "";
        }}
      />
    </div>
  );
}
