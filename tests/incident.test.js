import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";

async function createAuthenticatedUser(prefix = "user") {
    const email = `${prefix}-${randomUUID()}@example.com`;
    const password = "SecurePassword123!";
    const name = `${prefix} User`;

    await request(app)
        .post("/api/auth/register")
        .send({ name, email, password });

    const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email, password });

    return {
        id: loginRes.body.data.user.id,
        email,
        token: loginRes.body.data.accessToken
    };
}

test("Incident Management & Lifecycle State Machine (Phases 7 & 8)", async (t) => {
    const adminUser = await createAuthenticatedUser("admin");
    const memberUser = await createAuthenticatedUser("member");
    const viewerUser = await createAuthenticatedUser("viewer");
    const outsiderUser = await createAuthenticatedUser("outsider");

    // Create Org A
    const orgRes = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ name: `Incident Org ${randomUUID().slice(0, 6)}` });
    const orgId = orgRes.body.data.organization.id;

    // Create Org B (for multi-tenancy tests)
    const orgBRes = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${outsiderUser.token}`)
        .send({ name: `Other Org ${randomUUID().slice(0, 6)}` });
    const orgBId = orgBRes.body.data.organization.id;

    // Add memberUser as MEMBER in Org A
    await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ email: memberUser.email, role: "MEMBER" });

    // Add viewerUser as VIEWER in Org A
    await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ email: viewerUser.email, role: "VIEWER" });

    // Create service in Org A
    const serviceRes = await request(app)
        .post(`/api/organizations/${orgId}/services`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ name: "Checkout Service" });
    const serviceId = serviceRes.body.data.service.id;

    // Create service in Org B
    const serviceBRes = await request(app)
        .post(`/api/organizations/${orgBId}/services`)
        .set("Authorization", `Bearer ${outsiderUser.token}`)
        .send({ name: "External Service" });
    const serviceBId = serviceBRes.body.data.service.id;

    let incidentId = "";

    await t.test("POST /incidents creates incident with TRIGGERED status", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                title: "Checkout 500 Spike",
                description: "Sudden spike in HTTP 500 error responses during checkout flow.",
                severity: "HIGH",
                assignedToId: memberUser.id,
                serviceIds: [serviceId]
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.incident.title, "Checkout 500 Spike");
        assert.equal(response.body.data.incident.status, "TRIGGERED");
        assert.equal(response.body.data.incident.severity, "HIGH");
        assert.equal(response.body.data.incident.assignedTo.id, memberUser.id);
        assert.equal(response.body.data.incident.services.length, 1);
        assert.equal(response.body.data.incident.services[0].id, serviceId);

        incidentId = response.body.data.incident.id;
    });

    await t.test("POST /incidents rejects assignee who is not an org member (400)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                title: "Database Latency",
                description: "Latency exceeding 500ms on primary replica.",
                severity: "MEDIUM",
                assignedToId: outsiderUser.id // Not a member of Org A
            });

        assert.equal(response.status, 400);
        assert.match(response.body.message, /must be an active member/i);
    });

    await t.test("POST /incidents rejects services belonging to another org (400)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                title: "External Auth Failure",
                description: "Failed requests to auth endpoint.",
                severity: "LOW",
                serviceIds: [serviceBId] // Service belongs to Org B
            });

        assert.equal(response.status, 400);
        assert.match(response.body.message, /do not belong to this organization/i);
    });

    await t.test("RBAC: VIEWER cannot create incidents (403)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents`)
            .set("Authorization", `Bearer ${viewerUser.token}`)
            .send({
                title: "Viewer Attempt",
                description: "Viewer trying to create incident",
                severity: "LOW"
            });

        assert.equal(response.status, 403);
    });

    await t.test("GET /incidents supports pagination and filtering", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents?status=TRIGGERED&limit=10`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.status, "success");
        assert.ok(Array.isArray(response.body.data.incidents));
        assert.ok(response.body.data.pagination);
        assert.equal(response.body.data.pagination.page, 1);
        assert.equal(response.body.data.pagination.limit, 10);
        assert.ok(response.body.data.pagination.total >= 1);
    });

    await t.test("GET /incidents/:id returns single incident details", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}`)
            .set("Authorization", `Bearer ${viewerUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.incident.id, incidentId);
    });

    await t.test("State Machine: Invalid transition TRIGGERED -> CLOSED is rejected (400)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/close`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 400);
        assert.match(response.body.message, /invalid state transition/i);
    });

    await t.test("State Machine: Valid transition TRIGGERED -> ACKNOWLEDGED succeeds", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/acknowledge`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.incident.status, "ACKNOWLEDGED");
    });

    await t.test("State Machine: Invalid transition ACKNOWLEDGED -> CLOSED is rejected (400)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/close`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 400);
        assert.match(response.body.message, /invalid state transition/i);
    });

    await t.test("State Machine: Valid transition ACKNOWLEDGED -> RESOLVED succeeds", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/resolve`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.incident.status, "RESOLVED");
    });

    await t.test("State Machine: Valid transition RESOLVED -> CLOSED succeeds", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/close`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.incident.status, "CLOSED");
    });

    await t.test("State Machine: Transitioning CLOSED incident to anything fails (400)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/acknowledge`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(response.status, 400);
        assert.match(response.body.message, /invalid state transition/i);
    });

    await t.test("Multi-tenancy: Outsider cannot access Org A incident (403)", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}`)
            .set("Authorization", `Bearer ${outsiderUser.token}`);

        assert.equal(response.status, 403);
    });
});

