import bcrypt from "bcrypt";

const SALT_ROUNDS = 10;

/**
 * Hashes a plain-text password using bcrypt.
 *
 * @param {string} password - The plain-text password to hash
 * @returns {Promise<string>} The resulting password hash
 */
export async function hashPassword(password) {
    return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Compares a plain-text password with a stored bcrypt hash.
 *
 * @param {string} password - The plain-text candidate password
 * @param {string} hash - The stored bcrypt hash
 * @returns {Promise<boolean>} True if matching, false otherwise
 */
export async function comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
}

