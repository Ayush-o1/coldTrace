import * as updateService from "../services/update.service.js";

export async function createUpdate(req, res, next) {
    try {
        const update = await updateService.createIncidentUpdate({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            authorId: req.user.id,
            message: req.body.message,
            visibility: req.body.visibility
        });

        res.status(201).json({
            status: "success",
            data: { update }
        });
    } catch (error) {
        next(error);
    }
}

export async function listUpdates(req, res, next) {
    try {
        const updates = await updateService.listIncidentUpdates({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            visibility: req.query.visibility
        });

        res.status(200).json({
            status: "success",
            data: { updates }
        });
    } catch (error) {
        next(error);
    }
}

export async function getIncidentTimeline(req, res, next) {
    try {
        const timeline = await updateService.getIncidentTimeline({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId
        });

        res.status(200).json({
            status: "success",
            data: { timeline }
        });
    } catch (error) {
        next(error);
    }
}

export async function getOrgAuditLogs(req, res, next) {
    try {
        const result = await updateService.getOrganizationAuditLogs({
            organizationId: req.params.organizationId,
            page: req.query.page,
            limit: req.query.limit
        });

        res.status(200).json({
            status: "success",
            data: result
        });
    } catch (error) {
        next(error);
    }
}
