import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseTimeInputToSeconds } from "@/shared/lib/time.js";
import { TimeInput } from "./TimeInput.jsx";
import styles from "./TimeInput.module.css";

function Harness({ initial = "", ...props }) {
  const [value, setValue] = useState(initial);
  return <><TimeInput aria-label="Begin" value={value} onValueChange={setValue} {...props} /><output>{value}</output></>;
}

function setup(initial) {
  render(<Harness initial={initial} />);
  const input = screen.getByRole("textbox", { name: "Begin" });
  fireEvent.focus(input);
  return input;
}

// Apply the native text edit that precedes React's change handler, including selection.
function type(input, text) {
  for (const char of text) {
    const start = input.selectionStart;
    const next = input.value.slice(0, start) + char + input.value.slice(input.selectionEnd);
    fireEvent.change(input, { target: { value: next, selectionStart: start + 1, selectionEnd: start + 1 } });
  }
}

function paste(input, text) {
  fireEvent.paste(input, { clipboardData: { getData: () => text } });
}

describe("shared time entry", () => {
  it("shifts digits right to left, lights colons at each threshold, and pads on blur", () => {
    const input = setup();
    expect(input.value).toBe("");
    expect(input.parentElement.querySelector(`.${styles.mask}`).textContent).toBe("HH:MM:SS");
    for (const [digit, mask, dimCount] of [
      ["1", "__:__:_1", 7], ["2", "__:__:12", 6], ["4", "__:_1:24", 4],
      ["2", "__:12:42", 3], ["6", "_1:24:26", 1],
    ]) {
      type(input, digit);
      expect(input.value).toBe(mask);
      expect(input.parentElement.querySelector(`.${styles.mask}`).textContent).toBe(mask.replaceAll("_", "0"));
      expect(input.selectionStart).toBe(8);
      expect(input.parentElement.querySelectorAll(`.${styles.dim}`)).toHaveLength(dimCount);
    }
    // The draft can be saved even before blur.
    expect(screen.getByRole("status").textContent).toBe("01:24:26");
    fireEvent.blur(input);
    expect(input.value).toBe("01:24:26");
  });

  it("backs through digit groups and clears to an empty value", () => {
    const input = setup();
    type(input, "12426");
    for (const mask of ["__:12:42", "__:_1:24", "__:__:12", "__:__:_1", ""]) {
      fireEvent.keyDown(input, { key: "Backspace" });
      expect(input.value).toBe(mask);
    }
    fireEvent.blur(input);
    expect(input.value).toBe("");
    expect(screen.getByRole("status").textContent).toBe("");
    expect(input.parentElement.querySelector(`.${styles.mask}`).textContent).toBe("HH:MM:SS");
  });

  it("supports selecting and replacing a saved time or an individual group", () => {
    const input = setup("01:22:09");
    input.setSelectionRange(3, 5);
    type(input, "24");
    expect(input.value).toBe("01:24:09");
    input.select();
    type(input, "12426");
    fireEvent.keyDown(input, { key: "Enter" });
    // jsdom fireEvent.focus does not set document.activeElement, so dispatch blur explicitly.
    fireEvent.blur(input);
    expect(input.value).toBe("01:24:26");
  });

  it.each(["12426", "01:24:26", "1:24:26", " 1:2:3 "])("accepts pasted %j", (text) => {
    const input = setup();
    paste(input, text);
    fireEvent.blur(input);
    expect(input.value).toBe(text.includes("1:2:3") ? "01:02:03" : "01:24:26");
  });

  it("rejects extra digits and letters without changing the entered time", () => {
    const input = setup();
    type(input, "0124267x");
    expect(input.value).toBe("01:24:26");
    input.select();
    paste(input, "not a time");
    expect(input.value).toBe("01:24:26");
  });

  it("deletes digits across separators and preserves the caret for further edits", () => {
    const input = setup("01:24:26");
    input.setSelectionRange(6, 6);
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("_0:12:26");
    type(input, "4");
    expect(input.value).toBe("01:24:26");
    input.setSelectionRange(5, 5);
    fireEvent.keyDown(input, { key: "Delete" });
    expect(input.value).toBe("_0:12:46");
  });

  it("keeps invalid seconds invalid instead of treating digits as total seconds", () => {
    const input = setup();
    type(input, "75");
    fireEvent.blur(input);
    expect(input.value).toBe("00:00:75");
    expect(parseTimeInputToSeconds(input.value)).toBeNull();
  });

  it("shows externally changed draft values even while focused", () => {
    const view = render(<TimeInput aria-label="Begin" value="01:22:09" onValueChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Begin" });
    fireEvent.focus(input);
    view.rerender(<TimeInput aria-label="Begin" value="00:05:00" onValueChange={() => {}} />);
    expect(input.value).toBe("00:05:00");
    view.rerender(<TimeInput aria-label="Begin" value="" onValueChange={() => {}} />);
    expect(input.value).toBe("");
  });

  it("keeps tenths separate from right-aligned whole seconds, including deletion and paste", () => {
    render(<Harness tenths />);
    const input = screen.getByRole("textbox", { name: "Begin" });
    fireEvent.focus(input);
    type(input, "12426.5");
    expect(input.value).toBe("_1:24:26.5");
    expect(screen.getByRole("status").textContent).toBe("01:24:26.5");
    type(input, "6");
    expect(input.value).toBe("_1:24:26.5");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("_1:24:26.");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(input.value).toBe("_1:24:26");
    input.select();
    paste(input, "1:02:03.5");
    fireEvent.blur(input);
    expect(input.value).toBe("01:02:03.5");
  });

  it("finishes an empty decimal on blur and rejects decimals for whole-second fields", () => {
    const view = render(<Harness tenths />);
    const input = screen.getByRole("textbox", { name: "Begin" });
    type(input, "12426.");
    fireEvent.blur(input);
    expect(input.value).toBe("01:24:26");
    view.unmount();
    const whole = setup();
    paste(whole, "12426.5");
    expect(whole.value).toBe("");
  });

  it("preserves native props, read-only values, and consumer-owned keyboard shortcuts", () => {
    const onValueChange = vi.fn();
    const onKeyDown = vi.fn((event) => event.preventDefault());
    const view = render(<TimeInput inline tenths aria-label="Timestamp" value="00:10:00.5" onValueChange={onValueChange} onKeyDown={onKeyDown} readOnly />);
    const input = screen.getByRole("textbox", { name: "Timestamp" });
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute("inputmode")).toBe("decimal");
    fireEvent.keyDown(input, { key: "Backspace" });
    input.select();
    paste(input, "100");
    expect(onValueChange).not.toHaveBeenCalled();
    view.rerender(<TimeInput inline aria-label="Timestamp" value="00:10:00" onValueChange={onValueChange} onKeyDown={onKeyDown} />);
    const blur = vi.spyOn(input, "blur");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalled();
    expect(blur).not.toHaveBeenCalled();
  });

  it("scales an inline field in type under 16px, so on a touch screen it's set at 16px and iOS doesn't zoom in", () => {
    render(
      <p style={{ fontSize: "11.52px", letterSpacing: "1.6128px" }}>
        <TimeInput inline aria-label="Timestamp" value="" onValueChange={() => {}} />
      </p>
    );
    const control = screen.getByRole("textbox", { name: "Timestamp" }).parentElement;

    expect(control.classList.contains(styles.scaled)).toBe(true);
    expect(Number(control.style.getPropertyValue("--type-scale"))).toBeCloseTo(0.72);
    expect(parseFloat(control.style.getPropertyValue("--type-tracking"))).toBeCloseTo(2.24);
  });

  it("leaves an inline field in 16px type as it is", () => {
    render(
      <p style={{ fontSize: "16px" }}>
        <TimeInput inline aria-label="Timestamp" value="" onValueChange={() => {}} />
      </p>
    );
    const control = screen.getByRole("textbox", { name: "Timestamp" }).parentElement;

    expect(control.classList.contains(styles.scaled)).toBe(false);
    expect(control.style.getPropertyValue("--type-scale")).toBe("");
  });
});
