import { describe, expect, it } from "vitest";
import {
  formatMinutesToHms,
  formatSecondsToHms,
  normalizeTypedTime,
  parseTimeInputToMinutes,
  parseTimeInputToSeconds,
} from "./time.js";

describe("formatSecondsToHms", () => {
  it("pads hours, minutes and seconds, and floors fractions", () => {
    expect(formatSecondsToHms(0)).toBe("00:00:00");
    expect(formatSecondsToHms(65)).toBe("00:01:05");
    expect(formatSecondsToHms(3600 + 2 * 60 + 3.9)).toBe("01:02:03");
    expect(formatSecondsToHms(100 * 3600)).toBe("100:00:00");
    expect(formatSecondsToHms("600")).toBe("00:10:00");
  });

  it("returns the fallback for missing, negative or non-numeric values", () => {
    // null and "" coerce to 0 rather than falling back.
    expect(formatSecondsToHms(null)).toBe("00:00:00");
    expect(formatSecondsToHms("")).toBe("00:00:00");
    expect(formatSecondsToHms(undefined)).toBe("--:--:--");
    expect(formatSecondsToHms(-1)).toBe("--:--:--");
    expect(formatSecondsToHms("abc")).toBe("--:--:--");
    expect(formatSecondsToHms(Infinity, { fallback: "" })).toBe("");
  });
});

describe("formatMinutesToHms", () => {
  it("formats whole minutes and returns the fallback otherwise", () => {
    expect(formatMinutesToHms(125)).toBe("02:05:00");
    expect(formatMinutesToHms(0)).toBe("00:00:00");
    expect(formatMinutesToHms(-5)).toBe("--:--:--");
    expect(formatMinutesToHms("x", { fallback: "unknown" })).toBe("unknown");
  });
});

describe("parseTimeInputToSeconds", () => {
  it.each([
    ["01:02:03", 3723],
    ["1:2:3", 3723],
    [" 00:10:00 ", 600],
    ["12:34", 754],
    ["90:00", 5400],
    ["0:00", 0],
    ["75", 75],
    ["1 : 05", 65],
  ])("reads %j as %i seconds", (text, seconds) => {
    expect(parseTimeInputToSeconds(text)).toBe(seconds);
  });

  it("accepts non-negative finite numbers, flooring them", () => {
    expect(parseTimeInputToSeconds(42.9)).toBe(42);
    expect(parseTimeInputToSeconds(0)).toBe(0);
    expect(parseTimeInputToSeconds(-1)).toBeNull();
    expect(parseTimeInputToSeconds(NaN)).toBeNull();
  });

  it.each(["", "   ", null, undefined, "abc", "1:60", "1:00:60", "1:60:00", "1:2:3:4", "1:", ":30", "-1:00", "1.5:00", "11:xx"])(
    "rejects %j",
    (text) => {
      expect(parseTimeInputToSeconds(text)).toBeNull();
    }
  );
});

describe("parseTimeInputToMinutes", () => {
  it("rounds to the nearest minute", () => {
    expect(parseTimeInputToMinutes("01:30:29")).toBe(90);
    expect(parseTimeInputToMinutes("01:30:30")).toBe(91);
    expect(parseTimeInputToMinutes("nope")).toBeNull();
  });
});

describe("normalizeTypedTime", () => {
  it("reformats parseable input as HH:MM:SS", () => {
    expect(normalizeTypedTime("1:05")).toBe("00:01:05");
    expect(normalizeTypedTime(" 2:03:04 ")).toBe("02:03:04");
    expect(normalizeTypedTime("90")).toBe("00:01:30");
    expect(normalizeTypedTime("00:00:00")).toBe("00:00:00");
  });

  it("returns input it can't parse as typed", () => {
    expect(normalizeTypedTime("")).toBe("");
    expect(normalizeTypedTime("11:xx")).toBe("11:xx");
    expect(normalizeTypedTime(" 1:60 ")).toBe(" 1:60 ");
  });
});
