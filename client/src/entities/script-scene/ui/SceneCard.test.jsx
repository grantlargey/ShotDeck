import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
