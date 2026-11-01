import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Creates an incident update and records an audit log entry atomically.
 */
export async function createIncidentUpdate({
    organizationId,
    incidentId,
    authorId,
    message,
    visibility = "INTERNAL"
}) {
    const incident = await prisma.incident.findUnique({
        where: { id: incidentId }
    });

    if (!incident || incident.organizationId !== organizationId) {
        throw new AppError("Incident not found in this organization", 404);
    }

    const result = await prisma.$transaction(async (tx) => {
        const update = await tx.incidentUpdate.create({
            data: {
                incidentId,
                authorId,
                message: message.trim(),
                visibility
            },
            include: {
                author: {
                    select: { id: true, name: true, email: true }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId: authorId,
                action: "INCIDENT_UPDATE_POSTED",
                entityType: "Incident",
                entityId: incidentId,
                metadata: {
                    updateId: update.id,
                    visibility: update.visibility
                }
            }
        });

        return update;
    });

    return result;
}

/**
 * Lists all updates for an incident. Optionally filters by visibility.
 */
export async function listIncidentUpdates({ organizationId, incidentId, visibility }) {
    const incident = await prisma.incident.findUnique({
        where: { id: incidentId }
    });

    if (!incident || incident.organizationId !== organizationId) {
        throw new AppError("Incident not found in this organization", 404);
    }

    const updates = await prisma.incidentUpdate.findMany({
        where: {
            incidentId,
            ...(visibility ? { visibility } : {})
        },
        orderBy: { createdAt: "asc" },
        include: {
            author: {
                select: { id: true, name: true, email: true }
            }
        }
    });

    return updates;
}

/**
 * Returns the complete audit timeline for a specific incident.
 */
export async function getIncidentTimeline({ organizationId, incidentId }) {
    const incident = await prisma.incident.findUnique({
        where: { id: incidentId }
    });

    if (!incident || incident.organizationId !== organizationId) {
        throw new AppError("Incident not found in this organization", 404);
    }

    const logs = await prisma.auditLog.findMany({
        where: {
            organizationId,
            entityId: incidentId
        },
        orderBy: { createdAt: "asc" },
        include: {
            actor: {
                select: { id: true, name: true, email: true }
            }
        }
    });

    return logs;
}

/**
 * Returns paginated organization-level audit logs for compliance and accountability.
 */
export async function getOrganizationAuditLogs({ organizationId, page = 1, limit = 20 }) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { organizationId };

    const total = await prisma.auditLog.count({ where });
    const auditLogs = await prisma.auditLog.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: {
            actor: {
                select: { id: true, name: true, email: true }
            }
        }
    });

    return {
        auditLogs,
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
        }
    };
}
