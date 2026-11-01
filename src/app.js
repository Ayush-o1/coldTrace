import express from "express";
import cookieParser from "cookie-parser";
import healthRoutes from "./routes/health.routes.js";
import authRoutes from "./routes/auth.routes.js";
import organizationRoutes from "./routes/organization.routes.js";

import { notFound } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

const app = express();

// Parse incoming JSON request bodies and cookies.
app.use(express.json());
app.use(cookieParser());

// Register API routes.
app.use("/api", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/organizations", organizationRoutes);

// Handle requests that don't match any route.
app.use(notFound);

// Centralized error handling must come last.
app.use(errorHandler);

export default app;