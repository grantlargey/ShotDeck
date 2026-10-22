import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SceneSearchField } from "./SceneSearchField.jsx";

/*
 * The field's own contract. How Script Search's tile opens and closes around it
 * is covered by SceneSearchTile.test.jsx.
 */

const EXAMPLE = "Petty theft";
// The first example deals 450 ms after the field opens; each character takes 55 ms.
const typed = (characters) => 450 + 55 * characters;

function Field({ initialValue = "", onSubmit = () => {}, ...props }) {
  const [value, setValue] = useState(initialValue);
  return <SceneSearchField value={value} examples={[EXAMPLE]} onChange={setValue} onSubmit={onSubmit} {...props} />;
}

const field = () => screen.getByRole("searchbox", { name: "Describe a scene" });
const wait = (ms) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the scene search field", () => {
  it("types examples while it's open and empty, with or without focus", () => {
    render(<Field />);
    wait(typed(5));
    expect(screen.getByText("Petty")).toBeTruthy();

    act(() => field().focus());
    wait(typed(EXAMPLE.length));
    expect(screen.getByText(EXAMPLE)).toBeTruthy();
  });

  it("types nothing and shows no buttons while closed", () => {
    render(<Field open={false} initialValue="a fight" />);
    wait(typed(5));

    expect(screen.queryByText(/^Pett/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear the description" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Find scenes" })).toBeNull();
  });

  it("searches for the example on screen from its key, and takes it with →", () => {
    const onSubmit = vi.fn();
    render(<Field onSubmit={onSubmit} />);
    wait(typed(EXAMPLE.length));

    fireEvent.click(screen.getByRole("button", { name: `Search for “${EXAMPLE}”` }));
    expect(onSubmit).toHaveBeenCalledWith(EXAMPLE);

    act(() => field().focus());
    wait(typed(3));
    fireEvent.keyDown(field(), { key: "ArrowRight" });
    expect(field().value).toBe(EXAMPLE);
  });

  it("says when it gains and loses focus", () => {
    const onFocusChange = vi.fn();
    render(<Field onFocusChange={onFocusChange} />);

    act(() => field().focus());
    act(() => field().blur());
    expect(onFocusChange.mock.calls).toEqual([[true], [false]]);
  });
});
