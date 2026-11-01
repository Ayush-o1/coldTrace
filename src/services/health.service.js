import { prisma } from "../config/prisma.js";
import { calculateServiceHealth, calculateOverallHealth } from "../utils/health.js";
import { AppError } from "../utils/app-error.js";

const ACTIVE_STATUSES = ["TRIGGERED", "ACKNOWLEDGED"];

/**
 * Returns comprehensive health rollup for an authenticated organization dashboard.
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
 * Never leaks internal updates, user emails, actor IDs, or confidential records.
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
