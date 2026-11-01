import { prisma } from "../config/prisma.js";
import { slugify } from "../utils/slug.js";
import { AppError } from "../utils/app-error.js";

/**
 * Creates a new software service scoped to an organization.
 *
 * Engineering Concept — Organization-Scoped Uniqueness:
 * Service slugs must be unique within an organization, but different organizations are permitted to
 * use identical slugs (e.g. Org A can have 'auth-service', and Org B can also have 'auth-service').
 * This is enforced at the database level by `@@unique([organizationId, slug])`.
 *
 * @param {object} params
 * @param {string} params.organizationId - Tenant organization ID
 * @param {string} params.name - Display name of the service
 * @param {string} [params.slug] - Optional URL-safe slug
 * @param {string} params.actorId - User creating the service
 */
export async function createService({ organizationId, name, slug, actorId }) {
    const finalSlug = slug ? slugify(slug) : slugify(name);

    if (!finalSlug) {
        throw new AppError("Invalid service name or slug", 400);
    }

    const existing = await prisma.service.findUnique({
        where: {
            organizationId_slug: {
                organizationId,
                slug: finalSlug
            }
        }
    });

    if (existing) {
        throw new AppError("A service with this slug already exists in this organization", 409);
    }

    const result = await prisma.$transaction(async (tx) => {
        const service = await tx.service.create({
            data: {
                organizationId,
                name: name.trim(),
                slug: finalSlug
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "SERVICE_CREATED",
                entityType: "Service",
                entityId: service.id,
                metadata: { name: service.name, slug: service.slug }
            }
        });

        return service;
    });

    return result;
}

/**
 * Returns services belonging to an organization.
 * Filters out archived services unless explicitly requested.
 */
export async function listServices({ organizationId, includeArchived = false }) {
    const services = await prisma.service.findMany({
        where: {
            organizationId,
            ...(includeArchived ? {} : { isArchived: false })
        },
        orderBy: { createdAt: "asc" }
    });

    return services;
}

/**
 * Retrieves a service by ID with strict organization isolation.
 */
export async function getServiceById({ organizationId, serviceId }) {
    const service = await prisma.service.findUnique({
        where: { id: serviceId }
    });

    if (!service || service.organizationId !== organizationId) {
        throw new AppError("Service not found in this organization", 404);
    }

    return service;
}

/**
 * Updates service details. Enforces organization-scoped slug uniqueness.
 */
export async function updateService({ organizationId, serviceId, name, slug, isArchived, actorId }) {
    const existing = await getServiceById({ organizationId, serviceId });

    const dataToUpdate = {};

    if (name !== undefined) {
        dataToUpdate.name = name.trim();
    }

    if (slug !== undefined) {
        const finalSlug = slugify(slug);
        if (finalSlug !== existing.slug) {
            const conflict = await prisma.service.findUnique({
                where: {
                    organizationId_slug: {
                        organizationId,
                        slug: finalSlug
                    }
                }
            });

            if (conflict) {
                throw new AppError("A service with this slug already exists in this organization", 409);
            }

            dataToUpdate.slug = finalSlug;
        }
    }

    if (isArchived !== undefined) {
        dataToUpdate.isArchived = isArchived;
    }

    const result = await prisma.$transaction(async (tx) => {
        const updated = await tx.service.update({
            where: { id: serviceId },
            data: dataToUpdate
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "SERVICE_UPDATED",
                entityType: "Service",
                entityId: serviceId,
                metadata: dataToUpdate
            }
        });

        return updated;
    });

    return result;
}

/**
 * Archives a service instead of hard deleting it to preserve relational integrity with incidents.
 *
 * Engineering Concept — Soft-Deletion / Archival vs. Hard-Deletion:
 * In an incident management system, operational history is critical for post-mortems and compliance.
 * If a service is hard-deleted (`DELETE FROM services`):
 * 1. Historical incidents referencing this service would either have their foreign key violated,
 *    or cascade-delete all past incident records, destroying the organization's incident track record.
 * 2. By setting `isArchived: true`:
 *    - The service is excluded from active incident reporting and health calculations.
 *    - All historical incidents, post-mortems, and timeline audit records remain completely intact.
 *
 * @param {object} params
 * @param {string} params.organizationId - Target organization ID
 * @param {string} params.serviceId - Service UUID to archive
 * @param {string} params.actorId - User performing the archival
 */
export async function archiveService({ organizationId, serviceId, actorId }) {
    await getServiceById({ organizationId, serviceId });

    await prisma.$transaction(async (tx) => {
        await tx.service.update({
            where: { id: serviceId },
            data: { isArchived: true }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "SERVICE_ARCHIVED",
                entityType: "Service",
                entityId: serviceId
            }
        });
    });

    return { message: "Service archived successfully" };
}

