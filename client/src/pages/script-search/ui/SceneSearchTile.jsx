import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/shared/lib/cx.js";
import { isTypingTarget } from "@/shared/lib/keyboard.js";
import { useMediaQuery } from "@/shared/lib/useMediaQuery.js";
import { usePrefersReducedMotion } from "@/shared/lib/usePrefersReducedMotion.js";
import { CloseIcon, SearchIcon } from "@/shared/ui/icons.jsx";
import { createExampleDeck, SEARCH_EXAMPLES } from "../model/searchExamples.js";
import styles from "./SceneSearchTile.module.css";

// At this width and below, the open tile lifts out of its place and spans the toolbar row.
const SPANNING_QUERY = "(max-width: 900px)";
// How the examples are typed: a character at a time, a hold on the whole example,
// quicker backspacing, then a short pause before the next one deals.
const START_MS = 450;
const STEP_MS = { typing: 55, holding: 1900, erasing: 18, pausing: 300 };
// After the field is emptied, the examples wait this long before typing again.
const RESUME_MS = 1200;
// Room the buttons at the end of the field take, so text stops short of them.
const TOOL_SPACE = { take: 44, clear: 26, shutter: 26 };

function normalize(text) {
  return text.replace(/\s+/g, " ").trim();
}

/** Keeps the field focused while one of its buttons is pressed. */
function hold(event) {
  event.preventDefault();
}

/** Starts a caret's blink over, so it stays lit while it moves and blinks while it waits. */
function restartBlink(caret) {
  for (const animation of caret?.getAnimations?.() ?? []) animation.currentTime = 0;
}

/**
 * Example descriptions typed out in Slate capitals: each grows a character at
 * a time, holds, and is taken back before the next is dealt. The one on screen
 * goes to `exampleRef` for Tab, and to the take key, which searches for it.
 * With reduced motion an example shows whole and stays put.
 */
function TypedExample({ deck, reducedMotion, exampleRef, onTake }) {
  const [typed, setTyped] = useState(() => {
    if (!reducedMotion) return { example: "", shown: 0 };
    const example = deck.next();
    return { example, shown: example.length };
  });
  const boxRef = useRef(null);
  const lineRef = useRef(null);
  const caretRef = useRef(null);
  const visible = typed.shown > 0 ? typed.example : "";

  useEffect(() => {
    if (reducedMotion) return undefined;
    let example = "";
    let shown = 0;
    // The first step deals the first example.
    let phase = "pausing";
    let timer;
    function step() {
      if (phase === "typing") {
        shown += 1;
        if (shown >= example.length) phase = "holding";
      } else if (phase === "holding") {
        phase = "erasing";
      } else if (phase === "erasing") {
        shown -= 1;
        if (shown <= 0) phase = "pausing";
      } else {
        example = deck.next();
        shown = 0;
        phase = "typing";
      }
      setTyped({ example, shown });
      timer = setTimeout(step, STEP_MS[phase]);
    }
    timer = setTimeout(step, START_MS);
    return () => clearTimeout(timer);
  }, [deck, reducedMotion]);

  useEffect(() => {
    exampleRef.current = visible;
    return () => {
      exampleRef.current = "";
    };
  }, [exampleRef, visible]);

  // A long example scrolls as it types, so the caret stays in sight, lit while it moves.
  useLayoutEffect(() => {
    const box = boxRef.current;
    const line = lineRef.current;
    if (!box || !line) return;
    const overflow = Math.max(0, line.scrollWidth - box.clientWidth);
    line.style.transform = overflow ? `translateX(${-overflow}px)` : "";
    restartBlink(caretRef.current);
  }, [typed]);

  return (
    <>
      <span ref={boxRef} className={styles.example} aria-hidden="true">
        <span ref={lineRef} className={styles.exampleLine}>
          {typed.example.slice(0, typed.shown)}
          <span ref={caretRef} className={styles.caret} />
        </span>
      </span>
      {visible && (
        <span className={styles.tools}>
          <button
            type="button"
            className={styles.take}
            aria-label={`Search for “${visible}”`}
            onMouseDown={hold}
            onClick={() => onTake(visible)}
          >
            <span className={styles.takeKey} aria-hidden="true">
              tab
            </span>
            <span className={styles.takeTap} aria-hidden="true">
              Try
            </span>
          </button>
        </span>
      )}
    </>
  );
}

/**
 * The field's own caret, drawn as the examples' underscore. It sits after the
 * text up to the insertion point, so under the character it types over, and
 * it's hidden while text is selected. It reads the field directly, because
 * the browser moves the insertion point and scrolls long text on its own.
 */
function FieldCaret({ inputRef, value }) {
  const lineRef = useRef(null);
  const textRef = useRef(null);
  const caretRef = useRef(null);

  // Runs again for each new value, since React sets a value given to the field
  // (a taken example, Escape's last search) and the insertion point moves with it.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    let placed = null;
    function place() {
      const start = input.selectionStart ?? input.value.length;
      textRef.current.textContent = input.value.slice(0, start);
      lineRef.current.style.transform = input.scrollLeft ? `translateX(${-input.scrollLeft}px)` : "";
      caretRef.current.style.visibility = start === input.selectionEnd ? "" : "hidden";
      const at = `${start}:${input.value}`;
      if (at !== placed) {
        placed = at;
        restartBlink(caretRef.current);
      }
    }
    place();
    const events = ["input", "select", "keyup", "pointerup", "scroll"];
    for (const type of events) input.addEventListener(type, place);
    document.addEventListener("selectionchange", place);
    return () => {
      for (const type of events) input.removeEventListener(type, place);
      document.removeEventListener("selectionchange", place);
    };
  }, [inputRef, value]);

  return (
    <span className={styles.example} aria-hidden="true">
      <span ref={lineRef} className={cx(styles.exampleLine, styles.caretLine)}>
        <span ref={textRef} className={styles.caretText} />
        <span ref={caretRef} className={styles.caret} />
      </span>
    </span>
  );
}

/**
 * Script Search's semantic search: a 36px viewfinder tile beside the card
 * switches. Opening it (a click, a tap, or "/") widens it into a field as its
 * corners pull focus, and example descriptions type themselves out until you
 * type. What you type is set like them, under the same underscore caret.
 * Tab or → takes the example being typed; its key (Try on touch screens)
 * searches for it. Enter or the shutter searches and closes the tile; the page
 * shows the search as a tag.
 *
 * value: the description in the field; query: the one last searched.
 * fieldRef: the tile's box, for the tag to fly in from. inputRef: the field.
 */
export function SceneSearchTile({
  value,
  query,
  examples = SEARCH_EXAMPLES,
  disabled = false,
  fieldRef,
  inputRef,
  onChange,
  onSubmit,
  onFocusChange,
}) {
  const reducedMotion = usePrefersReducedMotion();
  const spanning = useMediaQuery(SPANNING_QUERY);
  const deck = useMemo(() => createExampleDeck(examples), [examples]);
  const ownField = useRef(null);
  const ownInput = useRef(null);
  const field = fieldRef ?? ownField;
  const input = inputRef ?? ownInput;
  const exampleRef = useRef("");
  const resumeTimer = useRef(null);
  const [focused, setFocused] = useState(false);
  const [resting, setResting] = useState(false);

  const draft = normalize(value);
  const pending = draft !== "" && draft !== query;
  // Open while it has focus; on a wide screen also while it holds a description not yet searched.
  const open = !disabled && (focused || (!spanning && pending));
  const typing = open && value === "" && !resting && examples.length > 0;
  // While the examples type, theirs is the caret; otherwise the field draws its own.
  const showCaret = open && focused && !typing;
  // The field's own buttons show only while it's open; the closed tile is just the tile.
  const showClear = open && value !== "";
  const showShutter = open && pending;
  const tools = typing ? TOOL_SPACE.take : (showClear ? TOOL_SPACE.clear : 0) + (showShutter ? TOOL_SPACE.shutter : 0);

  useEffect(() => () => clearTimeout(resumeTimer.current), []);

  // "/" opens the search from anywhere on the page that isn't taking text.
  useEffect(() => {
    if (disabled) return undefined;
    function onKeyDown(event) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target, { withinDialog: true })) return;
      event.preventDefault();
      input.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [disabled, input]);

  function change(next) {
    // Emptying the field gives the examples a moment before they type again.
    if (next === "" && value !== "") {
      setResting(true);
      clearTimeout(resumeTimer.current);
      resumeTimer.current = setTimeout(() => setResting(false), RESUME_MS);
    }
    onChange(next);
  }

  function submit(text) {
    onSubmit(normalize(text));
    input.current?.blur();
  }

  function onKeyDown(event) {
    if ((event.key === "Tab" && !event.shiftKey) || event.key === "ArrowRight") {
      const example = typing ? exampleRef.current : "";
      if (example) {
        event.preventDefault();
        change(example);
      }
      return;
    }
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      // First put back the description last searched, then close.
      if (value !== query) onChange(query);
      else input.current?.blur();
    }
  }

  return (
    <span className={cx(styles.slot, open && styles.slotOpen)} role="search">
      <span
        ref={field}
        className={cx(
          styles.field,
          open && styles.open,
          focused && styles.focused,
          disabled && styles.disabled
        )}
        style={{ "--tools": `${12 + tools}px` }}
        title={disabled ? "Semantic search isn't available yet" : undefined}
      >
        <span className={styles.frame} aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <SearchIcon className={styles.icon} size={15} />
        <input
          ref={input}
          className={styles.input}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          aria-label="Describe a scene"
          value={value}
          disabled={disabled}
          onChange={(event) => change(event.target.value)}
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onFocusChange?.(false);
          }}
          onKeyDown={onKeyDown}
        />
        {showCaret && <FieldCaret inputRef={input} value={value} />}
        {typing && <TypedExample deck={deck} reducedMotion={reducedMotion} exampleRef={exampleRef} onTake={submit} />}
        {(showClear || showShutter) && (
          <span className={styles.tools}>
            {showClear && (
              <button
                type="button"
                className={styles.clear}
                aria-label="Clear the description"
                onMouseDown={hold}
                onClick={() => change("")}
              >
                <CloseIcon size={12} />
              </button>
            )}
            {showShutter && (
              <button
                type="button"
                className={styles.shutter}
                aria-label="Find scenes"
                onMouseDown={hold}
                onClick={() => submit(value)}
              >
                <span className={styles.shutterDot} />
              </button>
            )}
          </span>
        )}
      </span>
    </span>
  );
}
