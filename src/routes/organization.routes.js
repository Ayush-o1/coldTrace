import { Router } from "express";
import * as orgController from "../controllers/organization.controller.js";
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
