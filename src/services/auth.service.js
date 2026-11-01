import { prisma } from "../config/prisma.js";
import { hashPassword, comparePassword } from "../utils/password.js";
import {
    generateAccessToken,
    generateRefreshToken,
    hashToken
} from "../utils/token.js";
import { AppError } from "../utils/app-error.js";

const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_EXPIRES_DAYS) || 7;

/**
 * Registers a new user account with a secure bcrypt password hash.
 *
 * Implementation Details:
 * 1. Email Normalization: The email is trimmed and converted to lowercase before lookup or insertion.
 *    PostgreSQL unique constraints depend on collation; normalising in application logic guarantees
 *    that 'User@Example.com' and 'user@example.com' collide predictably.
 * 2. Password Hashing: Plain-text passwords are never persisted. They are hashed using bcrypt with 10 salt rounds.
 * 3. Sanitized Projection: Only safe fields (id, name, email, createdAt) are returned. `passwordHash` is excluded.
 *
 * @param {object} params
 * @param {string} params.name - User's display name
 * @param {string} params.email - Unique email address
 * @param {string} params.password - Plain-text candidate password
 * @returns {Promise<object>} Sanitized user record
 */
export async function register({ name, email, password }) {
    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail }
    });

    if (existingUser) {
        throw new AppError("An account with this email already exists", 409);
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
        data: {
            name: name.trim(),
            email: normalizedEmail,
            passwordHash
        },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true
        }
    });

    return user;
}

/**
 * Authenticates user credentials, generates an active session, and issues dual tokens.
 *
 * Security Considerations:
 * 1. Account Enumeration Defense: If the email does not exist, or the password does not match,
 *    the exact same generic message ("Invalid email or password", 401) is returned.
 * 2. Token Segregation:
 *    - Access Token: Short-lived JWT (15m) carrying user identity claims (userId, email, jti).
 *    - Refresh Token: Long-lived opaque string (7d). Stored in the database as a SHA-256 hash.
 *      Storing only the hash ensures that a database compromise does not yield valid session tokens.
 *
 * @param {object} params
 * @param {string} params.email - Candidate email
 * @param {string} params.password - Candidate password
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
 */
export async function login({ email, password }) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail }
    });

    if (!user) {
        // Return a generic error to prevent email enumeration
        throw new AppError("Invalid email or password", 401);
    }

    const isMatch = await comparePassword(password, user.passwordHash);
    if (!isMatch) {
        throw new AppError("Invalid email or password", 401);
    }

    // Generate tokens
    const accessToken = generateAccessToken({
        userId: user.id,
        email: user.email
    });

    const rawRefreshToken = generateRefreshToken();
    const tokenHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    // Persist refresh session
    await prisma.session.create({
        data: {
            userId: user.id,
            tokenHash,
            expiresAt
        }
    });

    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email
        },
        accessToken,
        refreshToken: rawRefreshToken
    };
}

/**
 * Rotates an active refresh session to issue a fresh JWT and refresh token.
 *
 * Engineering Concept — Refresh Token Rotation (OWASP Best Practice):
 * Every time a refresh token is used, the previous session is immediately revoked (`revokedAt = now()`)
 * and a new session with a new refresh token is created inside an atomic transaction.
 *
 * Why this is essential:
 * If an attacker intercepts a refresh token and attempts to use it after the legitimate user has already
 * refreshed, the database check detects that the token is already revoked, stopping token replay attacks.
 *
 * @param {object} params
 * @param {string} params.refreshToken - Raw refresh token from cookie or body
 * @returns {Promise<{ user: object, accessToken: string, refreshToken: string }>}
 */
export async function refreshSession({ refreshToken }) {
    if (!refreshToken) {
        throw new AppError("Refresh token is required", 400);
    }

    const tokenHash = hashToken(refreshToken);

    const session = await prisma.session.findUnique({
        where: { tokenHash },
        include: { user: true }
    });

    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
        throw new AppError("Invalid or expired refresh token", 401);
    }

    if (!session.user) {
        throw new AppError("User account no longer exists", 401);
    }

    // Rotate tokens atomically: revoke old session, create new session
    const rawRefreshToken = generateRefreshToken();
    const newHash = hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction([
        prisma.session.update({
            where: { id: session.id },
            data: { revokedAt: new Date() }
        }),
        prisma.session.create({
            data: {
                userId: session.user.id,
                tokenHash: newHash,
                expiresAt
            }
        })
    ]);

    const accessToken = generateAccessToken({
        userId: session.user.id,
        email: session.user.email
    });

    return {
        user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email
        },
        accessToken,
        refreshToken: rawRefreshToken
    };
}

/**
 * Revoke the refresh session upon logout.
 */
export async function logout({ refreshToken }) {
    if (!refreshToken) {
        return;
    }

    const tokenHash = hashToken(refreshToken);

    await prisma.session.updateMany({
        where: {
            tokenHash,
            revokedAt: null
        },
        data: {
            revokedAt: new Date()
        }
    });
}

/**
 * Fetch profile for authenticated user.
 */
export async function getUserProfile(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            email: true,
            createdAt: true,
            updatedAt: true
        }
    });

    if (!user) {
        throw new AppError("User not found", 404);
    }

    return user;
}

