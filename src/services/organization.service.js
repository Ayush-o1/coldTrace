import { prisma } from "../config/prisma.js";
import { slugify } from "../utils/slug.js";
import { AppError } from "../utils/app-error.js";

/**
 * Creates a new organization and atomically assigns the creator as ADMIN.
 *
 * Engineering Concept — Transactional Consistency in Tenant Creation:
 * Creating an organization requires two coupled database records:
 * 1. The `organizations` row defining the tenant.
 * 2. A `memberships` row linking the creator user with the `ADMIN` role.
 *
 * Why this MUST run inside a single `prisma.$transaction`:
 * If organization creation succeeded but membership creation failed (due to a transient network error,
 * process kill, or DB constraint), an orphaned organization would exist in PostgreSQL with zero administrators.
 * No user would ever be able to administer that organization.
 * The transaction guarantees atomicity: both records commit, or the entire operation rolls back.
 *
 * @param {object} params
 * @param {string} params.name - Human-readable organization name
 * @param {string} [params.slug] - Optional URL-safe slug (auto-generated if omitted)
 * @param {string} params.userId - Authenticated creator's UUID
 * @returns {Promise<object>} Created organization with creator's role
 */
export async function createOrganization({ name, slug, userId }) {
    const finalSlug = slug ? slugify(slug) : slugify(name);

    if (!finalSlug) {
        throw new AppError("Invalid organization name or slug", 400);
    }

    const existing = await prisma.organization.findUnique({
        where: { slug: finalSlug }
    });

    if (existing) {
        throw new AppError("An organization with this slug already exists", 409);
    }

    // Atomic transaction: create organization, assign creator as ADMIN, log audit event
    const result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
            data: {
                name: name.trim(),
                slug: finalSlug
            }
        });

        const membership = await tx.membership.create({
            data: {
                userId,
                organizationId: organization.id,
                role: "ADMIN"
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId: organization.id,
                actorId: userId,
                action: "ORGANIZATION_CREATED",
                entityType: "Organization",
                entityId: organization.id,
                metadata: { name: organization.name, slug: organization.slug }
            }
        });

        return {
            ...organization,
            role: membership.role
        };
    });

    return result;
}

/**
 * Returns all organizations where the specified user is a member.
 */
export async function getUserOrganizations(userId) {
    const memberships = await prisma.membership.findMany({
        where: { userId },
        include: {
            organization: true
        },
        orderBy: { createdAt: "desc" }
    });

    return memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        slug: m.organization.slug,
        role: m.role,
        joinedAt: m.createdAt,
        createdAt: m.organization.createdAt
    }));
}

/**
 * Returns details for a specific organization.
 */
export async function getOrganizationById(organizationId) {
    const organization = await prisma.organization.findUnique({
        where: { id: organizationId }
    });

    if (!organization) {
        throw new AppError("Organization not found", 404);
    }

    return organization;
}

/**
 * Returns all members of an organization with user details.
 */
export async function getMembers(organizationId) {
    const members = await prisma.membership.findMany({
        where: { organizationId },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true
                }
            }
        },
        orderBy: { createdAt: "asc" }
    });

    return members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt
    }));
}

/**
 * Adds an existing registered user to an organization with a specified role.
 */
export async function addMember({ organizationId, email, role = "MEMBER", actorId }) {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique({
        where: { email: normalizedEmail }
    });

    if (!user) {
        throw new AppError("No registered user found with this email address", 404);
    }

    const existingMembership = await prisma.membership.findUnique({
        where: {
            userId_organizationId: {
                userId: user.id,
                organizationId
            }
        }
    });

    if (existingMembership) {
        throw new AppError("User is already a member of this organization", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
        const membership = await tx.membership.create({
            data: {
                userId: user.id,
                organizationId,
                role
            },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "MEMBER_ADDED",
                entityType: "Membership",
                entityId: membership.id,
                metadata: {
                    targetUserId: user.id,
                    targetEmail: user.email,
                    assignedRole: role
                }
            }
        });

        return {
            id: membership.id,
            userId: membership.user.id,
            name: membership.user.name,
            email: membership.user.email,
            role: membership.role,
            joinedAt: membership.createdAt
        };
    });

    return result;
}

/**
 * Updates a member's role while enforcing the Last Administrator Protection invariant.
 *
 * Business Invariant — Last Administrator Protection:
 * An organization must ALWAYS have at least one active administrator.
 * If an administrator attempts to demote their own or another admin's role to MEMBER or VIEWER,
 * we query the count of existing ADMINs. If `adminCount <= 1`, the demotion is strictly rejected with 400.
 * This guarantees that an organization can never lose administrative oversight.
 *
 * @param {object} params
 * @param {string} params.organizationId - Target organization ID
 * @param {string} params.memberId - Membership row ID to update
 * @param {string} params.newRole - Target role (ADMIN | MEMBER | VIEWER)
 * @param {string} params.actorId - User performing the role update
 */
export async function updateMemberRole({ organizationId, memberId, newRole, actorId }) {
    const membership = await prisma.membership.findUnique({
        where: { id: memberId },
        include: { user: true }
    });

    if (!membership || membership.organizationId !== organizationId) {
        throw new AppError("Member not found in this organization", 404);
    }

    // Protect the last administrator from demotion
    if (membership.role === "ADMIN" && newRole !== "ADMIN") {
        const adminCount = await prisma.membership.count({
            where: {
                organizationId,
                role: "ADMIN"
            }
        });

        if (adminCount <= 1) {
            throw new AppError("Cannot demote the last administrator in the organization", 400);
        }
    }

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.membership.update({
            where: { id: memberId },
            data: { role: newRole },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "MEMBER_ROLE_UPDATED",
                entityType: "Membership",
                entityId: memberId,
                metadata: {
                    targetUserId: membership.userId,
                    previousRole: membership.role,
                    newRole
                }
            }
        });

        return {
            id: updated.id,
            userId: updated.user.id,
            name: updated.user.name,
            email: updated.user.email,
            role: updated.role,
            joinedAt: updated.createdAt
        };
    });

    return result;
}

/**
 * Removes a member from an organization while enforcing the Last Administrator Protection invariant.
 *
 * Business Invariant:
 * Just like role demotion, deleting an ADMIN membership is blocked if `adminCount <= 1`.
 * In addition, deleting a membership triggers an audit log entry in the same transaction for compliance.
 *
 * @param {object} params
 * @param {string} params.organizationId - Target organization ID
 * @param {string} params.memberId - Membership row ID to delete
 * @param {string} params.actorId - User performing the removal
 */
export async function removeMember({ organizationId, memberId, actorId }) {
    const membership = await prisma.membership.findUnique({
        where: { id: memberId }
    });

    if (!membership || membership.organizationId !== organizationId) {
        throw new AppError("Member not found in this organization", 404);
    }

    // Protect the last administrator from removal
    if (membership.role === "ADMIN") {
        const adminCount = await prisma.membership.count({
            where: {
                organizationId,
                role: "ADMIN"
            }
        });

        if (adminCount <= 1) {
            throw new AppError("Cannot remove the last administrator from the organization", 400);
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.membership.delete({
            where: { id: memberId }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "MEMBER_REMOVED",
                entityType: "Membership",
                entityId: memberId,
                metadata: {
                    targetUserId: membership.userId,
                    role: membership.role
                }
            }
        });
    });

    return { message: "Member removed successfully" };
}

