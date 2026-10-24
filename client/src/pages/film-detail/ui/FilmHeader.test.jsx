import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilmEditForm } from "@/entities/film/model/filmForms.js";
import { FilmHeader } from "./FilmHeader.jsx";

/*
 * The film hero: its backdrop, a few of the film's stills picked at random
 * taking turns in film order; its cover, which opens the script for visitors
 * and the editor for admins; and the stills count in its eyebrow. Timers are
 * faked; the turn order, reloads and the editor are real.
 */

const FILM = { id: "m1", title: "Night Diner", runtime_minutes: 120 };
const COVER_URL = "https://media.test/cover.jpg";
const SCRIPT = { id: "s1", movie_id: "m1" };
const HOLD_MS = 7000;
// The cover swings open before the script opens.
const COVER_OPEN_MS = 750;

/** Still `n`, placed at minute `n`. */
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

// The still the header last told the page was on screen.
let reported;

function header(props) {
  return (
    <FilmHeader
      film={FILM}
      coverUrl={COVER_URL}
      onBackdropChange={(stillId) => {
        reported = stillId;
      }}
      {...props}
    />
  );
}

/** The number of the still on screen, as the header tells the page. */
function onScreen() {
  return Number(reported.slice(1));
}

function wait(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function nextTurn() {
  wait(HOLD_MS);
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

function lessMotion() {
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
}

beforeEach(() => {
  reported = undefined;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.matchMedia;
});

describe("the film hero's backdrop", () => {
  it("shows the blurred cover while no still has an image", () => {
    const { container } = render(header({ stills: [still(1, { image: false })] }));

    expect(reported).toBeNull();
    expect(container.querySelectorAll(`img[src="${COVER_URL}"]`)).toHaveLength(2);
  });

  it("takes turns through up to six random stills with images, then starts over", () => {
    render(header({ stills: [...stills(1, 2, 3, 4, 5, 6, 7, 8), still(9, { image: false })] }));

    const order = watchRotation(6);
    expect(new Set(order).size).toBe(6);
    for (const n of order) expect(n).toBeLessThanOrEqual(8);
    expect(onScreen()).toBe(order[0]);
  });

  it("plays the stills it picks in film order, telling the page each one", () => {
    render(header({ stills: stills(5, 1, 4, 2, 3) }));

    expect(watchRotation(5)).toEqual([1, 2, 3, 4, 5]);
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
    lessMotion();
    render(header({ stills: stills(1, 2, 3) }));
    const first = onScreen();

    nextTurn();
    nextTurn();
    expect(onScreen()).toBe(first);
  });
});

describe("the film hero's eyebrow", () => {
  it("counts the film's stills once they load", () => {
    const { rerender } = render(header({ stillCount: null }));
    expect(screen.getByText("Film").textContent).toBe("Film");

    rerender(header({ stillCount: 531 }));
    expect(screen.getByText("Film").textContent).toBe("Film531 stills");

    rerender(header({ stillCount: 1 }));
    expect(screen.getByText("1 still")).toBeTruthy();
  });
});

describe("the film hero's cover, for visitors", () => {
  it("is a picture they can't open while the film has no script", () => {
    render(header({ script: { current: null, onOpen: vi.fn() } }));

    expect(screen.getByRole("img", { name: "Night Diner cover" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Read the full script" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit details and script" })).toBeNull();
  });

  it("opens the script once it has swung open, and only once", () => {
    const onOpen = vi.fn();
    render(header({ script: { current: SCRIPT, onOpen } }));
    const cover = screen.getByRole("button", { name: "Read the full script" });

    fireEvent.click(cover);
    expect(cover.disabled).toBe(true);
    wait(COVER_OPEN_MS - 1);
    expect(onOpen).not.toHaveBeenCalled();
    wait(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens the script at once when the visitor asks for less motion", () => {
    lessMotion();
    const onOpen = vi.fn();
    render(header({ script: { current: SCRIPT, onOpen } }));

    fireEvent.click(screen.getByRole("button", { name: "Read the full script" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

/** The hero as an admin's page holds it: the draft starts from the film when the cover opens. */
function EditableHeader({ film = FILM, script = null, onAddStill, onPendingStill, onDiscard }) {
  const [values, setValues] = useState(null);
  return (
    <FilmHeader
      film={film}
      coverUrl={COVER_URL}
      script={script}
      edit={{
        values,
        saving: false,
        onStart: () => setValues(createFilmEditForm(film)),
        onChange: (field, value) => setValues((draft) => ({ ...draft, [field]: value })),
        onSave: () => setValues(null),
        onDiscard: () => {
          onDiscard?.();
          setValues(null);
        },
        onAddStill,
        onPendingStill,
      }}
    />
  );
}

function openCover() {
  fireEvent.click(screen.getByRole("button", { name: "Edit details and script" }));
}

describe("the film hero's editor", () => {
  it("puts the caret at the end of the last detail shown", () => {
    render(<EditableHeader film={{ ...FILM, director: "Ada Lane", writer: "Ada Lane, Sam Ford" }} />);

    openCover();

    const writer = screen.getByRole("textbox", { name: "Writer" });
    expect(document.activeElement).toBe(writer);
    expect(writer.selectionStart).toBe("Ada Lane, Sam Ford".length);
  });

  it("puts the caret at the end of the title when no other detail is filled in", () => {
    render(<EditableHeader film={{ id: "m1", title: "Night Diner" }} />);

    openCover();

    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Title" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(6);
  });

  it("opens onto the script's title page, with the way into the script and a way to replace it", () => {
    const onOpen = vi.fn();
    render(<EditableHeader script={{ current: SCRIPT, file: null, saving: false, onOpen, onFileChange: vi.fn(), onUpload: vi.fn() }} />);
    expect(screen.queryByRole("group", { name: "Script" })).toBeNull();

    openCover();

    const page = screen.getByRole("group", { name: "Script" });
    expect(within(page).getByText("Script uploaded")).toBeTruthy();
    expect(within(page).getByRole("button", { name: "Replace PDF" })).toBeTruthy();
    fireEvent.click(within(page).getByRole("button", { name: "Open script" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
  });

  it("asks on the page before a picked PDF replaces the script", () => {
    const onUpload = vi.fn();
    const onFileChange = vi.fn();
    const file = new File(["%PDF"], "revised.pdf", { type: "application/pdf" });
    render(<EditableHeader script={{ current: SCRIPT, file, saving: false, onOpen: vi.fn(), onFileChange, onUpload }} />);
    openCover();
    const page = screen.getByRole("group", { name: "Script" });
    expect(within(page).getByText("revised.pdf")).toBeTruthy();

    fireEvent.click(within(page).getByRole("button", { name: "Upload PDF" }));
    expect(onUpload).not.toHaveBeenCalled();
    expect(within(page).getByRole("alert").textContent).toMatch(/^Replace this script\?/);

    fireEvent.click(within(page).getByRole("button", { name: "Keep" }));
    expect(within(page).queryByRole("alert")).toBeNull();
    expect(onFileChange).not.toHaveBeenCalled();

    fireEvent.click(within(page).getByRole("button", { name: "Upload PDF" }));
    fireEvent.click(within(page).getByRole("button", { name: "Replace" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it("uploads a film's first script without asking, and takes a dropped PDF", () => {
    const onUpload = vi.fn();
    const onFileChange = vi.fn();
    const file = new File(["%PDF"], "first.pdf", { type: "application/pdf" });
    const { rerender } = render(
      <EditableHeader script={{ current: null, file: null, saving: false, onOpen: vi.fn(), onFileChange, onUpload }} />
    );
    openCover();
    const page = screen.getByRole("group", { name: "Script" });
    expect(within(page).getByText("No script yet")).toBeTruthy();

    fireEvent.drop(page, { dataTransfer: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
    expect(onFileChange).not.toHaveBeenCalled();
    fireEvent.drop(page, { dataTransfer: { files: [file] } });
    expect(onFileChange).toHaveBeenCalledWith(file);

    rerender(<EditableHeader script={{ current: null, file, saving: false, onOpen: vi.fn(), onFileChange, onUpload }} />);
    fireEvent.click(within(screen.getByRole("group", { name: "Script" })).getByRole("button", { name: "Upload PDF" }));
    expect(onUpload).toHaveBeenCalledTimes(1);
  });
});

describe("adding a still from the hero", () => {
  function stillTime() {
    return screen.getByRole("textbox", { name: "Add a still at" });
  }

  it("is a time typed after the stills count, shown only while the cover is open", () => {
    render(<EditableHeader onAddStill={vi.fn()} />);
    expect(screen.queryByRole("textbox", { name: "Add a still at" })).toBeNull();

    openCover();
    expect(stillTime().getAttribute("placeholder")).toBe("HH:MM:SS");
  });

  it("marks a whole typed time on the timeline, then adds a still there with Enter", () => {
    const onAddStill = vi.fn();
    const onPendingStill = vi.fn();
    render(<EditableHeader onAddStill={onAddStill} onPendingStill={onPendingStill} />);
    openCover();

    fireEvent.change(stillTime(), { target: { value: "13" } });
    expect(onPendingStill).toHaveBeenLastCalledWith(13);
    fireEvent.change(stillTime(), { target: { value: "01:30:05.5" } });
    expect(onPendingStill).toHaveBeenLastCalledWith(5405.5);

    fireEvent.keyDown(stillTime(), { key: "Enter" });
    expect(onAddStill).toHaveBeenCalledWith("01:30:05.5");
    expect(stillTime().value).toBe("");
    expect(onPendingStill).toHaveBeenLastCalledWith(null);
  });

  it("refuses a time the film can't hold, on the field", () => {
    const onAddStill = vi.fn();
    render(<EditableHeader onAddStill={onAddStill} />);
    openCover();

    fireEvent.change(stillTime(), { target: { value: "02:01:01" } });
    fireEvent.keyDown(stillTime(), { key: "Enter" });

    expect(onAddStill).not.toHaveBeenCalled();
    expect(stillTime().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "The timestamp can't be later than 02:01:00 (runtime plus one minute)."
    );
    fireEvent.change(stillTime(), { target: { value: "02:00:00" } });
    expect(stillTime().getAttribute("aria-invalid")).toBeNull();
  });

  it("clears the time with the first Esc and closes the cover with the next", () => {
    const onDiscard = vi.fn();
    const onPendingStill = vi.fn();
    render(<EditableHeader onAddStill={vi.fn()} onPendingStill={onPendingStill} onDiscard={onDiscard} />);
    openCover();
    fireEvent.change(stillTime(), { target: { value: "00:10:00" } });

    fireEvent.keyDown(stillTime(), { key: "Escape" });
    expect(stillTime().value).toBe("");
    expect(onPendingStill).toHaveBeenLastCalledWith(null);
    expect(onDiscard).not.toHaveBeenCalled();

    fireEvent.keyDown(stillTime(), { key: "Escape" });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("textbox", { name: "Add a still at" })).toBeNull();
  });
});
