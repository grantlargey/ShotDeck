import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilmEditForm } from "@/entities/film/model/filmForms.js";
import { FilmHeader } from "./FilmHeader.jsx";

/*
 * The film hero's backdrop: a few of the film's stills, picked at random,
 * take turns behind the hero in film order. Timers are faked; the turn order,
 * the caption and its timeline, and reloads are real.
 */

const FILM = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
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
  return <FilmHeader film={FILM} coverUrl={COVER_URL} {...props} />;
}

function caption() {
  return screen.queryByRole("button", { name: /^Open the still at / });
}

/** Where the caption's timeline marks the still on screen, or null without one. */
function timelineSpot() {
  return caption().querySelector('[style*="--spot"]')?.style.getPropertyValue("--spot") ?? null;
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

describe("the film hero's backdrop", () => {
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

  it("plays the stills it picks in film order", () => {
    render(header({ stills: stills(5, 1, 4, 2, 3) }));

    expect(watchRotation(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("marks where the still on screen falls in the film on the caption's timeline", () => {
    render(header({ stills: stills(30, 60, 90) }));
    const spots = [];
    for (let turn = 0; turn < 3; turn += 1) {
      spots.push(timelineSpot());
      nextTurn();
    }

    expect(spots).toEqual(["25%", "50%", "75%"]);
  });

  it("shows no timeline when the film has no runtime to place the still on", () => {
    render(header({ film: { ...FILM, runtime_minutes: null }, stills: stills(1, 2) }));

    expect(caption()).toBeNull();
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

/** The hero as an admin's page holds it: the draft starts from the film when the cover opens. */
function EditableHeader({ film }) {
  const [values, setValues] = useState(null);
  return (
    <FilmHeader
      film={film}
      coverUrl={COVER_URL}
      edit={{
        values,
        saving: false,
        onStart: () => setValues(createFilmEditForm(film)),
        onChange: (field, value) => setValues((draft) => ({ ...draft, [field]: value })),
        onSave: () => setValues(null),
        onDiscard: () => setValues(null),
      }}
    />
  );
}

describe("the film hero's editor", () => {
  it("shows visitors the cover as a picture they can't open", () => {
    render(header());

    expect(screen.getByRole("img", { name: "Night Diner cover" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
  });

  it("puts the caret at the end of the last detail shown", () => {
    render(<EditableHeader film={{ ...FILM, director: "Ada Lane", writer: "Ada Lane, Sam Ford" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    const writer = screen.getByRole("textbox", { name: "Writer" });
    expect(document.activeElement).toBe(writer);
    expect(writer.selectionStart).toBe("Ada Lane, Sam Ford".length);
  });

  it("puts the caret at the end of the title when no other detail is filled in", () => {
    render(<EditableHeader film={{ id: "m1", title: "Night Diner" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });
});
