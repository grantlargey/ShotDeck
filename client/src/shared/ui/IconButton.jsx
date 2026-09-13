import { cx } from "@/shared/lib/cx";
import styles from "./IconButton.module.css";

/**
 * Square button holding only an icon or glyph; `label` becomes its accessible
 * name.
 *
 * variant: ghost | secondary | overlay (for use on top of images)
 * size: sm (32px) | md (40px)
 */
export function IconButton({ label, size = "md", variant = "ghost", className, children, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cx(styles.iconButton, styles[size], styles[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
}
