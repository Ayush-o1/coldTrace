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

async function createOrgForUser(user, orgName = "Org") {
    const res = await request(app)
        .post("/api/organizations")
        .set("Authorization", `Bearer ${user.token}`)
        .send({
            name: `${orgName} ${randomUUID().slice(0, 6)}`
        });
    return res.body.data.organization;
}

test("Service Management (Phase 6)", async (t) => {
    const adminUser = await createAuthenticatedUser("admin");
    const memberUser = await createAuthenticatedUser("member");
    const otherOrgAdmin = await createAuthenticatedUser("otheradmin");

    const org1 = await createOrgForUser(adminUser, "Alpha Org");
    const org2 = await createOrgForUser(otherOrgAdmin, "Beta Org");

    // Add memberUser to org1 as MEMBER
    await request(app)
        .post(`/api/organizations/${org1.id}/members`)
        .set("Authorization", `Bearer ${adminUser.token}`)
        .send({
            email: memberUser.email,
            role: "MEMBER"
        });

    let serviceId = "";
    const sharedSlug = "payment-gateway";

    await t.test("POST /services creates service for ADMIN", async () => {
        const response = await request(app)
            .post(`/api/organizations/${org1.id}/services`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                name: "Payment Gateway",
                slug: sharedSlug
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.status, "success");
        assert.equal(response.body.data.service.name, "Payment Gateway");
        assert.equal(response.body.data.service.slug, sharedSlug);
        assert.equal(response.body.data.service.isArchived, false);
        assert.ok(response.body.data.service.id);

        serviceId = response.body.data.service.id;
    });

    await t.test("POST /services rejects duplicate slug within same organization (409)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${org1.id}/services`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                name: "Another Payment Gateway",
                slug: sharedSlug
            });

        assert.equal(response.status, 409);
        assert.match(response.body.message, /already exists in this organization/i);
    });

    await t.test("POST /services allows same slug in a DIFFERENT organization", async () => {
        const response = await request(app)
            .post(`/api/organizations/${org2.id}/services`)
            .set("Authorization", `Bearer ${otherOrgAdmin.token}`)
            .send({
                name: "Org 2 Payment Gateway",
                slug: sharedSlug
            });

        assert.equal(response.status, 201);
        assert.equal(response.body.data.service.slug, sharedSlug);
    });

    await t.test("RBAC: MEMBER cannot create services (403)", async () => {
        const response = await request(app)
            .post(`/api/organizations/${org1.id}/services`)
            .set("Authorization", `Bearer ${memberUser.token}`)
            .send({
                name: "Auth Service"
            });

        assert.equal(response.status, 403);
        assert.match(response.body.message, /requires one of \[ADMIN\]/i);
    });

    await t.test("GET /services lists active services for all members", async () => {
        const response = await request(app)
            .get(`/api/organizations/${org1.id}/services`)
            .set("Authorization", `Bearer ${memberUser.token}`);

        assert.equal(response.status, 200);
        assert.ok(Array.isArray(response.body.data.services));
        assert.equal(response.body.data.services.length, 1);
        assert.equal(response.body.data.services[0].id, serviceId);
    });

    await t.test("PATCH /services/:id updates service details", async () => {
        const response = await request(app)
            .patch(`/api/organizations/${org1.id}/services/${serviceId}`)
            .set("Authorization", `Bearer ${adminUser.token}`)
            .send({
                name: "Core Payment Gateway"
            });

        assert.equal(response.status, 200);
        assert.equal(response.body.data.service.name, "Core Payment Gateway");
    });

    await t.test("DELETE /services/:id archives service and hides from default list", async () => {
        const deleteRes = await request(app)
            .delete(`/api/organizations/${org1.id}/services/${serviceId}`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(deleteRes.status, 200);

        // Default list excludes archived services
        const listRes = await request(app)
            .get(`/api/organizations/${org1.id}/services`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(listRes.body.data.services.length, 0);

        // includeArchived=true returns archived service
        const archivedListRes = await request(app)
            .get(`/api/organizations/${org1.id}/services?includeArchived=true`)
            .set("Authorization", `Bearer ${adminUser.token}`);

        assert.equal(archivedListRes.body.data.services.length, 1);
        assert.equal(archivedListRes.body.data.services[0].isArchived, true);
    });

    await t.test("Cross-organization isolation: Org 2 cannot read Org 1 service (403)", async () => {
        const response = await request(app)
            .get(`/api/organizations/${org1.id}/services/${serviceId}`)
            .set("Authorization", `Bearer ${otherOrgAdmin.token}`);

        assert.equal(response.status, 403);
    });
});

