import * as orgService from "../services/organization.service.js";

export async function createOrg(req, res, next) {
    try {
        const organization = await orgService.createOrganization({
            name: req.body.name,
            slug: req.body.slug,
            userId: req.user.id
        });

        res.status(201).json({
            status: "success",
            data: { organization }
        });
    } catch (error) {
        next(error);
    }
}

export async function listMyOrgs(req, res, next) {
    try {
        const organizations = await orgService.getUserOrganizations(req.user.id);

        res.status(200).json({
            status: "success",
            data: { organizations }
        });
    } catch (error) {
        next(error);
    }
}

export async function getOrg(req, res, next) {
    try {
        res.status(200).json({
            status: "success",
            data: {
                organization: {
                    id: req.organization.id,
                    name: req.organization.name,
                    slug: req.organization.slug,
                    createdAt: req.organization.createdAt,
                    role: req.membership.role
                }
            }
        });
    } catch (error) {
        next(error);
    }
}

export async function listMembers(req, res, next) {
    try {
        const members = await orgService.getMembers(req.params.organizationId);

        res.status(200).json({
            status: "success",
            data: { members }
        });
    } catch (error) {
        next(error);
    }
}

export async function addMember(req, res, next) {
    try {
        const member = await orgService.addMember({
            organizationId: req.params.organizationId,
            email: req.body.email,
            role: req.body.role,
            actorId: req.user.id
        });

        res.status(201).json({
            status: "success",
            data: { member }
        });
    } catch (error) {
        next(error);
    }
}

export async function updateMemberRole(req, res, next) {
    try {
        const member = await orgService.updateMemberRole({
            organizationId: req.params.organizationId,
            memberId: req.params.memberId,
            newRole: req.body.role,
            actorId: req.user.id
        });

        res.status(200).json({
            status: "success",
            data: { member }
        });
    } catch (error) {
        next(error);
    }
}

export async function removeMember(req, res, next) {
    try {
        const result = await orgService.removeMember({
            organizationId: req.params.organizationId,
            memberId: req.params.memberId,
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
