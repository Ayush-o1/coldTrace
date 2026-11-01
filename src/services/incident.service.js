import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Valid incident lifecycle state transitions.
 * Enforces a strict one-way lifecycle: TRIGGERED -> ACKNOWLEDGED -> RESOLVED -> CLOSED.
 */
export const ALLOWED_TRANSITIONS = {
    TRIGGERED: ["ACKNOWLEDGED"],
    ACKNOWLEDGED: ["RESOLVED"],
    RESOLVED: ["CLOSED"],
    CLOSED: []
};

/**
 * Validates that an assignee belongs to the target organization.
 */
async function validateAssignee(organizationId, assignedToId) {
    if (!assignedToId) return;

    const membership = await prisma.membership.findUnique({
        where: {
            userId_organizationId: {
                userId: assignedToId,
                organizationId
            }
        }
    });

    if (!membership) {
        throw new AppError("Assigned user must be an active member of the incident's organization", 400);
    }
}

/**
 * Validates that all associated services belong to the target organization.
 */
async function validateServices(organizationId, serviceIds) {
    if (!serviceIds || serviceIds.length === 0) return;

    const uniqueIds = [...new Set(serviceIds)];
    const count = await prisma.service.count({
        where: {
            id: { in: uniqueIds },
            organizationId
        }
    });

    if (count !== uniqueIds.length) {
        throw new AppError("One or more associated services do not belong to this organization", 400);
    }
}

/**
 * Creates a new incident within an organization.
 */
export async function createIncident({
    organizationId,
    createdById,
    title,
    description,
    severity,
    assignedToId = null,
    serviceIds = []
}) {
    await validateAssignee(organizationId, assignedToId);
    await validateServices(organizationId, serviceIds);

    const uniqueServiceIds = [...new Set(serviceIds)];

    const result = await prisma.$transaction(async (tx) => {
        const incident = await tx.incident.create({
            data: {
                organizationId,
                createdById,
                assignedToId: assignedToId || null,
                title: title.trim(),
                description: description.trim(),
                severity,
                status: "TRIGGERED",
                services: {
                    create: uniqueServiceIds.map((serviceId) => ({
                        serviceId
                    }))
                }
            },
            include: {
                createdBy: {
                    select: { id: true, name: true, email: true }
                },
                assignedTo: {
                    select: { id: true, name: true, email: true }
                },
                services: {
                    include: {
                        service: {
                            select: { id: true, name: true, slug: true }
                        }
                    }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId: createdById,
                action: "INCIDENT_CREATED",
                entityType: "Incident",
                entityId: incident.id,
                metadata: {
                    title: incident.title,
                    severity: incident.severity,
                    status: incident.status,
                    assignedToId: incident.assignedToId,
                    serviceIds: uniqueServiceIds
                }
            }
        });

        return incident;
    });

    return formatIncident(result);
}

/**
 * Lists incidents with pagination and optional status/severity/service filters.
 */
export async function listIncidents({
    organizationId,
    page = 1,
    limit = 20,
    status,
    severity,
    serviceId,
    assignedToId
}) {
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Math.min(100, Number(limit) || 20));

    const where = {
        organizationId,
        ...(status ? { status } : {}),
        ...(severity ? { severity } : {}),
        ...(assignedToId ? { assignedToId } : {}),
        ...(serviceId
            ? {
                  services: {
                      some: { serviceId }
                  }
              }
            : {})
    };

    const skip = (pageNum - 1) * limitNum;

    const total = await prisma.incident.count({ where });
    const incidents = await prisma.incident.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { createdAt: "desc" },
        include: {
            createdBy: {
                select: { id: true, name: true, email: true }
            },
            assignedTo: {
                select: { id: true, name: true, email: true }
            },
            services: {
                include: {
                    service: {
                        select: { id: true, name: true, slug: true }
                    }
                }
            },
            _count: {
                select: { updates: true }
            }
        }
    });

    return {
        incidents: incidents.map((inc) => ({
            ...formatIncident(inc),
            updatesCount: inc._count.updates
        })),
        pagination: {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum)
        }
    };
}

/**
 * Retrieves a single incident by ID within an organization.
 */
export async function getIncidentById({ organizationId, incidentId }) {
    const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
            createdBy: {
                select: { id: true, name: true, email: true }
            },
            assignedTo: {
                select: { id: true, name: true, email: true }
            },
            services: {
                include: {
                    service: {
                        select: { id: true, name: true, slug: true, isArchived: true }
                    }
                }
            },
            updates: {
                orderBy: { createdAt: "asc" },
                include: {
                    author: {
                        select: { id: true, name: true, email: true }
                    }
                }
            }
        }
    });

    if (!incident || incident.organizationId !== organizationId) {
        throw new AppError("Incident not found in this organization", 404);
    }

    return formatIncident(incident);
}

/**
 * Updates incident properties (title, description, severity, assignee, services).
 */
export async function updateIncident({
    organizationId,
    incidentId,
    title,
    description,
    severity,
    assignedToId,
    serviceIds,
    actorId
}) {
    const existing = await prisma.incident.findUnique({
        where: { id: incidentId }
    });

    if (!existing || existing.organizationId !== organizationId) {
        throw new AppError("Incident not found in this organization", 404);
    }

    if (assignedToId !== undefined && assignedToId !== null) {
        await validateAssignee(organizationId, assignedToId);
    }

    if (serviceIds !== undefined) {
        await validateServices(organizationId, serviceIds);
    }

    const dataToUpdate = {};
    if (title !== undefined) dataToUpdate.title = title.trim();
    if (description !== undefined) dataToUpdate.description = description.trim();
    if (severity !== undefined) dataToUpdate.severity = severity;
    if (assignedToId !== undefined) dataToUpdate.assignedToId = assignedToId;

    const result = await prisma.$transaction(async (tx) => {
        // If serviceIds provided, replace existing associations
        if (serviceIds !== undefined) {
            const uniqueServiceIds = [...new Set(serviceIds)];
            await tx.incidentService.deleteMany({
                where: { incidentId }
            });
            if (uniqueServiceIds.length > 0) {
                await tx.incidentService.createMany({
                    data: uniqueServiceIds.map((serviceId) => ({
                        incidentId,
                        serviceId
                    }))
                });
            }
        }

        const updated = await tx.incident.update({
            where: { id: incidentId },
            data: dataToUpdate,
            include: {
                createdBy: {
                    select: { id: true, name: true, email: true }
                },
                assignedTo: {
                    select: { id: true, name: true, email: true }
                },
                services: {
                    include: {
                        service: {
                            select: { id: true, name: true, slug: true }
                        }
                    }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "INCIDENT_UPDATED",
                entityType: "Incident",
                entityId: incidentId,
                metadata: {
                    updatedFields: Object.keys(dataToUpdate),
                    servicesUpdated: serviceIds !== undefined
                }
            }
        });

        return updated;
    });

    return formatIncident(result);
}

/**
 * Transitions an incident to a new lifecycle state.
 * Validates transitions against the strict state machine and prevents race conditions.
 */
export async function transitionIncidentStatus({
    organizationId,
    incidentId,
    targetStatus,
    actorId
}) {
    const result = await prisma.$transaction(async (tx) => {
        const incident = await tx.incident.findUnique({
            where: { id: incidentId }
        });

        if (!incident || incident.organizationId !== organizationId) {
            throw new AppError("Incident not found in this organization", 404);
        }

        const currentStatus = incident.status;

        if (currentStatus === targetStatus) {
            return incident; // Idempotent if already in target status
        }

        const allowedNextStates = ALLOWED_TRANSITIONS[currentStatus] || [];

        if (!allowedNextStates.includes(targetStatus)) {
            throw new AppError(
                `Invalid state transition: Cannot change status from ${currentStatus} to ${targetStatus}. Allowed next states: [${allowedNextStates.join(", ") || "None"}].`,
                400
            );
        }

        const updated = await tx.incident.update({
            where: { id: incidentId },
            data: { status: targetStatus },
            include: {
                createdBy: {
                    select: { id: true, name: true, email: true }
                },
                assignedTo: {
                    select: { id: true, name: true, email: true }
                },
                services: {
                    include: {
                        service: {
                            select: { id: true, name: true, slug: true }
                        }
                    }
                }
            }
        });

        await tx.auditLog.create({
            data: {
                organizationId,
                actorId,
                action: "INCIDENT_STATUS_CHANGED",
                entityType: "Incident",
                entityId: incidentId,
                metadata: {
                    previousStatus: currentStatus,
                    newStatus: targetStatus
                }
            }
        });

        return updated;
    });

    return formatIncident(result);
}

/**
 * Formats incident response to expose services as a flat array.
 */
function formatIncident(incident) {
    const services = incident.services?.map((s) => s.service) || [];
    return {
        id: incident.id,
        organizationId: incident.organizationId,
        title: incident.title,
        description: incident.description,
        status: incident.status,
        severity: incident.severity,
        createdBy: incident.createdBy,
        assignedTo: incident.assignedTo,
        services,
        updates: incident.updates,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt
    };
}
