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

test("Automatic Service Health & Public Status Page (Phase 10)", async (t) => {
    const adminUser = await createAuthenticatedUser("admin");
    const outsiderUser = await createAuthenticatedUser("outsider");

    const orgSlug = `status-org-${randomUUID().slice(0, 8)}`;
    const orgRes = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
            name: "Status Page Corporation",
            slug: orgSlug
        });
    const orgId = orgRes.body.data.organization.id;

    // Create 2 services: Auth Service and Payment Service
    const authServiceRes = await request(app)
        .post(`/api/organizations/${orgId}/services`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ name: "Authentication API" });
    const authServiceId = authServiceRes.body.data.service.id;

    const paymentServiceRes = await request(app)
        .post(`/api/organizations/${orgId}/services`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({ name: "Payment Processor" });
    const paymentServiceId = paymentServiceRes.body.data.service.id;

    let incidentId = "";

    await t.test("Initial Health: Services without active incidents are OPERATIONAL", async () => {
        const response = await request(app)
            .get(`/api/organizations/${orgId}/health`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(response.status, 200);
        assert.equal(response.body.data.overallStatus, "OPERATIONAL");

        const auth = response.body.data.services.find((s) => s.id === authServiceId);
        assert.equal(auth.healthStatus, "OPERATIONAL");

        const payment = response.body.data.services.find((s) => s.id === paymentServiceId);
        assert.equal(payment.healthStatus, "OPERATIONAL");
    });

    await t.test("Active LOW/MEDIUM incident degrades service to DEGRADED", async () => {
        const incRes = await request(app)
            .post(`/api/organizations/${orgId}/incidents`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                title: "Intermittent Card Timeouts",
                description: "Occasional timeouts when tokenizing payment methods.",
                severity: "MEDIUM",
                serviceIds: [paymentServiceId]
            });
        incidentId = incRes.body.data.incident.id;

        const healthRes = await request(app)
            .get(`/api/organizations/${orgId}/health`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(healthRes.body.data.overallStatus, "DEGRADED");
        const payment = healthRes.body.data.services.find((s) => s.id === paymentServiceId);
        assert.equal(payment.healthStatus, "DEGRADED");
    });

    await t.test("Active HIGH/CRITICAL incident causes MAJOR_OUTAGE", async () => {
        // Upgrade severity to CRITICAL
        await request(app)
            .patch(`/api/organizations/${orgId}/incidents/${incidentId}`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({ severity: "CRITICAL" });

        const healthRes = await request(app)
            .get(`/api/organizations/${orgId}/health`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(healthRes.body.data.overallStatus, "MAJOR_OUTAGE");
        const payment = healthRes.body.data.services.find((s) => s.id === paymentServiceId);
        assert.equal(payment.healthStatus, "MAJOR_OUTAGE");
    });

    await t.test("Public Status Page: Unauthenticated access succeeds and returns derived health", async () => {
        // Post one INTERNAL update and one PUBLIC update
        await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                message: "Internal: Eng team restarted worker pool 4.",
                visibility: "INTERNAL"
            });

        await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                message: "Public: We are actively mitigating transaction processing delays.",
                visibility: "PUBLIC"
            });

        // Request WITHOUT Authorization header
        const publicRes = await request(app)
            .get(`/api/public/status/${orgSlug}`);

        assert.equal(publicRes.status, 200);
        assert.equal(publicRes.body.status, "success");
        assert.equal(publicRes.body.data.organization.name, "Status Page Corporation");
        assert.equal(publicRes.body.data.overallStatus, "MAJOR_OUTAGE");
        assert.equal(publicRes.body.data.services.length, 2);

        // Security assertion: Private information must NOT leak
        const publicIncidents = publicRes.body.data.incidents;
        assert.equal(publicIncidents.length, 1);
        const inc = publicIncidents[0];

        // Only the PUBLIC update must be present
        assert.equal(inc.updates.length, 1);
        assert.equal(inc.updates[0].message, "Public: We are actively mitigating transaction processing delays.");

        // Confirm absence of internal fields
        const stringified = JSON.stringify(publicRes.body);
        assert.equal(stringified.includes("Internal: Eng team"), false, "Internal updates must not leak");
        assert.equal(stringified.includes(adminUser.email), false, "User emails must not leak");
        assert.equal(stringified.includes("passwordHash"), false, "Password hashes must never leak");
    });

    await t.test("Resolving incident restores service to OPERATIONAL", async () => {
        // Lifecycle: Acknowledge -> Resolve
        await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/acknowledge`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        await request(app)
            .post(`/api/organizations/${orgId}/incidents/${incidentId}/resolve`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        // Active incidents calculation excludes RESOLVED incidents
        const healthRes = await request(app)
            .get(`/api/organizations/${orgId}/health`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(healthRes.body.data.overallStatus, "OPERATIONAL");
        const payment = healthRes.body.data.services.find((s) => s.id === paymentServiceId);
        assert.equal(payment.healthStatus, "OPERATIONAL");

        // Public status page also reflects OPERATIONAL
        const publicRes = await request(app).get(`/api/public/status/${orgSlug}`);
        assert.equal(publicRes.body.data.overallStatus, "OPERATIONAL");
        assert.equal(publicRes.body.data.incidents.length, 0, "Resolved incidents are inactive on status page");
    });

    await t.test("Public Status Page returns 404 for unknown slug", async () => {
        const response = await request(app).get("/api/public/status/unknown-slug-xyz");
        assert.equal(response.status, 404);
        assert.match(response.body.message, /not found/i);
    });
});

