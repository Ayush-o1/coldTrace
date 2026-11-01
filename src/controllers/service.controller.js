import * as serviceService from "../services/service.service.js";

export async function createService(req, res, next) {
    try {
        const service = await serviceService.createService({
            organizationId: req.params.organizationId,
            name: req.body.name,
            slug: req.body.slug,
            actorId: req.user.id
        });

        res.status(201).json({
            status: "success",
            data: { service }
        });
    } catch (error) {
        next(error);
    }
}

export async function listServices(req, res, next) {
    try {
        const includeArchived = req.query.includeArchived === "true";

        const services = await serviceService.listServices({
            organizationId: req.params.organizationId,
            includeArchived
        });

        res.status(200).json({
            status: "success",
            data: { services }
        });
    } catch (error) {
        next(error);
    }
}

export async function getService(req, res, next) {
    try {
        const service = await serviceService.getServiceById({
            organizationId: req.params.organizationId,
            serviceId: req.params.serviceId
        });

        res.status(200).json({
            status: "success",
            data: { service }
        });
    } catch (error) {
        next(error);
    }
}

export async function updateService(req, res, next) {
    try {
        const service = await serviceService.updateService({
            organizationId: req.params.organizationId,
            serviceId: req.params.serviceId,
            name: req.body.name,
            slug: req.body.slug,
            isArchived: req.body.isArchived,
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { service }
        });
    } catch (error) {
        next(error);
    }
}

export async function deleteService(req, res, next) {
    try {
        const result = await serviceService.archiveService({
            organizationId: req.params.organizationId,
            serviceId: req.params.serviceId,
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            message: result.message
        });
    } catch (error) {
        next(error);
    }
}
