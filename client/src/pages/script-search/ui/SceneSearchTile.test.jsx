import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneSearchTile } from "./SceneSearchTile.jsx";

const EXAMPLE = "Accidental gunshot";
// The first example deals 450 ms after opening; each character takes 55 ms.
const typed = (characters) => 450 + 55 * characters;

function Tile({ initialValue = "", query = "", onSubmit = () => {}, ...props }) {
  const [value, setValue] = useState(initialValue);
  return (
    <SceneSearchTile
      value={value}
      query={query}
      examples={[EXAMPLE]}
      onChange={setValue}
      onSubmit={onSubmit}
      {...props}
    />
  );
}

const field = () => screen.getByRole("searchbox", { name: "Describe a scene" });
const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete window.matchMedia;
});

describe("the scene search tile", () => {
  it("rests as a tile, and once opened types examples until you type", () => {
    render(<Tile />);
    wait(typed(5));
    expect(screen.queryByText("Accid")).toBeNull();

    act(() => field().focus());
    wait(typed(5));
    expect(screen.getByText("Accid")).toBeTruthy();

    fireEvent.change(field(), { target: { value: "a" } });
    expect(screen.queryByText(/^Accid/)).toBeNull();
  });

  it("takes the example being typed with Tab, and searches for it from its key", () => {
    const onSubmit = vi.fn();
    render(<Tile onSubmit={onSubmit} />);
    act(() => field().focus());
    wait(typed(EXAMPLE.length));

    fireEvent.click(screen.getByRole("button", { name: `Search for “${EXAMPLE}”` }));
    expect(onSubmit).toHaveBeenCalledWith(EXAMPLE);

    act(() => field().focus());
    wait(typed(8));
    fireEvent.keyDown(field(), { key: "Tab" });
    expect(field().value).toBe(EXAMPLE);
  });

  it("searches what's typed on Enter or with the shutter, and closes", () => {
    const onSubmit = vi.fn();
    render(<Tile onSubmit={onSubmit} />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "  a man   laughs alone " } });

    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onSubmit).toHaveBeenLastCalledWith("a man laughs alone");
    expect(document.activeElement).not.toBe(field());

    act(() => field().focus());
    fireEvent.click(screen.getByRole("button", { name: "Find scenes" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("draws its caret as the underscore after the text up to the insertion point, hidden over a selection", () => {
    render(<Tile />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "a fight" } });
    // The text before the insertion point is laid out unseen, with the underscore after it.
    const lead = screen.getByText("a fight");
    const caret = lead.nextElementSibling;
    expect(caret.style.visibility).toBe("");

    field().setSelectionRange(2, 2);
    fireEvent.select(field());
    expect(lead.textContent).toBe("a ");

    field().setSelectionRange(0, 7);
    fireEvent.select(field());
    expect(caret.style.visibility).toBe("hidden");
  });

  it("shows its buttons only while it's open", () => {
    render(<Tile initialValue="a fight" query="a fight" />);
    expect(screen.queryByRole("button", { name: "Clear the description" })).toBeNull();

    act(() => field().focus());
    expect(screen.getByRole("button", { name: "Clear the description" })).toBeTruthy();
  });

  it("shows the shutter only for a description not yet searched", () => {
    render(<Tile initialValue="a fight" query="a fight" />);
    act(() => field().focus());
    expect(screen.queryByRole("button", { name: "Find scenes" })).toBeNull();

    fireEvent.change(field(), { target: { value: "a fight on a train" } });
    expect(screen.getByRole("button", { name: "Find scenes" })).toBeTruthy();
  });

  it("puts back the last search on Escape, then closes", () => {
    render(<Tile initialValue="a fight" query="a fight" />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "a fig" } });

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(field().value).toBe("a fight");

    fireEvent.keyDown(field(), { key: "Escape" });
    expect(document.activeElement).not.toBe(field());
  });

  it("brings the examples back a moment after the field is emptied", () => {
    render(<Tile />);
    act(() => field().focus());
    fireEvent.change(field(), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear the description" }));

    wait(typed(3));
    expect(screen.queryByText("Acc")).toBeNull();
    wait(1200);
    wait(typed(3));
    expect(screen.getByText("Acc")).toBeTruthy();
  });

  it("opens on / from the page, but not while another field takes the typing", () => {
    render(
      <>
        <input aria-label="Other field" />
        <Tile />
      </>
    );

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(field());

    const other = screen.getByRole("textbox", { name: "Other field" });
    act(() => other.focus());
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
  });

  it("can't be used while semantic search is unavailable", () => {
    render(<Tile disabled />);

    expect(field().disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).not.toBe(field());
  });

  it("shows an example whole, without typing it, when motion is reduced", () => {
    window.matchMedia = (query) => ({
      matches: query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    });
    render(<Tile />);
    act(() => field().focus());

    expect(screen.getByText(EXAMPLE)).toBeTruthy();
  });
});
