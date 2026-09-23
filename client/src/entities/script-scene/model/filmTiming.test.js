import { describe, expect, it } from "vitest";
import {
  filmTimingCovers,
  filmTimingErrorWhileTyping,
  findOverlappingFilmTiming,
  formatFilmTiming,
  momentSeconds,
  parseFilmMoment,
  parseFilmTiming,
} from "./filmTiming.js";

const FORMAT = "Use HH:MM:SS (or MM:SS) for the start and end times.";
const BOTH = "Enter a start and an end time for this scene.";
const ORDER = "The end time must be at or after the start time.";

function scene(id, start, end) {
  return { id, start_time_seconds: start, end_time_seconds: end };
}

describe("parseFilmTiming", () => {
  it("reads HH:MM:SS and MM:SS times as seconds", () => {
    expect(parseFilmTiming("00:10:00", "12:30", 0)).toEqual({ start: 600, end: 750 });
    expect(parseFilmTiming(" 1:00:00 ", "1:00:00", 0)).toEqual({ start: 3600, end: 3600 });
  });

  it("checks format first, then that both times are present", () => {
    expect(parseFilmTiming("", "", 0)).toEqual({ error: BOTH });
    expect(parseFilmTiming("00:01:00", "  ", 0)).toEqual({ error: BOTH });
    expect(parseFilmTiming("", "abc", 0)).toEqual({ error: FORMAT });
    expect(parseFilmTiming("1:60", "00:02:00", 0)).toEqual({ error: FORMAT });
    expect(parseFilmTiming("00:01:00", "00:02:xx", 0)).toEqual({ error: FORMAT });
  });

  it("refuses an end before the start, and allows an end equal to the start", () => {
    expect(parseFilmTiming("00:02:00", "00:01:59", 0)).toEqual({ error: ORDER });
    expect(parseFilmTiming("00:02:00", "00:02:00", 0)).toEqual({ start: 120, end: 120 });
  });

  it("caps both times at a known runtime, and treats a runtime of 0 as unknown", () => {
    expect(parseFilmTiming("00:00:10", "00:01:00", 30)).toEqual({
      error: "Times can't be later than the film's runtime (00:00:30).",
    });
    expect(parseFilmTiming("00:00:40", "00:00:50", 30).error).toMatch(/runtime/);
    expect(parseFilmTiming("00:00:10", "00:00:30", 30)).toEqual({ start: 10, end: 30 });
    expect(parseFilmTiming("09:00:00", "10:00:00", 0)).toEqual({ start: 32400, end: 36000 });
  });

  it("reports an end before the start before a time past the runtime", () => {
    expect(parseFilmTiming("00:02:00", "00:01:00", 30)).toEqual({ error: ORDER });
  });
});

describe("filmTimingErrorWhileTyping", () => {
  it("doesn't flag missing or half-typed times", () => {
    expect(filmTimingErrorWhileTyping("", "", 0)).toBe("");
    expect(filmTimingErrorWhileTyping("00:1", "", 3600)).toBe("");
    expect(filmTimingErrorWhileTyping("00:01:00", "abc", 3600)).toBe("");
  });

  it("flags an end before the start, and a single time past a known runtime", () => {
    expect(filmTimingErrorWhileTyping("00:02:00", "00:01:00", 0)).toBe(ORDER);
    expect(filmTimingErrorWhileTyping("", "00:01:00", 30)).toBe("Times can't be later than the film's runtime (00:00:30).");
    expect(filmTimingErrorWhileTyping("00:01:00", "", 0)).toBe("");
  });
});

describe("parseFilmMoment", () => {
  it("reads a typed moment as seconds", () => {
    expect(parseFilmMoment("01:02:03", 0)).toEqual({ seconds: 3723 });
    expect(parseFilmMoment("2:05", 7200)).toEqual({ seconds: 125 });
  });

  it.each(["", "abc", "1:60", "-1:00"])("refuses %j with the timestamp format message", (text) => {
    expect(parseFilmMoment(text, 0)).toEqual({ error: "Use HH:MM:SS (or MM:SS) for the timestamp." });
  });

  it("allows one extra minute at a known runtime, inclusive, and treats 0 as unknown", () => {
    expect(parseFilmMoment("00:03:01", 120)).toEqual({
      error: "The timestamp can't be later than 00:03:00 (runtime plus one minute).",
    });
    expect(parseFilmMoment("00:02:00", 120)).toEqual({ seconds: 120 });
    expect(parseFilmMoment("00:02:25", 120)).toEqual({ seconds: 145 });
    expect(parseFilmMoment("00:03:00", 120)).toEqual({ seconds: 180 });
    expect(parseFilmMoment("05:00:00", 0)).toEqual({ seconds: 18000 });
  });
});

describe("formatFilmTiming", () => {
  it("labels a scene's range", () => {
    expect(formatFilmTiming(scene("a", 600, 720))).toBe("00:10:00 – 00:12:00");
    expect(formatFilmTiming(scene("a", 0, 0))).toBe("00:00:00 – 00:00:00");
    // Stored seconds can arrive as numeric strings, as overlap and coverage already accept.
    expect(formatFilmTiming(scene("a", "600", "720"))).toBe("00:10:00 – 00:12:00");
    expect(formatFilmTiming(findOverlappingFilmTiming([scene("b", "600", "720")], { start: 650, end: 700 }))).toBe(
      "00:10:00 – 00:12:00"
    );
  });

  it("says there's no timing when neither time is set, and shows the one that is", () => {
    expect(formatFilmTiming(scene("a", null, null))).toBe("No timing yet");
    expect(formatFilmTiming({})).toBe("No timing yet");
    expect(formatFilmTiming(null)).toBe("No timing yet");
    expect(formatFilmTiming(scene("a", undefined, 60))).toBe("--:--:-- – 00:01:00");
  });
});

describe("momentSeconds", () => {
  it("reads numbers and numeric strings, and returns null otherwise", () => {
    expect(momentSeconds(0)).toBe(0);
    expect(momentSeconds(12.5)).toBe(12.5);
    expect(momentSeconds("600")).toBe(600);
    for (const value of [null, undefined, "", "abc", NaN, Infinity]) {
      expect(momentSeconds(value)).toBeNull();
    }
  });
});

describe("filmTimingCovers", () => {
  const covered = scene("a", 600, 720);

  it("covers moments inside the timing, including both endpoints", () => {
    expect(filmTimingCovers(covered, 600)).toBe(true);
    expect(filmTimingCovers(covered, 660)).toBe(true);
    expect(filmTimingCovers(covered, 720)).toBe(true);
    expect(filmTimingCovers(covered, "720")).toBe(true);
  });

  it("doesn't cover moments outside it, or anything without usable timing", () => {
    expect(filmTimingCovers(covered, 599)).toBe(false);
    expect(filmTimingCovers(covered, 721)).toBe(false);
    expect(filmTimingCovers(covered, null)).toBe(false);
    expect(filmTimingCovers(scene("b", 600, null), 600)).toBe(false);
    expect(filmTimingCovers(null, 600)).toBe(false);
  });
});

describe("findOverlappingFilmTiming", () => {
  const saved = scene("saved", 600, 720);

  it.each([
    ["starts inside", { start: 660, end: 780 }],
    ["ends inside", { start: 540, end: 660 }],
    ["is identical", { start: 600, end: 720 }],
    ["is contained", { start: 630, end: 690 }],
    ["contains it", { start: 500, end: 800 }],
    ["overlaps by one second at the start", { start: 719, end: 800 }],
    ["overlaps by one second at the end", { start: 500, end: 601 }],
    ["is zero-length strictly inside", { start: 660, end: 660 }],
    ["shares only its end second", { start: 720, end: 840 }],
    ["shares only its start second", { start: 480, end: 600 }],
    ["is zero-length on its start second", { start: 600, end: 600 }],
    ["is zero-length on its end second", { start: 720, end: 720 }],
  ])("finds a scene when the timing %s", (_, timing) => {
    expect(findOverlappingFilmTiming([saved], timing)).toBe(saved);
  });

  it.each([
    ["starts the second after it ends", { start: 721, end: 840 }],
    ["ends the second before it starts", { start: 480, end: 599 }],
    ["is zero-length the second after it ends", { start: 721, end: 721 }],
    ["is entirely before it", { start: 0, end: 60 }],
  ])("allows a timing that %s", (_, timing) => {
    expect(findOverlappingFilmTiming([saved], timing)).toBeNull();
  });

  it("finds a zero-length scene from any timing covering its second", () => {
    const moment = scene("moment", 660, 660);
    expect(findOverlappingFilmTiming([moment], { start: 600, end: 720 })).toBe(moment);
    expect(findOverlappingFilmTiming([moment], { start: 660, end: 720 })).toBe(moment);
    expect(findOverlappingFilmTiming([moment], { start: 660, end: 660 })).toBe(moment);
    expect(findOverlappingFilmTiming([moment], { start: 661, end: 720 })).toBeNull();
  });

  it("skips the excluded scene and scenes without usable timing, and returns the first match", () => {
    const later = scene("later", 700, 800);
    const untimed = scene("untimed", null, null);
    const halfTimed = scene("half", 650, "");
    const timing = { start: 650, end: 750 };

    expect(findOverlappingFilmTiming([saved], timing, "saved")).toBeNull();
    expect(findOverlappingFilmTiming([untimed, halfTimed, saved, later], timing, "saved")).toBe(later);
    expect(findOverlappingFilmTiming([untimed, saved, later], timing, "")).toBe(saved);
    expect(findOverlappingFilmTiming([scene("strings", "600", "720")], timing)).toMatchObject({ id: "strings" });
  });

  it("finds nothing without scenes or without a usable timing", () => {
    expect(findOverlappingFilmTiming(null, { start: 0, end: 10 })).toBeNull();
    expect(findOverlappingFilmTiming([], { start: 0, end: 10 })).toBeNull();
    expect(findOverlappingFilmTiming([saved], { start: null, end: 700 })).toBeNull();
    expect(findOverlappingFilmTiming([saved], null)).toBeNull();
  });
});
