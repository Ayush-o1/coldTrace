
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

import app from "../src/app.js";
import { errorHandler } from "../src/middleware/error.middleware.js";

// Verify the API health endpoint.
test("GET /api/health returns 200", async () => {
    const response = await request(app).get("/api/health");

    assert.equal(response.status, 200);

    assert.deepEqual(response.body, {
        status: "ok",
        message: "coldTrace API is running"
    });
});

// Verify that unknown routes return 404.
test("Unknown routes return 404", async () => {
    const response = await request(app).get("/api/unknown");

    assert.equal(response.status, 404);
    assert.equal(response.body.status, "error");
});

// Verify that internal errors don't expose sensitive details.
test("Unexpected errors return a generic 500 response", async () => {
    const testApp = express();

    testApp.get("/fail", () => {
        throw new Error("Sensitive internal information");
    });

    // Register the centralized error handler.
    testApp.use(errorHandler);

    const response = await request(testApp).get("/fail");

    assert.equal(response.status, 500);

    assert.deepEqual(response.body, {
        status: "error",
        message: "Internal server error"
    });
});
