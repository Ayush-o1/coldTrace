import { prisma } from "../config/prisma.js";
import { AppError } from "../utils/app-error.js";

/**
 * Creates an incident update and records an audit log entry atomically.
 *
 * Information Security & Visibility Architecture:
 * Incident response requires two communication streams:
 * 1. INTERNAL: For engineers and responders to share raw diagnostic traces, unconfirmed hypotheses,
 *    internal dashboards, and infrastructure topology without worrying about public exposure.
 * 2. PUBLIC: Curated, customer-safe summaries appropriate for external stakeholders and public
 *    status pages.
 *
 * Atomicity:
 * The creation of an update and the corresponding `INCIDENT_UPDATE_POSTED` audit log entry are
 * executed within a database transaction (`prisma.$transaction`). This guarantees that audit trails
 * remain complete, tamper-evident, and synchronized with incident records.
 *
 * @param {Object} params
 * @param {string} params.organizationId - Tenant organization UUID
 * @param {string} params.incidentId - Incident UUID receiving the update
 * @param {string} params.authorId - User UUID posting the update
 * @param {string} params.message - Content of the update
 * @param {"INTERNAL"|"PUBLIC"} [params.visibility="INTERNAL"] - Target audience for the update
 * @returns {Promise<Object>} Created update record
 * @throws {AppError} 404 if incident does not exist in target organization
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
 *
 * @param {Object} params
 * @param {string} params.organizationId - Tenant organization UUID
 * @param {string} params.incidentId - Incident UUID
 * @param {"INTERNAL"|"PUBLIC"} [params.visibility] - Optional visibility filter
 * @returns {Promise<Array>} List of updates in chronological order
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
 *
 * Polymorphic Entity Architecture:
 * Audit records in coldTrace use an `entityType` ("Incident", "Organization", etc.) and `entityId` pattern.
 * This function queries all audit events targeting a specific incident ID, yielding a continuous,
 * immutable timeline of lifecycle status transitions, updates, and configuration adjustments
 * from incident inception to closure.
 *
 * @param {Object} params
 * @param {string} params.organizationId - Tenant organization UUID
 * @param {string} params.incidentId - Incident UUID
 * @returns {Promise<Array>} Chronological list of audit records
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
 *
 * Tenant Isolation & Governance:
 * Query filters strictly by `organizationId`. Even organization administrators can only
 * inspect records generated within their tenant boundary. Pagination protects memory from
 * unbounded log dumps.
 *
 * @param {Object} params
 * @param {string} params.organizationId - Tenant organization UUID
 * @param {number} [params.page=1] - Page number (1-indexed)
 * @param {number} [params.limit=20] - Number of records per page
 * @returns {Promise<Object>} Paginated audit records with page metadata
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

