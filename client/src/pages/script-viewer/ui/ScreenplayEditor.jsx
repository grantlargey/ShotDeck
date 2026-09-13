import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cycleScreenplayType,
  getScreenplayElement,
  NEXT_SCREENPLAY_TYPE,
  parseScreenplayMarkdown,
  SCREENPLAY_ELEMENTS,
  serializeScreenplayMarkdown,
} from "@/shared/lib/screenplay";
import { ScreenplayElementIcon } from "@/shared/ui";
import { elementShortcutLabel } from "../lib/platform.js";
import styles from "./ScreenplayEditor.module.css";

const SHORTCUT_TYPES = new Map(SCREENPLAY_ELEMENTS.map((element) => [`Digit${element.shortcut}`, element.type]));
const TYPE_BUTTON = "[data-element-type-button]";
let blockCounter = 0;

function createBlock(type, text = "") {
  blockCounter += 1;
  return { id: `screenplay-block-${blockCounter}`, type, text };
}

function blocksFromMarkdown(markdown) {
  const blocks = parseScreenplayMarkdown(markdown).map((element) => createBlock(element.type, element.text));
  return blocks.length > 0 ? blocks : [createBlock("action")];
}

function autosize(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function focusInput(input, caret) {
  if (!input) return;
  input.focus();
  const position = caret === "end" ? input.value.length : Math.min(caret, input.value.length);
  input.setSelectionRange(position, position);
}

function ElementTypeMenu({ currentType, onSelect, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    menuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    const handlePointerDown = (event) => {
      if (menuRef.current?.contains(event.target) || event.target.closest?.(TYPE_BUTTON)) return;
      onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onClose]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onSelect(currentType);
      return;
    }
    const byDigit = SCREENPLAY_ELEMENTS.find((element) => element.shortcut === event.key);
    if (byDigit) {
      event.preventDefault();
      onSelect(byDigit.type);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...menuRef.current.querySelectorAll("button")];
    const index = items.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
  }

  return (
    <div ref={menuRef} role="menu" aria-label="Element type" className={styles.typeMenu} onKeyDown={handleKeyDown}>
      {SCREENPLAY_ELEMENTS.map((element) => (
        <button
          key={element.type}
          type="button"
          role="menuitemradio"
          aria-checked={element.type === currentType}
          className={`${styles.typeOption} ${element.type === currentType ? styles.typeOptionActive : ""}`}
          onClick={() => onSelect(element.type)}
        >
          <ScreenplayElementIcon type={element.type} />
          <span>{element.label}</span>
          <kbd>{elementShortcutLabel(element.shortcut)}</kbd>
        </button>
      ))}
    </div>
  );
}

/**
 * Block editor for screenplay markdown. Each element is its own auto-sizing
 * field, laid out like the script page, with keyboard shortcuts for changing
 * element types. It owns its blocks after mounting; the parent remounts it
 * (via `key`) when the text is replaced from outside.
 */
export function ScreenplayEditor({ initialMarkdown, onChange }) {
  const [blocks, setBlocks] = useState(() => blocksFromMarkdown(initialMarkdown));
  const [focusedId, setFocusedId] = useState(null);
  const [menuBlockId, setMenuBlockId] = useState(null);
  const sheetRef = useRef(null);
  const inputsRef = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const layoutSignature = blocks.map((block) => `${block.id}:${block.type}`).join("|");

  useLayoutEffect(() => {
    for (const input of inputsRef.current.values()) autosize(input);
  }, [layoutSignature]);

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusInput(inputsRef.current.get(pending.id), pending.caret);
  }, [blocks]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return undefined;
    let lastWidth = sheet.clientWidth;
    const observer = new ResizeObserver(() => {
      if (sheet.clientWidth === lastWidth) return;
      lastWidth = sheet.clientWidth;
      for (const input of inputsRef.current.values()) autosize(input);
    });
    observer.observe(sheet);
    return () => observer.disconnect();
  }, []);

  const closeMenu = useCallback(() => setMenuBlockId(null), []);

  function commit(nextBlocks, focus) {
    if (focus) pendingFocusRef.current = focus;
    setBlocks(nextBlocks);
    onChange(serializeScreenplayMarkdown(nextBlocks));
  }

  function setBlockType(blockId, type) {
    setMenuBlockId(null);
    const input = inputsRef.current.get(blockId);
    const caret = input?.selectionStart ?? 0;
    const block = blocks.find((item) => item.id === blockId);
    if (!block || block.type === type) {
      focusInput(input, caret);
      return;
    }
    commit(
      blocks.map((item) => (item.id === blockId ? { ...item, type } : item)),
      { id: blockId, caret }
    );
  }

  function handleKeyDown(event, block, index) {
    const input = event.currentTarget;
    const { selectionStart, selectionEnd, value } = input;
    const collapsed = selectionStart === selectionEnd;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier && !event.shiftKey && SHORTCUT_TYPES.has(event.code)) {
      event.preventDefault();
      setBlockType(block.id, SHORTCUT_TYPES.get(event.code));
      return;
    }

    if (event.key === "Tab" && !modifier && !event.altKey) {
      event.preventDefault();
      setBlockType(block.id, cycleScreenplayType(block.type, event.shiftKey ? -1 : 1));
      return;
    }

    if (event.key === "Escape") {
      // First Escape leaves the field; the next one closes the dialog.
      event.preventDefault();
      input.blur();
      return;
    }

    if (event.key === "Enter" && !event.shiftKey && !modifier && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const after = value.slice(selectionEnd);
      const created = createBlock(after ? block.type : NEXT_SCREENPLAY_TYPE[block.type], after);
      commit(
        [...blocks.slice(0, index), { ...block, text: value.slice(0, selectionStart) }, created, ...blocks.slice(index + 1)],
        { id: created.id, caret: 0 }
      );
      return;
    }

    if (event.key === "Backspace" && collapsed && selectionStart === 0 && index > 0) {
      event.preventDefault();
      const previous = blocks[index - 1];
      if (!previous.text) {
        commit([...blocks.slice(0, index - 1), ...blocks.slice(index)], { id: block.id, caret: 0 });
      } else {
        commit(
          [...blocks.slice(0, index - 1), { ...previous, text: previous.text + value }, ...blocks.slice(index + 1)],
          { id: previous.id, caret: previous.text.length }
        );
      }
      return;
    }

    if (event.key === "Delete" && collapsed && selectionStart === value.length && index < blocks.length - 1) {
      event.preventDefault();
      const next = blocks[index + 1];
      commit(
        [...blocks.slice(0, index), { ...block, text: value + next.text }, ...blocks.slice(index + 2)],
        { id: block.id, caret: value.length }
      );
      return;
    }

    if (event.shiftKey || !collapsed) return;
    if (event.key === "ArrowUp" && selectionStart === 0 && index > 0) {
      event.preventDefault();
      focusInput(inputsRef.current.get(blocks[index - 1].id), "end");
    } else if (event.key === "ArrowDown" && selectionStart === value.length && index < blocks.length - 1) {
      event.preventDefault();
      focusInput(inputsRef.current.get(blocks[index + 1].id), 0);
    }
  }

  return (
    <div className={styles.editor}>
      <div ref={sheetRef} className={styles.sheet}>
        {blocks.map((block, index) => {
          const element = getScreenplayElement(block.type);
          return (
            <div
              key={block.id}
              className={[styles.block, styles[block.type], focusedId === block.id ? styles.focused : ""].join(" ")}
            >
              <div className={styles.gutter}>
                <button
                  type="button"
                  tabIndex={-1}
                  data-element-type-button
                  className={styles.typeButton}
                  title={`${element.label} · click to change`}
                  aria-label={`Change element type (currently ${element.label})`}
                  aria-haspopup="menu"
                  aria-expanded={menuBlockId === block.id}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setMenuBlockId((current) => (current === block.id ? null : block.id))}
                >
                  <ScreenplayElementIcon type={block.type} size={14} />
                </button>
                {menuBlockId === block.id && (
                  <ElementTypeMenu
                    currentType={block.type}
                    onSelect={(type) => setBlockType(block.id, type)}
                    onClose={closeMenu}
                  />
                )}
              </div>
              <textarea
                ref={(node) => {
                  if (node) inputsRef.current.set(block.id, node);
                  else inputsRef.current.delete(block.id);
                }}
                className={styles.input}
                rows={1}
                value={block.text}
                spellCheck={false}
                placeholder={element.label}
                aria-label={`${element.label}, block ${index + 1}`}
                onChange={(event) => {
                  autosize(event.currentTarget);
                  commit(blocks.map((item) => (item.id === block.id ? { ...item, text: event.target.value } : item)));
                }}
                onFocus={() => setFocusedId(block.id)}
                onBlur={() => setFocusedId((current) => (current === block.id ? null : current))}
                onKeyDown={(event) => handleKeyDown(event, block, index)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
