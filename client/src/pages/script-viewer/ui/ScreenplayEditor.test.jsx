import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseScreenplayMarkdown, serializeScreenplayMarkdown } from "@/shared/lib/screenplay/grammar.js";
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

const DUAL_DIALOGUE = [
  "Before.",
  "",
  "::: dual-dialogue",
  "### MURRAY FRANKLIN",
  "",
  "> No more jokes.",
  "::: column",
  "### JOKER",
  "",
  "> What do you get?",
  ":::",
  "",
  "After.",
].join("\n");

function lastDocument(onChange) {
  return parseScreenplayMarkdown(onChange.mock.lastCall[0]);
}

describe("editing simultaneous dialogue", () => {
  it.each([
    ["Action, block 1", "An audience waits.", 0, undefined],
    ["Dialogue, block 3", "We've had enough.", 1, 0],
    ["Dialogue, block 5", "One more joke.", 1, 1],
  ])("preserves both columns when changing %s", (label, value, blockIndex, columnIndex) => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const group = screen.getByRole("group", { name: "Simultaneous dialogue" });
    expect(within(group).getAllByRole("group")).toHaveLength(2);
    expect(within(group).getAllByRole("textbox")).toHaveLength(4);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });

    const expected = parseScreenplayMarkdown(DUAL_DIALOGUE);
    if (columnIndex === undefined) expected[blockIndex].text = value;
    else expected[blockIndex].columns[columnIndex][1].text = value;
    expect(lastDocument(onChange)).toEqual(expected);
  });

  it.each(["Backspace", "Delete"])("splits and rejoins a column with %s without changing the other speaker", (key) => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const original = screen.getByRole("textbox", { name: "Dialogue, block 3" });
    select(original, 3);

    fireEvent.keyDown(original, { key: "Enter" });

    const suffix = screen.getByRole("textbox", { name: "Dialogue, block 4" });
    expectCaret(suffix, 0);
    expect(lastDocument(onChange)[1].columns[0]).toEqual([
      { type: "character", text: "MURRAY FRANKLIN" },
      { type: "dialogue", text: "No" },
      { type: "dialogue", text: "more jokes." },
    ]);
    expect(lastDocument(onChange)[1].columns[1]).toEqual(parseScreenplayMarkdown(DUAL_DIALOGUE)[1].columns[1]);

    const mergeFrom = key === "Backspace" ? suffix : original;
    select(mergeFrom, key === "Backspace" ? 0 : original.value.length);
    fireEvent.keyDown(mergeFrom, { key });

    expect(lastDocument(onChange)).toEqual(parseScreenplayMarkdown(DUAL_DIALOGUE));
    expectCaret(original, 3);
  });

  it("keeps Enter at the end of a column in dialogue and preserves the new paragraph", () => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const original = screen.getByRole("textbox", { name: "Dialogue, block 5" });
    select(original, original.value.length);

    fireEvent.keyDown(original, { key: "Enter" });

    const continuation = screen.getByRole("textbox", { name: "Dialogue, block 6" });
    expectCaret(continuation, 0);
    fireEvent.change(continuation, { target: { value: "A punchline." } });
    expect(lastDocument(onChange)[1].columns[1]).toEqual([
      { type: "character", text: "JOKER" },
      { type: "dialogue", text: "What do you get?" },
      { type: "dialogue", text: "A punchline." },
    ]);
  });

  it.each([
    ["Delete", "Action, block 1"],
    ["Backspace", "Character, block 2"],
    ["Delete", "Dialogue, block 3"],
    ["Backspace", "Character, block 4"],
    ["Delete", "Dialogue, block 5"],
    ["Backspace", "Action, block 6"],
  ])("does not merge %s at the boundary of %s", (key, label) => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const input = screen.getByRole("textbox", { name: label });
    select(input, key === "Backspace" ? 0 : input.value.length);

    expect(fireEvent.keyDown(input, { key })).toBe(true);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
    expect(document.activeElement).toBe(input);
  });

  it("navigates through columns in reading order without changing text", () => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const before = screen.getByRole("textbox", { name: "Action, block 1" });
    select(before, before.value.length);
    fireEvent.keyDown(before, { key: "ArrowDown" });
    expectCaret(screen.getByRole("textbox", { name: "Character, block 2" }), 0);

    const leftDialogue = screen.getByRole("textbox", { name: "Dialogue, block 3" });
    select(leftDialogue, leftDialogue.value.length);
    fireEvent.keyDown(leftDialogue, { key: "ArrowDown" });
    const rightCharacter = screen.getByRole("textbox", { name: "Character, block 4" });
    expectCaret(rightCharacter, 0);
    fireEvent.keyDown(rightCharacter, { key: "ArrowUp" });
    expectCaret(leftDialogue, leftDialogue.value.length);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("limits element menus and keyboard type changes to speech elements inside columns", () => {
    const onChange = renderEditor(DUAL_DIALOGUE);
    const left = screen.getByRole("group", { name: "Speaker 1" });
    const input = within(left).getByRole("textbox", { name: /Character/ });
    select(input, 2);
    fireEvent.keyDown(input, { key: "2", code: "Digit2", ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expectCaret(input, 2);

    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(lastDocument(onChange)[1].columns[0][0]).toEqual({ type: "dialogue", text: "MURRAY FRANKLIN" });
    expectCaret(input, 2);
    fireEvent.click(within(left).getAllByRole("button", { name: "Change element type (currently Dialogue)" })[0]);
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3);
    expect(screen.queryByRole("menuitemradio", { name: /Action/ })).toBeNull();
  });

  it("keeps the other speaker when a column is emptied and the saved text is reopened", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScreenplayEditor sourceKey="first" initialMarkdown={DUAL_DIALOGUE} onChange={onChange} />);
    for (const input of within(screen.getByRole("group", { name: "Speaker 1" })).getAllByRole("textbox")) {
      fireEvent.change(input, { target: { value: "" } });
    }
    expect(lastDocument(onChange)[1].columns[0]).toEqual([]);
    expect(lastDocument(onChange)[1].columns[1]).toEqual(parseScreenplayMarkdown(DUAL_DIALOGUE)[1].columns[1]);

    rerender(<ScreenplayEditor sourceKey="saved" initialMarkdown={onChange.mock.lastCall[0]} onChange={onChange} />);

    expect(within(screen.getByRole("group", { name: "Speaker 1" })).getByRole("textbox").value).toBe("");
    expect(within(screen.getByRole("group", { name: "Speaker 2" })).getAllByRole("textbox").map((field) => field.value))
      .toEqual(["JOKER", "What do you get?"]);
  });

  it("hands focus to the same nested field on source replacement and clamps the caret", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScreenplayEditor sourceKey="first" initialMarkdown={DUAL_DIALOGUE} onChange={onChange} />);
    select(screen.getByRole("textbox", { name: "Dialogue, block 5" }), 10);
    const replacement = parseScreenplayMarkdown(DUAL_DIALOGUE);
    replacement[1].columns[1][1].text = "New.";

    rerender(<ScreenplayEditor sourceKey="replacement" initialMarkdown={serializeScreenplayMarkdown(replacement)} onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "Dialogue, block 5" });
    expect(input.value).toBe("New.");
    expectCaret(input, 4);
    expect(onChange).not.toHaveBeenCalled();
  });
});
