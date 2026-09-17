import { describe, expect, it } from "vitest";
import { isTypingTarget } from "./keyboard.js";

describe("isTypingTarget", () => {
  it("recognizes text-entry controls and their descendants", () => {
    const input = document.createElement("input");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    const child = document.createElement("span");
    editable.append(child);

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(child)).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });

  it("can suppress page shortcuts anywhere inside a dialog", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.append(button);

    expect(isTypingTarget(button)).toBe(false);
    expect(isTypingTarget(button, { withinDialog: true })).toBe(true);
  });
});
