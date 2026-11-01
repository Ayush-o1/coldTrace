import { Router } from "express";
import * as orgController from "../controllers/organization.controller.js";
import * as updateController from "../controllers/update.controller.js";
import serviceRoutes from "./service.routes.js";
import incidentRoutes from "./incident.routes.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireOrgMember, requireRole } from "../middleware/rbac.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
    createOrgSchema,
    addMemberSchema,
    updateMemberRoleSchema
} from "../validators/organization.validator.js";

const router = Router();

// Base routes (authenticated user context)
router.post("/", authenticate, validate(createOrgSchema), orgController.createOrg);
router.get("/", authenticate, orgController.listMyOrgs);

// Organization-scoped routes (require membership)
router.get("/:organizationId", authenticate, requireOrgMember(), orgController.getOrg);
router.get("/:organizationId/members", authenticate, requireOrgMember(), orgController.listMembers);
router.get("/:organizationId/audit-logs", authenticate, requireOrgMember(), updateController.getOrgAuditLogs);

// Mount nested domain resources
router.use("/:organizationId/services", serviceRoutes);
router.use("/:organizationId/incidents", incidentRoutes);

// Member management (ADMIN only)
router.post(
    "/:organizationId/members",
    authenticate,
    requireOrgMember(),
    requireRole("ADMIN"),
    validate(addMemberSchema),
    orgController.addMember
);

router.patch(
    "/:organizationId/members/:memberId",
    authenticate,
    requireOrgMember(),
    requireRole("ADMIN"),
    validate(updateMemberRoleSchema),
    orgController.updateMemberRole
);

router.delete(
    "/:organizationId/members/:memberId",
    authenticate,
    requireOrgMember(),
    requireRole("ADMIN"),
    orgController.removeMember
);

export default router;
