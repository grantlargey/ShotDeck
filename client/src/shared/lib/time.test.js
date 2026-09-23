import { describe, expect, it } from "vitest";
import {
  formatMinutesToHms,
  formatMomentToHms,
  formatSecondsToHms,
  normalizeTypedMoment,
  normalizeTypedTime,
  parseMomentInputToSeconds,
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

describe("moments, to a tenth of a second", () => {
  it.each([
    ["00:10:00.1", 600.1],
    ["10:00.5", 600.5],
    ["01:02:03", 3723],
    ["42.9", 42.9],
    [" 00:10:00.0 ", 600],
  ])("reads %j as %s seconds", (text, seconds) => {
    expect(parseMomentInputToSeconds(text)).toBe(seconds);
  });

  it.each(["00:10:00.12", "00:10:00.", ".5", "1.5:00", "abc", "", null])("refuses %j", (text) => {
    expect(parseMomentInputToSeconds(text)).toBeNull();
  });

  it("rounds a number to a tenth and refuses a negative one", () => {
    expect(parseMomentInputToSeconds(42.04)).toBe(42);
    expect(parseMomentInputToSeconds(42.15)).toBeCloseTo(42.2, 5);
    expect(parseMomentInputToSeconds(-1)).toBeNull();
  });

  it("shows a tenth only when the moment has one", () => {
    expect(formatMomentToHms(600)).toBe("00:10:00");
    expect(formatMomentToHms(600.1)).toBe("00:10:00.1");
    expect(formatMomentToHms("600.5")).toBe("00:10:00.5");
    expect(formatMomentToHms(3723.9)).toBe("01:02:03.9");
    expect(formatMomentToHms(undefined)).toBe("--:--:--");
    expect(formatMomentToHms(-1, { fallback: "" })).toBe("");
  });

  it("normalizes a typed moment and leaves unreadable input as typed", () => {
    expect(normalizeTypedMoment("10:00.5")).toBe("00:10:00.5");
    expect(normalizeTypedMoment("10:00")).toBe("00:10:00");
    expect(normalizeTypedMoment("1:2:3:4")).toBe("1:2:3:4");
  });
});
