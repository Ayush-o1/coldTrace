import * as incidentService from "../services/incident.service.js";

export async function createIncident(req, res, next) {
    try {
        const incident = await incidentService.createIncident({
            organizationId: req.params.organizationId,
            createdById: req.user.id,
            title: req.body.title,
            description: req.body.description,
            severity: req.body.severity,
            assignedToId: req.body.assignedToId,
            serviceIds: req.body.serviceIds
        });

        res.status(201).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function listIncidents(req, res, next) {
    try {
        const query = req.validated?.query || req.query;

        const result = await incidentService.listIncidents({
            organizationId: req.params.organizationId,
            page: query.page,
            limit: query.limit,
            status: query.status,
            severity: query.severity,
            serviceId: query.serviceId,
            assignedToId: query.assignedToId
        });

        res.status(200).json({
            status: "success",
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function getIncident(req, res, next) {
    try {
        const incident = await incidentService.getIncidentById({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function updateIncident(req, res, next) {
    try {
        const incident = await incidentService.updateIncident({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            title: req.body.title,
            description: req.body.description,
            severity: req.body.severity,
            assignedToId: req.body.assignedToId,
            serviceIds: req.body.serviceIds,
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function transitionStatus(req, res, next) {
    try {
        const incident = await incidentService.transitionIncidentStatus({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            targetStatus: req.body.status,
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function acknowledgeIncident(req, res, next) {
    try {
        const incident = await incidentService.transitionIncidentStatus({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            targetStatus: "ACKNOWLEDGED",
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function resolveIncident(req, res, next) {
    try {
        const incident = await incidentService.transitionIncidentStatus({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            targetStatus: "RESOLVED",
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}

export async function closeIncident(req, res, next) {
    try {
        const incident = await incidentService.transitionIncidentStatus({
            organizationId: req.params.organizationId,
            incidentId: req.params.incidentId,
            targetStatus: "CLOSED",
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { incident }
        });
    } catch (error) {
        next(error);
    }
}
