import { useRef } from "react";
import { cx } from "@/shared/lib/cx.js";
import { Button } from "./Button.jsx";
import styles from "./forms.module.css";

/** File picker shown as a button, with the chosen file's name beside it. */
export function FileInput({
  accept,
  file,
  onChange,
  label = "Choose file",
  placeholder = "No file chosen",
  disabled = false,
  className,
}) {
  const inputRef = useRef(null);

  return (
    <div className={cx(styles.file, className)}>
      <Button size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {label}
      </Button>
      {(file || placeholder) && (
        <span className={cx(styles.fileName, !file && styles.fileEmpty)} title={file?.name}>
          {file ? file.name : placeholder}
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className={styles.fileNative}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          // Clear the native value so picking the same file again still fires.
          event.target.value = "";
        }}
      />
    </div>
  );
}
