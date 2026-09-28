import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePdfPageWindowing } from "./usePdfPageWindowing.js";
let originalWidth;
let intersection;
beforeEach(() => {
  vi.useFakeTimers();
  originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class { constructor(callback) { intersection = callback; } observe() {} disconnect() {} });
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", originalWidth);
  document.body.innerHTML = "";
});
function setup(width, compact = false) {
  if (compact) Object.defineProperty(window, "innerWidth", { configurable: true, value: 600 });
  const pdf = { numPages: 30, getPage: vi.fn(async () => ({ getViewport: () => ({ width, height: width * 1.5 }) })) };
  const { result, unmount } = renderHook(() => usePdfPageWindowing(pdf));
  const wrap = document.createElement("div");
  wrap.style.padding = "0px";
  Object.defineProperties(wrap, { clientWidth: { value: 480 }, clientHeight: { value: 600 }, scrollHeight: { value: 5000 } });
  wrap.scrollTo = vi.fn();
  const page = document.createElement("div");
  page.id = "script-page-10";
  page.getBoundingClientRect = () => ({ height: 800, width: 480, top: 0 });
  Object.defineProperty(page, "offsetTop", { value: 1000 });
  wrap.append(page); document.body.append(wrap);
  act(() => result.current.wrapRef(wrap));
  return { result, unmount, pdf, wrap };
}
it.each([595.28, 1224])("scrolls points using a real %spt page before the text index arrives", async (width) => {
  const { result, wrap } = setup(width);
  const onDone = vi.fn();
  await act(async () => result.current.scrollToPage(10, { offsetPt: 300, onDone }));
  expect(wrap.scrollTo).toHaveBeenLastCalledWith({ top: 1000 + 300 * 480 / width - 200, behavior: "auto" });
  await act(async () => vi.advanceTimersByTimeAsync(260));
  expect(onDone).toHaveBeenCalledWith(true);
});
it("reveals a compact deep-link page and returns ready window/placeholder props", async () => {
  const { result } = setup(595.28, true);
  expect(result.current.pages).toHaveLength(4);
  await act(async () => result.current.scrollToPage(10, { behavior: "smooth" }));
  expect(result.current.pages).toHaveLength(10);
  expect(result.current.pages[9].inWindow).toBe(true);
  expect(result.current.pages[0].inWindow).toBe(false);
  expect(result.current.pages[0].placeholderHeight).toBeGreaterThan(0);
  const sentinel = document.createElement("div");
  act(() => result.current.sentinelRef(sentinel));
  act(() => intersection([{ isIntersecting: true }]));
  expect(result.current.pages).toHaveLength(14);
  act(() => result.current.revealAllPages());
  expect(result.current.pages).toHaveLength(30);
  expect(result.current.hasMore).toBe(false);
});
it("cancels late corrections on reader input and pending loads on unmount", async () => {
  const { result, wrap, unmount, pdf } = setup(600);
  await act(async () => result.current.scrollToPage(10, { offsetPt: 200 }));
  wrap.dispatchEvent(new Event("wheel"));
  await act(async () => vi.advanceTimersByTimeAsync(300));
  expect(wrap.scrollTo).toHaveBeenCalledTimes(1);
  let resolve;
  pdf.getPage.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  let pending;
  act(() => { pending = result.current.scrollToPage(10); });
  unmount();
  await act(async () => { resolve({ getViewport: () => ({ width: 600 }) }); await pending; });
  expect(wrap.scrollTo).toHaveBeenCalledTimes(1);
});
it("rejects pages beyond the document without loading or scrolling", async () => {
  const { result, pdf, wrap } = setup(600);
  const onDone = vi.fn();
  await act(async () => result.current.scrollToPage(31, { onDone }));
  expect(onDone).toHaveBeenCalledWith(false);
  expect(pdf.getPage).not.toHaveBeenCalled();
  expect(wrap.scrollTo).not.toHaveBeenCalled();
});
