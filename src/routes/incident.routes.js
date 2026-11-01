import { Router } from "express";
import * as incidentController from "../controllers/incident.controller.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { requireOrgMember, requireRole } from "../middleware/rbac.middleware.js";
import { validate } from "../middleware/validate.middleware.js";
import {
    createIncidentSchema,
    updateIncidentSchema,
    transitionStatusSchema,
    listIncidentsQuerySchema
} from "../validators/incident.validator.js";

const router = Router({ mergeParams: true });

// All incident routes require authentication and organization membership
router.use(authenticate, requireOrgMember("organizationId"));

// Read access: ADMIN, MEMBER, VIEWER
router.get("/", validate(listIncidentsQuerySchema, "query"), incidentController.listIncidents);
router.get("/:incidentId", incidentController.getIncident);

// Write access: ADMIN and MEMBER
router.post(
    "/",
    requireRole("ADMIN", "MEMBER"),
    validate(createIncidentSchema),
    incidentController.createIncident
);

router.patch(
    "/:incidentId",
    requireRole("ADMIN", "MEMBER"),
    validate(updateIncidentSchema),
    incidentController.updateIncident
);

// Lifecycle transition endpoints
router.patch(
    "/:incidentId/status",
    requireRole("ADMIN", "MEMBER"),
    validate(transitionStatusSchema),
    incidentController.transitionStatus
);

router.post(
    "/:incidentId/acknowledge",
    requireRole("ADMIN", "MEMBER"),
    incidentController.acknowledgeIncident
);

router.post(
    "/:incidentId/resolve",
    requireRole("ADMIN", "MEMBER"),
    incidentController.resolveIncident
);

router.post(
    "/:incidentId/close",
    requireRole("ADMIN", "MEMBER"),
    incidentController.closeIncident
);

export default router;
