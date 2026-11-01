import { verifyAccessToken } from "../utils/token.js";
import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Middleware that validates the JWT access token on incoming requests.
 * Extracts Bearer token from Authorization header and attaches the user to req.user.
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
