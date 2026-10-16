import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { FilmCard } from "./FilmCard.jsx";

vi.mock("@/shared/lib/media/useSignedMediaUrl.js", () => ({ useSignedMediaUrl: (_key, url) => url }));
afterEach(() => { vi.unstubAllGlobals(); });

it("clears the source poster name after capture and ignores a repeated click during the transition", async () => {
  let capture;
  let finish;
  const finished = new Promise((resolve) => { finish = resolve; });
  const start = vi.fn((callback) => { capture = callback; return { finished }; });
  const descriptor = Object.getOwnPropertyDescriptor(document, "startViewTransition");
  Object.defineProperty(document, "startViewTransition", { configurable: true, value: start });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  try {
    render(<MemoryRouter>
      <FilmCard film={{ id: "m", title: "Film", cover_image_url: "https://media.test/poster.jpg" }} />
      <FilmCard film={{ id: "n", title: "Second film", cover_image_url: "https://media.test/second.jpg" }} />
    </MemoryRouter>);
    const [image, secondImage] = screen.getAllByAltText("");
    Object.defineProperty(secondImage, "complete", { value: true });
    Object.defineProperty(image, "complete", { value: true });
    const [link, secondLink] = screen.getAllByRole("link");
    fireEvent.click(link);
    expect(image.style.viewTransitionName).toBe("film-poster");
    fireEvent.click(link);
    fireEvent.click(secondLink);
    expect(secondImage.style.viewTransitionName || "").toBe("");
    expect(start).toHaveBeenCalledTimes(1);
    // The transition callback runs after the old view's snapshot.
    let captured;
    act(() => { captured = capture(); });
    expect(image.style.viewTransitionName).toBe("");
    await act(async () => { finish(); await finished; });
    await captured;
  } finally {
    if (descriptor) Object.defineProperty(document, "startViewTransition", descriptor);
    else delete document.startViewTransition;
  }
});
