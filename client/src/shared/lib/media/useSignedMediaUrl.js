import { useEffect, useState } from "react";
import { api } from "@/shared/api";

// Signed view URLs expire, so cached entries are refetched after this long.
const CACHE_TTL_MS = 10 * 60 * 1000;
const urlCache = new Map();

function readCache(key) {
  const entry = urlCache.get(key);
  return entry && Date.now() - entry.at < CACHE_TTL_MS ? entry.url : null;
}

/**
 * Resolves a stored media key to a viewable URL. A `directUrl` from the API
 * wins; otherwise a signed URL is fetched once and shared by every component
 * showing the same key.
 */
export function useSignedMediaUrl(key, directUrl = null) {
  const [, setVersion] = useState(0);
  const cached = key ? readCache(key) : null;

  useEffect(() => {
    if (directUrl || !key || readCache(key)) return undefined;
    let cancelled = false;
    api
      .getViewUrlForKey(key)
      .then(({ url }) => {
        if (!url) return;
        urlCache.set(key, { url, at: Date.now() });
        if (!cancelled) setVersion((version) => version + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, directUrl]);

  return directUrl || cached;
}
