import { useEffect, useMemo, useState } from "react";
import { getViewUrlForKey } from "@/shared/api/uploads.js";

/*
 * A signed view URL for a stored media key, and its replacement when it dies.
 *
 * A URL reaches this module two ways: embedded in a record the API answered with,
 * or fetched here for a key that arrived without one. Both kinds expire, so both
 * are replaced the same way. An embedded URL that was never replaced is how a
 * project page left open while tagging ends up showing nothing but broken images.
 *
 * The API signs a URL from the start of a fixed window and only hands out one
 * with at least a window of life left, so asking for a replacement shortly before
 * the end always yields a newer URL rather than the same one back.
 *
 * An embedded URL usually travels on its own, without the expiry its record
 * carries beside it, so when nobody says when a URL dies this module reads the
 * moment out of the signature the URL carries.
 */

// A URL is replaced this long before it expires, so an image that starts loading
// just before the swap still has time to finish.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
// setTimeout fires at once for a delay past a 32-bit count of milliseconds, and a
// sleeping tab wakes with its timers long overdue, so a wait is capped and the
// check repeats instead of trusting one long timer.
const MAX_WAIT_MS = 30 * 60 * 1000;
// A request that fails is tried again this long after, this many times in all.
const RETRY_DELAY_MS = 30 * 1000;
const MAX_ATTEMPTS = 3;

// Every component showing one key shares its URL.
const urlCache = new Map();

/**
 * The moment a presigned URL stops working, read from the signature it carries:
 * when it was signed, in ISO basic format, and how many seconds it lasts. Null
 * for a URL that says nothing about expiring, which is then never replaced.
 */
function signatureExpiry(url) {
  let query;
  try {
    query = new URL(url).searchParams;
  } catch {
    return null;
  }
  const signedAt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(query.get("X-Amz-Date") ?? "");
  const lifetimeSeconds = Number(query.get("X-Amz-Expires"));
  if (!signedAt || !Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) return null;

  const [, year, month, day, hour, minute, second] = signedAt.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) + lifetimeSeconds * 1000;
}

/** A URL with the moment it dies, from either the pair the API gives or a bare URL. */
function toViewUrl(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (!url) return null;

  const declared = typeof value === "string" ? null : value.expiresAt;
  const stated = typeof declared === "number" ? declared : Date.parse(declared ?? "");
  return { url, expiresAt: Number.isFinite(stated) ? stated : signatureExpiry(url) };
}

/** Whether a view URL can still be handed to an image, allowing time for it to load. */
function isFresh(viewUrl, now) {
  if (!viewUrl) return false;
  return viewUrl.expiresAt === null || viewUrl.expiresAt - now > REFRESH_MARGIN_MS;
}

/** When a view URL runs out, with one that says nothing about expiring lasting forever. */
function lifetimeEnd(viewUrl) {
  return viewUrl.expiresAt ?? Infinity;
}

/**
 * The URL to show for a key: whichever of the URL fetched for it and the URL its
 * record came with lasts longer. Choosing by their expiries rather than by the
 * clock keeps the current time out of rendering, and it answers both cases that
 * matter: a page that has already fetched a replacement keeps it, and a record
 * that has just arrived with a newer URL is believed over a fetch from an older
 * window. A URL in its last minutes still beats showing nothing.
 */
function pickViewUrl(key, embedded) {
  const fetched = (key && urlCache.get(key)) || null;
  if (!fetched || !embedded) return fetched ?? embedded;
  return lifetimeEnd(fetched) >= lifetimeEnd(embedded) ? fetched : embedded;
}

/**
 * Resolves a stored media key to a viewable URL. `apiUrl` is the URL the API
 * already answered with for this key, as a bare URL or as the `{ url, expiresAt }`
 * pair; a key with no URL yet is signed on demand. Either way the URL is replaced
 * before it expires, for as long as the component is on screen.
 */
export function useSignedMediaUrl(key, apiUrl = null) {
  const [, setVersion] = useState(0);
  const embedded = useMemo(() => toViewUrl(apiUrl), [apiUrl]);
  const shown = pickViewUrl(key, embedded);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    let timer = null;
    let attempts = 0;

    function wait(ms) {
      timer = setTimeout(check, Math.min(Math.max(ms, 0), MAX_WAIT_MS));
    }

    function check() {
      const now = Date.now();
      const held = pickViewUrl(key, embedded);
      if (!isFresh(held, now)) {
        fetchUrl();
        return;
      }
      if (held.expiresAt !== null) wait(held.expiresAt - REFRESH_MARGIN_MS - now);
    }

    function fetchUrl() {
      if (attempts >= MAX_ATTEMPTS) return;
      attempts += 1;
      getViewUrlForKey(key)
        .then((answer) => {
          const fetched = toViewUrl(answer);
          if (!fetched) return;
          urlCache.set(key, fetched);
          if (cancelled) return;
          if (isFresh(fetched, Date.now())) attempts = 0;
          setVersion((version) => version + 1);
          check();
        })
        .catch(() => {
          if (!cancelled) wait(RETRY_DELAY_MS);
        });
    }

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, embedded]);

  return shown?.url ?? null;
}
