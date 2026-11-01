import { Router } from "express";
import * as serviceController from "../controllers/service.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireOrgMember, requireRole } from "../middleware/rbac.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
    createServiceSchema,
    updateServiceSchema
} from "../validators/service.validator.js";

const router = Router({ mergeParams: true });

// All service routes require user authentication and membership in the target organization
router.use(authenticate, requireOrgMember("organizationId"));

// Read access: all roles (ADMIN, MEMBER, VIEWER)
router.get("/", serviceController.listServices);
router.get("/:serviceId", serviceController.getService);

// Write access: ADMIN only
router.post(
    "/",
    requireRole("ADMIN"),
    validate(createServiceSchema),
    serviceController.createService
);

router.patch(
    "/:serviceId",
    requireRole("ADMIN"),
    validate(updateServiceSchema),
    serviceController.updateService
);

router.delete(
    "/:serviceId",
    requireRole("ADMIN"),
    serviceController.deleteService
);

export default router;

