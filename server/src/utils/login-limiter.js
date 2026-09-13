/**
 * Slows password guessing: after MAX_FAILURES failed sign-ins for the same
 * email or from the same address within the window, sign-in is refused until
 * the window passes. State is in memory, which suits the single API task.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

const failures = new Map();

function prune(now) {
    for (const [key, entry] of failures) {
        if (now - entry.first > WINDOW_MS) failures.delete(key);
    }
}

/** Seconds until sign-in is allowed again for any of `keys`, or 0 when it is allowed now. */
export function loginRetryAfterSeconds(keys, now = Date.now()) {
    prune(now);
    let retryAfter = 0;
    for (const key of keys) {
        const entry = failures.get(key);
        if (entry && entry.count >= MAX_FAILURES) {
            retryAfter = Math.max(retryAfter, Math.ceil((entry.first + WINDOW_MS - now) / 1000));
        }
    }
    return retryAfter;
}

export function recordLoginFailure(keys, now = Date.now()) {
    for (const key of keys) {
        const entry = failures.get(key);
        if (entry && now - entry.first <= WINDOW_MS) entry.count += 1;
        else failures.set(key, { count: 1, first: now });
    }
}

export function clearLoginFailures(keys) {
    for (const key of keys) failures.delete(key);
}
