import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Valid incident lifecycle state transitions.
 * Enforces a strict one-way lifecycle state machine:
 * TRIGGERED -> ACKNOWLEDGED -> RESOLVED -> CLOSED.
 *
 * Why this state machine design is essential:
 * In incident response, skipping phases (e.g. going straight from TRIGGERED to RESOLVED
 * without acknowledgment) creates accountability gaps where no responder is verified as owning
 * the triage process. Disallowing regressions (e.g. CLOSED -> TRIGGERED) ensures completed
 * incident postmortems and audit logs remain immutable historical records. If a recurrence happens,
 * standard site reliability engineering practice dictates creating a new linked incident.
 */
export const ALLOWED_TRANSITIONS = {
    TRIGGERED: ["ACKNOWLEDGED"],
    ACKNOWLEDGED: ["RESOLVED"],
    RESOLVED: ["CLOSED"],
    CLOSED: []
};

/**
 * Validates that an assignee belongs to the target organization.
 *
 * Why this check cannot be replaced by a simple SQL foreign key constraint:
 * Foreign keys ensure referential integrity (i.e. the assigned user ID exists in the `users` table),
 * but they do NOT enforce multi-tenant boundaries. Without this check, an attacker in Org A
 * could assign an incident to a user in Org B, leaking incident titles, descriptions, and user details
 * across tenant boundaries (Insecure Direct Object Reference / Tenant Boundary Breach).
 *
 * @param {string} organizationId - Target organization UUID
 * @param {string|null} assignedToId - Assigned user UUID
 * @throws {AppError} 400 Bad Request if user is not an active member
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
 *
 * Security & Data Isolation Rationale:
 * Similar to assignee validation, foreign keys only guarantee that service IDs exist,
 * not that they belong to the calling organization. By counting the services matching both
 * the target IDs and the tenant's `organizationId`, we ensure an organization cannot link,
 * corrupt, or observe another organization's infrastructure components.
 *
 * @param {string} organizationId - Target organization UUID
 * @param {string[]} serviceIds - Array of service UUIDs
 * @throws {AppError} 400 Bad Request if any service does not belong to the organization
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
 *
 * Transaction & Atomicity Rationale:
 * Creating an incident, linking its associated services in the junction table (`incident_services`),
 * and generating the initial immutable audit log entry (`INCIDENT_CREATED`) must succeed or fail as
 * an atomic unit. If audit log insertion were separated and failed, un-audited incidents would exist,
 * violating SOC2/ISO27001 regulatory compliance requirements.
 *
 * @param {Object} params
 * @param {string} params.organizationId - Target organization UUID
 * @param {string} params.createdById - User UUID creating the incident
 * @param {string} params.title - Summary of the incident
 * @param {string} params.description - Detailed timeline / symptoms
 * @param {string} params.severity - LOW | MEDIUM | HIGH | CRITICAL
 * @param {string|null} [params.assignedToId] - Optional initial responder
 * @param {string[]} [params.serviceIds] - Optional array of impacted service UUIDs
 * @returns {Promise<Object>} Created and formatted incident
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
 *
 * Concurrency & Integrity Considerations:
 * In a high-pressure production outage, multiple on-call engineers may view and attempt to
 * update an incident simultaneously. To prevent race conditions (such as two conflicting transitions
 * occurring at once or bypassing intermediate status requirements), the read of the current status,
 * transition validation, database status update, and audit log creation are wrapped in an atomic
 * `prisma.$transaction`.
 *
 * Idempotency:
 * If an engineer or automated webhook submits a transition to the status the incident is already in
 * (e.g. ACKNOWLEDGED when already ACKNOWLEDGED), the operation returns early as a safe no-op.
 * This avoids duplicate audit logs and prevents noisy errors on repeated client requests.
 *
 * @param {Object} params
 * @param {string} params.organizationId - Tenant organization UUID
 * @param {string} params.incidentId - Incident UUID to transition
 * @param {string} params.targetStatus - Next lifecycle state (ACKNOWLEDGED, RESOLVED, CLOSED)
 * @param {string} params.actorId - User UUID triggering the status change
 * @returns {Promise<Object>} Formatted updated incident
 * @throws {AppError} 404 if not found in tenant, 400 if state transition is invalid
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
