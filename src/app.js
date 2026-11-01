import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";
import publicRoutes from "./routes/public.routes.js";

import { notFound } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");

/**
 * coldTrace Express Application Setup
 *
 * Architectural Note:
 * app.js and server.js are intentionally separated.
 * - app.js configures middleware, static files, and routes, and exports the Express app instance.
 * - server.js imports app and calls app.listen() to bind to a TCP port.
 *
 * This separation allows automated test suites (via Supertest) to import app.js directly and execute
 * fast in-memory HTTP simulations without binding to a physical network port or causing port collisions.
 */
const app = express();

// Parse incoming JSON request bodies and cookies.
app.use(express.json());
app.use(cookieParser());

// Serve static frontend assets
app.use(express.static(publicDir));

// Public status page direct path
app.get("/status/:slug", (req, res) => {
    res.sendFile(path.join(publicDir, "status.html"));
});

// Register API routes.
app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/public", publicRoutes);

// Handle requests that don't match any route.
app.use(notFound);

// Centralized error handling must come last.
app.use(errorHandler);

export default app;