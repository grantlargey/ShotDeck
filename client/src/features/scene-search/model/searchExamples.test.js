import { describe, expect, it } from "vitest";
import { createExampleDeck, SEARCH_EXAMPLES } from "./searchExamples.js";

/** A repeatable stand-in for Math.random (mulberry32). */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deal(deck, count) {
  return Array.from({ length: count }, () => deck.next());
}

describe("the search examples", () => {
  it("are 34 different descriptions", () => {
    expect(SEARCH_EXAMPLES).toHaveLength(34);
    expect(new Set(SEARCH_EXAMPLES).size).toBe(34);
  });
});

describe("the example deck", () => {
  it("deals every example once before any repeats", () => {
    const deck = createExampleDeck(SEARCH_EXAMPLES, seeded(1));

    for (let round = 0; round < 5; round += 1) {
      expect(new Set(deal(deck, SEARCH_EXAMPLES.length))).toEqual(new Set(SEARCH_EXAMPLES));
    }
  });

  it("deals them in an order decided when the deck is made", () => {
    const first = deal(createExampleDeck(SEARCH_EXAMPLES, seeded(1)), SEARCH_EXAMPLES.length);
    const again = deal(createExampleDeck(SEARCH_EXAMPLES, seeded(1)), SEARCH_EXAMPLES.length);
    const other = deal(createExampleDeck(SEARCH_EXAMPLES, seeded(2)), SEARCH_EXAMPLES.length);

    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
    expect(first).not.toEqual(SEARCH_EXAMPLES);
  });

  it("never shows the same example twice in a row, even where one round meets the next", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const dealt = deal(createExampleDeck(["a", "b", "c"], seeded(seed)), 30);
      dealt.slice(1).forEach((example, index) => expect(example).not.toBe(dealt[index]));
    }
  });

  it("deals nothing from an empty list, and the only example from a list of one", () => {
    expect(createExampleDeck([]).next()).toBe("");
    expect(deal(createExampleDeck(["only"]), 3)).toEqual(["only", "only", "only"]);
  });
});
