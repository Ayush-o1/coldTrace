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

test("Incident Updates & Audit Timeline (Phase 9)", async (t) => {
    const adminUser = await createAuthenticatedUser("admin");
    const memberUser = await createAuthenticatedUser("member");
    const viewerUser = await createAuthenticatedUser("viewer");
    const outsiderUser = await createAuthenticatedUser("outsider");

    // Create organization
    const orgRes = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ name: `Audit Org ${randomUUID().slice(0, 6)}` });
    const orgId = orgRes.body.data.organization.id;

    // Add memberUser (MEMBER) and viewerUser (VIEWER)
    await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ email: memberUser.email, role: "MEMBER" });

    await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ email: viewerUser.email, role: "VIEWER" });

    // Create incident
    const incRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
            title: "API Gateway 502 Outage",
            description: "Upstream connection timeouts on edge router.",
            severity: "CRITICAL"
        });
    const incidentId = incRes.body.data.incident.id;

    await t.test("POST /updates adds INTERNAL update", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${memberUser.token}`)
            .send({
                message: "Investigating upstream container health.",
                visibility: "INTERNAL"
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.update.visibility, "INTERNAL");
        assert.equal(response.body.data.update.author.id, memberUser.id);
        assert.equal(response.body.data.update.message, "Investigating upstream container health.");
    });

    await t.test("POST /updates adds PUBLIC update", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                message: "We are actively investigating an issue affecting API response times.",
                visibility: "PUBLIC"
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.data.update.visibility, "PUBLIC");
    });

    await t.test("RBAC: VIEWER cannot post updates (403)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${viewerUser.token}`)
            .send({
                message: "Viewer attempt to post update",
                visibility: "INTERNAL"
            });

        assert.equal(response.status, 403);
    });

    await t.test("GET /updates lists all updates chronologically", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${viewerUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.updates.length, 2);
    });

    await t.test("GET /updates?visibility=PUBLIC filters for public updates only", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}/updates?visibility=PUBLIC`)
            .set("Authorization", `Bearer ${viewerUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.updates.length, 1);
        assert.equal(response.body.data.updates[0].visibility, "PUBLIC");
    });

    await t.test("GET /timeline returns chronological incident audit events", async () => {
        // Transition status to generate another audit log
        await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/acknowledge`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        const response = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}/timeline`)
            .set("Authorization", `Bearer ${viewerUser.token}`);

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.body.data.timeline));

        const actions = response.body.data.timeline.map((e) => e.action);
        assert.ok(actions.includes("INCIDENT_CREATED"));
        assert.ok(actions.includes("INCIDENT_UPDATE_POSTED"));
        assert.ok(actions.includes("INCIDENT_STATUS_CHANGED"));
    });

    await t.test("GET /audit-logs returns organization-level audit log history", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/audit-logs?limit=5`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.body.data.auditLogs));
        assert.ok(response.body.data.pagination);
        assert.ok(response.body.data.auditLogs.length > 0);
    });

    await t.test("Multi-tenancy: Outsider cannot view incident updates or audit logs (403)", async () => {
        const updatesRes = await request(app)
            .get(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${outsiderUser.token}`);
        assert.equal(updatesRes.status, 403);

        const logsRes = await request(app)
            .get(`/api/organizations/${orgId}/audit-logs`)
            .set("Authorization", `Bearer ${outsiderUser.token}`);
        assert.equal(logsRes.status, 403);
    });
});
