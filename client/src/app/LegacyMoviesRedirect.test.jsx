import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LegacyMoviesRedirect } from "./LegacyMoviesRedirect.jsx";

function Location() {
  const { pathname, search, hash } = useLocation();
  return <p>{`${pathname}${search}${hash}`}</p>;
}

function landOn(entry) {
  const { container } = render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/movies/*" element={<LegacyMoviesRedirect />} />
        <Route path="*" element={<Location />} />
      </Routes>
    </MemoryRouter>
  );
  return container.textContent;
}

describe("LegacyMoviesRedirect", () => {
  it("sends the old list address to the library, with its search", () => {
    expect(landOn("/movies")).toBe("/library");
    expect(landOn("/movies/")).toBe("/library");
    expect(landOn("/movies?query=joker")).toBe("/library?query=joker");
  });

  it("sends each old film address to the same page under /films", () => {
    expect(landOn("/movies/new")).toBe("/films/new");
    expect(landOn("/movies/m1/edit")).toBe("/films/m1/edit");
    expect(landOn("/movies/m1?annotationId=a1")).toBe("/films/m1?annotationId=a1");
    expect(landOn("/movies/m1/scripts/s1?sceneId=c1&page=3#top")).toBe("/films/m1/scripts/s1?sceneId=c1&page=3#top");
  });
});
