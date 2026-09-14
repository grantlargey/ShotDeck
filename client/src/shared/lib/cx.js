/** Joins truthy class names, e.g. `cx(styles.button, active && styles.active)`. */
export function cx(...names) {
  return names.filter(Boolean).join(" ");
}
