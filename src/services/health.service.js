import { prisma } from "../config/prisma.js";
import { calculateServiceHealth, calculateOverallHealth } from "../utils/health.js";
import { AppError } from "../utils/app-error.js";

// Active incident statuses that impact system availability
const ACTIVE_STATUSES = ["TRIGGERED", "ACKNOWLEDGED"];

/**
 * Returns comprehensive health rollup for an authenticated organization dashboard.
 *
 * Dynamic Health Derivation vs Stored State:
 * In coldTrace, service and organization health are derived on-the-fly from active incidents
 * rather than persisted as a static `healthStatus` column on the `services` table.
 *
 * Why this avoids distributed state drift:
 * If service health were persisted as a column, every incident creation, status transition,
 * severity edit, or resolution would require updating multiple tables. A missed update or
 * concurrent write could leave a service marked as "CRITICAL_OUTAGE" long after all incidents
 * were resolved. By computing health dynamically from `TRIGGERED` and `ACKNOWLEDGED` incidents,
 * the health status is guaranteed to be 100% mathematically consistent with the active incident state.
 *
 * @param {string} organizationId - Tenant organization UUID
 * @returns {Promise<Object>} Rollup of overallStatus, per-service health, and incident severity counts
 */
export async function getOrgHealthOverview(organizationId) {
    const services = await prisma.service.findMany({
        where: {
            organizationId,
            isArchived: false
        },
        orderBy: { name: "asc" }
    });

    const activeIncidents = await prisma.incident.findMany({
        where: {
            organizationId,
            status: { in: ACTIVE_STATUSES }
        },
        include: {
            services: true
        }
    });

    // Compute health per service
    const serviceHealthList = services.map((service) => {
        const linkedActiveIncidents = activeIncidents.filter((inc) =>
            inc.services.some((s) => s.serviceId === service.id)
        );

        const healthStatus = calculateServiceHealth(linkedActiveIncidents);

        return {
            id: service.id,
            name: service.name,
            slug: service.slug,
            healthStatus,
            activeIncidentsCount: linkedActiveIncidents.length
        };
    });

    const overallStatus = calculateOverallHealth(
        serviceHealthList.map((s) => s.healthStatus)
    );

    const activeIncidentsBySeverity = {
        LOW: activeIncidents.filter((i) => i.severity === "LOW").length,
        MEDIUM: activeIncidents.filter((i) => i.severity === "MEDIUM").length,
        HIGH: activeIncidents.filter((i) => i.severity === "HIGH").length,
        CRITICAL: activeIncidents.filter((i) => i.severity === "CRITICAL").length
    };

    return {
        overallStatus,
        services: serviceHealthList,
        activeIncidentsCount: activeIncidents.length,
        activeIncidentsBySeverity
    };
}

/**
 * Returns sanitized, public-safe status page data without authentication.
 *
 * Zero-Leakage Data Projection Architecture:
 * Public status pages are accessible by customers, stakeholders, and internet crawlers without
 * any authentication credentials. Therefore, this query enforces strict projection boundaries:
 * 1. Only active incidents (`TRIGGERED`, `ACKNOWLEDGED`) affecting public operational status are fetched.
 * 2. Only updates explicitly flagged as `visibility: "PUBLIC"` are included; internal engineering notes
 *    are completely omitted at the database query level (`updates: { where: { visibility: "PUBLIC" } }`).
 * 3. User information (responder emails, full names, assigned user IDs, author IDs) is completely excluded
 *    to prevent identity harvesting, phishing attacks, and internal org structure reconnaissance.
 * 4. Archived services are excluded (`isArchived: false`).
 *
 * @param {string} orgSlug - Public URL slug of the organization
 * @returns {Promise<Object>} Sanitized status report containing overallStatus, active public incidents, and service health
 * @throws {AppError} 404 if organization with slug does not exist
 */
export async function getPublicStatusPage(orgSlug) {
    const organization = await prisma.organization.findUnique({
        where: { slug: orgSlug },
        select: { id: true, name: true, slug: true }
    });

    if (!organization) {
        throw new AppError("Organization status page not found", 404);
    }

    const services = await prisma.service.findMany({
        where: {
            organizationId: organization.id,
            isArchived: false
        },
        select: {
            id: true,
            name: true,
            slug: true
        },
        orderBy: { name: "asc" }
    });

    const activeIncidents = await prisma.incident.findMany({
        where: {
            organizationId: organization.id,
            status: { in: ACTIVE_STATUSES }
        },
        select: {
            id: true,
            title: true,
            status: true,
            severity: true,
            createdAt: true,
            updatedAt: true,
            services: {
                select: {
                    service: {
                        select: { id: true, name: true, slug: true }
                    }
                }
            },
            updates: {
                where: { visibility: "PUBLIC" },
                orderBy: { createdAt: "asc" },
                select: {
                    id: true,
                    message: true,
                    createdAt: true
                }
            }
        },
        orderBy: { createdAt: "desc" }
    });

    // Compute health per service
    const serviceHealthList = services.map((service) => {
        const linkedActiveIncidents = activeIncidents.filter((inc) =>
            inc.services.some((s) => s.service.id === service.id)
        );

        const healthStatus = calculateServiceHealth(linkedActiveIncidents);

        return {
            id: service.id,
            name: service.name,
            slug: service.slug,
            status: healthStatus
        };
    });

    const overallStatus = calculateOverallHealth(
        serviceHealthList.map((s) => s.status)
    );

    const publicIncidents = activeIncidents.map((inc) => ({
        id: inc.id,
        title: inc.title,
        status: inc.status,
        severity: inc.severity,
        createdAt: inc.createdAt,
        updatedAt: inc.updatedAt,
        affectedServices: inc.services.map((s) => s.service),
        updates: inc.updates
    }));

    return {
        organization: {
            name: organization.name,
            slug: organization.slug
        },
        overallStatus,
        updatedAt: new Date().toISOString(),
        services: serviceHealthList,
        incidents: publicIncidents
    };
}

