import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app.js";

test("Tier 1 Complete End-to-End User Journey (Phase 12)", async () => {
    // 1. Register a new user
    const adminEmail = `e2e-admin-${randomUUID()}@example.com`;
    const adminPassword = "E2EAdminPassword123!";
    const adminName = "E2E Lead Engineer";

    const registerRes = await request(app)
        .post("/api/auth/register")
        .send({
            name: adminName,
            email: adminEmail,
            password: adminPassword
        });

    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.data.user.email, adminEmail.toLowerCase());
    assert.equal(registerRes.body.data.user.passwordHash, undefined);
    const adminUserId = registerRes.body.data.user.id;

    // 2. Log in
    const loginRes = await request(app)
        .post("/api/auth/login")
        .send({
            email: adminEmail,
            password: adminPassword
        });

    assert.equal(loginRes.status, 200);
    const adminToken = loginRes.body.data.accessToken;
    assert.ok(adminToken);

    // Save refresh cookie
    const cookies = loginRes.headers["set-cookie"];
    const refreshCookie = cookies.find((c) => c.startsWith("coldtrace_refresh=")).split(";")[0];

    // 3. Create an organization
    const orgSlug = `acme-cloud-${randomUUID().slice(0, 8)}`;
    const orgRes = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            name: "Acme Cloud Services",
            slug: orgSlug
        });

    assert.equal(orgRes.status, 201);
    const orgId = orgRes.body.data.organization.id;

    // 4. Verify creator automatically becomes ADMIN
    assert.equal(orgRes.body.data.organization.role, "ADMIN");

    // 5. Create services
    const authServiceRes = await request(app)
        .post(`/api/organizations/${orgId}/services`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Identity Service" });
    assert.equal(authServiceRes.status, 201);
    const authServiceId = authServiceRes.body.data.service.id;

    const billingServiceRes = await request(app)
        .post(`/api/organizations/${orgId}/services`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Billing Engine" });
    assert.equal(billingServiceRes.status, 201);
    const billingServiceId = billingServiceRes.body.data.service.id;

    // 6. Register a second user and add them as MEMBER
    const memberEmail = `e2e-member-${randomUUID()}@example.com`;
    const memberPassword = "E2EMemberPassword123!";
    const memberName = "E2E Incident Responder";

    const memberRegRes = await request(app)
        .post("/api/auth/register")
        .send({
            name: memberName,
            email: memberEmail,
            password: memberPassword
        });
    const memberUserId = memberRegRes.body.data.user.id;

    const memberLoginRes = await request(app)
        .post("/api/auth/login")
        .send({
            email: memberEmail,
            password: memberPassword
        });
    const memberToken = memberLoginRes.body.data.accessToken;

    const addMemberRes = await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            email: memberEmail,
            role: "MEMBER"
        });

    assert.equal(addMemberRes.status, 201);
    assert.equal(addMemberRes.body.data.member.role, "MEMBER");

    // 7. Verify role permissions (MEMBER cannot add other members)
    const unauthorizedAdd = await request(app)
        .post(`/api/organizations/${orgId}/members`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
            email: "someone-else@example.com",
            role: "VIEWER"
        });
    assert.equal(unauthorizedAdd.status, 403);

    // 8. Create an incident (TRIGGERED)
    const incidentRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
            title: "Billing Webhook Drop",
            description: "Upstream payment provider webhooks are returning 500.",
            severity: "CRITICAL",
            assignedToId: memberUserId,
            serviceIds: [billingServiceId]
        });

    assert.equal(incidentRes.status, 201);
    const incidentId = incidentRes.body.data.incident.id;
    assert.equal(incidentRes.body.data.incident.status, "TRIGGERED");
    assert.equal(incidentRes.body.data.incident.severity, "CRITICAL");

    // 9. Verify incident is associated with Billing Engine
    assert.equal(incidentRes.body.data.incident.services[0].id, billingServiceId);

    // 10. Verify incident is assigned to member
    assert.equal(incidentRes.body.data.incident.assignedTo.id, memberUserId);

    // 11. Acknowledge the incident
    const ackRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents/${incidentId}/acknowledge`)
        .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(ackRes.status, 200);
    assert.equal(ackRes.body.data.incident.status, "ACKNOWLEDGED");

    // 12. Resolve the incident
    const resolveRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents/${incidentId}/resolve`)
        .set("Authorization", `Bearer ${memberToken}`);
    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.data.incident.status, "RESOLVED");

    // 13. Close the incident
    const closeRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents/${incidentId}/close`)
        .set("Authorization", `Bearer ${adminToken}`);
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.body.data.incident.status, "CLOSED");

    // 14. Add INTERNAL and PUBLIC updates
    const internalUpdateRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
        .set("Authorization", `Bearer ${memberToken}`)
        .send({
            message: "Root cause: Expired TLS certificate on ingress proxy.",
            visibility: "INTERNAL"
        });
    assert.equal(internalUpdateRes.status, 201);

    const publicUpdateRes = await request(app)
        .post(`/api/organizations/${orgId}/incidents/${incidentId}/updates`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
            message: "All payment webhook delivery has been fully restored.",
            visibility: "PUBLIC"
        });
    assert.equal(publicUpdateRes.status, 201);

    // 15. Verify audit timeline captures events in chronological order
    const timelineRes = await request(app)
        .get(`/api/organizations/${orgId}/incidents/${incidentId}/timeline`)
        .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(timelineRes.status, 200);
    const actions = timelineRes.body.data.timeline.map((t) => t.action);
    assert.ok(actions.includes("INCIDENT_CREATED"));
    assert.ok(actions.includes("INCIDENT_STATUS_CHANGED"));
    assert.ok(actions.includes("INCIDENT_UPDATE_POSTED"));

    // 16. Verify automatic service-health changes
    // Because incident is CLOSED, health should be OPERATIONAL
    const healthRes = await request(app)
        .get(`/api/organizations/${orgId}/health`)
        .set("Authorization", `Bearer ${adminToken}`);

    assert.equal(healthRes.status, 200);
    assert.equal(healthRes.body.data.overallStatus, "OPERATIONAL");

    // 17. Open public status page without authentication
    const publicStatusRes = await request(app).get(`/api/public/status/${orgSlug}`);
    assert.equal(publicStatusRes.status, 200);
    assert.equal(publicStatusRes.body.data.organization.name, "Acme Cloud Services");
    assert.equal(publicStatusRes.body.data.overallStatus, "OPERATIONAL");

    // 18. Verify public endpoint exposes only approved information
    const responseText = JSON.stringify(publicStatusRes.body);
    assert.equal(responseText.includes("Expired TLS certificate"), false, "Internal update must not leak");
    assert.equal(responseText.includes(adminEmail), false, "User emails must not leak");
    assert.equal(responseText.includes(memberEmail), false, "User emails must not leak");
    assert.equal(responseText.includes("passwordHash"), false, "Password hash must not leak");

    // 19. Log out and verify token revocation
    const logoutRes = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", refreshCookie);
    assert.equal(logoutRes.status, 200);

    const refreshAttempt = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", refreshCookie);
    assert.equal(refreshAttempt.status, 401);
});
