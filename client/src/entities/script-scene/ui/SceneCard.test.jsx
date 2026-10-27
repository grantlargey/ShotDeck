import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLD_MS } from "@/shared/lib/useHoldPress.js";
import { SceneCard } from "./SceneCard.jsx";

const SCENE = {
  id: "c1",
  movie_title: "Joker",
  start_time_seconds: 60,
  end_time_seconds: 90,
  scene_text: "## INT. ELEVATOR - NIGHT",
  tags: [],
  first_image_annotation: null,
};

describe("the scene card", () => {
  it("plays its still in after the delay it's given", () => {
    render(<SceneCard scene={SCENE} layout="split" stillMotion={{ phase: "in", delay: 182, frameDelay: 0 }} />);
    const card = screen.getByRole("button", { name: /Joker/ });

    expect(card.className).toMatch(/stillIn/);
    expect(card.style.getPropertyValue("--still-delay")).toBe("182ms");
    expect(card.style.getPropertyValue("--frame-delay")).toBe("0ms");
  });

  it("plays its still away, then holds still once the motion is over", () => {
    const { rerender } = render(
      <SceneCard scene={SCENE} layout="split" stillMotion={{ phase: "out", delay: 0, frameDelay: 964 }} />
    );
    const card = screen.getByRole("button", { name: /Joker/ });

    expect(card.className).toMatch(/stillOut/);
    expect(card.style.getPropertyValue("--frame-delay")).toBe("964ms");

    rerender(<SceneCard scene={SCENE} layout="split" />);
    expect(card.className).not.toMatch(/still(In|Out)/);
    expect(card.style.getPropertyValue("--still-delay")).toBe("");
  });
});

describe("the scene card on a touch screen", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderTouchCard() {
    const handlers = { onClick: vi.fn(), onTap: vi.fn(), onHold: vi.fn() };
    render(
      <SceneCard
        scene={SCENE}
        onClick={handlers.onClick}
        touch={{ onTap: handlers.onTap, onHold: handlers.onHold, holdLabel: "Keep holding to edit" }}
      />
    );
    return { card: screen.getByRole("button", { name: /Joker/ }), ...handlers };
  }

  function touch(card, at = { clientX: 10, clientY: 10 }) {
    fireEvent.pointerDown(card, { pointerType: "touch", isPrimary: true, ...at });
  }

  it("opens on a tap", () => {
    vi.useFakeTimers();
    const { card, onClick, onTap, onHold } = renderTouchCard();

    touch(card);
    fireEvent.pointerUp(card, { pointerType: "touch" });
    fireEvent.click(card, { detail: 1 });
    act(() => vi.advanceTimersByTime(HOLD_MS));

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(onHold).not.toHaveBeenCalled();
  });

  it("edits on a hold, showing what the hold will do, and ignores the click after it", () => {
    vi.useFakeTimers();
    const { card, onTap, onHold } = renderTouchCard();

    touch(card);
    expect(card.className).toMatch(/holding/);
    expect(screen.getByText("Keep holding to edit")).toBeTruthy();

    act(() => vi.advanceTimersByTime(HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
    expect(card.className).not.toMatch(/holding/);

    fireEvent.pointerUp(card, { pointerType: "touch" });
    fireEvent.click(card, { detail: 1 });
    expect(onTap).not.toHaveBeenCalled();

    // The next tap is a tap again.
    touch(card);
    fireEvent.pointerUp(card, { pointerType: "touch" });
    fireEvent.click(card, { detail: 1 });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("lets a finger that drifts scroll the page instead of holding", () => {
    vi.useFakeTimers();
    const { card, onHold } = renderTouchCard();

    touch(card);
    fireEvent.pointerMove(card, { pointerType: "touch", clientX: 10, clientY: 40 });
    act(() => vi.advanceTimersByTime(HOLD_MS));

    expect(onHold).not.toHaveBeenCalled();
    expect(card.className).not.toMatch(/holding/);
  });

  it("keeps a mouse click on onClick", () => {
    const { card, onClick, onTap } = renderTouchCard();

    fireEvent.pointerDown(card, { pointerType: "mouse", isPrimary: true });
    fireEvent.click(card, { detail: 1 });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
    expect(card.className).not.toMatch(/holding/);
  });
});
