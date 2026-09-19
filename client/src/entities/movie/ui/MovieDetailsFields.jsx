import { normalizeTypedTime } from "@/shared/lib/time.js";
import { Field } from "@/shared/ui/Field.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { MOVIE_CREDITS } from "../model/movieCredits.js";
import styles from "./MovieDetailsFields.module.css";

/**
 * Title, crew credits, year, and runtime inputs shared by the project form and
 * the project page's inline editor. `values` matches `createMovieEditForm`.
 */
export function MovieDetailsFields({ values, onChange }) {
  return (
    <div className={styles.grid}>
      <Field label="Title" required className={styles.full}>
        <Input value={values.title} onChange={(event) => onChange("title", event.target.value)} required />
      </Field>

      {MOVIE_CREDITS.map(({ field, label, required }) => (
        <Field key={field} label={label} required={required} className={styles.third}>
          <Input
            value={values[field]}
            placeholder={required ? undefined : "Optional"}
            onChange={(event) => onChange(field, event.target.value)}
            required={required}
          />
        </Field>
      ))}

      <Field label="Release year" required className={styles.half}>
        <Input
          type="number"
          min="1888"
          max="2100"
          value={values.year}
          onChange={(event) => onChange("year", event.target.value)}
          required
        />
      </Field>

      <Field label="Runtime" hint="Format: HH:MM:SS" required className={styles.half}>
        <Input
          value={values.runtime_hms}
          placeholder="00:00:00"
          onChange={(event) => onChange("runtime_hms", event.target.value)}
          onBlur={(event) => {
            const typed = event.target.value;
            const normalized = normalizeTypedTime(typed);
            if (normalized !== typed) onChange("runtime_hms", normalized);
          }}
          required
        />
      </Field>
    </div>
  );
}
