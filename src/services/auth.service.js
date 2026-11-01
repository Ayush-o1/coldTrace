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
 * Register a new user account with hashed password.
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
 * Authenticate credentials, create an active session, and issue access + refresh tokens.
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
 * Rotate refresh session: invalidate previous session, generate a fresh token pair.
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
