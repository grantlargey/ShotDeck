import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MovieHeader } from "./MovieHeader.jsx";

/*
 * The project hero's backdrop: a few of the film's stills, picked at random,
 * take turns behind the hero. Timers are faked; the turn order, the caption
 * and reloads are real.
 */

const MOVIE = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
const COVER_URL = "https://media.test/cover.jpg";
const HOLD_MS = 7000;

/** Still `n`, placed at minute `n` so the caption names it. */
function still(n, { image = true } = {}) {
  return {
    id: `a${n}`,
    movie_id: "m1",
    time_seconds: 60 * n,
    image_key: image ? `stills/a${n}.jpg` : null,
    image_url: image ? `https://media.test/a${n}.jpg` : null,
  };
}

function stills(...numbers) {
  return numbers.map((n) => still(n));
}

function header(props) {
  return <MovieHeader movie={MOVIE} coverUrl={COVER_URL} {...props} />;
}

function caption() {
  return screen.queryByRole("button", { name: /^Open the still at / });
}

/** The number of the still on screen, read from its caption. */
function onScreen() {
  const [, minutes] = caption().getAttribute("aria-label").match(/00:(\d\d):00$/);
  return Number(minutes);
}

function nextTurn() {
  act(() => {
    vi.advanceTimersByTime(HOLD_MS);
  });
}

/** The turn order, read by watching one full rotation of `count` stills. */
function watchRotation(count) {
  const order = [];
  for (let turn = 0; turn < count; turn += 1) {
    order.push(onScreen());
    nextTurn();
  }
  return order;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.matchMedia;
});

describe("the project hero's backdrop", () => {
  it("shows the blurred cover while no still has an image", () => {
    const { container } = render(header({ stills: [still(1, { image: false })] }));

    expect(caption()).toBeNull();
    expect(container.querySelectorAll(`img[src="${COVER_URL}"]`)).toHaveLength(2);
  });

  it("takes turns through up to six random stills with images, then starts over", () => {
    render(header({ stills: [...stills(1, 2, 3, 4, 5, 6, 7, 8), still(9, { image: false })] }));

    const order = watchRotation(6);
    expect(new Set(order).size).toBe(6);
    for (const n of order) expect(n).toBeLessThanOrEqual(8);
    expect(onScreen()).toBe(order[0]);
  });

  it("keeps the still on screen when a reload deletes one earlier in the order", () => {
    const { rerender } = render(header({ stills: stills(1, 2, 3) }));
    const [first, second, third] = watchRotation(3);
    nextTurn();
    expect(onScreen()).toBe(second);

    rerender(header({ stills: stills(1, 2, 3).filter((row) => row.id !== `a${first}`) }));
    expect(onScreen()).toBe(second);
    nextTurn();
    expect(onScreen()).toBe(third);
    nextTurn();
    expect(onScreen()).toBe(second);
  });

  it("moves to the next still when a reload deletes the one on screen, and picks anew once none are left", () => {
    const { rerender } = render(header({ stills: stills(1, 2, 3) }));
    const [first, second] = watchRotation(3);

    rerender(header({ stills: stills(1, 2, 3).filter((row) => row.id !== `a${first}`) }));
    expect(onScreen()).toBe(second);

    rerender(header({ stills: stills(7, 8) }));
    expect([7, 8]).toContain(onScreen());
  });

  it("holds the first still when the visitor asks for less motion", () => {
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    render(header({ stills: stills(1, 2, 3) }));
    const first = onScreen();

    nextTurn();
    nextTurn();
    expect(onScreen()).toBe(first);
  });

  it("opens the still on screen from its caption", () => {
    const onOpenStill = vi.fn();
    render(header({ stills: stills(1, 2, 3), onOpenStill }));
    nextTurn();

    fireEvent.click(caption());
    expect(onOpenStill).toHaveBeenCalledWith(`a${onScreen()}`);
  });
});
