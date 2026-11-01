import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Middleware that verifies the authenticated user belongs to the target organization.
 * Prevents IDOR and enforces tenant data isolation.
 *
 * @param {string} [paramKey="organizationId"] - Name of the route parameter containing organization ID
 */
export function requireOrgMember(paramKey = "organizationId") {
    return async (req, res, next) => {
        try {
            if (!req.user?.id) {
                return next(new AppError("Authentication required.", 401));
            }

            const organizationId = req.params[paramKey] || req.body?.organizationId || req.query?.organizationId;

            if (!organizationId) {
                return next(new AppError("Organization identifier is missing from request.", 400));
            }

            const membership = await prisma.membership.findUnique({
                where: {
                    userId_organizationId: {
                        userId: req.user.id,
                        organizationId
                    }
                },
                include: {
                    organization: true
                }
            });

            if (!membership) {
                return next(new AppError("You do not have access to this organization.", 403));
            }

            // Expose membership and organization context to downstream handlers
            req.membership = membership;
            req.organization = membership.organization;
            next();
        } catch (error) {
            next(error);
        }
    };
}

/**
 * Middleware that verifies the member possesses one of the allowed roles.
 * Must be preceded by requireOrgMember.
 *
 * @param  {...("ADMIN" | "MEMBER" | "VIEWER")} allowedRoles
 */
export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.membership) {
            return next(new AppError("Organization membership context not established.", 500));
        }

        if (!allowedRoles.includes(req.membership.role)) {
            return next(new AppError(`Forbidden: Action requires one of [${allowedRoles.join(", ")}] role.`, 403));
        }

        next();
    };
}
