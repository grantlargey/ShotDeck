import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing for admin accounts, built on Node's own scrypt so the API
 * image needs no native module. Stored form:
 *   scrypt$N$r$p$<salt base64url>$<key base64url>
 */
const scrypt = promisify(scryptCallback);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const HASH_PATTERN = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 200;

/** Why a password can't be used, written for the person choosing it, or null when it's fine. */
export function passwordProblem(password) {
    if (typeof password !== "string" || !password) return "Enter a password.";
    if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
}

export function isPasswordHash(value) {
    return typeof value === "string" && HASH_PATTERN.test(value);
}

export async function hashPassword(password) {
    const salt = randomBytes(SALT_LENGTH);
    const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password, storedHash) {
    const match = typeof storedHash === "string" ? storedHash.match(HASH_PATTERN) : null;
    if (!match || typeof password !== "string") return false;

    const [, n, r, p, salt, key] = match;
    const expected = Buffer.from(key, "base64url");
    const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64url"), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// No 0/O, 1/l/I, so a password read over the phone or copied by hand survives.
const TEMPORARY_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A one-time password in four readable groups, e.g. "gR7w-kp2V-mX9q-Lt4c". */
export function generateTemporaryPassword() {
    const groups = [];
    for (let g = 0; g < 4; g += 1) {
        let group = "";
        for (let i = 0; i < 4; i += 1) group += TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)];
        groups.push(group);
    }
    return groups.join("-");
}
