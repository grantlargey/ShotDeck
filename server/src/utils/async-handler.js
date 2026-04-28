/**
 * Wraps async controllers so unexpected failures flow through one error path.
 */
export function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
