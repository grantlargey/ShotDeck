import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnotationTimeline } from "./AnnotationTimeline.jsx";
import styles from "./AnnotationTimeline.module.css";

function stillsAt(...times) {
  return times.map((time, index) => ({
    id: `still-${index}`,
    time_seconds: time,
    image_url: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><title>${time}</title></svg>`)}`,
  }));
}

const STILLS = stillsAt(0, 20, 60, 100);

function renderTimeline(overrides = {}) {
  const props = { annotations: STILLS, runtimeSeconds: 100, onSelect: vi.fn(), ...overrides };
  const view = render(<AnnotationTimeline {...props} />);
  const strip = screen.getByRole("slider", { name: "Film stills timeline" });
  // jsdom has no layout. This places the strip between x=100 and x=200.
  vi.spyOn(strip, "getBoundingClientRect").mockReturnValue({ left: 100, width: 100 });
  strip.setPointerCapture = vi.fn();

  return {
    strip,
    timeline: strip.parentElement,
    onSelect: props.onSelect,
    rerender: (changes) => view.rerender(<AnnotationTimeline {...props} {...changes} />),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("still timeline pointer gestures", () => {
  it("keeps the glow under the mouse while the image and playhead snap to the nearest still", () => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 162 });

    expect(timeline.style.getPropertyValue("--spot")).toBe("62%");
    expect(timeline.classList.contains(styles.previewing)).toBe(true);
    expect(timeline.querySelector(`.${styles.playhead}`).style.left).toBe("60%");
    expect(timeline.querySelector(`.${styles.preview}`).style.getPropertyValue("--pos")).toBe("60%");
    expect(timeline.querySelector("img").getAttribute("src")).toBe(STILLS[2].image_url);
    expect(screen.getByText("3 of 4")).toBeTruthy();
    expect(strip.getAttribute("aria-valuetext")).toBe("Still 3 of 4, 00:01:00");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clamps pointers outside the strip and treats zero percent as an active preview", () => {
    const { strip, timeline } = renderTimeline({ highlightedIndex: 2 });

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 80 });

    expect(timeline.style.getPropertyValue("--spot")).toBe("0%");
    expect(timeline.classList.contains(styles.previewing)).toBe(true);
    expect(screen.getByText("1 of 4")).toBeTruthy();

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 250 });

    expect(timeline.style.getPropertyValue("--spot")).toBe("100%");
    expect(screen.getByText("4 of 4")).toBeTruthy();
  });

  it("previews the beginning when the strip has no measured width", () => {
    const { strip, timeline } = renderTimeline();
    strip.getBoundingClientRect.mockReturnValue({ left: 100, width: 0 });

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 170 });

    expect(timeline.style.getPropertyValue("--spot")).toBe("0%");
    expect(screen.getByText("1 of 4")).toBeTruthy();
  });

  it("chooses the earlier still on a tie and retains tenths in the preview and accessible value", () => {
    const { strip } = renderTimeline({ annotations: stillsAt(10.5, 30.5) });

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 120.5 });

    expect(screen.getByText("1 of 2")).toBeTruthy();
    expect(screen.getByText("00:00:10.5")).toBeTruthy();
    expect(strip.getAttribute("aria-valuetext")).toBe("Still 1 of 2, 00:00:10.5");
  });

  it.each(["touch", "pen"])("only scrubs with %s while pressed, including after leaving the strip", (pointerType) => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.pointerMove(strip, { pointerType, pointerId: 7, clientX: 120 });
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();

    fireEvent.pointerDown(strip, { pointerType, pointerId: 7, clientX: 120 });
    expect(strip.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(screen.getByText("2 of 4")).toBeTruthy();

    fireEvent.pointerLeave(strip, { pointerType, pointerId: 7 });
    expect(screen.getByText("2 of 4")).toBeTruthy();

    fireEvent.pointerMove(strip, { pointerType, pointerId: 7, clientX: 160 });
    expect(screen.getByText("3 of 4")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(["mouse", "touch", "pen"])("opens the %s release location without moving the remembered keyboard position", (pointerType) => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.pointerDown(strip, { pointerType, pointerId: 7, clientX: 120 });
    fireEvent.pointerUp(strip, { pointerType, pointerId: 7, clientX: 160 });

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    expect(strip.getAttribute("aria-valuenow")).toBe("2");
    expect(timeline.classList.contains(styles.previewing)).toBe(pointerType === "mouse");
    expect(timeline.style.getPropertyValue("--spot")).toBe("20%");

    fireEvent.pointerUp(strip, { pointerType, pointerId: 7, clientX: 200 });
    expect(onSelect).toHaveBeenCalledTimes(1);

    fireEvent.pointerLeave(strip, { pointerType });
    expect(fireEvent.keyDown(strip, { key: "Enter" })).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith(1);
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();
  });

  it("cancels a drag without selecting and ignores later unpressed touch movement and release", () => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.pointerDown(strip, { pointerType: "touch", pointerId: 7, clientX: 160 });
    fireEvent.pointerCancel(strip, { pointerType: "touch", pointerId: 7 });
    fireEvent.pointerMove(strip, { pointerType: "touch", pointerId: 7, clientX: 200 });
    fireEvent.pointerUp(strip, { pointerType: "touch", pointerId: 7, clientX: 200 });

    expect(onSelect).not.toHaveBeenCalled();
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();
    expect(timeline.style.getPropertyValue("--spot")).toBe("60%");
    expect(strip.getAttribute("aria-valuenow")).toBe("3");
  });

  it("hides on blur while allowing an already pressed gesture to continue", () => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.pointerDown(strip, { pointerType: "pen", pointerId: 7, clientX: 120 });
    fireEvent.blur(strip);
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();

    fireEvent.pointerMove(strip, { pointerType: "pen", pointerId: 7, clientX: 160 });
    expect(screen.getByText("3 of 4")).toBeTruthy();
    fireEvent.pointerUp(strip, { pointerType: "pen", pointerId: 7, clientX: 160 });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
  });
});

describe("still timeline keyboard navigation", () => {
  it("steps through stills with arrows, page keys, Home and End, clamping at either end", () => {
    const annotations = stillsAt(...Array.from({ length: 15 }, (_, index) => index * 5));
    const { strip, onSelect } = renderTimeline({ annotations });
    const steps = [
      ["ArrowRight", 2],
      ["ArrowUp", 3],
      ["ArrowLeft", 2],
      ["ArrowDown", 1],
      ["PageUp", 11],
      ["PageUp", 15],
      ["ArrowRight", 15],
      ["PageDown", 5],
      ["PageDown", 1],
      ["ArrowLeft", 1],
      ["End", 15],
      ["Home", 1],
    ];

    for (const [key, number] of steps) {
      expect(fireEvent.keyDown(strip, { key })).toBe(false);
      expect(strip.getAttribute("aria-valuenow")).toBe(String(number));
      expect(screen.getByText(`${number} of 15`)).toBeTruthy();
    }

    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens with Enter or Space, and resumes from the last preview after hiding it", () => {
    const { strip, timeline, onSelect } = renderTimeline();

    fireEvent.keyDown(strip, { key: "End" });
    expect(fireEvent.keyDown(strip, { key: "Enter" })).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith(3);
    fireEvent.blur(strip);
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();
    expect(fireEvent.keyDown(strip, { key: " " })).toBe(false);
    expect(onSelect).toHaveBeenLastCalledWith(3);
    expect(onSelect).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(screen.getByText("3 of 4")).toBeTruthy();
    expect(timeline.style.getPropertyValue("--spot")).toBe("60%");
    expect(fireEvent.keyDown(strip, { key: "Escape" })).toBe(true);
    expect(screen.getByText("3 of 4")).toBeTruthy();
  });

  it("only shows the remembered still on focus when focus-visible matches", () => {
    const { strip, timeline } = renderTimeline();
    const matches = vi.spyOn(strip, "matches").mockReturnValue(false);
    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 160 });
    fireEvent.pointerLeave(strip, { pointerType: "mouse" });

    fireEvent.focus(strip);
    expect(matches).toHaveBeenCalledWith(":focus-visible");
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();

    matches.mockReturnValue(true);
    fireEvent.focus(strip);
    expect(screen.getByText("3 of 4")).toBeTruthy();
    expect(timeline.style.getPropertyValue("--spot")).toBe("60%");
  });
});

describe("still timeline display precedence", () => {
  it("prefers the preview over the grid highlight, then retains the last highlight position for fading", () => {
    const { strip, timeline, rerender } = renderTimeline({ highlightedIndex: 3, selectedIndex: 1 });
    const selectedMark = timeline.querySelector(`.${styles.selectedMark}`);
    expect(timeline.classList.contains(styles.linked)).toBe(true);
    expect(timeline.style.getPropertyValue("--spot")).toBe("100%");
    expect(selectedMark.style.left).toBe("20%");

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 162 });
    rerender({ highlightedIndex: 0 });
    expect(timeline.classList.contains(styles.previewing)).toBe(true);
    expect(timeline.classList.contains(styles.linked)).toBe(false);
    expect(timeline.style.getPropertyValue("--spot")).toBe("62%");

    fireEvent.pointerLeave(strip, { pointerType: "mouse" });
    expect(timeline.classList.contains(styles.linked)).toBe(true);
    expect(timeline.style.getPropertyValue("--spot")).toBe("0%");
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();

    rerender({ highlightedIndex: -1 });
    expect(timeline.classList.contains(styles.linked)).toBe(false);
    expect(timeline.classList.contains(styles.previewing)).toBe(false);
    expect(timeline.style.getPropertyValue("--spot")).toBe("0%");
    expect(timeline.querySelector(`.${styles.selectedMark}`)).toBe(selectedMark);
    expect(selectedMark.style.left).toBe("20%");
  });

  it("retains the pointer's glow position after leaving and keeps grid highlighting separate from the keyboard cursor", () => {
    const { strip, timeline, onSelect, rerender } = renderTimeline();
    expect(timeline.style.getPropertyValue("--spot")).toBe("");

    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 162 });
    fireEvent.pointerLeave(strip, { pointerType: "mouse" });
    expect(timeline.style.getPropertyValue("--spot")).toBe("62%");
    expect(timeline.classList.contains(styles.previewing)).toBe(false);

    rerender({ highlightedIndex: 0 });
    expect(timeline.style.getPropertyValue("--spot")).toBe("0%");
    expect(strip.getAttribute("aria-valuenow")).toBe("3");
    fireEvent.keyDown(strip, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(2);
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(screen.getByText("4 of 4")).toBeTruthy();
  });
});

describe("still timeline when its still list changes", () => {
  it("retains an active raw index after shrinking while clamping the accessible value", () => {
    const { strip, timeline, onSelect, rerender } = renderTimeline();
    fireEvent.keyDown(strip, { key: "End" });

    rerender({ annotations: STILLS.slice(0, 2) });

    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();
    expect(timeline.style.getPropertyValue("--spot")).toBe("100%");
    expect(strip.getAttribute("aria-valuemax")).toBe("2");
    expect(strip.getAttribute("aria-valuenow")).toBe("2");
    expect(strip.getAttribute("aria-valuetext")).toBe("Still 2 of 2, 00:00:20");
    // Selection and stepping still start at the active raw index (3).
    fireEvent.keyDown(strip, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(3);
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(screen.getByText("2 of 2")).toBeTruthy();
  });

  it("clamps the remembered index before keyboard navigation when the preview is hidden", () => {
    const { strip, onSelect, rerender } = renderTimeline();
    fireEvent.keyDown(strip, { key: "End" });
    fireEvent.blur(strip);

    rerender({ annotations: STILLS.slice(0, 2) });
    fireEvent.keyDown(strip, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(1);
    fireEvent.keyDown(strip, { key: "ArrowLeft" });
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("updates the active still at the same index without moving the pointer's glow", () => {
    const { strip, timeline, rerender } = renderTimeline();
    fireEvent.pointerMove(strip, { pointerType: "mouse", clientX: 162 });
    const replacement = stillsAt(0, 20, 75.5, 100);

    rerender({ annotations: replacement });

    expect(timeline.style.getPropertyValue("--spot")).toBe("62%");
    expect(timeline.querySelector(`.${styles.playhead}`).style.left).toBe("75.5%");
    expect(timeline.querySelector("img").getAttribute("src")).toBe(replacement[2].image_url);
    expect(strip.getAttribute("aria-valuetext")).toBe("Still 3 of 4, 00:01:15.5");
    expect(screen.getByText("3 of 4")).toBeTruthy();
  });

  it("does not preview or select from an initially empty list and becomes usable when stills arrive", () => {
    const { strip, timeline, onSelect, rerender } = renderTimeline({ annotations: [] });
    fireEvent.pointerDown(strip, { pointerType: "touch", pointerId: 7, clientX: 160 });
    fireEvent.pointerUp(strip, { pointerType: "touch", pointerId: 7, clientX: 160 });
    for (const key of ["Enter", " ", "ArrowRight", "Home", "End"]) {
      expect(fireEvent.keyDown(strip, { key })).toBe(false);
    }
    expect(onSelect).not.toHaveBeenCalled();
    expect(timeline.querySelector(`.${styles.preview}`)).toBeNull();
    expect(strip.getAttribute("aria-valuenow")).toBe("0");

    rerender({ annotations: STILLS });
    fireEvent.keyDown(strip, { key: "ArrowRight" });
    expect(screen.getByText("2 of 4")).toBeTruthy();
  });
});
