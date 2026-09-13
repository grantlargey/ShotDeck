import { MovieDetailsFields } from "@/entities/movie";
import { Button, Panel } from "@/shared/ui";
import styles from "./MovieDetailPage.module.css";

export function MovieEditPanel({ editForm, setEditForm, onCancel, onSave }) {
  return (
    <Panel title="Edit details">
      <MovieDetailsFields
        values={editForm}
        onChange={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
      />

      <div className={styles.panelActions}>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={onSave}>
          Save changes
        </Button>
      </div>
    </Panel>
  );
}
