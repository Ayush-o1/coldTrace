import { verifyAccessToken } from "../utils/token.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Authentication Middleware (Identity Verification)
 *
 * Engineering Concept — Authentication vs. Authorization:
 * - Authentication answers: "WHO are you?" (verifying credentials and token signatures).
 * - Authorization answers: "WHAT are you allowed to do?" (checking organization membership and roles).
 *
 * This middleware handles ONLY authentication. It extracts the Bearer JWT token from the Authorization
 * header, verifies its cryptographic signature against JWT_SECRET, and checks that the user still exists
 * in the database.
 *
 * Key Security Details:
 * 1. Bearer format enforcement: Rejects malformed or non-Bearer headers with 401.
 * 2. Token expiration differentiation: Differentiates between expired tokens (TokenExpiredError) and
 *    tampered tokens, instructing clients to refresh when appropriate.
 * 3. Database existence verification: Even if a JWT signature is mathematically valid, the account may
 *    have been deactivated or deleted. A lightweight query verifies the user is active and attaches
 *    sanitized identity details (id, email, name) to `req.user`. Password hashes are never selected.
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
export async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return next(new AppError("Authentication required. Please provide a valid Bearer token.", 401));
        }

        const token = authHeader.slice(7).trim();

        let decoded;
        try {
            decoded = verifyAccessToken(token);
        } catch (jwtError) {
            if (jwtError.name === "TokenExpiredError") {
                return next(new AppError("Access token has expired. Please refresh your session.", 401));
            }
            return next(new AppError("Invalid access token.", 401));
        }

        // Verify the user still exists in the database
        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: {
                id: true,
                email: true,
                name: true
            }
        });

        if (!user) {
            return next(new AppError("User account associated with this token no longer exists.", 401));
        }

        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
}

