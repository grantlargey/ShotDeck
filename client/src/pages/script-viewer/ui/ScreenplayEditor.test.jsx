import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScreenplayEditor } from "./ScreenplayEditor.jsx";

function renderEditor(markdown) {
  const onChange = vi.fn();
  render(<ScreenplayEditor sourceKey="scene" initialMarkdown={markdown} onChange={onChange} />);
  return onChange;
}

function select(input, start, end = start) {
  act(() => {
    input.focus();
    input.setSelectionRange(start, end);
  });
}

function expectCaret(input, position) {
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(position);
  expect(input.selectionEnd).toBe(position);
}

describe("splitting screenplay blocks", () => {
  it("replaces the selection with a split, keeps the type of the suffix, and focuses its start", () => {
    const onChange = renderEditor("Opening.\n\n### MAYA AND SAM\n\nClosing.");
    const original = screen.getByRole("textbox", { name: "Character, block 2" });
    select(original, 4, 9);

    expect(fireEvent.keyDown(original, { key: "Enter" })).toBe(false);

    const suffix = screen.getByRole("textbox", { name: "Character, block 3" });
    expect(original.value).toBe("MAYA");
    expect(screen.getByRole("textbox", { name: "Character, block 2" })).toBe(original);
    expect(suffix.value).toBe("SAM");
    expectCaret(suffix, 0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Opening.\n\n### MAYA\n\n### SAM\n\nClosing.");
  });

  it.each([
    ["### MAYA", "Character", "Dialogue"],
    ["> Hello.", "Dialogue", "Action"],
    ['<p align="right">CUT TO:</p>', "Transition", "Scene Heading"],
  ])("creates the next screenplay type after %s", (markdown, currentType, nextType) => {
    const onChange = renderEditor(markdown);
    const original = screen.getByRole("textbox", { name: `${currentType}, block 1` });
    select(original, original.value.length);

    expect(fireEvent.keyDown(original, { key: "Enter" })).toBe(false);

    const next = screen.getByRole("textbox", { name: `${nextType}, block 2` });
    expect(next.value).toBe("");
    expectCaret(next, 0);
    // Empty blocks remain editable without adding markers to the saved markdown.
    expect(onChange).toHaveBeenCalledExactlyOnceWith(markdown);
  });

  it("uses the next type when the selection extends to the end of the block", () => {
    const onChange = renderEditor("### MAYA (V.O.)");
    const character = screen.getByRole("textbox", { name: "Character, block 1" });
    select(character, 4, character.value.length);

    fireEvent.keyDown(character, { key: "Enter" });

    expect(character.value).toBe("MAYA");
    expectCaret(screen.getByRole("textbox", { name: "Dialogue, block 2" }), 0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("### MAYA");
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Control", { ctrlKey: true }],
    ["Command", { metaKey: true }],
    ["Alt", { altKey: true }],
    ["composition", { isComposing: true }],
  ])("leaves Enter to the field during %s", (_, options) => {
    const onChange = renderEditor("A door opens.");
    const input = screen.getByRole("textbox");
    select(input, 2);

    expect(fireEvent.keyDown(input, { key: "Enter", ...options })).toBe(true);

    expect(screen.getAllByRole("textbox")).toEqual([input]);
    expectCaret(input, 2);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("merging screenplay blocks", () => {
  it("merges backward into the previous type and places the caret at the join", () => {
    const onChange = renderEditor("Opening.\n\n### MAYA\n\n> Hello.\n\nClosing.");
    const previous = screen.getByRole("textbox", { name: "Character, block 2" });
    const current = screen.getByRole("textbox", { name: "Dialogue, block 3" });
    select(current, 0);

    expect(fireEvent.keyDown(current, { key: "Backspace" })).toBe(false);

    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Character, block 2" })).toBe(previous);
    expect(previous.value).toBe("MAYAHello.");
    expectCaret(previous, 4);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Opening.\n\n### MAYAHello.\n\nClosing.");
  });

  it("removes an empty previous block and retains the current field and type", () => {
    const onChange = renderEditor("Opening.\n\n### MAYA\n\n> Hello.\n\nClosing.");
    const previous = screen.getByRole("textbox", { name: "Character, block 2" });
    fireEvent.change(previous, { target: { value: "" } });
    onChange.mockClear();
    const current = screen.getByRole("textbox", { name: "Dialogue, block 3" });
    select(current, 0);

    expect(fireEvent.keyDown(current, { key: "Backspace" })).toBe(false);

    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Dialogue, block 2" })).toBe(current);
    expect(current.value).toBe("Hello.");
    expectCaret(current, 0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Opening.\n\n> Hello.\n\nClosing.");
  });

  it("merges forward into the current type and keeps the caret at the join", () => {
    const onChange = renderEditor("Opening.\n\n> Hello.\n\n### MAYA\n\nClosing.");
    const current = screen.getByRole("textbox", { name: "Dialogue, block 2" });
    select(current, current.value.length);

    expect(fireEvent.keyDown(current, { key: "Delete" })).toBe(false);

    expect(screen.getAllByRole("textbox")).toHaveLength(3);
    expect(screen.getByRole("textbox", { name: "Dialogue, block 2" })).toBe(current);
    expect(current.value).toBe("Hello.MAYA");
    expectCaret(current, 6);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Opening.\n\n> Hello.MAYA\n\nClosing.");
  });

  it("retains the current type when merging forward from an empty field", () => {
    const onChange = renderEditor("### MAYA\n\n> Hello.");
    const current = screen.getByRole("textbox", { name: "Character, block 1" });
    fireEvent.change(current, { target: { value: "" } });
    onChange.mockClear();
    select(current, 0);

    fireEvent.keyDown(current, { key: "Delete" });

    expect(screen.getAllByRole("textbox")).toEqual([current]);
    expect(current.getAttribute("aria-label")).toBe("Character, block 1");
    expect(current.value).toBe("Hello.");
    expectCaret(current, 0);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("### Hello.");
  });

  it.each([
    ["Backspace", 0, 0, 0],
    ["Backspace", 1, 1, 1],
    ["Backspace", 1, 0, 2],
    ["Delete", 1, 6, 6],
    ["Delete", 0, 2, 2],
    ["Delete", 0, 0, 5],
  ])("leaves %s on field %i with selection %i–%i to the browser", (key, index, start, end) => {
    const onChange = renderEditor("First\n\nSecond");
    const fields = screen.getAllByRole("textbox");
    const input = fields[index];
    select(input, start, end);

    expect(fireEvent.keyDown(input, { key })).toBe(true);

    expect(screen.getAllByRole("textbox")).toEqual(fields);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(start);
    expect(input.selectionEnd).toBe(end);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("keyboard focus and element types", () => {
  it("moves across block edges with arrows without changing the screenplay", () => {
    const onChange = renderEditor("First\n\nSecond");
    const [first, second] = screen.getAllByRole("textbox");
    select(second, 0);

    expect(fireEvent.keyDown(second, { key: "ArrowUp" })).toBe(false);
    expectCaret(first, 5);
    expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(false);
    expectCaret(second, 0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("leaves arrows within a block, selections, and Shift selection to the field", () => {
    const onChange = renderEditor("First\n\nSecond");
    const first = screen.getByRole("textbox", { name: "Action, block 1" });
    select(first, 2);
    expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(true);
    select(first, 0, 5);
    expect(fireEvent.keyDown(first, { key: "ArrowDown" })).toBe(true);
    select(first, 5);
    expect(fireEvent.keyDown(first, { key: "ArrowDown", shiftKey: true })).toBe(true);

    expectCaret(first, 5);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("cycles types with Tab and Shift+Tab while retaining the caret", () => {
    const onChange = renderEditor("### MAYA");
    const input = screen.getByRole("textbox");
    select(input, 2);

    expect(fireEvent.keyDown(input, { key: "Tab" })).toBe(false);
    expect(input.getAttribute("aria-label")).toBe("Parenthetical, block 1");
    expectCaret(input, 2);
    expect(onChange).toHaveBeenLastCalledWith("> > MAYA");

    expect(fireEvent.keyDown(input, { key: "Tab", shiftKey: true })).toBe(false);
    expect(input.getAttribute("aria-label")).toBe("Character, block 1");
    expectCaret(input, 2);
    expect(onChange).toHaveBeenLastCalledWith("### MAYA");
  });

  it.each(["ctrlKey", "metaKey"])("changes type with %s plus a digit without moving the caret", (modifier) => {
    const onChange = renderEditor("MAYA");
    const input = screen.getByRole("textbox");
    select(input, 2);

    expect(fireEvent.keyDown(input, { key: "3", code: "Digit3", [modifier]: true })).toBe(false);

    expect(input.getAttribute("aria-label")).toBe("Character, block 1");
    expectCaret(input, 2);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("### MAYA");
  });

  it("returns from the type menu to the original caret without emitting an unchanged type", () => {
    const onChange = renderEditor("### MAYA");
    const input = screen.getByRole("textbox");
    select(input, 2);
    fireEvent.click(screen.getByRole("button", { name: "Change element type (currently Character)" }));
    const selectedType = screen.getByRole("menuitemradio", { name: /Character/ });
    expect(document.activeElement).toBe(selectedType);

    expect(fireEvent.keyDown(selectedType, { key: "Escape" })).toBe(false);

    expect(screen.queryByRole("menu")).toBeNull();
    expectCaret(input, 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("blurs the field on Escape without changing its text", () => {
    const onChange = renderEditor("First");
    const input = screen.getByRole("textbox");
    select(input, 2);

    expect(fireEvent.keyDown(input, { key: "Escape" })).toBe(false);

    expect(document.activeElement).not.toBe(input);
    expect(onChange).not.toHaveBeenCalled();
  });
});
