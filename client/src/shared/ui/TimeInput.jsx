import { useLayoutEffect, useRef, useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { normalizeTypedMoment, normalizeTypedTime } from "@/shared/lib/time.js";
import { Input } from "./Input.jsx";
import styles from "./TimeInput.module.css";

// Colons and empty slots are decoration; a decimal point stays part of the entry.
const entryOf = (text) => text.replace(/[^\d.]/g, "");

function timecode(entry, padding) {
  const [whole, fraction] = entry.split(".");
  const slots = whole.padStart(6, padding);
  const hms = `${slots.slice(0, -4)}:${slots.slice(-4, -2)}:${slots.slice(-2)}`;
  return fraction === undefined ? hms : `${hms}.${fraction}`;
}

/**
 * Right-to-left HH:MM:SS entry. onValueChange receives a padded time (or "")
 * immediately, so consumers can validate/save without waiting for blur.
 * `tenths` permits an explicit decimal and one digit; `inline` inherits the
 * surrounding typography instead of using the standard boxed input styling.
 * Native input props and events are forwarded; preventing a key's default
 * lets a consumer own shortcuts such as Enter to save or Escape to discard.
 */
export function TimeInput({
  value = "", onValueChange, tenths = false, inline = false, className,
  onFocus, onBlur, onKeyDown, disabled, readOnly, ...props
}) {
  const [editing, setEditing] = useState(null);
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);
  const entry = editing?.value === value ? editing.entry : entryOf(value);
  const display = editing !== null && entry ? timecode(entry, "_") : value;
  const visible = entry ? display : "HH:MM:SS";
  const normalize = tenths ? normalizeTypedMoment : normalizeTypedTime;

  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  function update(nextEntry, beforeCaret = nextEntry.length) {
    if (disabled || readOnly) return;
    if (!(tenths ? /^\d{0,6}(\.\d?)?$/ : /^\d{0,6}$/).test(nextEntry)) return;
    const nextValue = nextEntry ? timecode(nextEntry, "0") : "";
    const mask = nextEntry ? timecode(nextEntry, "_") : "";
    const positions = [...mask].flatMap((char, index) => /[\d.]/.test(char) ? [index] : []);
    pendingCaret.current = beforeCaret > 0 ? positions[beforeCaret - 1] + 1 : positions[0] ?? 0;
    setEditing({ value: nextValue, entry: nextEntry });
    onValueChange(nextValue);
  }

  function handleKeyDown(event) {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing || disabled || readOnly) return;
    if (event.key === "Enter") {
      event.currentTarget.blur();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (start !== end) return;
    event.preventDefault();
    const before = entryOf(display.slice(0, start)).length;
    const index = event.key === "Backspace" ? before - 1 : before;
    if (index < 0 || index >= entry.length) return;
    update(entry.slice(0, index) + (entry[index] === "." ? "" : entry.slice(index + 1)), index);
  }

  const Control = inline ? "input" : Input;
  return (
    <span className={cx(styles.control, inline && styles.inline, className)}>
      <Control
        {...props}
        ref={inputRef}
        className={styles.input}
        inputMode={tenths ? "decimal" : "numeric"}
        placeholder="HH:MM:SS"
        value={display}
        disabled={disabled}
        readOnly={readOnly}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => {
          setEditing({ value, entry: entryOf(value) });
          onFocus?.(event);
        }}
        onChange={(event) => {
          const text = event.target.value;
          if (/[^\d:_.]/.test(text)) return;
          update(entryOf(text), entryOf(text.slice(0, event.target.selectionStart)).length);
        }}
        onKeyDown={handleKeyDown}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData("text").trim();
          if (!/^[\d:.]+$/.test(text)) return;
          const pasted = entryOf(text.includes(":") ? normalize(text) : text);
          const { selectionStart: start, selectionEnd: end } = event.currentTarget;
          const before = entryOf(display.slice(0, start));
          const after = entryOf(display.slice(end));
          update(before + pasted + after, before.length + pasted.length);
        }}
        onBlur={(event) => {
          setEditing(null);
          const normalized = normalize(value.endsWith(".") ? value.slice(0, -1) : value);
          if (normalized !== value && !disabled && !readOnly) onValueChange(normalized);
          onBlur?.(event);
        }}
      />
      <span className={styles.mask} aria-hidden="true">
        {[...visible].map((char, index) => (
          <span key={index} className={!entry || char === "_" || (char === ":" && !/\d/.test(visible.slice(0, index))) ? styles.dim : undefined}>
            {char === "_" ? "0" : char}
          </span>
        ))}
      </span>
    </span>
  );
}
