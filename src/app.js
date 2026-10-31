import express from "express";
import healthRoutes from "./routes/health.routes.js";

import { notFound } from "./middleware/not-found.middleware.js";
import { errorHandler } from "./middleware/error.middleware.js";

const app = express();

// Parse incoming JSON request bodies.
app.use(express.json());

// Register API routes.
app.use("/api", healthRoutes);

// Handle requests that don't match any route.
app.use(notFound);

// Centralized error handling must come last.
app.use(errorHandler);

export default app;