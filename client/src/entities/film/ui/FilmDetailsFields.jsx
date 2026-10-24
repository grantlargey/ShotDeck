import { TimeInput } from "@/shared/ui/TimeInput.jsx";
import { Field } from "@/shared/ui/Field.jsx";
import { Input } from "@/shared/ui/Input.jsx";
import { FILM_CREDITS } from "../model/filmCredits.js";
import styles from "./FilmDetailsFields.module.css";

/**
 * Title, crew credits, year, and runtime inputs shared by the film form and
 * the film page's inline editor. `values` matches `createFilmEditForm`.
 */
export function FilmDetailsFields({ values, onChange }) {
  return (
    <div className={styles.grid}>
      <Field label="Title" required className={styles.full}>
        <Input value={values.title} onChange={(event) => onChange("title", event.target.value)} required />
      </Field>

      {FILM_CREDITS.map(({ field, label, required }) => (
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
          numeric
          type="number"
          min="1888"
          max="2100"
          value={values.year}
          onChange={(event) => onChange("year", event.target.value)}
          required
        />
      </Field>

      <Field label="Runtime" hint="Format: HH:MM:SS" required className={styles.half}>
        <TimeInput
          value={values.runtime_hms}
          onValueChange={(value) => onChange("runtime_hms", value)}
          required
        />
      </Field>
    </div>
  );
}
