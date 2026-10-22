/**
 * Bounds semantic searches from one address, since each makes paid Gemini and
 * OpenAI calls and the endpoint is public. An address gets MAX_SEARCHES in a
 * window that starts with its first search; more are refused until the window
 * passes, and refused searches don't count. State is in memory, which suits
 * the single API task.
 */
const WINDOW_MS = 60 * 1000;
const MAX_SEARCHES = 20;

const windows = new Map();

function prune(now) {
    for (const [key, entry] of windows) {
        if (now - entry.first >= WINDOW_MS) windows.delete(key);
    }
}

/** Admits a search from `key` and returns 0, or refuses it and returns the seconds until `key` may search again. */
export function admitSearch(key, now = Date.now()) {
    prune(now);
    const entry = windows.get(key);
    if (!entry) {
        windows.set(key, { count: 1, first: now });
        return 0;
    }
    if (entry.count >= MAX_SEARCHES) return Math.max(1, Math.ceil((entry.first + WINDOW_MS - now) / 1000));
    entry.count += 1;
    return 0;
}
