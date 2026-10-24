import { describe, expect, it } from "vitest";
import {
  SCRIPT_TAG_CATEGORIES,
  groupScriptTagsByCategory,
} from "@server/domain/script-tags.js";
import { buildFilterGroups } from "./sceneBrowse.js";

describe("script tag grouping", () => {
  it("uses exactly the taxonomy for browse filters", () => {
    expect(buildFilterGroups()).toBe(SCRIPT_TAG_CATEGORIES);
    expect(buildFilterGroups().some((group) => group.label === "Other Tags")).toBe(false);
  });

  it("groups known tags in taxonomy order and omits unknown tags", () => {
    expect(
      groupScriptTagsByCategory([
        "tone:dread",
        "retired:free-form-tag",
        "character-focus:protagonist",
      ])
    ).toEqual([
      {
        label: "Character Focus",
        tags: [{ value: "character-focus:protagonist", label: "Protagonist" }],
      },
      {
        label: "Tone",
        tags: [{ value: "tone:dread", label: "Dread" }],
      },
    ]);
  });
});
