import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Organization Membership Gatekeeper (Tenant Authorization & IDOR Defense)
 *
 * Engineering Concept — Multi-Tenancy & Insecure Direct Object References (IDOR):
 * In a multi-tenant application, an attacker may attempt to access another organization's private data
 * simply by guessing or substituting an organization ID in the request path (e.g. /api/organizations/:id).
 *
 * This middleware prevents IDOR by enforcing two strict rules:
 * 1. The client-supplied organization ID is never trusted on its own.
 * 2. The database is queried using the compound unique key `(user_id, organization_id)`.
 *    If no membership row exists, the user is rejected immediately with 403 Forbidden.
 *
 * Downstream Benefit:
 * Once authorized, `req.membership` (role, joined date) and `req.organization` (name, slug) are attached
 * to the request object, eliminating redundant database queries in controllers and services.
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
 * Role-Based Access Control (RBAC) Guard
 *
 * Engineering Concept — Least Privilege Enforcement:
 * Verifies that the authenticated member has one of the required roles before executing protected actions.
 *
 * Permission Invariants:
 * - ADMIN: Organization owner, full rights to manage team members, services, and all incident lifecycles.
 * - MEMBER: Incident responder, permitted to create/update incidents and post updates, but forbidden
 *   from managing team memberships or archiving services.
 * - VIEWER: Read-only stakeholder, forbidden from creating, mutating, or transitioning any resource.
 *
 * @param  {...("ADMIN" | "MEMBER" | "VIEWER")} allowedRoles - Permitted roles for this route
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

