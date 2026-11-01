import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "coldtrace-default-dev-secret-change-in-production";
const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "15m";

/**
 * Generates a short-lived JSON Web Token for authenticated API access.
 *
 * @param {object} payload - Claims to embed in the token
 * @returns {string} The signed JWT access token
 */
export function generateAccessToken(payload) {
    return jwt.sign(
        {
            ...payload,
            jti: crypto.randomUUID()
        },
        JWT_SECRET,
        {
            expiresIn: ACCESS_TOKEN_EXPIRES_IN
        }
    );
}

/**
 * Verifies a JWT access token against the configured secret.
 *
 * @param {string} token - The raw JWT token string
 * @returns {object} The decoded token payload
 */
export function verifyAccessToken(token) {
    return jwt.verify(token, JWT_SECRET);
}

/**
 * Generates a cryptographically strong random token for refresh sessions.
 *
 * @returns {string} A 64-character hex string
 */
export function generateRefreshToken() {
    return crypto.randomBytes(32).toString("hex");
}

/**
 * Computes a SHA-256 hash of a raw token for secure database storage.
 * Storing only hashes ensures database leaks do not compromise active sessions.
 *
 * @param {string} token - The raw token string
 * @returns {string} SHA-256 hex digest
 */
export function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}
