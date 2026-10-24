import { useMemo } from "react";
import { parseScreenplayMarkdown } from "@/shared/lib/screenplay/grammar.js";
import styles from "./ScreenplayView.module.css";

function ScreenplayElement({ element }) {
  if (element.type === "dualDialogue") {
    return (
      <div className={`${styles.element} ${styles.dualDialogue}`} role="group" aria-label="Simultaneous dialogue">
        {element.columns.map((column, index) => (
          <div key={index} className={styles.dualColumn}>
            {column.map((child, childIndex) => <ScreenplayElement key={childIndex} element={child} />)}
          </div>
        ))}
      </div>
    );
  }

  return <p className={`${styles.element} ${styles[element.type] || ""}`}>{element.text}</p>;
}

/**
 * Renders screenplay markdown with screenplay page layout: bold scene
 * headings, indented character cues, dialogue and parentheticals, and
 * right-aligned transitions. Its type follows the visitor's scene text style
 * (features/scene-text-style), and the paper it sits on should use the same
 * style's --color-paper and --color-ink.
 *
 * - `page` scales the type to the container so a full 60-character action
 *   line fits, like a real script page.
 * - `reader` is `page` with roomier type, for full-size dialogs.
 * - `card` uses compact indents and small type for preview cards.
 */
export function ScreenplayView({ source, variant = "page", maxElements, emptyText = "", className = "" }) {
  const elements = useMemo(() => parseScreenplayMarkdown(source), [source]);
  const visible = maxElements ? elements.slice(0, maxElements) : elements;
  const rootClassName = [
    styles.root,
    variant === "card" ? styles.card : styles.page,
    variant === "reader" && styles.reader,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClassName}>
      <div className={styles.sheet}>
        {visible.length === 0 && emptyText ? (
          <p className={styles.empty}>{emptyText}</p>
        ) : (
          visible.map((element, index) => (
            <ScreenplayElement key={index} element={element} />
          ))
        )}
      </div>
    </div>
  );
}
