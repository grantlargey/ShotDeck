import { formatSecondsToHms, parseTimeInputToSeconds } from "@/shared/lib/time";
import { Field, Input } from "@/shared/ui";
import styles from "./MovieDetailsFields.module.css";

/**
 * Title, director, year, and runtime inputs shared by the project form and the
 * project page's inline editor. `values` matches `createMovieEditForm`.
 */
export function MovieDetailsFields({ values, onChange }) {
  return (
    <div className={styles.grid}>
      <Field label="Title" className={styles.full}>
        <Input value={values.title} onChange={(event) => onChange("title", event.target.value)} required />
      </Field>

      <Field label="Director">
        <Input value={values.director} onChange={(event) => onChange("director", event.target.value)} required />
      </Field>

      <Field label="Release year">
        <Input
          type="number"
          min="1888"
          max="2100"
          value={values.year}
          onChange={(event) => onChange("year", event.target.value)}
          required
        />
      </Field>

      <Field label="Runtime" hint="Format: HH:MM:SS">
        <Input
          value={values.runtime_hms}
          placeholder="00:00:00"
          onChange={(event) => onChange("runtime_hms", event.target.value)}
          onBlur={(event) => {
            const parsed = parseTimeInputToSeconds(event.target.value);
            if (parsed !== null) {
              onChange("runtime_hms", formatSecondsToHms(parsed, { fallback: "00:00:00" }));
            }
          }}
          required
        />
      </Field>
    </div>
  );
}
