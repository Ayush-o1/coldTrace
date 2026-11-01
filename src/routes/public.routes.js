import { Router } from "express";
import * as healthController from "../controllers/health.controller.js";

const router = Router();

// Public status page endpoint: unauthenticated and safe from internal data exposure
router.get("/status/:orgSlug", healthController.getPublicStatus);

export default router;

