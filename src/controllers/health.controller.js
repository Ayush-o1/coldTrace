import * as healthService from "../services/health.service.js";

export async function getOrgHealth(req, res, next) {
    try {
        const health = await healthService.getOrgHealthOverview(req.params.organizationId);

        res.status(200).json({
            status: "success",
            data: health
        });
    } catch (error) {
        next(error);
    }
}

export async function getPublicStatus(req, res, next) {
    try {
        const statusData = await healthService.getPublicStatusPage(req.params.orgSlug);

        res.status(200).json({
            status: "success",
            data: statusData
        });
    } catch (error) {
        next(error);
    }
}
