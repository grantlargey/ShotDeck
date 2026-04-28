/**
 * Request normalization helpers.
 *
 * These functions intentionally preserve the old route behavior:
 * - undefined means "the client did not send this field"
 * - null means "clear this field"
 * - "__INVALID__" is returned for controller-level 400 responses
 */
export function normalizeLinks(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return "__INVALID__";
}

export function normalizeTags(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof value === "string") {
        return value
            .split(/[,\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }
    return "__INVALID__";
}

export function isFiniteInt(value) {
    return Number.isFinite(value) && Number.isInteger(value);
}

export function normalizeOptionalInt(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const num = Number(value);
    return Number.isInteger(num) ? num : NaN;
}

export function normalizeAnchorGeometry(value) {
    if (value === undefined) return undefined;
    if (value === null) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : "__INVALID__";
        } catch {
            return "__INVALID__";
        }
    }
    return "__INVALID__";
}
