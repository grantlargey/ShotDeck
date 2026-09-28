import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSignedMediaUrl } from "./useSignedMediaUrl.js";

/*
 * Signed view URLs expire, so the hook replaces one shortly before it dies,
 * whether it fetched that URL itself or the API embedded it in a record. Only the
 * clock and the view-url request are faked; the shared cache, the timers and the
 * expiry the hook reads out of a URL are real.
 *
 * Each case uses its own key, because the cache outlives a test the way it
 * outlives a component. A case that renders more than one consumer of one key has
 * them share that cache exactly as two stills of one film on a page do.
 */

const api = vi.hoisted(() => ({ getViewUrlForKey: vi.fn() }));

vi.mock("@/shared/api/uploads.js", () => ({ getViewUrlForKey: api.getViewUrlForKey }));

const NOW = Date.UTC(2026, 8, 27, 10, 0, 0);
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// The API signs a URL for two windows of an hour.
const LIFETIME_MS = 2 * HOUR_MS;
// The hook replaces a URL five minutes before it expires.
const MARGIN_MS = 5 * 60 * 1000;
// A failed request is made again half a minute later.
const RETRY_MS = 30 * 1000;

/** A URL shaped like the API's: its signature says when it was signed and for how long. */
function signedUrl(name, signedAt = NOW) {
  const stamp = new Date(signedAt).toISOString().replace(/[-:]/g, "").replace(".000", "");
  return `https://media.test/${name}?X-Amz-Date=${stamp}&X-Amz-Expires=${LIFETIME_MS / 1000}&X-Amz-Signature=ab`;
}

/** What the view-url endpoint answers: the URL and the moment it stops working. */
function viewUrl(name, signedAt = NOW) {
  return { url: signedUrl(name, signedAt), expiresAt: new Date(signedAt + LIFETIME_MS).toISOString() };
}

/** One consumer of a key; several in a case name themselves apart. */
function Probe({ mediaKey, apiUrl, name = "shown" }) {
  const url = useSignedMediaUrl(mediaKey, apiUrl);
  return <span data-testid={name}>{url ?? ""}</span>;
}

function shown(name = "shown") {
  return screen.getByTestId(name).textContent;
}

/** Runs the clock on, letting the hook's timers and requests settle. */
async function passTime(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  api.getViewUrlForKey.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a signed media URL", () => {
  it("signs a key that arrives without a URL, and asks for another before that one expires", async () => {
    const first = viewUrl("first");
    const second = viewUrl("second", NOW + LIFETIME_MS);
    api.getViewUrlForKey.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    render(<Probe mediaKey="annotations/m/fetched.jpg" />);
    await passTime(0);
    expect(shown()).toBe(first.url);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);

    await passTime(LIFETIME_MS - MARGIN_MS - 1000);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(first.url);

    await passTime(2000);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(2);
    expect(shown()).toBe(second.url);
  });

  it("replaces a URL the API embedded in a record, so a page left open keeps its images", async () => {
    const embedded = signedUrl("embedded");
    const replacement = viewUrl("replacement", NOW + LIFETIME_MS);
    api.getViewUrlForKey.mockResolvedValue(replacement);

    render(<Probe mediaKey="annotations/m/embedded.jpg" apiUrl={embedded} />);
    await passTime(0);
    // A URL that came with the record costs nothing to show.
    expect(shown()).toBe(embedded);
    expect(api.getViewUrlForKey).not.toHaveBeenCalled();

    await passTime(LIFETIME_MS - MARGIN_MS + 1000);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);
    expect(shown()).toBe(replacement.url);
  });

  it("leaves a URL that says nothing about expiring alone", async () => {
    const permanent = "https://media.test/cover.png";
    render(<Probe mediaKey="covers/m/cover.png" apiUrl={permanent} />);

    await passTime(24 * HOUR_MS);
    expect(shown()).toBe(permanent);
    expect(api.getViewUrlForKey).not.toHaveBeenCalled();
  });

  it("keeps showing a URL in its last minutes when the request for another fails, and tries again", async () => {
    const embedded = signedUrl("failing");
    api.getViewUrlForKey.mockRejectedValue(new Error("offline"));

    render(<Probe mediaKey="annotations/m/failing.jpg" apiUrl={embedded} />);
    await passTime(LIFETIME_MS - MARGIN_MS + 1000);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);
    // Nearly expired still beats nothing at all.
    expect(shown()).toBe(embedded);

    await passTime(RETRY_MS);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(2);
  });
});

describe("a key shown by more than one consumer", () => {
  it("wakes the others when one of them fetches a replacement", async () => {
    // Signed all but the last twenty minutes of a lifetime ago.
    const ageing = signedUrl("ageing", NOW - LIFETIME_MS + 20 * MINUTE_MS);
    const replacement = viewUrl("shared");
    api.getViewUrlForKey.mockResolvedValue(replacement);

    // One still shows the URL its record came with, and asks for nothing.
    render(<Probe name="ageing" mediaKey="annotations/m/shared.jpg" apiUrl={ageing} />);
    expect(shown("ageing")).toBe(ageing);
    expect(api.getViewUrlForKey).not.toHaveBeenCalled();

    // The other arrived without a URL, so its request fills the shared cache.
    render(<Probe name="signed" mediaKey="annotations/m/shared.jpg" />);
    await passTime(0);
    expect(shown("signed")).toBe(replacement.url);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);

    // The still that asked for nothing has to take up that replacement as well,
    // rather than go on handing an image a URL with twenty minutes left in it.
    expect(shown("ageing")).toBe(replacement.url);

    // Past the moment its own URL died, and still on one request for the key.
    await passTime(21 * MINUTE_MS);
    expect(shown("ageing")).toBe(replacement.url);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);
  });

  it("costs a still that arrives on a signed key nothing, and replaces the URL for both", async () => {
    const first = viewUrl("first");
    const second = viewUrl("second", NOW + LIFETIME_MS);
    api.getViewUrlForKey.mockResolvedValueOnce(first).mockResolvedValue(second);

    render(<Probe name="left" mediaKey="annotations/m/twice-shown.jpg" />);
    await passTime(0);
    expect(shown("left")).toBe(first.url);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);

    // The key is signed already, so the second still shows it without a request.
    render(<Probe name="right" mediaKey="annotations/m/twice-shown.jpg" />);
    expect(shown("right")).toBe(first.url);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(1);

    // Whichever of them asks for the replacement, both end up showing it.
    await passTime(LIFETIME_MS - MARGIN_MS + 1000);
    expect(shown("left")).toBe(second.url);
    expect(shown("right")).toBe(second.url);
  });

  it("goes on refreshing a key for the still left behind when the one that fetched it leaves", async () => {
    const first = viewUrl("first");
    const second = viewUrl("second", NOW + LIFETIME_MS);
    api.getViewUrlForKey.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const ageing = signedUrl("ageing", NOW - LIFETIME_MS + 20 * MINUTE_MS);

    render(<Probe name="staying" mediaKey="annotations/m/outliving.jpg" apiUrl={ageing} />);
    const leaving = render(<Probe name="leaving" mediaKey="annotations/m/outliving.jpg" />);
    await passTime(0);
    expect(shown("staying")).toBe(first.url);

    // The URL it fetched stays behind for the still on screen, which now has the
    // refreshing of the key to itself.
    leaving.unmount();

    await passTime(LIFETIME_MS - MARGIN_MS + 1000);
    expect(api.getViewUrlForKey).toHaveBeenCalledTimes(2);
    expect(shown("staying")).toBe(second.url);
  });
});


it("keeps refreshing across more than three successful URL lifetimes", async () => {
  let generation = 0;
  api.getViewUrlForKey.mockImplementation(async () => viewUrl(`generation-${++generation}`, Date.now()));
  render(<Probe mediaKey="annotations/m/long-lived.jpg" />);
  await passTime(0);
  for (let index = 0; index < 5; index += 1) await passTime(LIFETIME_MS - MARGIN_MS);
  expect(api.getViewUrlForKey).toHaveBeenCalledTimes(6);
  expect(shown()).toContain("generation-6");
});
