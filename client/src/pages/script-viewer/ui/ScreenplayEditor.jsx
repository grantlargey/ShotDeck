import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  cycleScreenplayType,
  getScreenplayElement,
  NEXT_SCREENPLAY_TYPE,
  SCREENPLAY_ELEMENTS,
} from "@/shared/lib/screenplay/elements.js";
import {
  parseScreenplayMarkdown,
  serializeScreenplayMarkdown,
} from "@/shared/lib/screenplay/grammar.js";
import { ScreenplayElementIcon } from "@/shared/ui/ScreenplayElementIcon.jsx";
import { elementShortcutLabel } from "../lib/platform.js";
import styles from "./ScreenplayEditor.module.css";

const SHORTCUT_TYPES = new Map(SCREENPLAY_ELEMENTS.map((element) => [`Digit${element.shortcut}`, element.type]));
const SPEECH_ELEMENTS = SCREENPLAY_ELEMENTS.filter((element) =>
  ["character", "parenthetical", "dialogue"].includes(element.type),
);
const TYPE_BUTTON = "[data-element-type-button]";
let blockCounter = 0;

function createBlock(type, text = "") {
  blockCounter += 1;
  return { id: `screenplay-block-${blockCounter}`, type, text };
}

function blocksFromMarkdown(markdown) {
  const blocks = parseScreenplayMarkdown(markdown).map((element) => {
    if (element.type !== "dualDialogue") return createBlock(element.type, element.text);
    return {
      ...createBlock(element.type),
      columns: element.columns.map((column) =>
        column.length > 0
          ? column.map((speech) => createBlock(speech.type, speech.text))
          : [createBlock("dialogue")],
      ),
    };
  });
  return blocks.length > 0 ? blocks : [createBlock("action")];
}

// A column is its own editable sequence. Splits and merges never cross into
// another speaker or consume a neighboring dual-dialogue group.
function editableBlocks(blocks) {
  return blocks.flatMap((block, index) =>
    block.type === "dualDialogue"
      ? block.columns.flatMap((column, columnIndex) =>
          column.map((speech, speechIndex) => ({
            block: speech,
            siblings: column,
            index: speechIndex,
            groupIndex: index,
            columnIndex,
          })),
        )
      : [{ block, siblings: blocks, index }],
  );
}

function replaceSequence(blocks, location, nextSequence) {
  if (location.groupIndex === undefined) return nextSequence;
  return blocks.map((block, index) =>
    index === location.groupIndex
      ? {
          ...block,
          columns: block.columns.map((column, columnIndex) =>
            columnIndex === location.columnIndex ? nextSequence : column,
          ),
        }
      : block,
  );
}

// Each edit keeps the document change and its caret destination together.
function splitBlock(blocks, index, { value, selectionStart, selectionEnd }, nextType) {
  const block = blocks[index];
  const before = { ...block, text: value.slice(0, selectionStart) };
  const remainingText = value.slice(selectionEnd);
  const created = createBlock(remainingText ? block.type : nextType, remainingText);
  const nextBlocks = [...blocks];
  nextBlocks.splice(index, 1, before, created);
  return { blocks: nextBlocks, focus: { id: created.id, caret: 0 } };
}

function mergeBlockBackward(blocks, index, text) {
  const block = blocks[index];
  const previous = blocks[index - 1];
  const nextBlocks = [...blocks];

  // An empty preceding block is removed without changing the current block's type.
  if (!previous.text) {
    nextBlocks.splice(index - 1, 1);
    return { blocks: nextBlocks, focus: { id: block.id, caret: 0 } };
  }

  const merged = { ...previous, text: previous.text + text };
  nextBlocks.splice(index - 1, 2, merged);
  return { blocks: nextBlocks, focus: { id: previous.id, caret: previous.text.length } };
}

function mergeBlockForward(blocks, index, text) {
  const block = blocks[index];
  const next = blocks[index + 1];
  const merged = { ...block, text: text + next.text };
  const nextBlocks = [...blocks];
  nextBlocks.splice(index, 2, merged);
  return { blocks: nextBlocks, focus: { id: block.id, caret: text.length } };
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

function ElementTypeMenu({ currentType, elements, onSelect, onClose }) {
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
    const byDigit = elements.find((element) => element.shortcut === event.key);
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
      {elements.map((element) => (
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
 * element types. It owns its blocks until `sourceKey` changes, which means the
 * text was replaced from outside; it then starts again from `initialMarkdown`.
 * If one of its fields had focus, focus moves to the same block number with
 * the caret at the same offset, both clamped to the new text.
 */
export function ScreenplayEditor({ sourceKey, initialMarkdown, onChange }) {
  // Where focus was when the previous source's blocks were removed.
  const focusHandoffRef = useRef(null);
  return (
    <ScreenplayBlocks
      key={sourceKey}
      initialMarkdown={initialMarkdown}
      onChange={onChange}
      focusHandoffRef={focusHandoffRef}
    />
  );
}

function ScreenplayBlocks({ initialMarkdown, onChange, focusHandoffRef }) {
  const [blocks, setBlocks] = useState(() => blocksFromMarkdown(initialMarkdown));
  const [focusedId, setFocusedId] = useState(null);
  const [menuBlockId, setMenuBlockId] = useState(null);
  const sheetRef = useRef(null);
  const inputsRef = useRef(new Map());
  const pendingFocusRef = useRef(null);
  const fields = editableBlocks(blocks);
  const locations = new Map(fields.map((location, index) => [location.block.id, { ...location, fieldIndex: index }]));
  const layoutSignature = fields.map(({ block }) => `${block.id}:${block.type}`).join("|");

  useLayoutEffect(() => {
    for (const input of inputsRef.current.values()) autosize(input);
  }, [layoutSignature]);

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusInput(inputsRef.current.get(pending.id), pending.caret);
  }, [blocks]);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    const handoff = focusHandoffRef.current;
    focusHandoffRef.current = null;
    if (handoff) {
      const fields = sheet.querySelectorAll("textarea");
      focusInput(fields[Math.min(handoff.index, fields.length - 1)], handoff.caret);
    }
    // Layout cleanup runs before these fields leave the page, while one may still have focus.
    return () => {
      const focused = document.activeElement;
      const index = [...sheet.querySelectorAll("textarea")].indexOf(focused);
      if (index >= 0) focusHandoffRef.current = { index, caret: focused.selectionStart };
    };
  }, [focusHandoffRef]);

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

  function commit(edit) {
    if (edit.focus) pendingFocusRef.current = edit.focus;
    setBlocks(edit.blocks);
    onChange(serializeScreenplayMarkdown(edit.blocks));
  }

  function setBlockType(blockId, type) {
    setMenuBlockId(null);
    const input = inputsRef.current.get(blockId);
    const caret = input?.selectionStart ?? 0;
    const location = locations.get(blockId);
    const block = location?.block;
    const allowed = location?.groupIndex === undefined ? SCREENPLAY_ELEMENTS : SPEECH_ELEMENTS;
    if (!block || block.type === type || !allowed.some((element) => element.type === type)) {
      focusInput(input, caret);
      return;
    }
    commit({
      blocks: replaceSequence(blocks, location, location.siblings.map((item) =>
        item.id === blockId ? { ...item, type } : item,
      )),
      focus: { id: blockId, caret },
    });
  }

  function handleKeyDown(event, location) {
    const { block, siblings, index, fieldIndex, groupIndex } = location;
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
      const step = event.shiftKey ? -1 : 1;
      const speechIndex = SPEECH_ELEMENTS.findIndex((element) => element.type === block.type);
      const nextType = groupIndex === undefined
        ? cycleScreenplayType(block.type, step)
        : SPEECH_ELEMENTS[(speechIndex + step + SPEECH_ELEMENTS.length) % SPEECH_ELEMENTS.length].type;
      setBlockType(block.id, nextType);
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
      const nextType = groupIndex === undefined ? NEXT_SCREENPLAY_TYPE[block.type] : "dialogue";
      const edit = splitBlock(siblings, index, input, nextType);
      commit({ ...edit, blocks: replaceSequence(blocks, location, edit.blocks) });
      return;
    }

    if (event.key === "Backspace" && collapsed && selectionStart === 0 && index > 0 && siblings[index - 1].type !== "dualDialogue") {
      event.preventDefault();
      const edit = mergeBlockBackward(siblings, index, value);
      commit({ ...edit, blocks: replaceSequence(blocks, location, edit.blocks) });
      return;
    }

    if (event.key === "Delete" && collapsed && selectionStart === value.length && index < siblings.length - 1 && siblings[index + 1].type !== "dualDialogue") {
      event.preventDefault();
      const edit = mergeBlockForward(siblings, index, value);
      commit({ ...edit, blocks: replaceSequence(blocks, location, edit.blocks) });
      return;
    }

    if (event.shiftKey || !collapsed) return;
    if (event.key === "ArrowUp" && selectionStart === 0 && fieldIndex > 0) {
      event.preventDefault();
      focusInput(inputsRef.current.get(fields[fieldIndex - 1].block.id), "end");
    } else if (event.key === "ArrowDown" && selectionStart === value.length && fieldIndex < fields.length - 1) {
      event.preventDefault();
      focusInput(inputsRef.current.get(fields[fieldIndex + 1].block.id), 0);
    }
  }

  function renderBlock(block) {
    const location = locations.get(block.id);
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
              elements={location.groupIndex === undefined ? SCREENPLAY_ELEMENTS : SPEECH_ELEMENTS}
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
          aria-label={`${element.label}, block ${location.fieldIndex + 1}`}
          onChange={(event) => {
            autosize(event.currentTarget);
            commit({
              blocks: replaceSequence(blocks, location, location.siblings.map((item) =>
                item.id === block.id ? { ...item, text: event.target.value } : item,
              )),
            });
          }}
          onFocus={() => setFocusedId(block.id)}
          onBlur={() => setFocusedId((current) => (current === block.id ? null : current))}
          onKeyDown={(event) => handleKeyDown(event, location)}
        />
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <div ref={sheetRef} className={styles.sheet}>
        {blocks.map((block) => block.type === "dualDialogue" ? (
          <div key={block.id} className={styles.dualDialogue} role="group" aria-label="Simultaneous dialogue">
            {block.columns.map((column, columnIndex) => (
              <div key={columnIndex} className={styles.dialogueColumn} role="group" aria-label={`Speaker ${columnIndex + 1}`}>
                {column.map(renderBlock)}
              </div>
            ))}
          </div>
        ) : renderBlock(block))}
      </div>
    </div>
  );
}
